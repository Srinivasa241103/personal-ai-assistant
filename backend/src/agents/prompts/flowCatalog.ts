/**
 * AGT-03 — the flow catalog shown to the model, rendered from the registry.
 *
 * Never hand-written prose. `FLOW_CONTRACTS` is the single declaration of what
 * each flow is for, which sources it may read, and whether it writes; a prose
 * copy in a prompt would drift from it the first time a contract changed, and
 * nothing would fail until a run routed somewhere impossible.
 *
 * Deriving it also means a new flow appears in the prompt automatically, and a
 * disabled flow is absent — which is what makes the enum narrowing in
 * `supervisorProposalSchema` and this catalog say the same thing by
 * construction rather than by discipline.
 */

import {
  FLOW_CONTRACTS,
  type SupportedFlow,
} from "../contracts/index.js";
import { legalSourcesForFlow } from "../policies/flowSourcePolicy.js";

/**
 * One block per enabled flow. Kept terse: the model needs enough to
 * discriminate, and every extra sentence is tokens spent on every request.
 */
export function renderFlowCatalog(enabledFlows: readonly SupportedFlow[]): string {
  return enabledFlows
    .map((flow) => {
      const contract = FLOW_CONTRACTS[flow];
      const sources = [...legalSourcesForFlow(flow)].sort().join(", ");
      const writes = contract.approval.boundary === "before_external_write";

      const lines = [
        `- flow: ${flow}`,
        `  name: ${contract.displayName}`,
        `  purpose: ${contract.description}`,
        `  permitted_sources: ${sources}`,
        `  minimum_distinct_sources: ${contract.evidence.minimumDistinctSourcesForSuccess}`,
        `  writes_externally: ${writes ? "yes — requires action mode" : "no — read only"}`,
        `  not_for: ${contract.nonGoals[0]}`,
      ];

      return lines.join("\n");
    })
    .join("\n");
}

/** The mode each flow must run in, stated so the model cannot guess wrong. */
export function renderModeRules(enabledFlows: readonly SupportedFlow[]): string {
  const writeFlows = enabledFlows.filter(
    (flow) => FLOW_CONTRACTS[flow].approval.boundary === "before_external_write",
  );

  if (writeFlows.length === 0) {
    return 'Every flow listed is read-only: use mode "answer" or "briefing", and risk "low". Mode "action" is not available for this request.';
  }

  return [
    `Use mode "action" with risk "medium" or "high" for: ${writeFlows.join(", ")}.`,
    'Use mode "answer" or "briefing" with risk "low" for every other listed flow.',
  ].join(" ");
}
