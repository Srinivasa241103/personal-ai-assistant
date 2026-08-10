/**
 * AGT-01 — the state schema, its binding to the FND-02 contracts, and the
 * read-only projections built on it.
 *
 * Three things are under test here that the reducer and guard suites cannot
 * reach: that a state is *valid* in the ways that matter (nothing from another
 * tenant, no result for work nobody planned), that `EvidenceRef` and
 * `EvidenceItem` cannot drift apart, and that the projections are allow-lists
 * rather than filters — a channel added later must be invisible until someone
 * adds it deliberately.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  EvidenceItemSchema,
  SupervisorDecisionSchema,
  roundTripContract,
} from "../../../src/agents/contracts/index.js";
import {
  AGENT_STATE_SCHEMA_VERSION,
  EvidenceRefSchema,
  MyraAgentStateSchema,
  createInitialState,
  toEvidenceRef,
} from "../../../src/agents/state/stateSchema.js";
import {
  evaluateProgress,
  toRunStatusView,
  toTrajectorySnapshot,
} from "../../../src/agents/state/stateProjection.js";
import {
  AGT01_FIXTURES,
  CONVERSATION_ID,
  NESTED,
  RUN_ID,
  USER_ID,
  buildState,
} from "../../fixtures/agt01-state-fixtures.js";

/* -------------------------------------------------------------------------- */
/* the envelope                                                                */
/* -------------------------------------------------------------------------- */

test("a fully populated state parses and round-trips through JSON", () => {
  const state = buildState({
    supervisor: AGT01_FIXTURES.supervisorDecision as never,
    flow: "meeting_brief",
    plan: { ...NESTED.plan, flow: "meeting_brief" } as never,
    completedSubtasks: [AGT01_FIXTURES.completedSubtask as never],
    evidence: [AGT01_FIXTURES.evidenceRef as never],
    openQuestions: [AGT01_FIXTURES.openQuestion as never],
    candidateAnswer: "Your review is at 10:30.",
    verification: NESTED.verificationResult as never,
    memoryCandidates: [NESTED.memoryCandidate as never],
    errors: [AGT01_FIXTURES.runError as never],
    status: "verifying",
  });

  const parsed = MyraAgentStateSchema.parse(state);
  assert.deepEqual(roundTripContract(MyraAgentStateSchema, parsed), parsed);
});

test("createInitialState produces a valid, empty state", () => {
  const state = createInitialState({
    runId: RUN_ID,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    request: AGT01_FIXTURES.request,
    budgetLimits: AGT01_FIXTURES.budgetLimits,
  });

  assert.equal(state.schemaVersion, AGENT_STATE_SCHEMA_VERSION);
  assert.equal(state.status, "created");
  assert.deepEqual(state.evidence, []);
  assert.equal(state.budgetUsage.costUsd, 0);
  assert.doesNotThrow(() => MyraAgentStateSchema.parse(state));
});

/* -------------------------------------------------------------------------- */
/* tenancy and coherence                                                       */
/* -------------------------------------------------------------------------- */

test("a nested record from another run cannot ride into the state", () => {
  // The realistic path: a worker result merged from a stale checkpoint, or a
  // subgraph handed the wrong config.
  assert.throws(
    () =>
      MyraAgentStateSchema.parse(
        buildState({ plan: { ...NESTED.plan, runId: "run-999" } as never }),
      ),
    /belongs to run run-999/,
  );
});

test("a nested record from another user cannot ride into the state", () => {
  assert.throws(
    () =>
      MyraAgentStateSchema.parse(
        buildState({ proposedActions: [{ ...NESTED.actionProposal, userId: 999 }] as never }),
      ),
    /belongs to another user/,
  );
});

test("a result for work nobody planned is rejected", () => {
  assert.throws(
    () =>
      MyraAgentStateSchema.parse(
        buildState({
          flow: "schedule_meeting",
          plan: NESTED.plan as never,
          completedSubtasks: [
            { ...AGT01_FIXTURES.completedSubtask, subtaskId: "subtask-invented" } as never,
          ],
        }),
      ),
    /unplanned subtask subtask-invented/,
  );
});

test("the state flow must agree with the Supervisor and the plan", () => {
  assert.throws(
    () =>
      MyraAgentStateSchema.parse(
        buildState({
          supervisor: AGT01_FIXTURES.supervisorDecision as never,
          flow: "cross_source_answer",
        }),
      ),
    /must match the Supervisor decision/,
  );
});

test("duplicate evidence references are rejected", () => {
  assert.throws(
    () =>
      MyraAgentStateSchema.parse(
        buildState({
          evidence: [AGT01_FIXTURES.evidenceRef, AGT01_FIXTURES.evidenceRef] as never,
        }),
      ),
    /unique by evidenceId/,
  );
});

