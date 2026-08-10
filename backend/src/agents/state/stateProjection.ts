/**
 * AGT-01 — read-only views of the state.
 *
 * Two consumers need to see inside a run and neither should receive the state
 * itself: the run API (AGT-07), which serves it to a browser, and the
 * evaluation harness (QLT-01), which asserts on it.
 *
 * Handing either the raw state would leak by default. The state holds the
 * user's own question, an action proposal's full normalized payload, and memory
 * candidates extracted from private sources — none of which belongs in a status
 * poll or a stored trajectory. These projections are allow-lists: a field
 * appears because someone added it deliberately, so a channel added later is
 * invisible until reviewed rather than exposed by default.
 */

import type { AgentRunStatus, EvidenceSource, SupportedFlow } from "../contracts/index.js";
import type { MyraAgentState } from "./stateSchema.js";
import { isInterruptStatus, isTerminalStatus } from "./statusTransitions.js";

/* -------------------------------------------------------------------------- */
/* run status view — what a client polling a run may see                       */
/* -------------------------------------------------------------------------- */

export interface RunStatusView {
  runId: string;
  conversationId: string;
  status: AgentRunStatus;
  terminal: boolean;
  awaitingUser: boolean;
  flow: SupportedFlow | null;
  mode: "answer" | "briefing" | "action" | null;
  plan: {
    revision: number;
    objective: string;
    subtasks: Array<{
      id: string;
      capability: string;
      description: string;
      dependsOn: string[];
      status: "pending" | "complete" | "partial" | "failed";
    }>;
  } | null;
  evidence: {
    total: number;
    bySource: Partial<Record<EvidenceSource, number>>;
  };
  openQuestions: Array<{
    id: string;
    prompt: string;
    missingFields: string[];
    options?: string[];
    answered: boolean;
  }>;
  pendingApproval: {
    proposalId: string;
    proposalVersion: string;
    risk: string;
    actionType: string;
    connector: string;
    expiresAt: string;
  } | null;
  verification: {
    status: "pass" | "revise" | "blocked";
    issueCount: number;
  } | null;
  budget: {
    usage: MyraAgentState["budgetUsage"];
    limits: MyraAgentState["budgetLimits"];
  };
  /** Codes and categories only. Messages can quote source content. */
  errors: Array<{ code: string; category: string; retryable: boolean }>;
  cancellationRequested: boolean;
}

export function toRunStatusView(state: MyraAgentState): RunStatusView {
  const resultBySubtask = new Map(
    state.completedSubtasks.map((subtask) => [subtask.subtaskId, subtask.status]),
  );

  const bySource: Partial<Record<EvidenceSource, number>> = {};
  for (const reference of state.evidence) {
    bySource[reference.source] = (bySource[reference.source] ?? 0) + 1;
  }

  // The proposal a user is being asked about right now: awaiting approval, and
  // not already decided. A decided proposal is history, not a pending prompt.
  const decidedProposalIds = new Set(state.approvals.map((approval) => approval.proposalId));
  const pending =
    state.status === "waiting_for_approval"
      ? state.proposedActions.find((proposal) => !decidedProposalIds.has(proposal.id)) ?? null
      : null;

  return {
    runId: state.runId,
    conversationId: state.conversationId,
    status: state.status,
    terminal: isTerminalStatus(state.status),
    awaitingUser: isInterruptStatus(state.status),
    flow: state.flow,
    mode: state.supervisor?.mode ?? null,
    plan: state.plan
      ? {
          revision: state.plan.revision,
          objective: state.plan.objective,
          subtasks: state.plan.subtasks.map((subtask) => ({
            id: subtask.id,
            capability: subtask.capability,
            description: subtask.description,
            dependsOn: [...subtask.dependsOn],
            status: resultBySubtask.get(subtask.id) ?? "pending",
          })),
        }
      : null,
    evidence: { total: state.evidence.length, bySource },
    openQuestions: state.openQuestions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      missingFields: [...question.missingFields],
      ...(question.options ? { options: [...question.options] } : {}),
      answered: Boolean(question.answeredAt),
    })),
    pendingApproval: pending
      ? {
          proposalId: pending.id,
          proposalVersion: pending.proposalVersion,
          risk: pending.risk,
          actionType: pending.actionType,
          connector: pending.connector,
          expiresAt: pending.expiresAt,
        }
      : null,
    verification: state.verification
      ? {
          status: state.verification.status,
          issueCount: state.verification.issues.length,
        }
      : null,
    budget: { usage: state.budgetUsage, limits: state.budgetLimits },
    errors: state.errors.map((error) => ({
      code: error.code,
      category: error.category,
      retryable: error.retryable,
    })),
    cancellationRequested: state.cancellationRequested,
  };
}

