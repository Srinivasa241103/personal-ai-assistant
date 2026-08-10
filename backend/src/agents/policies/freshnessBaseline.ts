/**
 * AGT-03 — the deterministic freshness baseline, and the seam FRS-01 replaces.
 *
 * Master plan §8.1: "The Supervisor does not invent `freshness`. FRS-01 computes
 * the baseline directives deterministically; the Supervisor may **escalate** a
 * source to a fresher tier when it has a specific reason, and may never
 * downgrade one."
 *
 * FRS-01 is Day 4. Until it lands, this computes the baseline from something
 * that already exists and is already authoritative: the flow's own evidence
 * requirements. `schedule_meeting` declares `live_availability` with
 * `freshness: "live"`, so calendar starts live for that flow — not because a
 * rule here says calendars are volatile, but because the contract says this
 * flow needs live calendar evidence. That is a real derivation, not a stub.
 *
 * What it deliberately cannot do, and what FRS-01 will add: `indexAge` from
 * `sync_logs.sync_completed_at`, and per-connector volatility windows. Those
 * need I/O, and this function is pure so the whole routing path stays testable
 * without a database. `computeBaseline` is injected into the node for exactly
 * this reason — FRS-01 replaces it at one call site.
 */

import {
  FLOW_CONTRACTS,
  type EvidenceSource,
  type FreshnessDirective,
  type FreshnessMode,
  type SupportedFlow,
} from "../contracts/index.js";

/** Cheapest first. An escalation must move strictly up this ladder. */
export const FRESHNESS_ORDER: readonly FreshnessMode[] = ["index", "refresh", "live"];

export function freshnessRank(mode: FreshnessMode): number {
  return FRESHNESS_ORDER.indexOf(mode);
}

export type BaselineComputer = (
  flow: SupportedFlow,
  sources: readonly EvidenceSource[],
) => FreshnessDirective[];

/**
 * Map a contract requirement's freshness word onto a directive tier.
 * `"hydrated"` means the cited object is re-fetched at verification time
 * (FRS-03), which is a verification duty rather than a retrieval tier — so it
 * does not by itself make the *retrieval* live.
 */
function tierForRequirement(requirementFreshness: "any" | "live" | "hydrated"): FreshnessMode {
  return requirementFreshness === "live" ? "live" : "index";
}

/**
 * One directive per selected source, every one stamped `origin: "computed"`.
 *
 * The model is never allowed to emit `origin` at all — it may only propose
 * escalations, which the node stamps `"escalated"`. That is what turns §8.1's
 * rule from a prompt instruction into something the model cannot violate.
 */
export const computeBaselineDirectives: BaselineComputer = (flow, sources) => {
  const contract = FLOW_CONTRACTS[flow];

  return sources.map((source) => {
    // The strictest requirement naming this source wins: if any requirement
    // needs it live, live is the baseline.
    let tier: FreshnessMode = "index";
    let reason = `${flow} reads ${source} from the index by default`;

    for (const requirement of contract.evidence.requirements) {
      if (!requirement.sources.includes(source)) continue;
      const candidate = tierForRequirement(requirement.freshness);
      if (freshnessRank(candidate) > freshnessRank(tier)) {
        tier = candidate;
        reason = `${contract.flow} requirement "${requirement.id}" needs ${requirement.freshness} ${source} evidence`;
      }
    }

    return { source, mode: tier, reason, origin: "computed" as const };
  });
};
