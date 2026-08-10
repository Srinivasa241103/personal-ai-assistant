/**
 * `agents` — the LangGraph agent runtime.
 *
 * Layer 4, the top of the V2 stack: the Supervisor graph, its nodes, the
 * capability subagents, and the deterministic policies that bound them. It
 * orchestrates the layers below and nothing depends on it except `evaluation`.
 *
 * Two rules this module lives by, both enforced by the FND-07 architecture test:
 *   * It reaches **user data** only through `tools` — never a connector SDK,
 *     never a credential store. `googleapis`, `credentialRepository`, and
 *     `service/oauth` are what `CREDENTIAL_SPECIFIER_PATTERNS` names and what
 *     the architecture test rejects here. An agent that can read a refresh
 *     token is an agent that can leak one into a prompt.
 *
 *     The **reasoning model client** is the documented exception, sanctioned by
 *     master plan §13.4 — "LangGraph for control and provider model clients
 *     inside nodes". It is confined to `src/agents/models/`, its key is the
 *     process's own rather than any user's, it grants access to no user data,
 *     and revoking it stops the system rather than exposing anyone. The
 *     distinction is between the model that thinks and the connectors that hold
 *     someone's mailbox; only the second belongs behind the gateway.
 *     (CON-01…CON-05 must extend `CREDENTIAL_SPECIFIER_PATTERNS` as the Slack,
 *     Notion, and Drive SDKs arrive, so this prose and that test keep agreeing.)
 *   * The shared contracts it is built on live in `agents/contracts`, which is a
 *     layer-0 boundary of its own. Depending on the contracts is not depending on
 *     the runtime.
 *
 * Populated by AGT-01…AGT-07 (state, checkpointing, supervisor, planner/worker
 * loop, interrupts, run API). AGT-01 supplies the shared state and reducers;
 * AGT-02 supplies durable PostgreSQL checkpointing and the run lifecycle.
 *
 * What is deliberately *not* exported. The reducers and the LangGraph
 * annotation are internal — they are how this module merges its own state, and
 * code outside it reaching for them would be assembling a second graph. The
 * state schema and the projections are public because AGT-07 serves them and
 * `evaluation` asserts on them.
 */

export {
  AGENT_STATE_SCHEMA_VERSION,
  AgentRequestSchema,
  AgentRunErrorSchema,
  CompletedSubtaskSchema,
  EvidenceRefSchema,
  MyraAgentStateSchema,
  OpenQuestionSchema,
  createInitialState,
  toEvidenceRef,
  type AgentRequest,
  type AgentRunError,
  type CompletedSubtask,
  type EvidenceRef,
  type MyraAgentState,
  type OpenQuestion,
} from "./state/stateSchema.js";

export {
  INTERRUPT_STATUSES,
  InvalidStatusTransitionError,
  LEGAL_STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
  assertStatusTransition,
  canTransition,
  isInterruptStatus,
  isTerminalStatus,
} from "./state/statusTransitions.js";

export {
  CheckpointTooLargeError,
  CredentialInStateError,
  StateOwnershipError,
  assertCheckpointSafe,
  assertNoCredentialMaterial,
  assertStateOwnership,
  assertStateWithinSizeLimit,
  channelSizes,
  estimateStateBytes,
  findCredentialMaterial,
  type CheckpointGuardOptions,
  type CredentialFinding,
} from "./state/stateGuards.js";

export {
  evaluateProgress,
  toRunStatusView,
  toTrajectorySnapshot,
  type ProgressCheck,
  type RunStatusView,
  type TrajectorySnapshot,
} from "./state/stateProjection.js";

export { ChannelCapacityError, ImmutableChannelError } from "./state/reducers.js";

export {
  type RunExecution,
  type StartAgentRunInput,
  AgentRunLifecycle,
} from "./runtime/runLifecycle.js";

export { AGENT_GRAPH_VERSION } from "./runtime/graphVersion.js";

export {
  createAgentRuntimePersistence,
  getAgentRuntimePersistence,
  type AgentRuntimePersistence,
} from "./runtime/persistence.js";

export {
  IncompatibleRunVersionError,
  MissingRunCheckpointError,
  RunAlreadyActiveError,
  RunLifecycleError,
  RunNotFoundError,
  RunNotResumableError,
  normalizeRunError,
} from "./runtime/runErrors.js";

/* AGT-03 — Supervisor routing. AGT-04 mounts the node; nothing else outside
 * this module needs the policy, the prompt internals, or the model client. */

export {
  DEFAULT_SUPERVISOR_TIER,
  SUPERVISOR_NODE_NAME,
  createSupervisorNode,
  type SupervisorDecider,
  type SupervisorNode,
  type SupervisorNodeDependencies,
} from "./nodes/supervisorRouter.js";

export {
  MAX_SUPERVISOR_ATTEMPTS,
  decideSupervisorOutcome,
  resolveEnabledFlows,
  type SupervisorOutcome,
  type SupervisorRequestContext,
} from "./policies/supervisorPolicy.js";

export {
  SUPERVISOR_ERROR_CODES,
  type SupervisorErrorCode,
} from "./policies/supervisorErrors.js";

export {
  SUPERVISOR_PROMPT_FINGERPRINT,
  SUPERVISOR_PROMPT_VERSION,
  SUPERVISOR_TOOL_NAME,
} from "./prompts/supervisorPrompt.js";

export { coreFlows, isWriteFlow } from "./policies/flowSourcePolicy.js";
