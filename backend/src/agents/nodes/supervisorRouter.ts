/**
 * AGT-03 — the Supervisor as a LangGraph node.
 *
 * Deliberately thin. All the judgement lives in `supervisorPolicy`, which is a
 * pure function; this reads state, builds a context, calls it, and maps the
 * outcome onto a state update. Keeping the graph-shaped part this small is what
 * makes every routing fixture a unit test with no graph.
 *
 * The node name is `route_request`, not `supervisor`. LangGraph refuses a node
 * whose name collides with a state channel, and `supervisor`, `flow`, `plan`,
 * `status`, `evidence`, and `errors` are all channels — `assertUsableNodeName`
 * (AGT-01) is called at module load so the collision surfaces here rather than
 * as a confusing "state attribute" error during graph assembly.
 */

import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { AgentStateChannels, AgentStateUpdate } from "../state/channels.js";
import { assertUsableNodeName } from "../state/channels.js";
import type { OpenQuestion } from "../state/stateSchema.js";
import type { SupportedFlow } from "../contracts/index.js";
import { createAgentChatModel, type ModelTier } from "../models/agentChatModel.js";
import { invokeStructuredTool } from "../models/structuredCall.js";
import { recordAgentModelUsage, type UsageRecorder } from "../models/usageLogging.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";
import type { BaselineComputer } from "../policies/freshnessBaseline.js";
import {
  decideSupervisorOutcome,
  outcomeToRunError,
  type ProposalRequester,
  type SupervisorOutcome,
  type SupervisorRequestContext,
} from "../policies/supervisorPolicy.js";

export const SUPERVISOR_NODE_NAME = "route_request";

// Fails at import time if a future channel ever takes this name.
assertUsableNodeName(SUPERVISOR_NODE_NAME);

/**
 * Routing is the decision every later cost depends on, and discriminating
 * `cross_source_answer` from `meeting_brief` is exactly what a cheap model gets
 * wrong. `mid` by default; overridable so QLT-* can measure rather than guess.
 */
export const DEFAULT_SUPERVISOR_TIER: ModelTier = "mid";

/** Enough for a decision with rationale; far short of anything discursive. */
const SUPERVISOR_MAX_TOKENS = 1_200;

export type SupervisorDecider = (
  context: SupervisorRequestContext,
) => Promise<SupervisorOutcome>;

export interface SupervisorNodeDependencies {
  /**
   * The whole decision, injectable. This single seam is what makes routing
   * fixtures pure unit tests: pass a scripted decider and no provider, graph,
   * or database is touched.
   */
  decide?: SupervisorDecider;
  enabledFlows?: readonly SupportedFlow[];
  computeBaseline?: BaselineComputer;
  /** Injected so `decidedAt` is deterministic in fixtures. */
  now?: () => string;
  recordUsage?: UsageRecorder;
  tier?: ModelTier;
}

export type SupervisorNode = (
  state: AgentStateChannels,
  config?: LangGraphRunnableConfig,
) => Promise<AgentStateUpdate>;

/* -------------------------------------------------------------------------- */
/* the default, model-backed decider                                           */
/* -------------------------------------------------------------------------- */

function createModelDecider(dependencies: SupervisorNodeDependencies): SupervisorDecider {
  const tier = dependencies.tier ?? DEFAULT_SUPERVISOR_TIER;

  const requestProposal: ProposalRequester = async (request) => {
    const model = createAgentChatModel({ tier, maxTokens: SUPERVISOR_MAX_TOKENS });
    return invokeStructuredTool({
      model,
      toolName: request.toolName,
      toolDescription: request.toolDescription,
      schema: request.schema,
      messages: request.messages,
      signal: request.signal,
    });
  };

  return (context) =>
    decideSupervisorOutcome(context, {
      requestProposal,
      ...(dependencies.computeBaseline ? { computeBaseline: dependencies.computeBaseline } : {}),
      ...(dependencies.enabledFlows ? { enabledFlowsForRelease: dependencies.enabledFlows } : {}),
    });
}

/* -------------------------------------------------------------------------- */
/* outcome → state update                                                      */
/* -------------------------------------------------------------------------- */

function toOpenQuestion(
  outcome: Extract<SupervisorOutcome, { kind: "routed" }>,
  askedAt: string,
): OpenQuestion | null {
  const clarification = outcome.decision.clarification;
  if (!clarification) return null;

  return {
    id: clarification.id,
    prompt: clarification.prompt,
    missingFields: [...clarification.missingFields],
    ...(clarification.options ? { options: [...clarification.options] } : {}),
    askedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* the node                                                                    */
/* -------------------------------------------------------------------------- */

export function createSupervisorNode(
  dependencies: SupervisorNodeDependencies = {},
): SupervisorNode {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const decide = dependencies.decide ?? createModelDecider(dependencies);
  const recordUsage = dependencies.recordUsage ?? recordAgentModelUsage;

  return async (state) => {
    const decidedAt = now();

    const context: SupervisorRequestContext = {
      // Every identity field is read from state and stamped onto the decision;
      // nothing the model returns can name a run or a tenant.
      runId: state.runId,
      userId: state.userId,
      conversationId: state.conversationId,
      input: state.request.input,
      timezone: state.request.timezone,
      now: decidedAt,
      cancellationRequested: state.cancellationRequested,
    };

    const outcome = await decide(context);

    if (outcome.kind === "cancelled") {
      return { status: "cancelled" };
    }

    if (outcome.kind === "refused" || outcome.kind === "failed") {
      return {
        errors: [outcomeToRunError(outcome, decidedAt)],
        status: "failed",
        budgetUsage: { steps: 1 },
      };
    }

    // Usage logging is best-effort and must never fail the decision, which is
    // why the recorder swallows its own errors rather than being awaited here
    // for correctness.
    if (outcome.usage.inputTokens > 0 || outcome.usage.outputTokens > 0) {
      const config = getRuntimeConfig();
      await recordUsage({
        conversationId: state.conversationId,
        userId: state.userId,
        provider: config.agents.models.provider,
        model: config.agents.models[dependencies.tier ?? DEFAULT_SUPERVISOR_TIER],
        usage: outcome.usage,
        invocationType: LLM_INVOCATION_TYPES.AGENT_SUPERVISOR,
      });
    }

    const budgetUsage = {
      steps: 1,
      // The corrective retry, which is exactly what AGT-05 will bound.
      retries: Math.max(0, outcome.attempts - 1),
      tokens: outcome.usage.inputTokens + outcome.usage.outputTokens,
      durationMs: outcome.durationMs,
    };

    const question = toOpenQuestion(outcome, decidedAt);

    if (question) {
      return {
        supervisor: outcome.decision,
        flow: outcome.decision.flow,
        openQuestions: [question],
        status: "waiting_for_clarification",
        budgetUsage,
      };
    }

    return {
      supervisor: outcome.decision,
      flow: outcome.decision.flow,
      status: "planning",
      budgetUsage,
    };
  };
}
