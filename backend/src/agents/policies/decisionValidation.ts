/**
 * AGT-03 — semantic validation, past what Zod can express.
 *
 * Three layers already run before this one and none of them can catch what it
 * catches:
 *
 *   The provider's JSON schema constrains field names and enum members. It
 *   cannot express a cross-field rule at all — `z.toJSONSchema` silently drops
 *   `superRefine`, so a provider will happily return `mode: "action"` beside a
 *   read-only flow.
 *
 *   `SupervisorProposalSchema` gives enum membership and string bounds.
 *
 *   `SupervisorDecisionSchema` (AGT-01) gives mode↔flow approval coherence in
 *   both directions, read-only ⇒ low risk, unique sources, and one directive
 *   per selected source. All free; none of it restated here.
 *
 * What is left needs the FND-01 registry *and* the request together: whether
 * the chosen sources are ones this flow may read, whether enough distinct
 * sources were chosen for the flow to be able to succeed at all, whether a
 * freshness escalation actually escalates, and — the load-bearing one —
 * whether the user asked for a write.
 *
 * Every issue carries an **authored** message. They are fed back to the model
 * as a correction, so a message that interpolated model output would carry
 * injected text into the prompt in an unfenced position.
 */

import {
  FLOW_CONTRACTS,
  type EvidenceSource,
  type SupportedFlow,
} from "../contracts/index.js";
import { freshnessRank, type BaselineComputer } from "./freshnessBaseline.js";
import { legalSourcesForFlow, sourcesReachableByFlow } from "./flowSourcePolicy.js";
import type { SupervisorProposal } from "../prompts/supervisorProposalSchema.js";
import type { RequestSignals } from "./requestSignals.js";
import type { WriteIntent } from "./writeIntent.js";

/** Closed union, mirroring the `RerankSkipReason` convention in the RAG stack. */
export type SemanticIssueCode =
  | "source_outside_flow_requirements"
  | "source_unreachable_by_tools"
  | "insufficient_distinct_sources"
  | "freshness_downgrade"
  | "escalation_for_unselected_source"
  | "write_without_intent"
  | "clarification_incoherent"
  | "no_sources_selected";

export interface SemanticIssue {
  code: SemanticIssueCode;
  /** Authored text. Never contains model output or user input. */
  message: string;
}

export interface SemanticValidationContext {
  signals: RequestSignals;
  writeIntent: WriteIntent;
  computeBaseline: BaselineComputer;
}

function formatSourceList(sources: Iterable<EvidenceSource>): string {
  return [...sources].sort().join(", ");
}

export function validateDecisionSemantics(
  proposal: SupervisorProposal,
  context: SemanticValidationContext,
): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const flow = proposal.flow as SupportedFlow;
  const contract = FLOW_CONTRACTS[flow];

  /* ---------------------------------------------------------------------- */
  /* the write guarantee                                                     */
  /* ---------------------------------------------------------------------- */

  // Redundant with the enum narrowing that removed write flows from the
  // model's vocabulary — deliberately. This asserts that narrowing was
  // computed correctly, and it is the check the mutation test deletes.
  if (
    contract.approval.boundary === "before_external_write" &&
    !context.writeIntent.hasWriteIntent
  ) {
    issues.push({
      code: "write_without_intent",
      message:
        `Flow ${flow} performs an external write, but the request contains no instruction to ` +
        `create, send, or change anything. Select a read-only flow, or ask a clarifying question.`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* sources                                                                 */
  /* ---------------------------------------------------------------------- */

  if (proposal.sources.length === 0 && !proposal.clarification) {
    issues.push({
      code: "no_sources_selected",
      message: "Select at least one source to read, or ask a clarifying question instead.",
    });
  }

  const legal = legalSourcesForFlow(flow);
  const reachable = sourcesReachableByFlow(flow);

  for (const source of proposal.sources) {
    if (!legal.has(source)) {
      issues.push({
        code: "source_outside_flow_requirements",
        message:
          `Flow ${flow} has no evidence requirement naming ${source}. ` +
          `Its permitted sources are: ${formatSourceList(legal)}.`,
      });
      continue;
    }
    if (!reachable.has(source)) {
      issues.push({
        code: "source_unreachable_by_tools",
        message:
          `Flow ${flow} has no tool that can read ${source}. ` +
          `It can reach: ${formatSourceList(reachable)}.`,
      });
    }
  }

  // A flow whose contract needs three distinct sources cannot reach full
  // success with two. Catching it here makes it a correctable error rather
  // than a guaranteed partial result nobody notices until verification.
  const minimumSources = contract.evidence.minimumDistinctSourcesForSuccess;
  if (!proposal.clarification && proposal.sources.length < minimumSources) {
    issues.push({
      code: "insufficient_distinct_sources",
      message:
        `Flow ${flow} requires evidence from at least ${minimumSources} distinct sources to ` +
        `succeed; ${proposal.sources.length} were selected.`,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* freshness                                                               */
  /* ---------------------------------------------------------------------- */

  const baseline = new Map(
    context.computeBaseline(flow, proposal.sources).map((directive) => [directive.source, directive]),
  );

  for (const escalation of proposal.freshnessEscalations) {
    if (!proposal.sources.includes(escalation.source)) {
      issues.push({
        code: "escalation_for_unselected_source",
        message:
          `A freshness escalation names ${escalation.source}, which is not one of the ` +
          `selected sources.`,
      });
      continue;
    }

    const current = baseline.get(escalation.source);
    if (!current) continue;

    if (freshnessRank(escalation.mode) <= freshnessRank(current.mode)) {
      issues.push({
        code: "freshness_downgrade",
        message:
          `Freshness for ${escalation.source} is already "${current.mode}". An escalation must ` +
          `request a fresher tier; it can never lower one.`,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* clarification                                                           */
  /* ---------------------------------------------------------------------- */

  if (proposal.clarification) {
    const { missingFields, options } = proposal.clarification;

    if (missingFields.length === 0) {
      issues.push({
        code: "clarification_incoherent",
        message: "A clarification must name at least one missing field.",
      });
    }

    if (options && new Set(options).size !== options.length) {
      issues.push({
        code: "clarification_incoherent",
        message: "Clarification options must be distinct.",
      });
    }
  }

  return issues;
}
