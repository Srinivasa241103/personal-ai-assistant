/**
 * AGT-01 — the shared graph state, as a validated schema.
 *
 * Master plan §9.1 sketches `MyraAgentState`. This is that sketch mapped onto
 * the FND-02 contracts, with one deliberate departure: the plan writes
 * `evidence: EvidenceItem[]`, and this stores `EvidenceRef[]` instead.
 *
 * Why the departure. AGT-01's own acceptance criterion is "keep large raw tool
 * results outside checkpoint state; reference stored evidence IDs". An
 * `EvidenceItem` carries `content`, which for a Drive document or an email
 * thread is unbounded. Every checkpoint write would serialize every body found
 * so far, and a checkpoint is written after every node — so a ten-source
 * research run would rewrite the same megabytes a dozen times, and a resume
 * would have to deserialize them all to make one routing decision. Bodies live
 * in `evidence_items`, keyed by the ID this state carries. `toEvidenceRef` is
 * the only conversion, and a test asserts it accepts every valid `EvidenceItem`
 * so the two shapes cannot drift.
 *
 * Everything here must survive `JSON.stringify` → `JSON.parse` unchanged: it is
 * checkpoint content. That rules out `Date`, `Map`, `Set`, `undefined`-valued
 * keys, and class instances anywhere in the tree.
 */

import { z } from "zod";
import {
  AgentCapabilitySchema,
  AgentRunStatusSchema,
  EvidenceFreshnessSchema,
  EvidenceSourceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  MemoryCandidateSchema,
  PlanSchema,
  RunBudgetLimitsSchema,
  RunBudgetUsageSchema,
  Sha256Schema,
  SupervisorDecisionSchema,
  SupportedFlowSchema,
  UserIdSchema,
  VerificationResultSchema,
  ActionProposalSchema,
  ApprovalDecisionSchema,
  ActionReceiptSchema,
  type EvidenceItem,
} from "../contracts/index.js";

/**
 * Versioned independently of the FND-01 flow contract and the FND-02 domain
 * contracts. AGT-02 pairs it with the graph version when deciding whether a
 * persisted checkpoint may resume into the current build.
 */
export const AGENT_STATE_SCHEMA_VERSION = "2.0.0" as const;

/* -------------------------------------------------------------------------- */
/* request                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately not `FlowRequestSchema`: that contract requires a `flow`, and at
 * the moment a request enters the graph no flow has been chosen. The Supervisor
 * decides that, and it decides it from this.
 */
export const AgentRequestSchema = z.object({
  requestId: IdentifierSchema,
  input: z.string().trim().min(1),
  receivedAt: IsoDateTimeSchema,
  /** IANA zone. Date reasoning without it is guesswork about "tomorrow". */
  timezone: z.string().trim().min(1).optional(),
}).strict();

/* -------------------------------------------------------------------------- */
/* evidence reference                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The projection of an `EvidenceItem` that routing actually needs: enough to
 * deduplicate, to judge freshness, to name a source, and to fetch the body.
 * No `content`, no `metadata`, no `permissionScope`.
 */
export const EvidenceRefSchema = z.object({
  evidenceId: IdentifierSchema,
  source: EvidenceSourceSchema,
  sourceRecordId: IdentifierSchema,
  freshness: EvidenceFreshnessSchema,
  contentHash: Sha256Schema,
  retrievedAt: IsoDateTimeSchema,
  occurredAt: IsoDateTimeSchema.optional(),
  title: z.string().trim().min(1).max(300).optional(),
  subtaskId: IdentifierSchema.optional(),
  toolCallId: IdentifierSchema.optional(),
}).strict();

/**
 * The single conversion from a stored evidence item to the reference the graph
 * carries. Keeping it here, beside the schema, is what makes the drift test
 * possible: any valid `EvidenceItem` must produce a valid `EvidenceRef`.
 */
