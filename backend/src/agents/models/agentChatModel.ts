/**
 * AGT-03 — the reasoning model client.
 *
 * This is the **only** file in `src/agents/` that imports a provider SDK, and
 * that is a deliberate, documented exception rather than an oversight. Master
 * plan §13.4: "MyRA will use LangGraph for control and **provider model clients
 * inside nodes**." The rule the module barrel states — never a provider SDK —
 * is about *connector* SDKs and credential stores: `googleapis`,
 * `credentialRepository`, `service/oauth`. Those hold a user's OAuth tokens and
 * are what `CREDENTIAL_SPECIFIER_PATTERNS` in the FND-07 architecture test
 * actually enforces. This key is the process's own, grants access to no user
 * data, and revoking it stops the system rather than exposing anyone.
 *
 * Two deliberate differences from `src/RAG/query/llmService.js`:
 *
 *   `maxRetries: 0`. The SDK's own retry is invisible to us, and AGT-03 counts
 *   attempts — one initial call and one correction. Letting the client retry
 *   underneath would make that bound a lie and the recorded `retries` wrong.
 *
 *   Configuration comes from `config.agents.models`, not the V1
 *   `ANTHROPIC_CHAT_MODEL` / `OPENAI_CHAT_MODEL` variables, so the agent
 *   runtime's model choice is pinned and log-visible independently of the RAG
 *   path's.
 *
 * API keys are read from `process.env` exactly as the V1 client does; they are
 * not in `runtimeConfig` today and moving them there is a config-package
 * change, not this one. `apiKey` is injectable so tests never touch the
 * environment.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  getRuntimeConfig,
  type AgentModelProvider,
  type RuntimeConfig,
} from "../../config/runtimeConfig.js";

export type ModelTier = "cheap" | "mid" | "strong";

export interface CreateAgentChatModelOptions {
  tier: ModelTier;
  /** Routing is a classification task: deterministic by default. */
  temperature?: number;
  maxTokens: number;
  timeoutMs?: number;
  apiKey?: string;
  config?: RuntimeConfig;
}

export interface AgentModelSelection {
  provider: AgentModelProvider;
  model: string;
}

export class MissingModelApiKeyError extends Error {
  constructor(provider: AgentModelProvider) {
    // Names the variable, never a value.
    super(
      `No API key configured for the ${provider} agent model; set ${
        provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
      }`,
    );
    this.name = "MissingModelApiKeyError";
  }
}

export function resolveAgentModel(
  tier: ModelTier,
  config: RuntimeConfig = getRuntimeConfig(),
): AgentModelSelection {
  return { provider: config.agents.models.provider, model: config.agents.models[tier] };
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createAgentChatModel(options: CreateAgentChatModelOptions): BaseChatModel {
  const config = options.config ?? getRuntimeConfig();
  const { provider, model } = resolveAgentModel(options.tier, config);

  const apiKey = options.apiKey
    ?? (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
  if (!apiKey) throw new MissingModelApiKeyError(provider);

  const base = {
    model,
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // See the header: the one corrective retry belongs to the policy.
    maxRetries: 0,
    streaming: false,
  };

  return provider === "anthropic"
    ? new ChatAnthropic({ ...base, apiKey })
    : new ChatOpenAI({ ...base, apiKey });
}
