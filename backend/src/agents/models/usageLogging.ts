/**
 * AGT-03 — recording what a model call cost.
 *
 * Two currencies live here and they are not a mistake:
 *
 *   `llm_usage_logs.input_cost` / `output_cost` hold **INR**. `logLLMUsage` in
 *   the RAG stack multiplies USD rates by the live USD→INR rate before
 *   inserting, and `apiBudgetRepository` aggregates the column as `usage_inr`
 *   against `monthly_budget_inr`. Writing USD there would under-report every
 *   agent run by roughly 85× and silently break the user's budget alerts.
 *
 *   `budgetUsage.costUsd` in the agent state is **USD**, named so by AGT-01's
 *   reducer, and it is what AGT-05 will check against `maxCostUsd`.
 *
 * So the node tracks USD and this writes INR. Both are correct; if you are here
 * because one of them looks wrong, it is the pairing that is load-bearing.
 *
 * Failure policy: this never throws. A routing decision must not be lost
 * because a stats insert timed out or the FX endpoint was unreachable.
 */

import type { AIMessage } from "@langchain/core/messages";
import type { AgentModelProvider } from "../../config/runtimeConfig.js";
import { logger } from "../../utils/logger.js";
import { usdToInr } from "../../utils/exchanceRates.js";
import { StatsRepository } from "../../database/statsRepository.js";
import { costUsdFor, type TokenUsage } from "./modelPricing.js";

/**
 * `apiBudgetRepository` groups by `LOWER(provider)`, so either casing joins
 * correctly for a budget. But `statsRepository.getCostAndTokensConsumed` groups
 * by the **raw** column, so writing "anthropic" beside the existing "Anthropic"
 * would split that report into two rows for the same provider.
 */
export function canonicalProviderName(provider: AgentModelProvider): "Anthropic" | "OpenAI" {
  return provider === "anthropic" ? "Anthropic" : "OpenAI";
}

/**
 * Token counts, probing the shapes LangChain actually returns. Mirrors the
 * probe order in `llmService.js`'s `normalizeUsageData` — the providers differ
 * and change, and a single access path silently yields zero.
 */
export function extractTokenUsage(message: AIMessage | undefined): TokenUsage {
  if (!message) return { inputTokens: 0, outputTokens: 0 };

  const candidates: Array<Record<string, unknown> | undefined> = [
    message.usage_metadata as Record<string, unknown> | undefined,
    (message.response_metadata?.usage ?? undefined) as Record<string, unknown> | undefined,
    (message.response_metadata ?? undefined) as Record<string, unknown> | undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const input = candidate.input_tokens ?? candidate.prompt_tokens ?? candidate.promptTokens;
    const output = candidate.output_tokens ?? candidate.completion_tokens ?? candidate.completionTokens;
    if (typeof input === "number" || typeof output === "number") {
      return {
        inputTokens: typeof input === "number" ? input : 0,
        outputTokens: typeof output === "number" ? output : 0,
      };
    }
  }

  return { inputTokens: 0, outputTokens: 0 };
}

export interface RecordUsageInput {
  conversationId: string;
  userId: string | number;
  provider: AgentModelProvider;
  model: string;
  usage: TokenUsage;
  invocationType: string;
}

export type UsageRecorder = (input: RecordUsageInput) => Promise<void>;

/** Injectable so unit tests never touch the database or the FX endpoint. */
export interface UsageLoggingDependencies {
  insertLLMPrice?: (stats: Record<string, unknown>) => Promise<unknown>;
  fetchUsdToInr?: () => Promise<number>;
}

export function createUsageRecorder(
  dependencies: UsageLoggingDependencies = {},
): UsageRecorder {
  // Constructed lazily on first use so importing this module performs no
  // database work while the agent runtime flag is off.
  let repository: StatsRepository | undefined;
  const insert = dependencies.insertLLMPrice
    ?? ((stats: Record<string, unknown>) => {
      repository ??= new StatsRepository();
      return repository.insertLLMPrice(stats);
    });
  const fetchRate = dependencies.fetchUsdToInr ?? usdToInr;

  return async (input) => {
    try {
      if (input.usage.inputTokens === 0 && input.usage.outputTokens === 0) return;

      const usd = costUsdFor(input.provider, input.model, input.usage);
      let inputCost = 0;
      let outputCost = 0;

      if (usd) {
        const rate = await fetchRate();
        if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
          inputCost = usd.inputUsd * rate;
          outputCost = usd.outputUsd * rate;
        }
      } else {
        logger.warn("No agent model pricing configured; logging tokens at zero cost", {
          provider: input.provider,
          model: input.model,
        });
      }

      await insert({
        conversationId: input.conversationId,
        provider: canonicalProviderName(input.provider),
        model: input.model,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        inputCost,
        outputCost,
        invocationType: input.invocationType,
        userId: input.userId,
      });
    } catch (error) {
      // Never rethrow: losing a routing decision to a stats failure would be a
      // far worse outcome than an under-counted budget.
      logger.warn("Failed to record agent model usage", {
        model: input.model,
        invocationType: input.invocationType,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  };
}

/** The default recorder, used when the node is constructed without overrides. */
export const recordAgentModelUsage: UsageRecorder = createUsageRecorder();
