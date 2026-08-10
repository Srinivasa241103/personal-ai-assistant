/**
 * AGT-03 — the schema the *model* fills in.
 *
 * This is deliberately **not** `SupervisorDecisionSchema`. The contract carries
 * five fields the model has no business choosing — `schemaVersion`, `runId`,
 * `userId`, `promptVersion`, `decidedAt` — and the node stamps every one of
 * them from state and config. Three consequences, all load-bearing:
 *
 *   1. **The model cannot name a tenant.** Asking a model for a `userId` is
 *      inviting cross-tenant smuggling. `MyraAgentStateSchema` would catch a
 *      mismatch, but not asking beats catching.
 *   2. **Freshness `origin` becomes structural.** The model may only propose
 *      *escalations*; the node stamps `origin: "escalated"` on those and
 *      `"computed"` on the deterministic baseline. §8.1's "the Supervisor does
 *      not invent freshness" stops being an instruction and becomes something
 *      the vocabulary cannot express.
 *   3. **Fewer wasted retries.** A model that mistypes a `runId` would
 *      otherwise fail an otherwise-correct decision and burn the one correction.
 *
 * `flow` is narrowed to the *enabled* flows at build time, which is what makes
 * P1 gating and the write-flow guarantee **parse errors** rather than
 * post-checks. When the request carries no write intent, `schedule_meeting` is
 * not merely discouraged — it is not a member of the enum.
 */

import { z } from "zod";
import {
  ActionRiskSchema,
  EvidenceSourceSchema,
  SupervisorModeSchema,
  SupportedFlowSchema,
  FreshnessModeSchema,
  type SupportedFlow,
} from "../contracts/index.js";

/**
 * Caps that exist for security rather than tidiness: a clarification is echoed
 * to the user, so an injected instruction that survived everything else has a
 * bounded blast radius.
 */
export const PROPOSAL_LIMITS = Object.freeze({
  maxClarificationPromptChars: 300,
  maxClarificationOptions: 5,
  maxClarificationOptionChars: 100,
  maxSuccessCriteria: 6,
  maxSuccessCriterionChars: 200,
  maxSignals: 8,
  maxSignalChars: 120,
  maxRejectedFlows: 6,
  maxReasonChars: 200,
});

const ClarificationProposalSchema = z.object({
  prompt: z.string().trim().min(1).max(PROPOSAL_LIMITS.maxClarificationPromptChars),
  missingFields: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
  options: z
    .array(z.string().trim().min(1).max(PROPOSAL_LIMITS.maxClarificationOptionChars))
    .max(PROPOSAL_LIMITS.maxClarificationOptions)
    .optional(),
}).strict();

const FreshnessEscalationSchema = z.object({
  source: EvidenceSourceSchema,
  mode: FreshnessModeSchema,
  reason: z.string().trim().min(1).max(PROPOSAL_LIMITS.maxReasonChars),
}).strict();

const RationaleProposalSchema = z.object({
  signals: z
    .array(z.string().trim().min(1).max(PROPOSAL_LIMITS.maxSignalChars))
    .max(PROPOSAL_LIMITS.maxSignals)
    .default([]),
  rejectedFlows: z
    .array(z.object({
      flow: SupportedFlowSchema,
      reason: z.string().trim().min(1).max(PROPOSAL_LIMITS.maxReasonChars),
    }).strict())
    .max(PROPOSAL_LIMITS.maxRejectedFlows)
    .default([]),
}).strict();

/**
 * The widest form, used for the inferred type and for tests. Runtime parsing
 * always goes through `buildSupervisorProposalSchema`, which narrows `flow`.
 */
export const SupervisorProposalSchema = z.object({
  mode: SupervisorModeSchema,
  flow: SupportedFlowSchema,
  risk: ActionRiskSchema,
  sources: z.array(EvidenceSourceSchema).max(7).default([]),
  freshnessEscalations: z.array(FreshnessEscalationSchema).max(7).default([]),
  successCriteria: z
    .array(z.string().trim().min(1).max(PROPOSAL_LIMITS.maxSuccessCriterionChars))
    .min(1)
    .max(PROPOSAL_LIMITS.maxSuccessCriteria),
  clarification: ClarificationProposalSchema.optional(),
  rationale: RationaleProposalSchema,
}).strict();

export type SupervisorProposal = z.infer<typeof SupervisorProposalSchema>;

export class NoEnabledFlowsError extends Error {
  constructor() {
    super("At least one flow must be enabled before the Supervisor can route");
    this.name = "NoEnabledFlowsError";
  }
}

/**
 * The model-facing schema for one request. `flow` accepts only what this
 * request is allowed to reach.
 */
export function buildSupervisorProposalSchema(enabledFlows: readonly SupportedFlow[]) {
  if (enabledFlows.length === 0) throw new NoEnabledFlowsError();

  return SupervisorProposalSchema.extend({
    flow: z.enum(enabledFlows as [SupportedFlow, ...SupportedFlow[]]),
  }).strict();
}
