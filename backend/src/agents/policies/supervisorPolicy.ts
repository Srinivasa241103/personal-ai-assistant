/**
 * AGT-03 — the routing decision, as a pure value-in/value-out function.
 *
 * Zero LangGraph. This takes a request context and returns an outcome; the node
 * in `nodes/supervisorRouter.ts` is a thin adapter that maps state to context
 * and outcome to a state update. Splitting them this way is what lets every
 * routing fixture be a unit test with no graph, no checkpointer, and — through
 * the `decide` seam — no provider.
 *
 * The order of operations is the design:
 *
 *   1. Deterministic gates that can settle the request alone. A refusal or an
 *      obvious lookup never costs a model call.
 *   2. Narrow the vocabulary. `enabledFlows` is computed *before* the prompt
 *      from the user's own write intent, so a write flow the user did not ask
 *      for is not a member of the enum the model answers in.
 *   3. Call the model, at most twice: once, then once more with a correction
 *      built from the actual validation error.
 *   4. Compose the contract object from the model's narrow proposal plus fields
 *      the node stamps, and validate it three more ways.
 */

import {
  DOMAIN_CONTRACT_SCHEMA_VERSION,
  SupervisorDecisionSchema,
  type EvidenceSource,
  type FreshnessDirective,
  type SupervisorDecision,
  type SupportedFlow,
  type UserId,
} from "../contracts/index.js";
import type { AgentRunError } from "../state/stateSchema.js";
import {
  buildCorrectionMessages,
  buildSupervisorMessages,
  SUPERVISOR_PROMPT_VERSION,
  SUPERVISOR_TOOL_DESCRIPTION,
  SUPERVISOR_TOOL_NAME,
} from "../prompts/supervisorPrompt.js";
import { createFenceNonce } from "../prompts/untrustedContent.js";
import {
  buildSupervisorProposalSchema,
  type SupervisorProposal,
} from "../prompts/supervisorProposalSchema.js";
import type { StructuredToolAttempt } from "../models/structuredCall.js";
import type { TokenUsage } from "../models/modelPricing.js";
import { computeBaselineDirectives, type BaselineComputer } from "./freshnessBaseline.js";
import { classifyProhibited } from "./prohibitedRequests.js";
import { coreFlows, isWriteFlow } from "./flowSourcePolicy.js";
import { detectFastPathLookup } from "./fastPath.js";
import { deriveRequestSignals, type RequestSignals } from "./requestSignals.js";
import { detectWriteIntent, type WriteIntent } from "./writeIntent.js";
import { validateDecisionSemantics, type SemanticIssue } from "./decisionValidation.js";
import {
  SUPERVISOR_ERROR_CODES,
  toSupervisorRunError,
  type SupervisorErrorCode,
} from "./supervisorErrors.js";

/**
 * One initial call and one correction. A single constant so the bound is not
 * spread across three conditionals, and a test asserts the value.
 */
export const MAX_SUPERVISOR_ATTEMPTS = 2;

/* -------------------------------------------------------------------------- */
/* types                                                                       */
/* -------------------------------------------------------------------------- */

export interface SupervisorRequestContext {
  runId: string;
  userId: UserId;
  conversationId: string;
  input: string;
  timezone?: string | undefined;
  /** ISO instant; injected so a fixture is reproducible. */
  now: string;
  cancellationRequested: boolean;
}

export type SupervisorOutcome =
  | { kind: "cancelled" }
  | { kind: "refused"; code: SupervisorErrorCode; rule: string }
  | { kind: "failed"; code: SupervisorErrorCode; issues: string[] }
  | {
      kind: "routed";
      decision: SupervisorDecision;
      gate: "deterministic" | "model";
      usage: TokenUsage;
      attempts: number;
      durationMs: number;
    };

/** The model-facing half, injectable so tests need no provider. */
export type ProposalRequester = (request: {
  messages: ReturnType<typeof buildSupervisorMessages>;
  schema: ReturnType<typeof buildSupervisorProposalSchema>;
  toolName: string;
  toolDescription: string;
  signal?: AbortSignal | undefined;
}) => Promise<StructuredToolAttempt>;