/* -------------------------------------------------------------------------- */
/* trajectory snapshot — what an evaluation record may store                   */
/* -------------------------------------------------------------------------- */

export interface TrajectorySnapshot {
  status: AgentRunStatus;
  flow: SupportedFlow | null;
  mode: "answer" | "briefing" | "action" | null;
  promptVersion: string | null;
  /** Freshness as decided, and whether each tier was computed or escalated. */
  freshness: Array<{ source: EvidenceSource; mode: string; origin: string }>;
  planRevision: number | null;
  subtaskIds: string[];
  completedSubtasks: Array<{ subtaskId: string; status: string; evidenceCount: number }>;
  evidenceIds: string[];
  evidenceSources: EvidenceSource[];
  toolCallIds: string[];
  proposalIds: string[];
  approvedProposalIds: string[];
  receiptIds: string[];
  memoryCandidateIds: string[];
  verificationStatus: "pass" | "revise" | "blocked" | null;
  replanIterations: number;
  verificationRetries: number;
  budgetUsage: MyraAgentState["budgetUsage"];
  errorCodes: string[];
  /** True once the answer exists, without storing the answer. */
  hasCandidateAnswer: boolean;
}

/**
 * Identifiers, counts, and decisions — no content. A trajectory is persisted
 * and replayed, so the same rule that keeps evidence bodies out of checkpoints
 * keeps them out of here. Every deterministic evaluator QLT-03 needs (selected
 * flow, tools used, citations present, memory changed, retries, budgets) is
 * expressible over IDs; nothing needs the text.
 */
export function toTrajectorySnapshot(state: MyraAgentState): TrajectorySnapshot {
  return {
    status: state.status,
    flow: state.flow,
    mode: state.supervisor?.mode ?? null,
    promptVersion: state.supervisor?.promptVersion ?? null,
    freshness: (state.supervisor?.freshness ?? []).map((directive) => ({
      source: directive.source,
      mode: directive.mode,
      origin: directive.origin,
    })),
    planRevision: state.plan?.revision ?? null,
    subtaskIds: state.plan?.subtasks.map((subtask) => subtask.id) ?? [],
    completedSubtasks: state.completedSubtasks.map((subtask) => ({
      subtaskId: subtask.subtaskId,
      status: subtask.status,
      evidenceCount: subtask.evidenceIds.length,
    })),
    evidenceIds: state.evidence.map((reference) => reference.evidenceId),
    evidenceSources: [...new Set(state.evidence.map((reference) => reference.source))],
    toolCallIds: [
      ...new Set(state.completedSubtasks.flatMap((subtask) => subtask.toolCallIds)),
    ],
    proposalIds: state.proposedActions.map((proposal) => proposal.id),
    approvedProposalIds: state.approvals
      .filter((approval) => approval.decision === "approve")
      .map((approval) => approval.proposalId),
    receiptIds: state.actionReceipts.map((receipt) => receipt.id),
    memoryCandidateIds: state.memoryCandidates.map((candidate) => candidate.id),
    verificationStatus: state.verification?.status ?? null,
    replanIterations: state.replanIterations,
    verificationRetries: state.verificationRetries,
    budgetUsage: state.budgetUsage,
    errorCodes: state.errors.map((error) => error.code),
    hasCandidateAnswer: state.candidateAnswer !== null,
  };
}

/* -------------------------------------------------------------------------- */
/* progress                                                                    */
/* -------------------------------------------------------------------------- */

export interface ProgressCheck {
  newEvidenceIds: string[];
  madeProgress: boolean;
}

/**
 * The monotonic progress check (§9.4), as a pure comparison over the state's
 * own record of what it knew last time round.
 *
 * AGT-05 owns the decision this feeds — whether to re-enter the loop — but the
 * comparison belongs beside the channel that stores the baseline, and keeping
 * it pure is what lets the whole matrix be tested without a graph.
 */
export function evaluateProgress(state: MyraAgentState): ProgressCheck {
  const previous = new Set(state.evidenceIdsAtLastReplan);
  const newEvidenceIds = state.evidence
    .map((reference) => reference.evidenceId)
    .filter((id) => !previous.has(id));

  return { newEvidenceIds, madeProgress: newEvidenceIds.length > 0 };
}
