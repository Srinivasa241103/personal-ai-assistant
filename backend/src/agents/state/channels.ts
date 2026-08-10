/**
 * AGT-01 — the state, wired to LangGraph channels.
 *
 * `stateSchema.ts` says what a valid state is; this says how concurrent writes
 * to it are merged. Each channel names its reducer explicitly — no channel is
 * left on the default last-write-wins behaviour, because with a fan-out that
 * default silently discards the findings of every worker but one.
 *
 * One piece of LangGraph behaviour this file depends on. A channel declared
 * *without* a `default` takes its first update verbatim and only runs the
 * reducer from the second update onward (`BinaryOperatorAggregate.update`).
 * That is exactly what the identity channels need: the run's own `runId` seeds
 * the channel without tripping `replaceOnceReducer`, and every write after that
 * has to match it. Channels that start empty declare a default instead, so a
 * node never has to tell "absent" from "empty".
 */

import { Annotation } from "@langchain/langgraph";
import type {
  ActionProposal,
  ActionReceipt,
  AgentRunStatus,
  ApprovalDecision,
  MemoryCandidate,
  Plan,
  RunBudgetLimits,
  RunBudgetUsage,
  SupervisorDecision,
  SupportedFlow,
  UserId,
  VerificationResult,
} from "../contracts/index.js";
import {
  AGENT_STATE_SCHEMA_VERSION,
  type AgentRequest,
  type AgentRunError,
  type CompletedSubtask,
  type EvidenceRef,
  type OpenQuestion,
} from "./stateSchema.js";
import {
  budgetUsageReducer,
  dedupeByIdReducer,
  errorAppendReducer,
  latchReducer,
  monotonicCounterReducer,
  replaceOnceReducer,
  replaceReducer,
  statusTransitionReducer,
} from "./reducers.js";

/**
 * Per-channel entry caps.
 *
 * These are not the run budget — a run can exhaust its steps long before it
 * fills any of these. They are the backstop that keeps a single checkpoint
 * bounded when something goes wrong: a planner that emits subtasks in a loop, a
 * connector paginating without end, a retry storm. Hitting one is a bug, and it
 * surfaces as a `ChannelCapacityError` naming the channel rather than as a
 * checkpoint that grows until PostgreSQL refuses it.
 */
export const CHANNEL_CAPS = Object.freeze({
  evidence: 500,
  completedSubtasks: 200,
  openQuestions: 50,
  proposedActions: 50,
  approvals: 50,
  actionReceipts: 50,
  memoryCandidates: 200,
  errors: 50,
});

