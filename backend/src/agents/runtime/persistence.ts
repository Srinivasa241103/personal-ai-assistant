/** AGT-02 — assemble the shared checkpointer, projection, and lifecycle. */

import type { Pool } from "pg";
import { getPool } from "../../config/dbConfig.js";
import { getRuntimeConfig, type RuntimeConfig } from "../../config/runtimeConfig.js";
import { createPostgresCheckpointSaver } from "./checkpointer.js";
import { RunCancellationRegistry } from "./cancellation.js";
import { AgentRunLifecycle } from "./runLifecycle.js";
import { RunCheckpointProjection } from "./runProjection.js";

export interface AgentRuntimePersistence {
  checkpointer: Awaited<ReturnType<typeof createPostgresCheckpointSaver>>;
  lifecycle: AgentRunLifecycle;
}

export async function createAgentRuntimePersistence(options: {
  pool?: Pool;
  agentConfig?: RuntimeConfig["agents"];
  cancellations?: RunCancellationRegistry;
  now?: () => Date;
} = {}): Promise<AgentRuntimePersistence> {
  const pool = options.pool ?? getPool();
  const agentConfig = options.agentConfig ?? getRuntimeConfig().agents;
  const projection = new RunCheckpointProjection(pool);
  const checkpointer = await createPostgresCheckpointSaver({
    pool,
    schema: agentConfig.checkpointing.schema,
    maxStateBytes: agentConfig.checkpointing.maxStateBytes,
    observer: projection,
  });
  const lifecycle = new AgentRunLifecycle({
    pool,
    checkpointer,
    projection,
    agentConfig,
    ...(options.cancellations ? { cancellations: options.cancellations } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  return { checkpointer, lifecycle };
}

let shared: Promise<AgentRuntimePersistence> | undefined;

/** Lazily initialized so the disabled-by-default runtime does no boot I/O. */
export function getAgentRuntimePersistence(): Promise<AgentRuntimePersistence> {
  shared ??= createAgentRuntimePersistence();
  return shared;
}

export function resetAgentRuntimePersistenceForTests(): void {
  shared = undefined;
}
