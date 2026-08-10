/**
 * AGT-02 — durable run lifecycle.
 *
 * This is intentionally below the future API and above LangGraph. AGT-07 will
 * turn authenticated requests into these calls; AGT-03/04 will supply the
 * compiled graph. Keeping those concerns out leaves start/resume/cancel rules
 * deterministic and testable with a three-node fixture graph.
 */

import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { Pool } from "pg";
import {
  FLOW_CONTRACT_SCHEMA_VERSION,
  type RunBudgetLimits,
} from "../contracts/index.js";
import { getRuntimeConfig, type RuntimeConfig } from "../../config/runtimeConfig.js";
import {
  AgentRunRepository,
  type AgentRunRecord,
} from "../../database/foundation/agentRunRepository.js";
import { AuditEventRepository } from "../../database/foundation/auditEventRepository.js";
import type { JsonObject } from "../../database/foundation/types.js";
import { withTransaction } from "../../database/transaction.js";
import { CHANNEL_CAPS } from "../state/channels.js";
import {
  AGENT_STATE_SCHEMA_VERSION,
  MyraAgentStateSchema,
  createInitialState,
  type AgentRequest,
  type AgentRunError,
  type MyraAgentState,
} from "../state/stateSchema.js";
import {
  assertStatusTransition,
  isInterruptStatus,
  isTerminalStatus,
} from "../state/statusTransitions.js";
import {
  validateCheckpointTuple,
  type GuardedCheckpointSaver,
} from "./checkpointer.js";
import { RunCancellationRegistry, type RunExecutionLease } from "./cancellation.js";
import {
  AGENT_GRAPH_VERSION,
  assertRunVersionCompatible,
  createRunGraphConfig,
} from "./graphVersion.js";
import {
  IncompatibleRunVersionError,
  MissingRunCheckpointError,
  RunCancelledError,
  RunNotFoundError,
  RunNotResumableError,
  StaleRunProjectionError,
  normalizeRunError,
} from "./runErrors.js";
import { RunCheckpointProjection } from "./runProjection.js";

function jsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}

function stateSchemaVersion(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as { schemaVersion?: unknown }).schemaVersion;
}

export function parseStoredRunState(row: AgentRunRecord): MyraAgentState {
  if (
    row.graph_version !== AGENT_GRAPH_VERSION ||
    stateSchemaVersion(row.state) !== AGENT_STATE_SCHEMA_VERSION
  ) {
    throw new IncompatibleRunVersionError();
  }

  const state = MyraAgentStateSchema.parse(row.state);
  assertRunVersionCompatible(row.graph_version, state);
  if (
    state.runId !== row.id ||
    String(state.userId) !== String(row.user_id) ||
    state.conversationId !== row.conversation_id
  ) {
    throw new IncompatibleRunVersionError();
  }
  return state;
}

function appendError(
  errors: readonly AgentRunError[],
  error: AgentRunError,
): AgentRunError[] {
  if (errors.length >= CHANNEL_CAPS.errors) return [...errors];
  return [...errors, error];
}

export interface StartAgentRunInput {
  runId: string;
  userId: string | number;
  conversationId: string;
  request: AgentRequest;
  budgetLimits?: RunBudgetLimits;
}

export interface RunExecution {
  state: MyraAgentState;
  config: LangGraphRunnableConfig;
  signal: AbortSignal;
  release(): void;
}

export interface AgentRunLifecycleOptions {
  pool: Pool;
  checkpointer: GuardedCheckpointSaver;
  projection: RunCheckpointProjection;
  agentConfig?: RuntimeConfig["agents"];
  cancellations?: RunCancellationRegistry;
  now?: () => Date;
}

export class AgentRunLifecycle {
  private readonly agentConfig: RuntimeConfig["agents"];
  private readonly cancellations: RunCancellationRegistry;
  private readonly now: () => Date;

  constructor(private readonly options: AgentRunLifecycleOptions) {
    this.agentConfig = options.agentConfig ?? getRuntimeConfig().agents;
    this.cancellations = options.cancellations ?? new RunCancellationRegistry();
    this.now = options.now ?? (() => new Date());
  }