export interface SupervisorPolicyDependencies {
  requestProposal: ProposalRequester;
  computeBaseline?: BaselineComputer;
  enabledFlowsForRelease?: readonly SupportedFlow[];
  createNonce?: () => string;
  signal?: AbortSignal | undefined;
}

/* -------------------------------------------------------------------------- */
/* corrections                                                                 */
/* -------------------------------------------------------------------------- */

type FailureClass = "no_tool_call" | "wrong_tool" | "schema_invalid" | "semantically_invalid" | "transport";

const MAX_REPORTED_ISSUES = 5;

/**
 * The correction text.
 *
 * It never echoes the value the model returned. This mirrors `toConfigIssues`
 * in `runtimeConfig.ts`, which discards `issue.received` — and here it is a
 * security property rather than tidiness: a received value can carry injected
 * text straight back into the prompt in an *unfenced* position.
 */
function buildCorrection(failure: FailureClass, issues: string[]): string {
  switch (failure) {
    case "no_tool_call":
      return `You did not call the required tool. Call ${SUPERVISOR_TOOL_NAME} exactly once with every required field.`;
    case "wrong_tool":
      return `You called a tool that does not exist. Call ${SUPERVISOR_TOOL_NAME}.`;
    case "schema_invalid":
    case "semantically_invalid":
      return [
        "Your arguments were rejected:",
        ...issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => `- ${issue}`),
      ].join("\n");
    case "transport":
      return "The previous attempt failed to reach the model.";
  }
}

