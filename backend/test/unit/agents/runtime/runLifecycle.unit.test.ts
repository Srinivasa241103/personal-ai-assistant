/** AGT-02 — stored projections remain bound to their database owner. */

import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_GRAPH_VERSION } from "../../../../src/agents/runtime/graphVersion.js";
import { parseStoredRunState } from "../../../../src/agents/runtime/runLifecycle.js";
import { IncompatibleRunVersionError } from "../../../../src/agents/runtime/runErrors.js";
import type { AgentRunRecord } from "../../../../src/database/foundation/agentRunRepository.js";
import { buildState } from "../../../fixtures/agt01-state-fixtures.js";

function storedRow(
  overrides: Partial<AgentRunRecord> = {},
): AgentRunRecord {
  const state = buildState();
  return {
    id: state.runId,
    user_id: state.userId,
    conversation_id: state.conversationId,
    request_id: state.request.requestId,
    flow: state.flow,
    status: state.status,
    schema_version: state.schemaVersion,
    flow_contract_version: null,
    graph_version: AGENT_GRAPH_VERSION,
    request_payload: state.request,
    state,
    budget_limits: state.budgetLimits,
    budget_usage: state.budgetUsage,
    error_code: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: new Date("2026-08-10T09:00:00.000Z"),
    updated_at: new Date("2026-08-10T09:00:00.000Z"),
    ...overrides,
  };
}

test("a PostgreSQL bigint string matches the same numeric state owner", () => {
  const state = buildState();
  assert.deepEqual(
    parseStoredRunState(storedRow({ user_id: String(state.userId) })),
    state,
  );
});

test("a state belonging to another user is rejected", () => {
  assert.throws(
    () => parseStoredRunState(storedRow({ user_id: "999999" })),
    IncompatibleRunVersionError,
  );
});
