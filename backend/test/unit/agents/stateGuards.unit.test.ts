/**
 * AGT-01 — the checks that run before a checkpoint is written.
 *
 * Size, ownership, and serializability. The credential scan is large enough to
 * deserve its own file and lives in `test/security/`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CheckpointTooLargeError,
  StateOwnershipError,
  assertCheckpointSafe,
  assertStateOwnership,
  assertStateWithinSizeLimit,
  channelSizes,
  estimateStateBytes,
} from "../../../src/agents/state/stateGuards.js";
import { AGT01_FIXTURES, RUN_ID, USER_ID, buildState } from "../../fixtures/agt01-state-fixtures.js";

const scope = { runId: RUN_ID, userId: USER_ID, maxBytes: 262_144 };

/* -------------------------------------------------------------------------- */
/* ownership                                                                   */
/* -------------------------------------------------------------------------- */

test("a state written for the wrong run is rejected", () => {
  assert.throws(
    () => assertStateOwnership(buildState(), { runId: "run-2", userId: USER_ID }),
    StateOwnershipError,
  );
});

test("a state written for the wrong user is rejected", () => {
  assert.throws(
    () => assertStateOwnership(buildState(), { runId: RUN_ID, userId: 99 }),
    StateOwnershipError,
  );
});

test("an ownership failure never echoes the user id", () => {
  // This message reaches logs. Naming the field is diagnostic; naming the
  // tenant is a small leak repeated on every failure.
  let caught: unknown;
  try {
    assertStateOwnership(buildState(), { runId: RUN_ID, userId: 777_777 });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof StateOwnershipError);
  assert.equal(caught.field, "userId");
  assert.equal(caught.message.includes("777777"), false);
  assert.equal(caught.message.includes(String(USER_ID)), false);
});

/* -------------------------------------------------------------------------- */
/* size                                                                        */
/* -------------------------------------------------------------------------- */

test("a state within the limit passes", () => {
  assert.doesNotThrow(() => assertStateWithinSizeLimit(buildState(), 262_144));
  assert.ok(estimateStateBytes(buildState()) > 0);
});

test("an oversized state names the channels responsible", () => {
  // The realistic cause: a node putting evidence *bodies* where references
  // belong. "State is 300KB" prompts a guess; "evidence=280KB" points at it.
  const bloated = buildState({
    evidence: Array.from({ length: 200 }, (_, index) => ({
      ...AGT01_FIXTURES.evidenceRef,
      evidenceId: `evidence-${index}`,
      title: "x".repeat(280),
    })),
  });

  let caught: unknown;
  try {
    assertStateWithinSizeLimit(bloated, 4_096);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof CheckpointTooLargeError);
  assert.equal(caught.maxBytes, 4_096);
  assert.ok(caught.bytes > 4_096);
  assert.equal(
    caught.largestChannels[0].channel,
    "evidence",
    "the biggest channel must be named first",
  );
  assert.match(caught.message, /evidence=\d+B/);
});

test("the channel breakdown is ordered by size", () => {
  const sizes = channelSizes(
    buildState({
      candidateAnswer: "y".repeat(5_000),
    }) as unknown as Record<string, unknown>,
  );

  assert.equal(sizes[0].channel, "candidateAnswer");
  for (let index = 1; index < sizes.length; index += 1) {
    assert.ok(sizes[index - 1].bytes >= sizes[index].bytes, "sizes must descend");
  }
});

/* -------------------------------------------------------------------------- */
/* the composed gate                                                           */
/* -------------------------------------------------------------------------- */

test("a well-formed state passes every gate", () => {
  assert.doesNotThrow(() => assertCheckpointSafe(buildState(), scope));
});

test("the gate rejects a state that cannot round-trip through JSON", () => {
  // A checkpoint that cannot serialize is a run that cannot resume. The FND-02
  // guard catches the whole family; a cycle stands in for it here.
  const cyclic = buildState() as unknown as Record<string, unknown>;
  cyclic.request = { ...(cyclic.request as object) };
  (cyclic.request as Record<string, unknown>).self = cyclic;

  assert.throws(
    () => assertCheckpointSafe(cyclic as never, scope),
    /circular reference/,
  );
});

test("the gate reports the most specific failure first", () => {
  // An oversized state belonging to the wrong user is an ownership bug, not a
  // size bug, and the error should say so.
  const wrongOwner = buildState({
    candidateAnswer: "z".repeat(10_000),
  });

  assert.throws(
    () => assertCheckpointSafe(wrongOwner, { runId: "run-2", userId: USER_ID, maxBytes: 64 }),
    StateOwnershipError,
  );
});