export const AgentStateAnnotation = Annotation.Root({
  schemaVersion: Annotation<typeof AGENT_STATE_SCHEMA_VERSION, typeof AGENT_STATE_SCHEMA_VERSION | undefined>({
    reducer: replaceOnceReducer("schemaVersion"),
    default: () => AGENT_STATE_SCHEMA_VERSION,
  }),

  /* identity — set once at run creation, never reassigned ------------------ */

  runId: Annotation<string, string | undefined>({
    reducer: replaceOnceReducer("runId"),
  }),
  userId: Annotation<UserId, UserId | undefined>({
    reducer: replaceOnceReducer("userId"),
  }),
  conversationId: Annotation<string, string | undefined>({
    reducer: replaceOnceReducer("conversationId"),
  }),
  request: Annotation<AgentRequest, AgentRequest | undefined>({
    reducer: replaceOnceReducer("request"),
  }),
  budgetLimits: Annotation<RunBudgetLimits, RunBudgetLimits | undefined>({
    reducer: replaceOnceReducer("budgetLimits"),
  }),

  /* single-writer scalars --------------------------------------------------- */

  supervisor: Annotation<SupervisorDecision | null, SupervisorDecision | null | undefined>({
    reducer: replaceReducer(),
    default: () => null,
  }),
  flow: Annotation<SupportedFlow | null, SupportedFlow | null | undefined>({
    reducer: replaceReducer(),
    default: () => null,
  }),
  plan: Annotation<Plan | null, Plan | null | undefined>({
    reducer: replaceReducer(),
    default: () => null,
  }),
  candidateAnswer: Annotation<string | null, string | null | undefined>({
    reducer: replaceReducer(),
    default: () => null,
  }),
  verification: Annotation<VerificationResult | null, VerificationResult | null | undefined>({
    reducer: replaceReducer(),
    default: () => null,
  }),

  /* concurrent writers ------------------------------------------------------ */

  // Keep the first sighting: whichever worker retrieved a record first owns its
  // retrievedAt and contentHash, and later records may already cite them.
  evidence: Annotation<EvidenceRef[], EvidenceRef | readonly EvidenceRef[] | undefined>({
    reducer: dedupeByIdReducer<EvidenceRef>(
      "evidence",
      (item) => item.evidenceId,
      { cap: CHANNEL_CAPS.evidence, keep: "first" },
    ),
    default: () => [],
  }),

  // Keep the last: a retried worker supersedes the attempt that failed. This is
  // also what makes a duplicated subtask completion idempotent after a resume.
  completedSubtasks: Annotation<
    CompletedSubtask[],
    CompletedSubtask | readonly CompletedSubtask[] | undefined
  >({
    reducer: dedupeByIdReducer<CompletedSubtask>(
      "completedSubtasks",
      (item) => item.subtaskId,
      { cap: CHANNEL_CAPS.completedSubtasks, keep: "last" },
    ),
    default: () => [],
  }),

  // Answering a question replaces it in place, which is why this keeps the last.
  openQuestions: Annotation<OpenQuestion[], OpenQuestion | readonly OpenQuestion[] | undefined>({
    reducer: dedupeByIdReducer<OpenQuestion>(
      "openQuestions",
      (item) => item.id,
      { cap: CHANNEL_CAPS.openQuestions, keep: "last" },
    ),
    default: () => [],
  }),

  // Proposals are keyed by proposal id, not action id: a re-proposal after the
  // user edits the arguments is a *new* proposal requiring its own approval
  // (§16.4), so it must not overwrite the one it supersedes.
  proposedActions: Annotation<
    ActionProposal[],
    ActionProposal | readonly ActionProposal[] | undefined
  >({
    reducer: dedupeByIdReducer<ActionProposal>(
      "proposedActions",
      (item) => item.id,
      { cap: CHANNEL_CAPS.proposedActions, keep: "last" },
    ),
    default: () => [],
  }),

  // Keep the first decision. One proposal gets one answer — the database says
  // so too (action_approvals_one_decision_per_proposal), and a duplicate submit
  // must be a no-op rather than a second, different verdict.
  approvals: Annotation<
    ApprovalDecision[],
    ApprovalDecision | readonly ApprovalDecision[] | undefined
  >({
    reducer: dedupeByIdReducer<ApprovalDecision>(
      "approvals",
      (item) => item.proposalId,
      { cap: CHANNEL_CAPS.approvals, keep: "first" },
    ),
    default: () => [],
  }),

  // Keep the first: a receipt records an external side effect that already
  // happened. Overwriting one would be rewriting what the provider did.
  actionReceipts: Annotation<
    ActionReceipt[],
    ActionReceipt | readonly ActionReceipt[] | undefined
  >({
    reducer: dedupeByIdReducer<ActionReceipt>(
      "actionReceipts",
      (item) => item.proposalId,
      { cap: CHANNEL_CAPS.actionReceipts, keep: "first" },
    ),
    default: () => [],
  }),

  memoryCandidates: Annotation<
    MemoryCandidate[],
    MemoryCandidate | readonly MemoryCandidate[] | undefined
  >({
    reducer: dedupeByIdReducer<MemoryCandidate>(
      "memoryCandidates",
      (item) => item.id,
      { cap: CHANNEL_CAPS.memoryCandidates, keep: "last" },
    ),
    default: () => [],
  }),

  /* loop counters and budget ------------------------------------------------ */

  replanIterations: Annotation<number, number | undefined>({
    reducer: monotonicCounterReducer("replanIterations"),
    default: () => 0,
  }),
  verificationRetries: Annotation<number, number | undefined>({
    reducer: monotonicCounterReducer("verificationRetries"),
    default: () => 0,
  }),
  evidenceIdsAtLastReplan: Annotation<string[], string[] | undefined>({
    reducer: replaceReducer(),
    default: () => [],
  }),
  budgetUsage: Annotation<RunBudgetUsage, Partial<RunBudgetUsage> | undefined>({
    reducer: budgetUsageReducer(),
    default: () => ({
      steps: 0,
      retries: 0,
      durationMs: 0,
      tokens: 0,
      costUsd: 0,
      externalActions: 0,
    }),
  }),

  /* control ----------------------------------------------------------------- */

  errors: Annotation<AgentRunError[], AgentRunError | readonly AgentRunError[] | undefined>({
    reducer: errorAppendReducer(CHANNEL_CAPS.errors),
    default: () => [],
  }),
  status: Annotation<AgentRunStatus, AgentRunStatus | undefined>({
    reducer: statusTransitionReducer(),
    default: () => "created" as AgentRunStatus,
  }),
  cancellationRequested: Annotation<boolean, boolean | undefined>({
    reducer: latchReducer(),
    default: () => false,
  }),
});

/** The state type the graph's nodes receive. */
export type AgentStateChannels = typeof AgentStateAnnotation.State;

/** The partial update a node may return. */
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;

export const AGENT_STATE_CHANNEL_NAMES: readonly string[] = Object.freeze(
  Object.keys(AgentStateAnnotation.spec),
);

export class ReservedNodeNameError extends Error {
  constructor(name: string) {
    super(
      `"${name}" is a state channel and cannot also be a node name. ` +
        `Reserved: ${AGENT_STATE_CHANNEL_NAMES.join(", ")}`,
    );
    this.name = "ReservedNodeNameError";
  }
}

/**
 * LangGraph refuses to register a node whose name collides with a channel, and
 * the names that collide are exactly the obvious ones: `plan`, `supervisor`,
 * `verification`, `evidence`, `status`, `flow`, `errors`. AGT-03 and AGT-04
 * will each want at least one of them.
 *
 * The failure without this is survivable but wasteful — `addNode` throws at
 * graph-assembly time with a message about state attributes, which reads like a
 * schema problem rather than "rename your node". Calling this first turns it
 * into one sentence naming the conflict and listing what is taken.
 */
export function assertUsableNodeName(name: string): void {
  if (AGENT_STATE_CHANNEL_NAMES.includes(name)) throw new ReservedNodeNameError(name);
}