  async startRun(input: StartAgentRunInput): Promise<RunExecution> {
    const state = createInitialState({
      runId: input.runId,
      userId: input.userId,
      conversationId: input.conversationId,
      request: input.request,
      budgetLimits: input.budgetLimits ?? this.agentConfig.budgets,
    });

    await withTransaction(async (client) => {
      const runs = new AgentRunRepository(client);
      const audit = new AuditEventRepository(client);
      await runs.create({
        id: input.runId,
        userId: input.userId,
        conversationId: input.conversationId,
        requestId: input.request.requestId,
        flow: null,
        status: "created",
        schemaVersion: AGENT_STATE_SCHEMA_VERSION,
        flowContractVersion: null,
        graphVersion: AGENT_GRAPH_VERSION,
        requestPayload: jsonObject(input.request),
        state: jsonObject(state),
        budgetLimits: jsonObject(state.budgetLimits),
        budgetUsage: jsonObject(state.budgetUsage),
      });
      await audit.append({
        userId: input.userId,
        runId: input.runId,
        eventType: "run.created",
        entityType: "agent_run",
        entityId: input.runId,
        details: { graphVersion: AGENT_GRAPH_VERSION },
      });
    }, {}, this.options.pool);

    return this.execution(state);
  }

  async resumeRun(userId: string | number, runId: string): Promise<RunExecution> {
    const row = await new AgentRunRepository(this.options.pool).findById(userId, runId);
    if (!row) throw new RunNotFoundError();

    const projectedState = parseStoredRunState(row);
    if (isTerminalStatus(projectedState.status)) throw new RunNotResumableError();

    const config = createRunGraphConfig({
      runId,
      userId,
      conversationId: projectedState.conversationId,
    });
    const tuple = await this.options.checkpointer.getTuple(config);
    if (!tuple) throw new MissingRunCheckpointError();

    const checkpointState = validateCheckpointTuple(
      tuple,
      config,
      this.agentConfig.checkpointing.maxStateBytes,
    );
    if (
      checkpointState.runId !== runId ||
      String(checkpointState.userId) !== String(userId) ||
      checkpointState.conversationId !== projectedState.conversationId ||
      !isInterruptStatus(checkpointState.status)
    ) {
      throw new RunNotResumableError();
    }

    // Repairs the narrow crash window where LangGraph committed the checkpoint
    // and the process stopped before the searchable row was updated.
    await this.options.projection.afterCheckpoint(checkpointState);
    return this.execution(checkpointState);
  }

  async getRunState(userId: string | number, runId: string): Promise<MyraAgentState> {
    const row = await new AgentRunRepository(this.options.pool).findById(userId, runId);
    if (!row) throw new RunNotFoundError();
    return parseStoredRunState(row);
  }

  async cancelRun(userId: string | number, runId: string): Promise<MyraAgentState> {
    const cancelled = await this.transitionToTerminal(
      userId,
      runId,
      "cancelled",
      new RunCancelledError(),
    );
    this.cancellations.cancel(runId);
    return cancelled;
  }

  async failRun(
    userId: string | number,
    runId: string,
    error: unknown,
  ): Promise<MyraAgentState> {
    return this.transitionToTerminal(userId, runId, "failed", error);
  }

  private execution(state: MyraAgentState): RunExecution {
    const lease: RunExecutionLease = this.cancellations.acquire(state.runId);
    const config = createRunGraphConfig(
      {
        runId: state.runId,
        userId: state.userId,
        conversationId: state.conversationId,
      },
      lease.signal,
    );

    return {
      state,
      config,
      signal: lease.signal,
      release: lease.release,
    };
  }

  private async transitionToTerminal(
    userId: string | number,
    runId: string,
    status: "failed" | "cancelled",
    cause: unknown,
  ): Promise<MyraAgentState> {
    return withTransaction(async (client) => {
      const runs = new AgentRunRepository(client);
      const audit = new AuditEventRepository(client);
      const row = await runs.findByIdForUpdate(userId, runId);
      if (!row) throw new RunNotFoundError();

      const current = parseStoredRunState(row);
      if (current.status === status) return current;
      assertStatusTransition(current.status, status);

      const normalized = normalizeRunError(cause, this.now().toISOString());
      const next = MyraAgentStateSchema.parse({
        ...current,
        status,
        cancellationRequested: status === "cancelled" || current.cancellationRequested,
        errors: appendError(current.errors, normalized),
      });
      const updated = await runs.updateLifecycle({
        userId,
        runId,
        expectedStatus: current.status,
        status,
        flow: next.flow,
        flowContractVersion: next.flow ? FLOW_CONTRACT_SCHEMA_VERSION : null,
        graphVersion: AGENT_GRAPH_VERSION,
        state: jsonObject(next),
        budgetUsage: jsonObject(next.budgetUsage),
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
      if (!updated) throw new StaleRunProjectionError();

      await audit.append({
        userId,
        runId,
        eventType: status === "cancelled" ? "run.cancelled" : "run.failed",
        entityType: "agent_run",
        entityId: runId,
        details: {
          from: current.status,
          to: status,
          errorCode: normalized.code,
          graphVersion: AGENT_GRAPH_VERSION,
        },
      });
      return next;
    }, {}, this.options.pool);
  }
}
