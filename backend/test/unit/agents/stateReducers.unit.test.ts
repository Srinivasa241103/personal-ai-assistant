/**
 * AGT-01 — reducer behaviour.
 *
 * These are the merges that decide what a concurrent run remembers. The cases
 * that matter are not the happy ones: two workers finding the same record, a
 * worker retried after a timeout, a node re-emitting a status it already set,
 * and a loop that would grow a checkpoint without bound.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ChannelCapacityError,
  ImmutableChannelError,
  appendReducer,
  budgetUsageReducer,
  dedupeByIdReducer,
  errorAppendReducer,
  latchReducer,
  monotonicCounterReducer,
  replaceOnceReducer,
  replaceReducer,
  statusTransitionReducer,
} from "../../../src/agents/state/reducers.js";
import { InvalidStatusTransitionError } from "../../../src/agents/state/statusTransitions.js";
import { AGT01_FIXTURES } from "../../fixtures/agt01-state-fixtures.js";

interface Identified {
  id: string;
  value: string;
}

const identify = (item: Identified) => item.id;

/* -------------------------------------------------------------------------- */
/* the rules every reducer obeys                                               */
/* -------------------------------------------------------------------------- */

test("an undefined update leaves the channel untouched", () => {
  // A node returning a partial object must not erase channels it never wrote.
  assert.equal(replaceReducer<string>()("kept", undefined), "kept");
  assert.deepEqual(
    dedupeByIdReducer<Identified>("c", identify, { cap: 10, keep: "first" })(
      [{ id: "a", value: "1" }],
      undefined,
    ),
    [{ id: "a", value: "1" }],
  );
  assert.equal(monotonicCounterReducer("c")(3, undefined), 3);
  assert.equal(latchReducer()(true, undefined), true);
});

test("reducers never mutate the value they were given", () => {
  // LangGraph may still hold the previous value in a serialized checkpoint.
  // Mutating it would edit history that has already been written.
  const current: Identified[] = [{ id: "a", value: "1" }];
  const frozen = JSON.stringify(current);

  dedupeByIdReducer<Identified>("c", identify, { cap: 10, keep: "last" })(current, {
    id: "b",
    value: "2",
  });
  appendReducer<Identified>("c", { cap: 10 })(current, { id: "b", value: "2" });
  errorAppendReducer(10)([{ ...AGT01_FIXTURES.runError }], AGT01_FIXTURES.runError);

  assert.equal(JSON.stringify(current), frozen);
});

/* -------------------------------------------------------------------------- */
/* identity channels                                                           */
/* -------------------------------------------------------------------------- */

test("an identity channel accepts the same value and rejects a different one", () => {
  const reducer = replaceOnceReducer<string>("runId");

  assert.equal(reducer("run-1", "run-1"), "run-1", "re-emitting the same id is routine");
  assert.throws(() => reducer("run-1", "run-2"), ImmutableChannelError);
});

test("an identity channel compares objects structurally, not by reference", () => {
  const reducer = replaceOnceReducer<{ requestId: string }>("request");
  const current = { requestId: "request-1" };

  assert.deepEqual(reducer(current, { ...current }), current);
  assert.throws(() => reducer(current, { requestId: "request-2" }), ImmutableChannelError);
});

test("a user id can never be reassigned mid-run", () => {
  // This is the reducer standing between a merged update from the wrong run and
  // a cross-tenant checkpoint.
  const reducer = replaceOnceReducer<number>("userId");
  assert.throws(() => reducer(42, 43), /set once at run creation/);
});

/* -------------------------------------------------------------------------- */
/* concurrent evidence                                                         */
/* -------------------------------------------------------------------------- */

test("parallel workers finding the same record produce one reference", () => {
  const reducer = dedupeByIdReducer<Identified>("evidence", identify, {
    cap: 500,
    keep: "first",
  });

  // Four workers, three of them citing the same calendar event.
  let state: Identified[] = [];
  state = reducer(state, { id: "evidence-1", value: "worker-a" });
  state = reducer(state, { id: "evidence-1", value: "worker-b" });
  state = reducer(state, [
    { id: "evidence-1", value: "worker-c" },
    { id: "evidence-2", value: "worker-c" },
  ]);
  state = reducer(state, { id: "evidence-3", value: "worker-d" });

  assert.deepEqual(state.map(identify), ["evidence-1", "evidence-2", "evidence-3"]);
  assert.equal(
    state[0].value,
    "worker-a",
    "keep:first must preserve the earliest observation, whose retrievedAt others cite",
  );
});

test("a retried worker supersedes its failed attempt instead of appending", () => {
  const reducer = dedupeByIdReducer<Identified>("completedSubtasks", identify, {
    cap: 200,
    keep: "last",
  });

  const state = reducer(
    reducer([], { id: "subtask-1", value: "failed" }),
    { id: "subtask-1", value: "complete" },
  );

  assert.equal(state.length, 1, "duplicate subtask completion must not double-append");
  assert.equal(state[0].value, "complete");
});

