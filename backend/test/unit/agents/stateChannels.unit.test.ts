/**
 * AGT-01 — the channels inside a real LangGraph.
 *
 * The reducer suite tests the merge functions in isolation. This tests that
 * they are actually *wired*: that a fan-out of workers writing the same
 * evidence produces one reference, that budget deltas accumulate across a
 * superstep, and that the identity channels reject a rewrite when the write
 * comes from a node rather than from a test.
 *
 * Isolation matters here in the other direction too. A reducer can be perfect
 * and the annotation still wrong — a channel left on LangGraph's default
 * last-write-wins would pass every test in `stateReducers.unit.test.ts` and
 * silently discard three workers out of four in production.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import {
  AGENT_STATE_CHANNEL_NAMES,
  AgentStateAnnotation,
  ReservedNodeNameError,
  assertUsableNodeName,
  type AgentStateChannels,
} from "../../../src/agents/state/channels.js";
import { ImmutableChannelError } from "../../../src/agents/state/reducers.js";
import { AGT01_FIXTURES, CONVERSATION_ID, RUN_ID, USER_ID } from "../../fixtures/agt01-state-fixtures.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-03T10:00:00.000+05:30";
const LATER = "2026-08-03T10:30:00.000+05:30";

const seedInput = {
  runId: RUN_ID,
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  request: AGT01_FIXTURES.request,
  budgetLimits: AGT01_FIXTURES.budgetLimits,
};

function evidenceRef(evidenceId: string, source: string, worker: string) {
  return {
    evidenceId,
    source,
    sourceRecordId: `record-for-${evidenceId}`,
    freshness: source === "index" ? "recent_index" : "live",
    contentHash: worker === "first" ? HASH_A : HASH_B,
    retrievedAt: NOW,
    title: `${evidenceId} via ${worker}`,
  } as AgentStateChannels["evidence"][number];
}

function completed(subtaskId: string, evidenceIds: string[], attempt = 1) {
  return {
    subtaskId,
    capability: "research",
    status: "complete",
    evidenceIds,
    gaps: [],
    toolCallIds: [`tool-${subtaskId}-${attempt}`],
    unavailableSources: [],
    startedAt: NOW,
    completedAt: LATER,
    attempt,
  } as AgentStateChannels["completedSubtasks"][number];
}

/**
 * Three research workers dispatched together, two of which surface the same
 * calendar record — the ordinary case, not a pathological one.
 */
function buildFanOutGraph() {
  const graph = new StateGraph(AgentStateAnnotation)
    // Not "plan": LangGraph forbids a node whose name collides with a channel,
    // and `plan` is a channel. `assertUsableNodeName` exists so AGT-03/AGT-04
    // hit that as an assertion rather than as a runtime surprise.
    .addNode("dispatch", () => ({ status: "planning" as const }))
    .addNode("calendarWorker", () => ({
      status: "researching" as const,
      evidence: [evidenceRef("evidence-shared", "calendar", "first")],
      completedSubtasks: [completed("subtask-calendar", ["evidence-shared"])],
      budgetUsage: { steps: 1, tokens: 800, costUsd: 0.01, durationMs: 9_000 },
    }))
    .addNode("gmailWorker", () => ({
      status: "researching" as const,
      // The same underlying record, found a second way.
      evidence: [
        evidenceRef("evidence-shared", "calendar", "second"),
        evidenceRef("evidence-gmail", "gmail", "second"),
      ],
      completedSubtasks: [completed("subtask-gmail", ["evidence-gmail"])],
      budgetUsage: { steps: 1, tokens: 1_200, costUsd: 0.02, durationMs: 11_000 },
    }))
    .addNode("indexWorker", () => ({
      status: "researching" as const,
      evidence: [evidenceRef("evidence-index", "index", "third")],
      completedSubtasks: [completed("subtask-index", ["evidence-index"])],
      budgetUsage: { steps: 1, tokens: 400, costUsd: 0.005, durationMs: 3_000 },
    }))
    .addEdge(START, "dispatch")
    .addEdge("dispatch", "calendarWorker")
    .addEdge("dispatch", "gmailWorker")
    .addEdge("dispatch", "indexWorker")
    .addEdge("calendarWorker", END)
    .addEdge("gmailWorker", END)
    .addEdge("indexWorker", END);

  return graph;
}

test("a parallel fan-out merges into one evidence list without duplicates", async () => {
  const app = buildFanOutGraph().compile();
  const state = await app.invoke(seedInput);

  assert.deepEqual(
    state.evidence.map((reference) => reference.evidenceId).sort(),
    ["evidence-gmail", "evidence-index", "evidence-shared"],
    "the record found twice must appear once",
  );

  const shared = state.evidence.find((reference) => reference.evidenceId === "evidence-shared");
  assert.equal(
    shared?.contentHash,
    HASH_A,
    "keep:first must preserve the earliest worker's hash, not the last writer's",
  );

  assert.equal(state.completedSubtasks.length, 3, "every worker's result must survive the merge");
});

test("budget deltas from a fan-out accumulate, and wall clock does not", async () => {
  const app = buildFanOutGraph().compile();
  const state = await app.invoke(seedInput);

  assert.equal(state.budgetUsage.steps, 3, "each worker's step must be counted");
  assert.equal(state.budgetUsage.tokens, 2_400);
  assert.equal(state.budgetUsage.costUsd, 0.035);
  assert.equal(
    state.budgetUsage.durationMs,
    11_000,
    "three workers running in parallel consume the longest one's wall clock, not their sum",
  );
});

