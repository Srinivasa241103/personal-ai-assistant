import { z } from "zod";
import {
  AgentRunStatusSchema,
  FLOW_CONTRACT_SCHEMA_VERSION,
  FlowFailureResultSchema,
  FlowPartialSuccessResultSchema,
  FlowSuccessResultSchema,
  SupportedFlowSchema,
} from "../flowContracts.js";
import {
  ApprovableActionRiskSchema,
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  Sha256Schema,
  UserIdSchema,
} from "./common.js";

export const ActiveAgentRunStatusSchema = AgentRunStatusSchema.exclude([
  "waiting_for_clarification",
  "waiting_for_approval",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
]);

export const RunBudgetLimitsSchema = z.object({
  maxSteps: z.number().int().positive(),
  maxRetries: z.number().int().nonnegative(),
  maxDurationMs: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  maxCostUsd: z.number().nonnegative().finite(),
  maxParallelWorkers: z.number().int().positive(),
  maxExternalActions: z.number().int().nonnegative(),
}).strict();

export const RunBudgetUsageSchema = z.object({
  steps: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().finite(),
  externalActions: z.number().int().nonnegative(),
}).strict();

const RunStateIdentityShape = {
  schemaVersion: DomainSchemaVersionSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
};

export const ActiveRunStateSchema = z.object({
  ...RunStateIdentityShape,
  kind: z.literal("active"),
  status: ActiveAgentRunStatusSchema,
  enteredAt: IsoDateTimeSchema,
}).strict();

export const ClarificationInterruptStateSchema = z.object({
  ...RunStateIdentityShape,
  kind: z.literal("interrupt"),
  interruptType: z.literal("clarification"),
  interruptId: IdentifierSchema,
  status: z.literal("waiting_for_clarification"),
  payload: z.object({
    prompt: z.string().trim().min(1),
    missingFields: z.array(z.string().trim().min(1)).min(1),
    options: z.array(z.string().trim().min(1)).optional(),
    responseSchema: JsonObjectSchema.optional(),
    context: JsonObjectSchema.optional(),
  }).strict(),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.optional(),
}).strict().superRefine((state, context) => {
  if (
    state.expiresAt &&
    Date.parse(state.expiresAt) <= Date.parse(state.createdAt)
  ) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "Clarification expiry must be after creation",
    });
  }
});

export const ApprovalInterruptStateSchema = z.object({
  ...RunStateIdentityShape,
  kind: z.literal("interrupt"),
  interruptType: z.literal("approval"),
  interruptId: IdentifierSchema,
  status: z.literal("waiting_for_approval"),
  payload: z.object({
    proposalId: IdentifierSchema,
    proposalVersion: z.string().trim().min(1),
    payloadHash: Sha256Schema,
    risk: ApprovableActionRiskSchema,
    preview: JsonObjectSchema,
  }).strict(),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
}).strict().superRefine((state, context) => {
  if (Date.parse(state.expiresAt) <= Date.parse(state.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "Approval expiry must be after creation",
    });
  }
});

export const InterruptRunStateSchema = z.discriminatedUnion("interruptType", [
  ClarificationInterruptStateSchema,
  ApprovalInterruptStateSchema,
]);

const TerminalStateBaseShape = {
  ...RunStateIdentityShape,
  kind: z.literal("terminal"),
  completedAt: IsoDateTimeSchema,
};

export const CompletedRunStateSchema = z.object({
  ...TerminalStateBaseShape,
  status: z.literal("completed"),
  result: FlowSuccessResultSchema,
}).strict();

export const PartiallyCompletedRunStateSchema = z.object({
  ...TerminalStateBaseShape,
  status: z.literal("partially_completed"),
  result: FlowPartialSuccessResultSchema,
}).strict();

export const FailedRunStateSchema = z.object({
  ...TerminalStateBaseShape,
  status: z.literal("failed"),
  result: FlowFailureResultSchema,
}).strict();

export const CancelledRunStateSchema = z.object({
  ...TerminalStateBaseShape,
  status: z.literal("cancelled"),
  reason: z.string().trim().min(1).optional(),
}).strict();

export const TerminalRunStateSchema = z.discriminatedUnion("status", [
  CompletedRunStateSchema,
  PartiallyCompletedRunStateSchema,
  FailedRunStateSchema,
  CancelledRunStateSchema,
]);

export const AgentRunStateSchema = z.union([
  ActiveRunStateSchema,
  InterruptRunStateSchema,
  TerminalRunStateSchema,
]);

export const AgentRunSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  userId: UserIdSchema,
  conversationId: IdentifierSchema,
  requestId: IdentifierSchema,
  flow: SupportedFlowSchema.nullable(),
  flowContractVersion: z.literal(FLOW_CONTRACT_SCHEMA_VERSION).nullable(),
  state: AgentRunStateSchema,
  budgetLimits: RunBudgetLimitsSchema,
  budgetUsage: RunBudgetUsageSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict().superRefine((run, context) => {
  if (run.state.runId !== run.id) {
    context.addIssue({
      code: "custom",
      path: ["state", "runId"],
      message: "Run state must reference its containing run",
    });
  }
  if (run.state.userId !== run.userId) {
    context.addIssue({
      code: "custom",
      path: ["state", "userId"],
      message: "Run state user scope must match its containing run",
    });
  }
  if (Date.parse(run.updatedAt) < Date.parse(run.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "updatedAt cannot be before createdAt",
    });
  }
  if ((run.flow === null) !== (run.flowContractVersion === null)) {
    context.addIssue({
      code: "custom",
      path: ["flowContractVersion"],
      message: "flow and flowContractVersion must either both be set or both be null",
    });
  }

  if (run.state.kind === "terminal" && "result" in run.state) {
    if (run.state.result.runId !== run.id) {
      context.addIssue({
        code: "custom",
        path: ["state", "result", "runId"],
        message: "Terminal flow result must reference its containing run",
      });
    }
    if (run.flow !== run.state.result.flow) {
      context.addIssue({
        code: "custom",
        path: ["state", "result", "flow"],
        message: "Terminal flow result must match the run flow",
      });
    }
    if (run.requestId !== run.state.result.requestId) {
      context.addIssue({
        code: "custom",
        path: ["state", "result", "requestId"],
        message: "Terminal flow result must match the run request",
      });
    }
  }

  const stateTimestamp = run.state.kind === "active"
    ? run.state.enteredAt
    : run.state.kind === "interrupt"
      ? run.state.createdAt
      : run.state.completedAt;
  if (Date.parse(stateTimestamp) < Date.parse(run.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["state"],
      message: "Run state timestamp cannot be before run creation",
    });
  }
  if (Date.parse(stateTimestamp) > Date.parse(run.updatedAt)) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "Run updatedAt cannot be before its current state timestamp",
    });
  }
});

// Added by AGT-01: every other schema in FND-02 ships a paired type, and the
// graph state carries both of these as channels.
export type RunBudgetLimits = z.infer<typeof RunBudgetLimitsSchema>;
export type RunBudgetUsage = z.infer<typeof RunBudgetUsageSchema>;
export type ActiveRunState = z.infer<typeof ActiveRunStateSchema>;
export type InterruptRunState = z.infer<typeof InterruptRunStateSchema>;
export type TerminalRunState = z.infer<typeof TerminalRunStateSchema>;
export type AgentRunState = z.infer<typeof AgentRunStateSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
