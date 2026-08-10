/** AGT-02 — the AGT-01 guard is wired into the actual saver protocol. */

import assert from "node:assert/strict";
import test from "node:test";
import { emptyCheckpoint, MemorySaver } from "@langchain/langgraph";

import {
  GuardedCheckpointSaver,
  extractCheckpointState,
} from "../../../../src/agents/runtime/checkpointer.js";
import {
  CHECKPOINT_METADATA_KEYS,
  createRunGraphConfig,
} from "../../../../src/agents/runtime/graphVersion.js";
import { InvalidCheckpointMetadataError } from "../../../../src/agents/runtime/runErrors.js";
import { CredentialInStateError } from "../../../../src/agents/state/stateGuards.js";
import { AGT01_FIXTURES, buildState } from "../../../fixtures/agt01-state-fixtures.js";
import { CREDENTIAL_SHAPE_FIXTURES } from "../../../fixtures/credential-shape-fixtures.js";

const state = buildState();
const config = createRunGraphConfig(state);
const metadata = {
  source: "update" as const,
  step: 1,
  parents: {},
  ...config.metadata,
};

function checkpoint(value = state) {
  return {
    ...emptyCheckpoint(),
    channel_values: value as unknown as Record<string, unknown>,
  };
}

test("a valid state is persisted and restored through the guarded saver", async () => {
  const delegate = new MemorySaver();
  const saver = new GuardedCheckpointSaver(delegate, { maxStateBytes: 262_144 });

  const stored = await saver.put(config, checkpoint(), metadata, {});
  const restored = await saver.getTuple(stored);

  assert.ok(restored);
  assert.deepEqual(extractCheckpointState(restored.checkpoint), state);
});

test("LangGraph bookkeeping channels are not passed into the strict state schema", () => {
  const withBookkeeping = checkpoint({
    ...state,
    "branch:to:next": "next",
  } as never);

  assert.deepEqual(extractCheckpointState(withBookkeeping), state);
});

test("a thread not derived from the state is rejected before persistence", async () => {
  const delegate = new MemorySaver();
  const saver = new GuardedCheckpointSaver(delegate, { maxStateBytes: 262_144 });
  const wrongConfig = {
    ...config,
    configurable: { ...config.configurable, thread_id: "wrong-thread" },
  };

  await assert.rejects(
    () => saver.put(wrongConfig, checkpoint(), metadata, {}),
    InvalidCheckpointMetadataError,
  );
  assert.equal(await delegate.getTuple(config), undefined);
});

test("missing graph metadata is rejected", async () => {
  const saver = new GuardedCheckpointSaver(new MemorySaver(), {
    maxStateBytes: 262_144,
  });
  const missingConfig = { ...config, metadata: {} };

  await assert.rejects(
    () => saver.put(missingConfig, checkpoint(), metadata, {}),
    InvalidCheckpointMetadataError,
  );
});

test("pending state writes are scanned before the delegate sees them", async () => {
  const delegate = new MemorySaver();
  const saver = new GuardedCheckpointSaver(delegate, { maxStateBytes: 262_144 });

  await assert.rejects(
    () =>
      saver.putWrites(
        config,
        [["candidateAnswer", CREDENTIAL_SHAPE_FIXTURES.bearerHeader]],
        "task-1",
      ),
    CredentialInStateError,
  );
});

test("checkpoint metadata constants cannot drift from config construction", () => {
  assert.equal(
    metadata[CHECKPOINT_METADATA_KEYS.graphVersion],
    config.metadata?.[CHECKPOINT_METADATA_KEYS.graphVersion],
  );
  assert.equal(AGT01_FIXTURES.request.requestId, state.request.requestId);
});