export function toEvidenceRef(
  item: EvidenceItem,
  scope: { subtaskId?: string } = {},
): EvidenceRef {
  return EvidenceRefSchema.parse({
    evidenceId: item.id,
    source: item.source,
    sourceRecordId: item.sourceRecordId,
    freshness: item.freshness,
    contentHash: item.contentHash,
    retrievedAt: item.retrievedAt,
    ...(item.occurredAt ? { occurredAt: item.occurredAt } : {}),
    // Titles are source-controlled text; the reference caps them so an
    // adversarial subject line cannot inflate every future checkpoint.
    ...(item.title ? { title: item.title.slice(0, 300) } : {}),
    ...(scope.subtaskId ? { subtaskId: scope.subtaskId } : {}),
    ...(item.toolCallId ? { toolCallId: item.toolCallId } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* worker results                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What a subagent hands back. Diagram 01's hard rule: claims and citations,
 * never prose — so this records evidence IDs and named gaps, not a narrative.
 * `partial` is a first-class outcome (§5.7): a source that failed is reported,
 * not silently omitted.
 */
export const CompletedSubtaskSchema = z.object({
  subtaskId: IdentifierSchema,
  capability: AgentCapabilitySchema,
  status: z.enum(["complete", "partial", "failed"]),
  evidenceIds: z.array(IdentifierSchema).default([]),
  gaps: z.array(z.string().trim().min(1)).default([]),
  toolCallIds: z.array(IdentifierSchema).default([]),
  unavailableSources: z.array(EvidenceSourceSchema).default([]),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  attempt: z.number().int().positive(),
}).strict().superRefine((subtask, context) => {
  if (Date.parse(subtask.completedAt) < Date.parse(subtask.startedAt)) {
    context.addIssue({
      code: "custom",
      path: ["completedAt"],
      message: "completedAt cannot be before startedAt",
    });
  }
  // A partial or failed result that names no gap tells the replanner nothing,
  // and AGT-05's replan loop needs a named gap to be allowed to run at all.
  if (subtask.status !== "complete" && subtask.gaps.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["gaps"],
      message: `A ${subtask.status} subtask must name at least one gap`,
    });
  }
});

/* -------------------------------------------------------------------------- */
/* open questions and errors                                                   */
/* -------------------------------------------------------------------------- */

export const OpenQuestionSchema = z.object({
  id: IdentifierSchema,
  prompt: z.string().trim().min(1),
  missingFields: z.array(z.string().trim().min(1)).min(1),
  options: z.array(z.string().trim().min(1)).optional(),
  askedAt: IsoDateTimeSchema,
  answeredAt: IsoDateTimeSchema.optional(),
  answer: z.string().trim().min(1).optional(),
}).strict().superRefine((question, context) => {
  if (Boolean(question.answeredAt) !== Boolean(question.answer)) {
    context.addIssue({
      code: "custom",
      path: ["answer"],
      message: "An answered question needs both answer and answeredAt",
    });
  }
});

export const AgentRunErrorSchema = z.object({
  code: IdentifierSchema,
  category: z.enum([
    "tool",
    "model",
    "validation",
    "policy",
    "budget",
    "timeout",
    "cancelled",
    "internal",
  ]),
  message: z.string().trim().min(1).max(2_000),
  occurredAt: IsoDateTimeSchema,
  retryable: z.boolean(),
  subtaskId: IdentifierSchema.optional(),
  toolCallId: IdentifierSchema.optional(),
}).strict();

/* -------------------------------------------------------------------------- */
/* the state                                                                   */
/* -------------------------------------------------------------------------- */

export const MyraAgentStateSchema = z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  /** Set once at run creation and never reassigned; see `replaceOnceReducer`. */
  runId: IdentifierSchema,
  userId: UserIdSchema,
  conversationId: IdentifierSchema,
  request: AgentRequestSchema,

  supervisor: SupervisorDecisionSchema.nullable(),
  flow: SupportedFlowSchema.nullable(),
  plan: PlanSchema.nullable(),
  completedSubtasks: z.array(CompletedSubtaskSchema).default([]),

  evidence: z.array(EvidenceRefSchema).default([]),
  openQuestions: z.array(OpenQuestionSchema).default([]),

  candidateAnswer: z.string().nullable(),
  verification: VerificationResultSchema.nullable(),

  proposedActions: z.array(ActionProposalSchema).default([]),
  approvals: z.array(ApprovalDecisionSchema).default([]),
  actionReceipts: z.array(ActionReceiptSchema).default([]),
  memoryCandidates: z.array(MemoryCandidateSchema).default([]),

  /** Loop counters, separate from the budget because they bound the graph. */
  replanIterations: z.number().int().nonnegative(),
  verificationRetries: z.number().int().nonnegative(),
  /**
   * Evidence IDs known at the end of the previous replan iteration. The
   * monotonic progress check (§9.4) compares against it: an iteration that adds
   * nothing new ends the loop regardless of remaining budget.
   */
  evidenceIdsAtLastReplan: z.array(IdentifierSchema).default([]),

  budgetLimits: RunBudgetLimitsSchema,
  budgetUsage: RunBudgetUsageSchema,

  errors: z.array(AgentRunErrorSchema).default([]),
  status: AgentRunStatusSchema,
  cancellationRequested: z.boolean(),
}).strict().superRefine((state, context) => {
  // Ownership is a property of the state itself, not only of the rows it is
  // written to. Anything nested that names a run or a user must name this one —
  // otherwise a merged worker result could smuggle another tenant's evidence
  // into a checkpoint that the repository layer will happily persist.
  const scoped: Array<[string, { runId?: string; userId?: string | number }]> = [];

  if (state.supervisor) scoped.push(["supervisor", state.supervisor]);
  if (state.plan) scoped.push(["plan", state.plan]);
  if (state.verification) scoped.push(["verification", state.verification]);
  state.proposedActions.forEach((item, i) => scoped.push([`proposedActions[${i}]`, item]));
  state.approvals.forEach((item, i) => scoped.push([`approvals[${i}]`, item]));
  state.actionReceipts.forEach((item, i) => scoped.push([`actionReceipts[${i}]`, item]));
  state.memoryCandidates.forEach((item, i) => scoped.push([`memoryCandidates[${i}]`, item]));

  for (const [path, item] of scoped) {
    if (item.runId !== undefined && item.runId !== state.runId) {
      context.addIssue({
        code: "custom",
        path: [path, "runId"],
        message: `${path} belongs to run ${item.runId}, not ${state.runId}`,
      });
    }
    if (item.userId !== undefined && item.userId !== state.userId) {
      context.addIssue({
        code: "custom",
        path: [path, "userId"],
        message: `${path} belongs to another user`,
      });
    }
  }

  if (state.flow && state.supervisor && state.flow !== state.supervisor.flow) {
    context.addIssue({
      code: "custom",
      path: ["flow"],
      message: "State flow must match the Supervisor decision",
    });
  }

  if (state.plan && state.flow && state.plan.flow !== state.flow) {
    context.addIssue({
      code: "custom",
      path: ["plan", "flow"],
      message: "Plan flow must match the run flow",
    });
  }

  // Every completed subtask must correspond to a planned one. A worker result
  // for a subtask nobody planned is either a stale checkpoint being merged or a
  // model inventing work, and both should stop here.
  if (state.plan) {
    const plannedIds = new Set(state.plan.subtasks.map((subtask) => subtask.id));
    for (const [index, completed] of state.completedSubtasks.entries()) {
      if (!plannedIds.has(completed.subtaskId)) {
        context.addIssue({
          code: "custom",
          path: ["completedSubtasks", index, "subtaskId"],
          message: `Result for unplanned subtask ${completed.subtaskId}`,
        });
      }
    }
  }

  const evidenceIds = new Set(state.evidence.map((ref) => ref.evidenceId));
  if (evidenceIds.size !== state.evidence.length) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "Evidence references must be unique by evidenceId",
    });
  }
});