/** Zod issues as `path: message`, with no received values. */
function describeSchemaIssues(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

/* -------------------------------------------------------------------------- */
/* composition                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the contract object from the model's narrow proposal.
 *
 * The five envelope fields are stamped here, never taken from the model — see
 * `supervisorProposalSchema.ts` for why. Freshness is composed the same way:
 * the deterministic baseline is stamped `origin: "computed"`, and only the
 * sources the model escalated are replaced with `origin: "escalated"`.
 */
function composeDecision(
  proposal: SupervisorProposal,
  context: SupervisorRequestContext,
  baseline: readonly FreshnessDirective[],
): SupervisorDecision {
  const bySource = new Map<string, FreshnessDirective>(
    baseline.map((directive) => [directive.source, directive]),
  );

  for (const escalation of proposal.freshnessEscalations) {
    if (!bySource.has(escalation.source)) continue;
    bySource.set(escalation.source, {
      source: escalation.source,
      mode: escalation.mode,
      reason: escalation.reason,
      origin: "escalated",
    });
  }

  return SupervisorDecisionSchema.parse({
    schemaVersion: DOMAIN_CONTRACT_SCHEMA_VERSION,
    runId: context.runId,
    userId: context.userId,
    mode: proposal.mode,
    flow: proposal.flow,
    risk: proposal.risk,
    freshness: [...bySource.values()],
    sources: proposal.sources,
    successCriteria: proposal.successCriteria,
    ...(proposal.clarification
      ? {
          clarification: {
            id: `${context.runId}-clarification-1`,
            prompt: proposal.clarification.prompt,
            missingFields: proposal.clarification.missingFields,
            ...(proposal.clarification.options ? { options: proposal.clarification.options } : {}),
          },
        }
      : {}),
    rationale: proposal.rationale,
    promptVersion: SUPERVISOR_PROMPT_VERSION,
    decidedAt: context.now,
  });
}

/** The decision a deterministic gate produces, composed through the same path. */
function composeDeterministicDecision(
  flow: SupportedFlow,
  rule: string,
  context: SupervisorRequestContext,
  signals: RequestSignals,
  computeBaseline: BaselineComputer,
): SupervisorDecision {
  // `simple_lookup` reads the index; a source the user named is carried through
  // so the trace records what they actually asked about.
  const sources: EvidenceSource[] =
    signals.namedSources.length > 0 ? [...signals.namedSources] : ["index"];

  return composeDecision(
    {
      mode: "answer",
      flow,
      risk: "low",
      sources: [...sources],
      freshnessEscalations: [],
      successCriteria: ["The indexed answer addresses the request without cross-source research."],
      rationale: { signals: [`deterministic_gate: ${rule}`], rejectedFlows: [] },
    },
    context,
    computeBaseline(flow, sources),
  );
}

/* -------------------------------------------------------------------------- */
/* the policy                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Which flows may the model choose from for *this* request?
 *
 * This is barrier 1 of the read-cannot-become-write guarantee. With no write
 * intent in the user's own words, every write flow is removed — not
 * discouraged, removed — from both the catalog and the enum the model answers
 * in. A model that names one produces a parse error, which becomes a
 * correction, which after two attempts becomes a safe failure.
 */
export function resolveEnabledFlows(
  writeIntent: WriteIntent,
  releaseFlows: readonly SupportedFlow[],
): SupportedFlow[] {
  return releaseFlows.filter((flow) => !isWriteFlow(flow) || writeIntent.hasWriteIntent);
}

export async function decideSupervisorOutcome(
  context: SupervisorRequestContext,
  dependencies: SupervisorPolicyDependencies,
): Promise<SupervisorOutcome> {
  // Gate 1 — cancellation. Costs one branch and honours §9.4 without reaching
  // into the runtime package.
  if (context.cancellationRequested) return { kind: "cancelled" };

  const computeBaseline = dependencies.computeBaseline ?? computeBaselineDirectives;
  const releaseFlows = dependencies.enabledFlowsForRelease ?? coreFlows();
  const createNonce = dependencies.createNonce ?? createFenceNonce;

  const signals = deriveRequestSignals({ input: context.input, timezone: context.timezone });
  const writeIntent = detectWriteIntent(context.input, signals);

  // Gates 2 and 3 — prohibited actions and unsupported capabilities.
  const prohibited = classifyProhibited(context.input, signals);
  if (prohibited) {
    return {
      kind: "refused",
      code:
        prohibited.kind === "unsupported_capability"
          ? SUPERVISOR_ERROR_CODES.capabilityUnsupported
          : SUPERVISOR_ERROR_CODES.requestProhibited,
      rule: prohibited.rule,
    };
  }

  // Gate 4 — the P1 tier. A request that clearly wants email composition while
  // those flows are outside the release fails as policy rather than being
  // routed somewhere approximate.
  const enabledFlows = resolveEnabledFlows(writeIntent, releaseFlows);
  if (enabledFlows.length === 0) {
    return { kind: "failed", code: SUPERVISOR_ERROR_CODES.noEnabledFlows, issues: [] };
  }

  // Gate 5 — the fast path. Read-only by construction: it can only produce
  // `simple_lookup`. No deterministic gate enters the write vertical.
  const fastPath = detectFastPathLookup(signals, writeIntent);
  if (fastPath.matched && fastPath.rule && enabledFlows.includes("simple_lookup")) {
    return {
      kind: "routed",
      gate: "deterministic",
      decision: composeDeterministicDecision(
        "simple_lookup",
        fastPath.rule,
        context,
        signals,
        computeBaseline,
      ),
      usage: { inputTokens: 0, outputTokens: 0 },
      attempts: 0,
      durationMs: 0,
    };
  }

  return runModelRouting({
    context,
    signals,
    writeIntent,
    enabledFlows,
    computeBaseline,
    createNonce,
    dependencies,
  });
}

interface ModelRoutingInput {
  context: SupervisorRequestContext;
  signals: RequestSignals;
  writeIntent: WriteIntent;
  enabledFlows: SupportedFlow[];
  computeBaseline: BaselineComputer;
  createNonce: () => string;
  dependencies: SupervisorPolicyDependencies;
}

async function runModelRouting(input: ModelRoutingInput): Promise<SupervisorOutcome> {
  const { context, signals, writeIntent, enabledFlows, computeBaseline, dependencies } = input;

  const proposalSchema = buildSupervisorProposalSchema(enabledFlows);
  const nonce = input.createNonce();

  // The baseline shown in the prompt covers every source the flows can read;
  // the per-decision baseline is recomputed once a flow and sources are chosen.
  let messages = buildSupervisorMessages({
    input: context.input,
    enabledFlows,
    signals,
    baseline: [],
    hasWriteIntent: writeIntent.hasWriteIntent,
    now: context.now,
    timezone: context.timezone,
    nonce,
  });

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let durationMs = 0;
  let attempts = 0;
  let lastFailure: FailureClass = "transport";
  let lastIssues: string[] = [];

  while (attempts < MAX_SUPERVISOR_ATTEMPTS) {
    attempts += 1;

    const attempt = await dependencies.requestProposal({
      messages,
      schema: proposalSchema,
      toolName: SUPERVISOR_TOOL_NAME,
      toolDescription: SUPERVISOR_TOOL_DESCRIPTION,
      signal: dependencies.signal,
    });

    usage.inputTokens += attempt.usage.inputTokens;
    usage.outputTokens += attempt.usage.outputTokens;
    durationMs += attempt.durationMs;

    // A transport error consumes an attempt on purpose. Without that, a model
    // that times out forever would loop forever and the bound would be a lie.
    if (attempt.outcome === "transport_error") {
      lastFailure = "transport";
      lastIssues = [];
      continue;
    }

    if (attempt.outcome === "no_tool_call" || attempt.outcome === "wrong_tool") {
      lastFailure = attempt.outcome === "no_tool_call" ? "no_tool_call" : "wrong_tool";
      lastIssues = [];
      messages = buildCorrectionMessages(
        messages,
        attempt.raw,
        buildCorrection(lastFailure, lastIssues),
        undefined,
      );
      continue;
    }

    const parsed = proposalSchema.safeParse(attempt.args);
    if (!parsed.success) {
      lastFailure = "schema_invalid";
      lastIssues = describeSchemaIssues(parsed.error);
      messages = buildCorrectionMessages(
        messages,
        attempt.raw,
        buildCorrection(lastFailure, lastIssues),
        attempt.toolCallId,
      );
      continue;
    }

    const proposal = parsed.data as SupervisorProposal;
    const issues: SemanticIssue[] = validateDecisionSemantics(proposal, {
      signals,
      writeIntent,
      computeBaseline,
    });

    if (issues.length > 0) {
      lastFailure = "semantically_invalid";
      lastIssues = issues.map((issue) => issue.message);
      messages = buildCorrectionMessages(
        messages,
        attempt.raw,
        buildCorrection(lastFailure, lastIssues),
        attempt.toolCallId,
      );
      continue;
    }

    const baseline = computeBaseline(proposal.flow as SupportedFlow, proposal.sources);

    try {
      return {
        kind: "routed",
        gate: "model",
        decision: composeDecision(proposal, context, baseline),
        usage,
        attempts,
        durationMs,
      };
    } catch (error) {
      // The composed object failed the FND-02 contract — a cross-field rule the
      // proposal schema cannot express. Treat it as a correctable failure.
      lastFailure = "semantically_invalid";
      lastIssues = [
        error instanceof Error && "issues" in error
          ? "The composed decision violated the flow contract."
          : "The composed decision violated the flow contract.",
      ];
      messages = buildCorrectionMessages(
        messages,
        attempt.raw,
        buildCorrection(lastFailure, lastIssues),
        attempt.toolCallId,
      );
    }
  }

  return {
    kind: "failed",
    code:
      lastFailure === "transport"
        ? SUPERVISOR_ERROR_CODES.modelUnavailable
        : SUPERVISOR_ERROR_CODES.outputInvalid,
    issues: lastIssues,
  };
}

/** Convenience for the node: the run error a non-routed outcome produces. */
export function outcomeToRunError(
  outcome: Extract<SupervisorOutcome, { kind: "refused" | "failed" }>,
  occurredAt: string,
): AgentRunError {
  return toSupervisorRunError(outcome.code, occurredAt);
}
