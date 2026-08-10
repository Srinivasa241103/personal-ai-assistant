/**
 * AGT-01 — the Supervisor's decision, as a contract.
 *
 * Additive to FND-02: a new file and one line in `domain/index.ts`, nothing
 * changed. It lives here rather than in `src/agents/state` for the same reason
 * `Plan` and `ActionProposal` do — it is a persisted, serialized shape that
 * outlives the node that produced it. The evaluation harness reads it out of a
 * trajectory, the run API projects it, and neither should have to depend on the
 * graph runtime to name its fields.
 *
 * Master plan §8.1 defines the shape. Two of its rules are enforced here rather
 * than left to the node that fills it in, because a contract that cannot be
 * violated is worth more than a prompt that asks nicely:
 *
 *   1. A read cannot quietly become a write. `mode: "action"` is legal only for
 *      a flow whose contract declares an approval boundary, and a flow without
 *      one can never be answered in action mode.
 *   2. The Supervisor does not invent freshness. Each directive records whether
 *      it is the deterministic baseline (FRS-01) or an escalation, so the trace
 *      shows which is which — and FRS-01's "may escalate, never downgrade" rule
 *      has something to check against.
 */

import { z } from "zod";
import {
  EvidenceSourceSchema,
  FLOW_CONTRACTS,
  SupportedFlowSchema,
} from "../flowContracts.js";
import {
  ActionRiskSchema,
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  UserIdSchema,
} from "./common.js";

export const SupervisorModeSchema = z.enum(["answer", "briefing", "action"]);

/** Mirrors the freshness contract's three tiers (§8.8), cheapest first. */
export const FreshnessModeSchema = z.enum(["index", "refresh", "live"]);

export const FreshnessDirectiveSchema = z.object({
  source: EvidenceSourceSchema,
  mode: FreshnessModeSchema,
  reason: z.string().trim().min(1),
  /**
   * `computed` is FRS-01's deterministic baseline; `escalated` is the
   * Supervisor raising a tier for a stated reason. There is no third option —
   * in particular there is no way to record a downgrade.
   */
  origin: z.enum(["computed", "escalated"]),
}).strict();

export const ClarificationRequestSchema = z.object({
  id: IdentifierSchema,
  prompt: z.string().trim().min(1),
  missingFields: z.array(z.string().trim().min(1)).min(1),
  options: z.array(z.string().trim().min(1)).optional(),
}).strict();

/**
 * Why this flow, in fields a human and an evaluator can both read. Explicitly
 * not a place for free-text reasoning: AGT-03 requires "rationale as safe
 * structured fields, not hidden chain-of-thought".
 */
export const SupervisorRationaleSchema = z.object({
  signals: z.array(z.string().trim().min(1)).default([]),
  rejectedFlows: z.array(z.object({
    flow: SupportedFlowSchema,
    reason: z.string().trim().min(1),
  }).strict()).default([]),
}).strict();

export const SupervisorDecisionSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  mode: SupervisorModeSchema,
  flow: SupportedFlowSchema,
  risk: ActionRiskSchema,
  freshness: z.array(FreshnessDirectiveSchema).default([]),
  sources: z.array(EvidenceSourceSchema).default([]),
  successCriteria: z.array(z.string().trim().min(1)).min(1),
  clarification: ClarificationRequestSchema.optional(),
  rationale: SupervisorRationaleSchema,
  /** Pinned so an evaluation record can name the prompt that produced this. */
  promptVersion: z.string().trim().min(1),
  decidedAt: IsoDateTimeSchema,
}).strict().superRefine((decision, context) => {
  const writesExternally =
    FLOW_CONTRACTS[decision.flow].approval.boundary === "before_external_write";

  if (decision.mode === "action" && !writesExternally) {
    context.addIssue({
      code: "custom",
      path: ["mode"],
      message: `Flow ${decision.flow} has no approval boundary and cannot run in action mode`,
    });
  }

  if (decision.mode !== "action" && writesExternally) {
    context.addIssue({
      code: "custom",
      path: ["mode"],
      message: `Flow ${decision.flow} writes externally and must run in action mode`,
    });
  }

  // A read that claims elevated risk is either mislabelled or is an action
  // wearing a read's clothes. Either way the graph should not proceed on it.
  if (decision.mode !== "action" && decision.risk !== "low") {
    context.addIssue({
      code: "custom",
      path: ["risk"],
      message: `${decision.mode} mode is read-only and must be low risk`,
    });
  }

  const seenSources = new Set<string>();
  for (const [index, source] of decision.sources.entries()) {
    if (seenSources.has(source)) {
      context.addIssue({
        code: "custom",
        path: ["sources", index],
        message: `Duplicate source: ${source}`,
      });
    }
    seenSources.add(source);
  }

  // One directive per source. Two directives for one source is not a merge
  // problem to solve later — it is an undecided plan.
  const seenDirectives = new Set<string>();
  for (const [index, directive] of decision.freshness.entries()) {
    if (seenDirectives.has(directive.source)) {
      context.addIssue({
        code: "custom",
        path: ["freshness", index, "source"],
        message: `Duplicate freshness directive for ${directive.source}`,
      });
    }
    seenDirectives.add(directive.source);

    if (!seenSources.has(directive.source)) {
      context.addIssue({
        code: "custom",
        path: ["freshness", index, "source"],
        message: `Freshness directive for ${directive.source}, which is not a selected source`,
      });
    }
  }
});

export type SupervisorMode = z.infer<typeof SupervisorModeSchema>;
export type FreshnessMode = z.infer<typeof FreshnessModeSchema>;
export type FreshnessDirective = z.infer<typeof FreshnessDirectiveSchema>;
export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;
export type SupervisorRationale = z.infer<typeof SupervisorRationaleSchema>;
export type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;
