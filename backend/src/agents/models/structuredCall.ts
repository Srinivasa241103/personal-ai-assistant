/**
 * AGT-03 — a structured model call whose failures are visible.
 *
 * `withStructuredOutput` cannot be used here, and the reason is specific.
 * In `@langchain/core@1.1.48`:
 *
 *     const parserAssign = RunnablePassthrough.assign({ parsed: (input, config) => outputParser.invoke(input.raw, config) });
 *     const parserNone   = RunnablePassthrough.assign({ parsed: () => null });
 *     const parsedWithFallback = parserAssign.withFallbacks({ fallbacks: [parserNone] });
 *
 * The fallback branch takes **no argument**. A Zod violation, a missing tool
 * call, and a wrong function name all collapse into `parsed: null`, and the
 * `ZodError` is not merely swallowed — it is unreachable. `llmService`'s
 * `generateStructuredResponse` therefore returns `null` with no error, and the
 * two existing consumers survive only by dereferencing it and catching the
 * resulting `TypeError`.
 *
 * AGT-03's whole point is to retry *with a correction*, and a correction has to
 * be built from the validation error. So this binds the tool itself, forces the
 * choice, and returns the raw arguments **unparsed**. The caller parses, which
 * means the caller owns the error.
 *
 * The return is a discriminated union rather than a nullable value, so every
 * failure mode has a name and TypeScript enforces that the policy handles all
 * of them.
 */

import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";
import { extractTokenUsage } from "./usageLogging.js";
import type { TokenUsage } from "./modelPricing.js";

export interface StructuredToolRequest {
  model: BaseChatModel;
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<unknown>;
  messages: BaseMessage[];
  signal?: AbortSignal | undefined;
}

interface AttemptBase {
  usage: TokenUsage;
  durationMs: number;
}

export type StructuredToolAttempt =
  | (AttemptBase & {
      outcome: "tool_call";
      /** Deliberately unparsed — the caller validates and owns the error. */
      args: unknown;
      toolCallId: string | undefined;
      raw: AIMessage;
    })
  | (AttemptBase & { outcome: "no_tool_call"; raw: AIMessage })
  | (AttemptBase & { outcome: "wrong_tool"; calledName: string; raw: AIMessage })
  | (AttemptBase & { outcome: "transport_error"; error: Error });

const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * `bindTools` with a forced `tool_choice` is the closest thing both providers
 * offer to "you must answer in this shape". It is still only a strong request:
 * `no_tool_call` remains reachable, which is why it is a named outcome.
 */
export async function invokeStructuredTool(
  request: StructuredToolRequest,
): Promise<StructuredToolAttempt> {
  const startedAt = Date.now();

  let raw: AIMessage;
  try {
    const bound = request.model.bindTools?.(
      [
        {
          name: request.toolName,
          description: request.toolDescription,
          schema: request.schema,
        },
      ],
      { tool_choice: request.toolName },
    );

    if (!bound) {
      return {
        outcome: "transport_error",
        error: new Error("The configured chat model does not support tool binding"),
        usage: NO_USAGE,
        durationMs: Date.now() - startedAt,
      };
    }

    raw = (await bound.invoke(
      request.messages,
      request.signal ? { signal: request.signal } : undefined,
    )) as AIMessage;
  } catch (error) {
    return {
      outcome: "transport_error",
      error: error instanceof Error ? error : new Error("Unknown model transport failure"),
      usage: NO_USAGE,
      durationMs: Date.now() - startedAt,
    };
  }

  const usage = extractTokenUsage(raw);
  const durationMs = Date.now() - startedAt;
  const toolCalls = raw.tool_calls ?? [];

  if (toolCalls.length === 0) {
    return { outcome: "no_tool_call", raw, usage, durationMs };
  }

  const call = toolCalls[0];
  if (call.name !== request.toolName) {
    return { outcome: "wrong_tool", calledName: call.name, raw, usage, durationMs };
  }

  return {
    outcome: "tool_call",
    args: call.args,
    toolCallId: call.id,
    raw,
    usage,
    durationMs,
  };
}