test("evidence order is stable across merges", () => {
  // Citation ordinals are assigned from this list; a reducer that reordered on
  // every merge would renumber citations mid-run.
  const reducer = dedupeByIdReducer<Identified>("evidence", identify, {
    cap: 10,
    keep: "first",
  });

  let state = reducer([], [{ id: "a", value: "1" }, { id: "b", value: "2" }]);
  state = reducer(state, { id: "a", value: "again" });
  state = reducer(state, { id: "c", value: "3" });

  assert.deepEqual(state.map(identify), ["a", "b", "c"]);
});

/* -------------------------------------------------------------------------- */
/* caps                                                                        */
/* -------------------------------------------------------------------------- */

test("a channel that would grow without bound fails by name", () => {
  const reducer = dedupeByIdReducer<Identified>("evidence", identify, {
    cap: 2,
    keep: "first",
  });
  const state = reducer([], [{ id: "a", value: "1" }, { id: "b", value: "2" }]);

  // node:assert's throws() returns undefined, so capture the error to inspect it.
  let caught: unknown;
  try {
    reducer(state, { id: "c", value: "3" });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ChannelCapacityError, "expected a ChannelCapacityError");
  assert.equal(caught.channel, "evidence", "the error must name the channel to look at");
  assert.equal(caught.cap, 2);
});

test("re-adding a known item at the cap is not an overflow", () => {
  const reducer = dedupeByIdReducer<Identified>("evidence", identify, {
    cap: 2,
    keep: "first",
  });
  const state = reducer([], [{ id: "a", value: "1" }, { id: "b", value: "2" }]);

  assert.deepEqual(reducer(state, { id: "a", value: "again" }).map(identify), ["a", "b"]);
});

test("appendReducer enforces its cap too", () => {
  const reducer = appendReducer<Identified>("some_channel", { cap: 2 });
  assert.throws(
    () => reducer([{ id: "a", value: "1" }, { id: "b", value: "2" }], { id: "c", value: "3" }),
    ChannelCapacityError,
  );
});

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

test("the error channel keeps the earliest failures and drops the overflow", () => {
  const reducer = errorAppendReducer(2);
  const error = (code: string) => ({ ...AGT01_FIXTURES.runError, code });

  const state = reducer(reducer([], [error("first"), error("second")]), error("third"));

  // Keeping the first is the deliberate choice: a cascade's tenth error is a
  // consequence of its first, and every failure is persisted in full to
  // agent_steps and tool_calls regardless.
  assert.deepEqual(state.map((entry) => entry.code), ["first", "second"]);
});

test("overflowing the error channel does not throw", () => {
  // A run that is already failing must not fail differently because its error
  // list filled up.
  const reducer = errorAppendReducer(1);
  assert.doesNotThrow(() => reducer([AGT01_FIXTURES.runError], AGT01_FIXTURES.runError));
});

/* -------------------------------------------------------------------------- */
/* budgets and counters                                                        */
/* -------------------------------------------------------------------------- */

test("budget deltas from concurrent workers accumulate", () => {
  const reducer = budgetUsageReducer();
  const zero = { ...AGT01_FIXTURES.zeroUsage };

  const state = reducer(
    reducer(zero, { steps: 1, tokens: 800, costUsd: 0.1 }),
    { steps: 1, tokens: 1_200, costUsd: 0.2, retries: 1 },
  );

  assert.equal(state.steps, 2);
  assert.equal(state.tokens, 2_000);
  assert.equal(state.retries, 1);
  assert.equal(state.costUsd, 0.3, "float drift must not leak into a cost report");
});

test("parallel wall-clock is taken as a maximum, not a sum", () => {
  // Four workers running ten seconds in parallel have consumed ten seconds of
  // the run's 90s budget, not forty.
  const reducer = budgetUsageReducer();
  let state = { ...AGT01_FIXTURES.zeroUsage };
  for (const durationMs of [10_000, 9_500, 10_200, 8_000]) {
    state = reducer(state, { durationMs });
  }

  assert.equal(state.durationMs, 10_200);
});

test("loop counters may only rise", () => {
  const reducer = monotonicCounterReducer("replanIterations");

  assert.equal(reducer(1, 2), 2);
  assert.equal(reducer(2, 2), 2, "re-emitting the current value is legal");
  assert.throws(() => reducer(2, 1), ImmutableChannelError);
});

test("cancellation latches and cannot be cleared", () => {
  // A node holding pre-cancellation state must not resurrect the run.
  const reducer = latchReducer();

  assert.equal(reducer(false, true), true);
  assert.equal(reducer(true, false), true);
});

/* -------------------------------------------------------------------------- */
/* status                                                                      */
/* -------------------------------------------------------------------------- */

test("the status channel enforces the transition table", () => {
  const reducer = statusTransitionReducer();

  assert.equal(reducer("created", "planning"), "planning");
  assert.equal(reducer("planning", "planning"), "planning", "re-entry is a no-op");
  assert.throws(() => reducer("created", "executing_action"), InvalidStatusTransitionError);
});

test("a terminal run cannot be moved anywhere", () => {
  const reducer = statusTransitionReducer();

  for (const terminal of ["completed", "failed", "cancelled", "partially_completed"] as const) {
    assert.throws(
      () => reducer(terminal, "planning"),
      /terminal/,
      `${terminal} must not accept an outgoing transition`,
    );
  }
});
