/**
 * AGT-02 — guarded PostgreSQL checkpointing.
 *
 * Migration 0003 owns the tables. This module verifies that owned schema,
 * wraps the pinned PostgresSaver, and makes AGT-01's state guard unavoidable at
 * the persistence boundary. The raw saver is never exported from `agents`.
 */

import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointTuple,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { Pool } from "pg";
import { assertJsonSerializable } from "../contracts/index.js";
import { AGENT_STATE_CHANNEL_NAMES } from "../state/channels.js";
import {
  assertCheckpointSafe,
  assertNoCredentialMaterial,
  assertStateWithinSizeLimit,
} from "../state/stateGuards.js";
import {
  AGENT_STATE_SCHEMA_VERSION,
  MyraAgentStateSchema,
  type MyraAgentState,
} from "../state/stateSchema.js";
import {
  CHECKPOINT_METADATA_KEYS,
  assertCheckpointMetadata,
} from "./graphVersion.js";
import {
  CheckpointSchemaUnavailableError,
  IncompatibleRunVersionError,
} from "./runErrors.js";

const EXPECTED_CHECKPOINT_TABLES = [
  "checkpoint_blobs",
  "checkpoint_migrations",
  "checkpoint_writes",
  "checkpoints",
] as const;
const EXPECTED_CHECKPOINT_MIGRATIONS = [0, 1, 2, 3, 4] as const;
const POSTGRES_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface CheckpointWriteObserver {
  beforeCheckpoint(state: MyraAgentState): Promise<void>;
  afterCheckpoint(state: MyraAgentState): Promise<void>;
}

export interface GuardedCheckpointOptions {
  maxStateBytes: number;
  observer?: CheckpointWriteObserver;
}

function stateCandidate(checkpoint: Checkpoint): unknown {
  const values = checkpoint.channel_values;

  // The input checkpoint stores the seed under __start__. Every later
  // checkpoint stores state channels directly, sometimes alongside LangGraph
  // bookkeeping channels that the strict Myra schema must not receive.
  if (values.__start__ !== undefined) return values.__start__;

  return Object.fromEntries(
    AGENT_STATE_CHANNEL_NAMES
      .filter((channel) => Object.prototype.hasOwnProperty.call(values, channel))
      .map((channel) => [channel, values[channel]]),
  );
}

export function extractCheckpointState(checkpoint: Checkpoint): MyraAgentState {
  const candidate = stateCandidate(checkpoint);
  if (
    !candidate ||
    typeof candidate !== "object" ||
    (candidate as { schemaVersion?: unknown }).schemaVersion !==
      AGENT_STATE_SCHEMA_VERSION
  ) {
    throw new IncompatibleRunVersionError();
  }
  return MyraAgentStateSchema.parse(candidate);
}

export function validateCheckpointTuple(
  tuple: CheckpointTuple,
  config: LangGraphRunnableConfig,
  maxStateBytes: number,
): MyraAgentState {
  const state = extractCheckpointState(tuple.checkpoint);
  assertCheckpointSafe(state, {
    runId: state.runId,
    userId: state.userId,
    maxBytes: maxStateBytes,
  });
  assertCheckpointMetadata(
    config,
    tuple.metadata as Record<string, unknown> | undefined,
    state,
  );
  return state;
}

/**
 * Delegates the storage protocol byte-for-byte. Only the two write methods add
 * policy: full checkpoints pass the composed AGT-01 guard, and pending writes
 * are scanned so a credential cannot sit in PostgreSQL before the next full
 * checkpoint has a chance to reject it.
 */
