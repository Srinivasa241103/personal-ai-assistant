/**
 * AGT-03 — which sources a flow is actually allowed to touch.
 *
 * Everything here is *derived* from `FLOW_CONTRACTS` rather than restated. That
 * is the point: FND-01 already declares, per flow, which sources its evidence
 * requirements name and which tools it may call. A second hand-written list
 * would be a second source of truth, and the two would disagree the first time
 * a contract changed.
 *
 * Two different questions, deliberately kept apart:
 *
 *   `legalSourcesForFlow` — what the contract *requires evidence from*. This is
 *   the declared intent of the flow.
 *
 *   `sourcesReachableByFlow` — what its `allowedTools` can physically read.
 *   This is the mechanical truth, and it is the tighter of the two for flows
 *   whose requirement lists are broad (`cross_source_answer` names seven
 *   sources in one requirement but reaches them through thirteen named tools).
 *
 * AGT-04 reuses both for per-subtask tool allowlists.
 */

import {
  FLOW_CONTRACTS,
  type EvidenceSource,
  type FlowToolName,
  type SupportedFlow,
} from "../contracts/index.js";

/**
 * The source each internal tool reads from. Exhaustive over `FLOW_TOOL_NAMES`,
 * and a compile error if a tool is added without one — which is the intended
 * pressure: a new tool must declare what it reads before a flow can use it.
 */
export const SOURCE_BY_TOOL: Readonly<Record<FlowToolName, EvidenceSource>> = Object.freeze({
  indexed_search: "index",
  memory_search: "memory",
  gmail_search: "gmail",
  gmail_get_thread: "gmail",
  gmail_get_message: "gmail",
  calendar_list_events: "calendar",
  calendar_get_event: "calendar",
  calendar_free_busy: "calendar",
  calendar_create_event: "calendar",
  slack_search: "slack",
  slack_get_thread: "slack",
  notion_search: "notion",
  notion_get_page: "notion",
  drive_search: "drive",
  drive_get_file: "drive",
  gmail_send_message: "gmail",
  gmail_send_reply: "gmail",
});

const legalSourceCache = new Map<SupportedFlow, ReadonlySet<EvidenceSource>>();
const reachableSourceCache = new Map<SupportedFlow, ReadonlySet<EvidenceSource>>();

/** Union of every source named by the flow's evidence requirements. */
export function legalSourcesForFlow(flow: SupportedFlow): ReadonlySet<EvidenceSource> {
  const cached = legalSourceCache.get(flow);
  if (cached) return cached;

  const sources = new Set<EvidenceSource>();
  for (const requirement of FLOW_CONTRACTS[flow].evidence.requirements) {
    for (const source of requirement.sources) sources.add(source);
  }

  const frozen: ReadonlySet<EvidenceSource> = sources;
  legalSourceCache.set(flow, frozen);
  return frozen;
}

/** Every source the flow's `allowedTools` can actually read. */
export function sourcesReachableByFlow(flow: SupportedFlow): ReadonlySet<EvidenceSource> {
  const cached = reachableSourceCache.get(flow);
  if (cached) return cached;

  const sources = new Set<EvidenceSource>();
  for (const tool of FLOW_CONTRACTS[flow].allowedTools) {
    sources.add(SOURCE_BY_TOOL[tool]);
  }

  const frozen: ReadonlySet<EvidenceSource> = sources;
  reachableSourceCache.set(flow, frozen);
  return frozen;
}

/** True when the flow's contract declares an external-write approval boundary. */
export function isWriteFlow(flow: SupportedFlow): boolean {
  return FLOW_CONTRACTS[flow].approval.boundary === "before_external_write";
}

/** The flows inside the release gate, derived rather than hard-coded. */
export function coreFlows(): SupportedFlow[] {
  return (Object.keys(FLOW_CONTRACTS) as SupportedFlow[]).filter(
    (flow) => FLOW_CONTRACTS[flow].releaseTier === "core",
  );
}