test("a partial or failed subtask must name a gap", () => {
  // Without one, AGT-05's replan loop has nothing to act on — and a silently
  // empty source is exactly the "silent omission" §5.7 forbids.
  assert.throws(
    () =>
      MyraAgentStateSchema.parse(
        buildState({
          completedSubtasks: [
            { ...AGT01_FIXTURES.completedSubtask, status: "partial", gaps: [] } as never,
          ],
        }),
      ),
    /must name at least one gap/,
  );
});

/* -------------------------------------------------------------------------- */
/* the EvidenceItem → EvidenceRef binding                                      */
/* -------------------------------------------------------------------------- */

test("every valid EvidenceItem produces a valid EvidenceRef", () => {
  // This is what stops the two shapes drifting. If a required field is added to
  // EvidenceItem and not carried here, or a field's type changes, this fails.
  const item = EvidenceItemSchema.parse(NESTED.evidenceItem);
  const reference = toEvidenceRef(item, { subtaskId: "subtask-1" });

  assert.doesNotThrow(() => EvidenceRefSchema.parse(reference));
  assert.equal(reference.evidenceId, item.id);
  assert.equal(reference.contentHash, item.contentHash);
  assert.equal(reference.source, item.source);
  assert.equal(reference.freshness, item.freshness);
});

test("an evidence reference carries no body", () => {
  const item = EvidenceItemSchema.parse(NESTED.evidenceItem);
  const serialized = JSON.stringify(toEvidenceRef(item));

  assert.equal(
    serialized.includes(item.content),
    false,
    "content must stay in evidence_items, not in the checkpoint",
  );
  assert.equal(serialized.includes("permissionScope"), false);
  assert.equal(serialized.includes("calendarId"), false, "metadata must not ride along");
});

test("a hostile title cannot inflate every future checkpoint", () => {
  const item = EvidenceItemSchema.parse({
    ...NESTED.evidenceItem,
    title: "T".repeat(5_000),
  });

  assert.equal(toEvidenceRef(item).title?.length, 300);
});

/* -------------------------------------------------------------------------- */
/* the Supervisor decision contract                                            */
/* -------------------------------------------------------------------------- */

test("a read-only flow cannot be answered in action mode", () => {
  // "A read request cannot be upgraded into a write action without user intent"
  // — enforced by the contract, not only by the prompt.
  assert.throws(
    () =>
      SupervisorDecisionSchema.parse({
        ...AGT01_FIXTURES.supervisorDecision,
        mode: "action",
        risk: "medium",
      }),
    /has no approval boundary and cannot run in action mode/,
  );
});

test("a write flow cannot masquerade as a briefing", () => {
  assert.throws(
    () =>
      SupervisorDecisionSchema.parse({
        ...AGT01_FIXTURES.actionSupervisorDecision,
        mode: "briefing",
        risk: "low",
      }),
    /writes externally and must run in action mode/,
  );
});

test("a read-only decision must be low risk", () => {
  assert.throws(
    () =>
      SupervisorDecisionSchema.parse({ ...AGT01_FIXTURES.supervisorDecision, risk: "high" }),
    /read-only and must be low risk/,
  );
});

test("freshness directives are one per selected source", () => {
  assert.throws(
    () =>
      SupervisorDecisionSchema.parse({
        ...AGT01_FIXTURES.supervisorDecision,
        freshness: [
          { source: "calendar", mode: "live", reason: "a", origin: "computed" },
          { source: "calendar", mode: "index", reason: "b", origin: "computed" },
        ],
      }),
    /Duplicate freshness directive/,
  );

  assert.throws(
    () =>
      SupervisorDecisionSchema.parse({
        ...AGT01_FIXTURES.supervisorDecision,
        freshness: [{ source: "slack", mode: "live", reason: "a", origin: "computed" }],
      }),
    /which is not a selected source/,
  );
});

test("the action-mode fixture is itself valid", () => {
  assert.doesNotThrow(() =>
    SupervisorDecisionSchema.parse(AGT01_FIXTURES.actionSupervisorDecision),
  );
});

/* -------------------------------------------------------------------------- */
/* projections                                                                 */
/* -------------------------------------------------------------------------- */

test("the run status view reports progress without exposing payloads", () => {
  const state = buildState({
    supervisor: AGT01_FIXTURES.supervisorDecision as never,
    flow: "meeting_brief",
    plan: { ...NESTED.plan, flow: "meeting_brief" } as never,
    completedSubtasks: [AGT01_FIXTURES.completedSubtask as never],
    evidence: [AGT01_FIXTURES.evidenceRef as never],
    candidateAnswer: "the drafted answer",
    errors: [AGT01_FIXTURES.runError as never],
    status: "verifying",
  });

  const view = toRunStatusView(state);
  const serialized = JSON.stringify(view);

  assert.equal(view.status, "verifying");
  assert.equal(view.terminal, false);
  assert.equal(view.awaitingUser, false);
  assert.equal(view.plan?.subtasks[0].status, "complete");
  assert.deepEqual(view.evidence, { total: 1, bySource: { calendar: 1 } });

  // Error *messages* can quote retrieved source content; only codes go out.
  assert.deepEqual(view.errors, [
    { code: "tool_timeout", category: "timeout", retryable: true },
  ]);
  assert.equal(
    serialized.includes("slack_search exceeded"),
    false,
    "an error message must not reach a status poll",
  );
});

