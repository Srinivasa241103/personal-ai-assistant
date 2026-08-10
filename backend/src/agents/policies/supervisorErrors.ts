/**
 * AGT-03 — the Supervisor's error vocabulary.
 *
 * Every message here is **authored**. Nothing interpolates model output, user
 * input, or a provider's error text, and that is a hard rule rather than a
 * style preference: these values land in `state.errors`, which AGT-02 runs
 * through `assertCheckpointSafe` before persisting. An error carrying a pasted
 * token would fail the credential scan and take the whole checkpoint with it,
 * and one carrying injected text would replay it to whoever reads the trace.
 *
 * The same discipline AGT-02's `normalizeRunError` already follows, applied at
 * the other end of the run.
 */

import { AgentRunErrorSchema, type AgentRunError } from "../state/stateSchema.js";

export const SUPERVISOR_ERROR_CODES = Object.freeze({
  requestProhibited: "supervisor_request_prohibited",
  capabilityUnsupported: "supervisor_capability_unsupported",
  flowNotEnabled: "supervisor_flow_not_enabled",
  outputInvalid: "supervisor_output_invalid",
  modelUnavailable: "supervisor_model_unavailable",
  noEnabledFlows: "supervisor_no_enabled_flows",
});

export type SupervisorErrorCode =
  (typeof SUPERVISOR_ERROR_CODES)[keyof typeof SUPERVISOR_ERROR_CODES];

interface ErrorSpec {
  category: AgentRunError["category"];
  message: string;
  retryable: boolean;
}

const SPECS: Readonly<Record<SupervisorErrorCode, ErrorSpec>> = Object.freeze({
  [SUPERVISOR_ERROR_CODES.requestProhibited]: {
    category: "policy",
    // Deliberately does not repeat what was asked for.
    message:
      "This request asks for an action MyRA does not perform: deleting external content, " +
      "changing access permissions, messaging a large group, or a bulk write.",
    retryable: false,
  },
  [SUPERVISOR_ERROR_CODES.capabilityUnsupported]: {
    category: "policy",
    message:
      "This request needs a capability MyRA does not have yet. Writing to Slack, Notion, " +
      "and Drive are explicit non-goals of the current release.",
    retryable: false,
  },
  [SUPERVISOR_ERROR_CODES.flowNotEnabled]: {
    category: "policy",
    message:
      "This request maps to a flow that is not enabled in this release. Email composition, " +
      "replies, and post-meeting follow-up arrive in a later package.",
    retryable: false,
  },
  [SUPERVISOR_ERROR_CODES.outputInvalid]: {
    category: "model",
    message:
      "The router could not produce a valid routing decision after a correction attempt.",
    // Worth a run-level retry: the next attempt may well succeed.
    retryable: true,
  },
  [SUPERVISOR_ERROR_CODES.modelUnavailable]: {
    category: "model",
    message: "The routing model could not be reached.",
    retryable: true,
  },
  [SUPERVISOR_ERROR_CODES.noEnabledFlows]: {
    category: "internal",
    message: "No flow is enabled for this request, so it cannot be routed.",
    retryable: false,
  },
});

export function toSupervisorRunError(
  code: SupervisorErrorCode,
  occurredAt: string,
): AgentRunError {
  const spec = SPECS[code];
  return AgentRunErrorSchema.parse({
    code,
    category: spec.category,
    message: spec.message,
    occurredAt,
    retryable: spec.retryable,
  });
}
