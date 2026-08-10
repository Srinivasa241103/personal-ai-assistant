/** AGT-02 — credentials are rejected before the backing saver is called. */

import assert from "node:assert/strict";
import test from "node:test";
import { emptyCheckpoint, MemorySaver } from "@langchain/langgraph";

import { GuardedCheckpointSaver } from "../../src/agents/runtime/checkpointer.js";
import { createRunGraphConfig } from "../../src/agents/runtime/graphVersion.js";
import { CredentialInStateError } from "../../src/agents/state/stateGuards.js";
import { buildState } from "../fixtures/agt01-state-fixtures.js";
import { CREDENTIAL_SHAPE_FIXTURES } from "../fixtures/credential-shape-fixtures.js";

test("a token in a full checkpoint never reaches the backing store", async () => {
  const state = buildState({
    candidateAnswer: CREDENTIAL_SHAPE_FIXTURES.anthropicApiKey,
  });
  const config = createRunGraphConfig(state);
  const delegate = new MemorySaver();
  const saver = new GuardedCheckpointSaver(delegate, { maxStateBytes: 262_144 });
  const checkpoint = {
    ...emptyCheckpoint(),
    channel_values: state as unknown as Record<string, unknown>,
  };
  const metadata = {
    source: "update" as const,
    step: 1,
    parents: {},
    ...config.metadata,
  };

  await assert.rejects(
    () => saver.put(config, checkpoint, metadata, {}),
    CredentialInStateError,
  );
  assert.equal(await delegate.getTuple(config), undefined);
});