test("a pending approval appears only while one is actually pending", () => {
  const proposed = buildState({
    proposedActions: [NESTED.actionProposal as never],
    status: "created",
  });
  assert.equal(toRunStatusView(proposed).pendingApproval, null, "not while status says otherwise");

  const waiting = buildState({
    proposedActions: [NESTED.actionProposal as never],
    status: "waiting_for_approval",
  });
  assert.equal(toRunStatusView(waiting).pendingApproval?.proposalId, "proposal-1");
  assert.equal(toRunStatusView(waiting).awaitingUser, true);

  const decided = buildState({
    proposedActions: [NESTED.actionProposal as never],
    approvals: [NESTED.approvalDecision as never],
    status: "waiting_for_approval",
  });
  assert.equal(
    toRunStatusView(decided).pendingApproval,
    null,
    "a decided proposal is history, not a pending prompt",
  );
});

test("a trajectory snapshot stores identifiers, never content", () => {
  const state = buildState({
    supervisor: AGT01_FIXTURES.supervisorDecision as never,
    flow: "meeting_brief",
    plan: { ...NESTED.plan, flow: "meeting_brief" } as never,
    completedSubtasks: [AGT01_FIXTURES.completedSubtask as never],
    evidence: [AGT01_FIXTURES.evidenceRef as never],
    candidateAnswer: "Your Project X review is at 10:30 with Rahul.",
    memoryCandidates: [NESTED.memoryCandidate as never],
    status: "verifying",
  });

  const snapshot = toTrajectorySnapshot(state);
  const serialized = JSON.stringify(snapshot);

  assert.deepEqual(snapshot.evidenceIds, ["evidence-1"]);
  assert.deepEqual(snapshot.evidenceSources, ["calendar"]);
  assert.deepEqual(snapshot.toolCallIds, ["tool-call-1"]);
  assert.equal(snapshot.promptVersion, "supervisor@1.0.0");
  assert.equal(snapshot.hasCandidateAnswer, true);

  // A trajectory is persisted and replayed. The same rule that keeps bodies out
  // of a checkpoint keeps them out of here.
  for (const content of [
    "Your Project X review is at 10:30 with Rahul.",
    AGT01_FIXTURES.request.input,
    "Project X review with Rahul is scheduled.",
  ]) {
    assert.equal(serialized.includes(content), false, `content leaked: ${content}`);
  }
});

test("the freshness origin survives into the trajectory", () => {
  // FRS-01's "escalate, never downgrade" rule is only checkable if the record
  // says which directives were computed and which the Supervisor raised.
  const snapshot = toTrajectorySnapshot(
    buildState({
      supervisor: AGT01_FIXTURES.supervisorDecision as never,
      flow: "meeting_brief",
    }),
  );

  assert.deepEqual(snapshot.freshness, [
    { source: "calendar", mode: "live", origin: "computed" },
    { source: "gmail", mode: "refresh", origin: "escalated" },
  ]);
});

/* -------------------------------------------------------------------------- */
/* monotonic progress                                                          */
/* -------------------------------------------------------------------------- */

test("an iteration that adds no new evidence reports no progress", () => {
  // The monotonic progress check (§9.4). AGT-05 decides what to do with it;
  // this is the comparison it decides on.
  const stalled = buildState({
    evidence: [AGT01_FIXTURES.evidenceRef as never],
    evidenceIdsAtLastReplan: ["evidence-1"],
  });

  assert.deepEqual(evaluateProgress(stalled), { newEvidenceIds: [], madeProgress: false });
});

test("new evidence since the last replan is reported by id", () => {
  const advanced = buildState({
    evidence: [
      AGT01_FIXTURES.evidenceRef,
      { ...AGT01_FIXTURES.evidenceRef, evidenceId: "evidence-2" },
    ] as never,
    evidenceIdsAtLastReplan: ["evidence-1"],
  });

  assert.deepEqual(evaluateProgress(advanced), {
    newEvidenceIds: ["evidence-2"],
    madeProgress: true,
  });
});

test("the first iteration always counts as progress when evidence exists", () => {
  const first = buildState({ evidence: [AGT01_FIXTURES.evidenceRef as never] });
  assert.equal(evaluateProgress(first).madeProgress, true);
});