export class GuardedCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly delegate: BaseCheckpointSaver,
    private readonly options: GuardedCheckpointOptions,
  ) {
    super(delegate.serde);
  }

  override getTuple(
    config: Parameters<BaseCheckpointSaver["getTuple"]>[0],
  ): ReturnType<BaseCheckpointSaver["getTuple"]> {
    return this.delegate.getTuple(config);
  }

  override list(
    config: Parameters<BaseCheckpointSaver["list"]>[0],
    options?: Parameters<BaseCheckpointSaver["list"]>[1],
  ): ReturnType<BaseCheckpointSaver["list"]> {
    return this.delegate.list(config, options);
  }

  override async put(
    config: Parameters<BaseCheckpointSaver["put"]>[0],
    checkpoint: Parameters<BaseCheckpointSaver["put"]>[1],
    metadata: Parameters<BaseCheckpointSaver["put"]>[2],
    newVersions: Parameters<BaseCheckpointSaver["put"]>[3],
  ): ReturnType<BaseCheckpointSaver["put"]> {
    const state = extractCheckpointState(checkpoint);
    assertCheckpointSafe(state, {
      runId: state.runId,
      userId: state.userId,
      maxBytes: this.options.maxStateBytes,
    });
    // Normal StateGraph execution does not copy RunnableConfig.metadata into
    // CheckpointMetadata (manual updateState does). Validate the config and
    // copy only MyRA's three version keys into the durable metadata ourselves.
    assertCheckpointMetadata(config, config.metadata, state);
    const durableMetadata = {
      ...metadata,
      [CHECKPOINT_METADATA_KEYS.graphVersion]:
        config.metadata?.[CHECKPOINT_METADATA_KEYS.graphVersion],
      [CHECKPOINT_METADATA_KEYS.stateSchemaVersion]:
        config.metadata?.[CHECKPOINT_METADATA_KEYS.stateSchemaVersion],
      [CHECKPOINT_METADATA_KEYS.threadIdVersion]:
        config.metadata?.[CHECKPOINT_METADATA_KEYS.threadIdVersion],
    };

    await this.options.observer?.beforeCheckpoint(state);
    const stored = await this.delegate.put(
      config,
      checkpoint,
      durableMetadata,
      newVersions,
    );
    await this.options.observer?.afterCheckpoint(state);
    return stored;
  }

  override async putWrites(
    config: Parameters<BaseCheckpointSaver["putWrites"]>[0],
    writes: Parameters<BaseCheckpointSaver["putWrites"]>[1],
    taskId: Parameters<BaseCheckpointSaver["putWrites"]>[2],
  ): ReturnType<BaseCheckpointSaver["putWrites"]> {
    assertStateWithinSizeLimit(writes, this.options.maxStateBytes);
    for (const [channel, value] of writes) {
      // Scan every value, including interrupts and error writes. Only declared
      // state channels are required to be plain JSON: LangGraph's internal
      // channels legitimately carry Command/Send/Error class instances.
      assertNoCredentialMaterial(value);
      assertStateWithinSizeLimit(value, this.options.maxStateBytes);
      if (AGENT_STATE_CHANNEL_NAMES.includes(channel)) {
        assertJsonSerializable(value);
      }
    }

    await this.delegate.putWrites(config, writes, taskId);
  }

  override deleteThread(
    threadId: Parameters<BaseCheckpointSaver["deleteThread"]>[0],
  ): ReturnType<BaseCheckpointSaver["deleteThread"]> {
    return this.delegate.deleteThread(threadId);
  }
}

export async function verifyOwnedCheckpointSchema(
  pool: Pool,
  schema: string,
): Promise<void> {
  if (!POSTGRES_IDENTIFIER.test(schema)) {
    throw new CheckpointSchemaUnavailableError();
  }

  try {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name LIKE 'checkpoint%'
        ORDER BY table_name`,
      [schema],
    );
    const versions = await pool.query<{ v: number }>(
      `SELECT v FROM "${schema}".checkpoint_migrations ORDER BY v`,
    );

    if (
      JSON.stringify(tables.rows.map((row) => row.table_name)) !==
        JSON.stringify(EXPECTED_CHECKPOINT_TABLES) ||
      JSON.stringify(versions.rows.map((row) => row.v)) !==
        JSON.stringify(EXPECTED_CHECKPOINT_MIGRATIONS)
    ) {
      throw new CheckpointSchemaUnavailableError();
    }
  } catch (error) {
    if (error instanceof CheckpointSchemaUnavailableError) throw error;
    throw new CheckpointSchemaUnavailableError();
  }
}

export async function createPostgresCheckpointSaver(options: {
  pool: Pool;
  schema: string;
  maxStateBytes: number;
  observer?: CheckpointWriteObserver;
}): Promise<GuardedCheckpointSaver> {
  // Verify before setup. `setup()` is required by the library, but it must be a
  // no-op here; allowing it to run first would let an application process
  // become a competing schema author in production.
  await verifyOwnedCheckpointSchema(options.pool, options.schema);

  const postgres = new PostgresSaver(options.pool, undefined, {
    schema: options.schema,
  });
  await postgres.setup();

  return new GuardedCheckpointSaver(postgres, {
    maxStateBytes: options.maxStateBytes,
    ...(options.observer ? { observer: options.observer } : {}),
  });
}
