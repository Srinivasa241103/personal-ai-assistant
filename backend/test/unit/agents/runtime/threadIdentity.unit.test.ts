/** AGT-02 — stable checkpoint identity and version metadata. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_GRAPH_VERSION,
  CHECKPOINT_METADATA_KEYS,
  assertRunVersionCompatible,
  createRunGraphConfig,
} from "../../../../src/agents/runtime/graphVersion.js";
import { IncompatibleRunVersionError } from "../../../../src/agents/runtime/runErrors.js";
import { buildRunThreadId } from "../../../../src/agents/runtime/threadIdentity.js";
import { AGENT_STATE_SCHEMA_VERSION } from "../../../../src/agents/state/stateSchema.js";

const scope = {
  runId: "run-1",
  userId: 42,
  conversationId: "conversation-1",
};

test("the same run scope always produces the same opaque thread id", () => {
  const first = buildRunThreadId(scope);
  const second = buildRunThreadId({ ...scope });

  assert.equal(first, second);
  assert.match(first, /^myra:v1:[a-f0-9]{64}$/);
  assert.equal(first.includes(scope.runId), false);
  assert.equal(first.includes(scope.conversationId), false);
  assert.equal(first.includes(String(scope.userId)), false);
});

test("changing any ownership field changes the thread", () => {
  const base = buildRunThreadId(scope);
  assert.notEqual(buildRunThreadId({ ...scope, runId: "run-2" }), base);
  assert.notEqual(buildRunThreadId({ ...scope, userId: 43 }), base);
  assert.notEqual(
    buildRunThreadId({ ...scope, conversationId: "conversation-2" }),
    base,
  );
});

test("graph config pins every version needed for resume", () => {
  const config = createRunGraphConfig(scope);

  assert.equal(config.configurable?.thread_id, buildRunThreadId(scope));
  assert.equal(config.configurable?.checkpoint_ns, "");
  assert.equal(
    config.metadata?.[CHECKPOINT_METADATA_KEYS.graphVersion],
    AGENT_GRAPH_VERSION,
  );
  assert.equal(
    config.metadata?.[CHECKPOINT_METADATA_KEYS.stateSchemaVersion],
    AGENT_STATE_SCHEMA_VERSION,
  );
});

test("resume accepts only the exact graph and state versions", () => {
  assert.doesNotThrow(() =>
    assertRunVersionCompatible(AGENT_GRAPH_VERSION, {
      schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    }),
  );
  assert.throws(
    () =>
      assertRunVersionCompatible("1.0.0", {
        schemaVersion: AGENT_STATE_SCHEMA_VERSION,
      }),
    IncompatibleRunVersionError,
  );
});
