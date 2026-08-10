/**
 * AGT-01 fixtures.
 *
 * Built on top of the FND-02 fixtures rather than beside them: every nested
 * record in the graph state is an FND-02 contract, and a second hand-written
 * copy of `ActionProposal` would drift from the first the moment either schema
 * changes. What is new here is only what AGT-01 adds — the state envelope, the
 * evidence *reference*, and a worker result.
 */

import { DOMAIN_CONTRACT_SCHEMA_VERSION } from "../../src/agents/contracts/domain/common.js";
import { FND02_FIXTURES } from "./fnd02-domain-contract-fixtures.js";
import {
  AGENT_STATE_SCHEMA_VERSION,
  type MyraAgentState,
} from "../../src/agents/state/stateSchema.js";

export const RUN_ID = "run-1";
export const USER_ID = 42;
export const CONVERSATION_ID = "conversation-1";

const NOW = "2026-08-03T10:00:00.000+05:30";
const LATER = "2026-08-03T10:30:00.000+05:30";

export const AGT01_FIXTURES = {
  request: {
    requestId: "request-1",
    input: "Prepare me for tomorrow's Project X review with Rahul.",
    receivedAt: NOW,
    timezone: "Asia/Kolkata",
  },

  budgetLimits: {
    maxSteps: 20,
    maxRetries: 2,
    maxDurationMs: 90_000,
    maxTokens: 20_000,
    maxCostUsd: 2,
    maxParallelWorkers: 4,
    maxExternalActions: 3,
  },

  zeroUsage: {
    steps: 0,
    retries: 0,
    durationMs: 0,
    tokens: 0,
    costUsd: 0,
    externalActions: 0,
  },

  /** A read-only decision. `schedule_meeting` needs action mode; see below. */
  supervisorDecision: {
    schemaVersion: DOMAIN_CONTRACT_SCHEMA_VERSION,
    runId: RUN_ID,
    userId: USER_ID,
    mode: "briefing",
    flow: "meeting_brief",
    risk: "low",
    freshness: [
      { source: "calendar", mode: "live", reason: "latest intent on a volatile source", origin: "computed" },
      { source: "gmail", mode: "refresh", reason: "index older than the volatility window", origin: "escalated" },
    ],
    sources: ["calendar", "gmail"],
    successCriteria: ["The brief names the meeting, participants, and open items."],
    rationale: {
      signals: ["explicit meeting reference", "temporal word: tomorrow"],
      rejectedFlows: [{ flow: "simple_lookup", reason: "requires more than one source" }],
    },
    promptVersion: "supervisor@1.0.0",
    decidedAt: NOW,
  },

  /** The write-mode counterpart, for the read-cannot-become-write assertions. */
  actionSupervisorDecision: {
    schemaVersion: DOMAIN_CONTRACT_SCHEMA_VERSION,
    runId: RUN_ID,
    userId: USER_ID,
    mode: "action",
    flow: "schedule_meeting",
    risk: "medium",
    freshness: [
      { source: "calendar", mode: "live", reason: "availability must be current", origin: "computed" },
    ],
    sources: ["calendar"],
    successCriteria: ["A slot free for every attendee is proposed."],
    rationale: { signals: ["imperative: schedule"], rejectedFlows: [] },
    promptVersion: "supervisor@1.0.0",
    decidedAt: NOW,
  },

  evidenceRef: {
    evidenceId: "evidence-1",
    source: "calendar",
    sourceRecordId: "calendar-event-1",
    freshness: "live",
    contentHash: "a".repeat(64),
    retrievedAt: NOW,
    occurredAt: LATER,
    title: "Project X review",
    subtaskId: "subtask-1",
    toolCallId: "tool-call-1",
  },

  completedSubtask: {
    subtaskId: "subtask-1",
    capability: "scheduling",
    status: "complete",
    evidenceIds: ["evidence-1"],
    gaps: [],
    toolCallIds: ["tool-call-1"],
    unavailableSources: [],
    startedAt: NOW,
    completedAt: LATER,
    attempt: 1,
  },

  openQuestion: {
    id: "question-1",
    prompt: "Which Rahul did you mean?",
    missingFields: ["attendee"],
    options: ["Rahul Sharma", "Rahul Verma"],
    askedAt: NOW,
  },

  runError: {
    code: "tool_timeout",
    category: "timeout",
    message: "slack_search exceeded its 15s budget",
    occurredAt: NOW,
    retryable: true,
    subtaskId: "subtask-1",
  },
} as const;

/**
 * A complete, valid state. Takes overrides so a test can express exactly the
 * one field it is about, instead of restating twenty that it is not.
 */
export function buildState(overrides: Partial<MyraAgentState> = {}): MyraAgentState {
  return {
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    runId: RUN_ID,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    request: AGT01_FIXTURES.request,
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
    budgetLimits: AGT01_FIXTURES.budgetLimits,
    budgetUsage: AGT01_FIXTURES.zeroUsage,
    errors: [],
    status: "created",
    cancellationRequested: false,
    ...overrides,
  } as MyraAgentState;
}

/** The FND-02 records this module nests, re-exported so tests read as one set. */
export const NESTED = {
  plan: FND02_FIXTURES.plan,
  evidenceItem: FND02_FIXTURES.evidenceItem,
  actionProposal: FND02_FIXTURES.actionProposal,
  approvalDecision: FND02_FIXTURES.approvalDecision,
  actionReceipt: FND02_FIXTURES.actionReceipt,
  verificationResult: FND02_FIXTURES.verificationResult,
  memoryCandidate: FND02_FIXTURES.memoryCandidate,
} as const;