test("identity channels are seeded from the input and survive every merge", async () => {
  const app = buildFanOutGraph().compile();
  const state = await app.invoke(seedInput);

  assert.equal(state.runId, RUN_ID);
  assert.equal(state.userId, USER_ID);
  assert.equal(state.conversationId, CONVERSATION_ID);
  assert.deepEqual(state.request, AGT01_FIXTURES.request);
  assert.deepEqual(state.budgetLimits, AGT01_FIXTURES.budgetLimits);
});

test("a node cannot reassign the run's user", async () => {
  // The failure this prevents: an update merged from the wrong run, or a node
  // "normalizing" an id, silently rewriting whose checkpoint this is.
  const app = new StateGraph(AgentStateAnnotation)
    .addNode("hijack", () => ({ userId: 999 }))
    .addEdge(START, "hijack")
    .addEdge("hijack", END)
    .compile();

  await assert.rejects(
    () => app.invoke(seedInput),
    (error: unknown) =>
      error instanceof ImmutableChannelError ||
      /set once at run creation/.test((error as Error).message),
  );
});

test("a node cannot report a status its position could not produce", async () => {
  const app = new StateGraph(AgentStateAnnotation)
    .addNode("jump", () => ({ status: "executing_action" as const }))
    .addEdge(START, "jump")
    .addEdge("jump", END)
    .compile();

  await assert.rejects(
    () => app.invoke(seedInput),
    /Illegal run status transition created → executing_action/,
  );
});

test("state survives a checkpoint round trip unchanged", async () => {
  // The checkpointer is LangGraph's in-memory one: AGT-02 owns the PostgreSQL
  // saver. What is under test here is that every channel value this module
  // defines is serializable and comes back identical — no Date, no Map, no
  // class instance smuggled into a channel.
  const app = buildFanOutGraph().compile({ checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: `agt01-${RUN_ID}` } };

  const invoked = await app.invoke(seedInput, config);
  const restored = await app.getState(config);

  assert.deepEqual(
    JSON.parse(JSON.stringify(restored.values)),
    JSON.parse(JSON.stringify(invoked)),
    "the checkpointed state must match what the run produced",
  );
  assert.equal(restored.values.evidence.length, 3);
  assert.equal(restored.values.budgetUsage.steps, 3);
});

test("a retried worker replaces its earlier result instead of appending", async () => {
  const app = new StateGraph(AgentStateAnnotation)
    // created → planning → researching: the status channel rejects the shortcut,
    // so even a test has to walk the lifecycle it claims to be in.
    .addNode("attempt1", () => ({
      status: "planning" as const,
      completedSubtasks: [completed("subtask-flaky", [], 1)],
    }))
    .addNode("attempt2", () => ({
      status: "researching" as const,
      completedSubtasks: [completed("subtask-flaky", ["evidence-late"], 2)],
    }))
    .addEdge(START, "attempt1")
    .addEdge("attempt1", "attempt2")
    .addEdge("attempt2", END)
    .compile();

  const state = await app.invoke(seedInput);

  assert.equal(state.completedSubtasks.length, 1);
  assert.equal(state.completedSubtasks[0].attempt, 2);
  assert.deepEqual(state.completedSubtasks[0].evidenceIds, ["evidence-late"]);
});

test("defaults let a node write one channel without erasing the rest", async () => {
  const app = new StateGraph(AgentStateAnnotation)
    .addNode("touchOne", () => ({ candidateAnswer: "drafted" }))
    .addEdge(START, "touchOne")
    .addEdge("touchOne", END)
    .compile();

  const state = await app.invoke(seedInput);

  assert.equal(state.candidateAnswer, "drafted");
  assert.deepEqual(state.evidence, [], "untouched list channels stay empty, never undefined");
  assert.deepEqual(state.errors, []);
  assert.equal(state.status, "created");
  assert.equal(state.cancellationRequested, false);
  assert.equal(state.replanIterations, 0);
});

/* -------------------------------------------------------------------------- */
/* node naming                                                                 */
/* -------------------------------------------------------------------------- */

test("the obvious node names collide with channels and are rejected early", () => {
  // Found the hard way while writing this file: LangGraph refuses a node whose
  // name matches a channel, and the names AGT-03 and AGT-04 will reach for
  // first — plan, supervisor, verification — are all channels.
  for (const reserved of ["plan", "supervisor", "verification", "evidence", "status", "flow"]) {
    assert.throws(
      () => assertUsableNodeName(reserved),
      ReservedNodeNameError,
      `${reserved} must be rejected as a node name`,
    );
  }

  for (const usable of ["planner", "supervisorNode", "verify", "researchWorker", "dispatch"]) {
    assert.doesNotThrow(() => assertUsableNodeName(usable));
  }
});

test("the reserved list is derived from the annotation, not hand-written", () => {
  // A channel added later must join this list without anyone remembering to.
  assert.ok(AGENT_STATE_CHANNEL_NAMES.includes("budgetUsage"));
  assert.ok(AGENT_STATE_CHANNEL_NAMES.includes("cancellationRequested"));
  assert.equal(
    AGENT_STATE_CHANNEL_NAMES.length,
    Object.keys(AgentStateAnnotation.spec).length,
  );
});

test("LangGraph agrees that a reserved name is unusable", () => {
  // Pins the assumption to the library rather than to a comment: if LangGraph
  // ever allows the collision, this fails and the guard can be dropped.
  assert.throws(
    () => new StateGraph(AgentStateAnnotation).addNode("plan", () => ({})),
    /cannot also be used as a node name/,
  );
});
