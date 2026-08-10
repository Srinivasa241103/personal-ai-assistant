/**
 * AGT-01 — which run status may follow which.
 *
 * The fourteen statuses are FND-01's (`AGENT_RUN_STATUSES`); the edges between
 * them are here. This lives in the state module because the status reducer is
 * its first consumer and because "what may happen next" is part of the state
 * contract, not a database concern. AGT-02's run lifecycle imports this rather
 * than restating it — one table, two consumers, no chance of the checkpoint and
 * the `agent_runs` row disagreeing about what a legal run looks like.
 *
 * Read the table as: after `from`, the run may enter any of `to`. Terminal
 * statuses have no outgoing edges at all, which is what makes "a cancelled run
 * makes no further tool calls" checkable rather than aspirational.
 *
 * `cancelled` and `failed` are reachable from every non-terminal status on
 * purpose: cancellation arrives from outside the graph at an arbitrary moment,
 * and an unhandled error can occur in any node.
 */

import type { AgentRunStatus } from "../contracts/index.js";

export const TERMINAL_STATUSES = [
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
] as const satisfies readonly AgentRunStatus[];

export const INTERRUPT_STATUSES = [
  "waiting_for_clarification",
  "waiting_for_approval",
] as const satisfies readonly AgentRunStatus[];

const TERMINAL_SET: ReadonlySet<AgentRunStatus> = new Set(TERMINAL_STATUSES);
const INTERRUPT_SET: ReadonlySet<AgentRunStatus> = new Set(INTERRUPT_STATUSES);

/** Available from any non-terminal status; see the header. */
const ALWAYS: readonly AgentRunStatus[] = ["failed", "cancelled"];

export const LEGAL_STATUS_TRANSITIONS: Readonly<
  Record<AgentRunStatus, readonly AgentRunStatus[]>
> = Object.freeze({
  created: ["planning", "waiting_for_clarification", ...ALWAYS],

  // Planning may answer straight from recalled memory without researching, and
  // may stop to ask before spending anything.
  planning: ["researching", "synthesizing", "waiting_for_clarification", ...ALWAYS],

  // Back to planning is the replan loop; AGT-05 bounds how often.
  researching: [
    "synthesizing",
    "planning",
    "waiting_for_clarification",
    "partially_completed",
    ...ALWAYS,
  ],

  synthesizing: ["verifying", "waiting_for_approval", ...ALWAYS],

  // Verification decides the ending: pass, revise (back to planning), or an
  // action proposal that needs a human.
  verifying: [
    "completed",
    "partially_completed",
    "planning",
    "researching",
    "waiting_for_approval",
    "curating_memory",
    ...ALWAYS,
  ],

  waiting_for_clarification: ["planning", "researching", ...ALWAYS],

  // A rejection ends the run without executing anything, which is why
  // curating_memory and completed are reachable from here.
  waiting_for_approval: ["executing_action", "curating_memory", "completed", ...ALWAYS],

  executing_action: ["verifying_action", ...ALWAYS],

  verifying_action: ["curating_memory", "completed", "partially_completed", ...ALWAYS],

  curating_memory: ["completed", "partially_completed", ...ALWAYS],

  completed: [],
  partially_completed: [],
  failed: [],
  cancelled: [],
});

export class InvalidStatusTransitionError extends Error {
  readonly from: AgentRunStatus;
  readonly to: AgentRunStatus;

  constructor(from: AgentRunStatus, to: AgentRunStatus) {
    const allowed = LEGAL_STATUS_TRANSITIONS[from];
    super(
      allowed.length === 0
        ? `Run status ${from} is terminal; it cannot transition to ${to}`
        : `Illegal run status transition ${from} → ${to}; allowed: ${allowed.join(", ")}`,
    );
    this.name = "InvalidStatusTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isTerminalStatus(status: AgentRunStatus): boolean {
  return TERMINAL_SET.has(status);
}

export function isInterruptStatus(status: AgentRunStatus): boolean {
  return INTERRUPT_SET.has(status);
}

/**
 * Re-entering the current status is allowed and is a no-op. Nodes re-emit their
 * status routinely — a resumed node, a retried worker — and treating that as a
 * violation would make the reducer reject correct behaviour.
 */
export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  if (from === to) return true;
  return LEGAL_STATUS_TRANSITIONS[from].includes(to);
}

export function assertStatusTransition(
  from: AgentRunStatus,
  to: AgentRunStatus,
): void {
  if (!canTransition(from, to)) throw new InvalidStatusTransitionError(from, to);
}