export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type CompletedSubtask = z.infer<typeof CompletedSubtaskSchema>;
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;
export type AgentRunError = z.infer<typeof AgentRunErrorSchema>;
export type MyraAgentState = z.infer<typeof MyraAgentStateSchema>;

/**
 * The state a run starts from. Every channel that a reducer can append to
 * begins empty, so a node never has to distinguish "absent" from "empty".
 */
export function createInitialState(input: {
  runId: string;
  userId: string | number;
  conversationId: string;
  request: AgentRequest;
  budgetLimits: MyraAgentState["budgetLimits"];
}): MyraAgentState {
  return MyraAgentStateSchema.parse({
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    request: input.request,
    supervisor: null,
    flow: null,
    plan: null,
    completedSubtasks: [],
    evidence: [],
    openQuestions: [],
    candidateAnswer: null,
    verification: null,
    proposedActions: [],
    approvals: [],
    actionReceipts: [],
    memoryCandidates: [],
    replanIterations: 0,
    verificationRetries: 0,
    evidenceIdsAtLastReplan: [],
    budgetLimits: input.budgetLimits,
    budgetUsage: {
      steps: 0,
      retries: 0,
      durationMs: 0,
      tokens: 0,
      costUsd: 0,
      externalActions: 0,
    },
    errors: [],
    status: "created",
    cancellationRequested: false,
  });
}
