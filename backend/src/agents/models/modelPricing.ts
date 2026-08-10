/**
 * AGT-03 — prices for the models this runtime actually configures.
 *
 * Why this exists rather than reusing the RAG stack's table: `agents` cannot
 * import `src/RAG/**` (FND-07 gives it no `legacyAllowlist`), and more
 * importantly `getModelPricing` in `src/RAG/query/llmService.js` knows only
 * `claude-haiku-4-5*` among the Anthropic models. `claude-sonnet-5` and
 * `claude-opus-5` — the `AGENT_MODEL_MID` and `AGENT_MODEL_STRONG` defaults —
 * fall through it and log at **zero cost**. Two things break quietly as a
 * result: the user's monthly budget under-counts every agent run, and AGT-05,
 * whose acceptance criterion is to enforce a cost limit, has nothing to enforce
 * against.
 *
 * The honest cost of fixing it here: two price tables now exist and can
 * disagree for `claude-haiku-4-5-20251001`, which appears in both. A test pins
 * that shared row. Consolidation belongs to whoever refactors the RAG stack —
 * editing another package's file mid-stream is the worse trade.
 *
 * Rates are USD per million tokens.
 */

import type { AgentModelProvider } from "../../config/runtimeConfig.js";

export interface ModelPrice {
  input: number;
  output: number;
}

export const AGENT_MODEL_PRICING_USD_PER_MILLION: Readonly<
  Record<string, ModelPrice>
> = Object.freeze({
  // Anthropic. `claude-haiku-4-5-20251001` is also in llmService.js's table;
  // the values must match, and a test asserts it.
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 15, output: 75 },
  "claude-fable-5": { input: 3, output: 15 },

  // OpenAI, for deployments that switch AGENT_MODEL_PROVIDER.
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
});

/**
 * Exact match first, then a prefix match so a dated release
 * (`claude-sonnet-5-20260101`) inherits its family's price instead of silently
 * costing nothing. Returns null when nothing matches — the caller logs the
 * tokens at zero cost and warns, rather than inventing a number.
 */
export function priceFor(
  _provider: AgentModelProvider,
  model: string,
): ModelPrice | null {
  const exact = AGENT_MODEL_PRICING_USD_PER_MILLION[model];
  if (exact) return exact;

  for (const [name, price] of Object.entries(AGENT_MODEL_PRICING_USD_PER_MILLION)) {
    if (model.startsWith(name)) return price;
  }

  return null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** USD cost of one call, or null when the model has no configured price. */
export function costUsdFor(
  provider: AgentModelProvider,
  model: string,
  usage: TokenUsage,
): { inputUsd: number; outputUsd: number } | null {
  const price = priceFor(provider, model);
  if (!price) return null;

  return {
    inputUsd: (usage.inputTokens * price.input) / 1_000_000,
    outputUsd: (usage.outputTokens * price.output) / 1_000_000,
  };
}
