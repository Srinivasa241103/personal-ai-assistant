/** AGT-02 — graph and checkpoint compatibility policy. */

import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { AGENT_STATE_SCHEMA_VERSION, type MyraAgentState } from "../state/stateSchema.js";
import { IncompatibleRunVersionError, InvalidCheckpointMetadataError } from "./runErrors.js";
import { buildRunThreadId, type RunCheckpointScope } from "./threadIdentity.js";

/**
 * Independent from domain and state schema versions. Change this whenever a
 * topology change could make resuming at an old node unsafe.
 */
export const AGENT_GRAPH_VERSION = "2.0.0" as const;

export const CHECKPOINT_METADATA_KEYS = Object.freeze({
  graphVersion: "myra_graph_version",
  stateSchemaVersion: "myra_state_schema_version",
  threadIdVersion: "myra_thread_id_version",
});

export function createRunGraphConfig(
  scope: RunCheckpointScope,
  signal?: AbortSignal,
): LangGraphRunnableConfig {
  return {
    configurable: {
      thread_id: buildRunThreadId(scope),
      checkpoint_ns: "",
    },
    metadata: {
      [CHECKPOINT_METADATA_KEYS.graphVersion]: AGENT_GRAPH_VERSION,
      [CHECKPOINT_METADATA_KEYS.stateSchemaVersion]: AGENT_STATE_SCHEMA_VERSION,
      [CHECKPOINT_METADATA_KEYS.threadIdVersion]: "v1",
    },
    ...(signal ? { signal } : {}),
  };
}

export function assertRunVersionCompatible(
  storedGraphVersion: string | null,
  state: Pick<MyraAgentState, "schemaVersion">,
): void {
  if (
    storedGraphVersion !== AGENT_GRAPH_VERSION ||
    state.schemaVersion !== AGENT_STATE_SCHEMA_VERSION
  ) {
    throw new IncompatibleRunVersionError();
  }
}

export function assertCheckpointMetadata(
  config: LangGraphRunnableConfig,
  metadata: Record<string, unknown> | undefined,
  state: MyraAgentState,
): void {
  const expectedThreadId = buildRunThreadId({
    runId: state.runId,
    userId: state.userId,
    conversationId: state.conversationId,
  });
  const configuredThreadId = config.configurable?.thread_id;
  const graphVersion = metadata?.[CHECKPOINT_METADATA_KEYS.graphVersion];
  const stateSchemaVersion = metadata?.[CHECKPOINT_METADATA_KEYS.stateSchemaVersion];
  const threadIdVersion = metadata?.[CHECKPOINT_METADATA_KEYS.threadIdVersion];

  if (
    configuredThreadId !== expectedThreadId ||
    graphVersion !== AGENT_GRAPH_VERSION ||
    stateSchemaVersion !== AGENT_STATE_SCHEMA_VERSION ||
    threadIdVersion !== "v1"
  ) {
    throw new InvalidCheckpointMetadataError();
  }
}
