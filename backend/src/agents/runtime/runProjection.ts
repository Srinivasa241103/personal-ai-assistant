/**
 * AGT-02 — mirror validated checkpoint state into `agent_runs`.
 *
 * The LangGraph checkpoint is authoritative for which node runs next. The
 * `agent_runs` row is the tenant-scoped, queryable lifecycle projection used by
 * status APIs and resume authorization. A process can die between those two
 * writes, so resume validates the checkpoint and calls this projection again;
 * repeated projection of the same status is deliberately idempotent.
 */

import type { Pool } from "pg";
import { FLOW_CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
import type { JsonObject } from "../../database/foundation/types.js";
import { AgentRunRepository } from "../../database/foundation/agentRunRepository.js";
import { AuditEventRepository } from "../../database/foundation/auditEventRepository.js";
import { withTransaction } from "../../database/transaction.js";
import { assertStatusTransition } from "../state/statusTransitions.js";
import type { MyraAgentState } from "../state/stateSchema.js";
import { AGENT_GRAPH_VERSION, assertRunVersionCompatible } from "./graphVersion.js";
import {
  InvalidCheckpointMetadataError,
  RunNotFoundError,
  StaleRunProjectionError,
} from "./runErrors.js";
import type { CheckpointWriteObserver } from "./checkpointer.js";

function jsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}

function assertRowMatchesState(
  row: {
    conversation_id: string;
    flow: string | null;
    graph_version: string | null;
    status: MyraAgentState["status"];
  },
  state: MyraAgentState,
): void {
  assertRunVersionCompatible(row.graph_version, state);
  if (
    row.conversation_id !== state.conversationId ||
    (row.flow !== null && row.flow !== state.flow)
  ) {
    throw new InvalidCheckpointMetadataError();
  }
  assertStatusTransition(row.status, state.status);
}

export class RunCheckpointProjection implements CheckpointWriteObserver {
  constructor(private readonly pool: Pool) {}

  /**
   * Tenant authorization happens before PostgreSQL receives checkpoint bytes.
   * The checkpoint tables carry no user_id, so this lookup is the isolation
   * boundary recorded beside migration 0003.
   */
  async beforeCheckpoint(state: MyraAgentState): Promise<void> {
    const row = await new AgentRunRepository(this.pool).findById(
      state.userId,
      state.runId,
    );
    if (!row) throw new RunNotFoundError();
    assertRowMatchesState(row, state);
  }

  async afterCheckpoint(state: MyraAgentState): Promise<void> {
    await withTransaction(async (client) => {
      const runs = new AgentRunRepository(client);
      const audit = new AuditEventRepository(client);
      const row = await runs.findByIdForUpdate(state.userId, state.runId);
      if (!row) throw new RunNotFoundError();

      assertRowMatchesState(row, state);
      const latestError = state.errors.at(-1) ?? null;
      const updated = await runs.updateLifecycle({
        userId: state.userId,
        runId: state.runId,
        expectedStatus: row.status,
        status: state.status,
        flow: state.flow,
        flowContractVersion: state.flow ? FLOW_CONTRACT_SCHEMA_VERSION : null,
        graphVersion: AGENT_GRAPH_VERSION,
        state: jsonObject(state),
        budgetUsage: jsonObject(state.budgetUsage),
        errorCode: latestError?.code ?? null,
        errorMessage: latestError?.message ?? null,
      });
      if (!updated) throw new StaleRunProjectionError();

      if (row.status !== state.status) {
        await audit.append({
          userId: state.userId,
          runId: state.runId,
          eventType: "run.status_changed",
          entityType: "agent_run",
          entityId: state.runId,
          details: {
            from: row.status,
            to: state.status,
            graphVersion: AGENT_GRAPH_VERSION,
          },
        });
      }
    }, {}, this.pool);
  }
}
