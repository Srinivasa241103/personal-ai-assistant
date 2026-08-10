/**
 * FND-05 — validated runtime configuration.
 *
 * Replaces the import-time `process.exit(1)` in `environment.js` for all V2 code.
 * Two properties matter and are both tested:
 *
 *   1. Validation is *pure and total* — `loadRuntimeConfig(env)` takes an
 *      environment, reports **every** problem at once, and throws rather than
 *      killing the process. The entrypoint decides what a failure means; a test
 *      can assert on it.
 *   2. No secret reaches a diagnostic surface. `ConfigValidationError` names the
 *      offending variables, never their values, and `describeRuntimeConfig`
 *      produces a log-safe summary.
 *
 * `environment.js` is intentionally left untouched so the existing V1 runtime
 * keeps working; migrating its callers is separate cleanup, not FND-05 risk.
 */

import { z } from "zod";
import { describeSecret, isSecretEnvName } from "./redaction.js";

export const RUNTIME_CONFIG_SCHEMA_VERSION = "2.0.0" as const;

/* -------------------------------------------------------------------------- */
/* primitives                                                                  */
/* -------------------------------------------------------------------------- */

const RequiredString = (label: string) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} must not be empty`);

const Port = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .min(1, `${label} must be between 1 and 65535`)
    .max(65535, `${label} must be between 1 and 65535`);

const PositiveInt = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .positive(`${label} must be greater than zero`);

const NonNegativeInt = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .nonnegative(`${label} must not be negative`);

const NonNegativeMoney = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .nonnegative(`${label} must not be negative`)
    .finite(`${label} must be a finite amount`);

/**
 * A positive integer with a ceiling the operator cannot raise. Used only where
 * the master plan states a bound as a rule rather than a starting value — the
 * verification and replanning loops (§8.6, §9.4). Everything else is a default.
 */
const BoundedPositiveInt = (label: string, max: number, why: string) =>
  PositiveInt(label).max(max, `${label} must not exceed ${max}: ${why}`);

/** Accepts the shell-ish truthy spellings people actually put in .env files. */
const BooleanFlag = z
  .string()
  .transform((value) => ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));

export const NodeEnvSchema = z.enum(["development", "test", "production"]);
export const VectorStoreSchema = z.enum(["pgvector", "chroma"]);
export const MigrationModeSchema = z.enum(["auto", "verify"]);
export const AgentModelProviderSchema = z.enum(["anthropic", "openai"]);

export type NodeEnvName = z.infer<typeof NodeEnvSchema>;
export type VectorStoreName = z.infer<typeof VectorStoreSchema>;
/** `auto` applies pending migrations on boot; `verify` only reports drift. */
export type MigrationMode = z.infer<typeof MigrationModeSchema>;
export type AgentModelProvider = z.infer<typeof AgentModelProviderSchema>;

/* -------------------------------------------------------------------------- */
/* error                                                                       */
/* -------------------------------------------------------------------------- */

export interface ConfigIssue {
  /** Environment variable name, e.g. "DB_PASSWORD". */
  variable: string;
  message: string;
}

/**
 * Thrown — never `process.exit` — so callers choose the failure behaviour and
 * tests can assert on the full issue list.
 */
export class ConfigValidationError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    const detail = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`).join("\n");
    super(
      `Invalid runtime configuration (${issues.length} problem${issues.length === 1 ? "" : "s"}):\n${detail}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }

  get variables(): string[] {
    return [...new Set(this.issues.map((issue) => issue.variable))];
  }
}

/* -------------------------------------------------------------------------- */
/* schema                                                                      */
/* -------------------------------------------------------------------------- */

const DEFAULTS = {
  PORT: "2020",
  NODE_ENV: "development",
  VECTOR_STORE: "pgvector",
  CHROMA_HOST: "localhost",
  CHROMA_PORT: "8000",
  CHROMA_COLLECTION: "myra_chunks_v1",
  REDIS_URL: "redis://localhost:6379",
  DB_MAX_CONNECTIONS: "10",
  READINESS_PROBE_TIMEOUT_MS: "2000",
  SHUTDOWN_DRAIN_TIMEOUT_MS: "10000",

  // AGT/TOL runtime limits. Master plan §9.4: "These values must be
  // configuration, not hard-coded business logic."
  LANGGRAPH_CHECKPOINT_SCHEMA: "langgraph",
  AGENT_MAX_CHECKPOINT_BYTES: "262144",
  AGENT_MAX_STEPS: "40",
  AGENT_MAX_RETRIES: "2",
  AGENT_MAX_DURATION_MS: "90000",
  AGENT_MAX_TOKENS: "120000",
  AGENT_MAX_COST_USD: "1",
  AGENT_MAX_PARALLEL_WORKERS: "4",
  AGENT_MAX_EXTERNAL_ACTIONS: "3",
  AGENT_MAX_REPLAN_ITERATIONS: "3",
  AGENT_MAX_VERIFICATION_RETRIES: "2",
  AGENT_CLARIFICATION_TTL_MS: "900000",
  AGENT_APPROVAL_TTL_MS: "900000",
  AGENT_MODEL_PROVIDER: "anthropic",
  AGENT_MODEL_CHEAP: "claude-haiku-4-5-20251001",
  AGENT_MODEL_MID: "claude-sonnet-5",
  AGENT_MODEL_STRONG: "claude-opus-5",
  TOOL_DEFAULT_TIMEOUT_MS: "15000",
  TOOL_MAX_RESULT_BYTES: "131072",
} as const;

const RawEnvSchema = z.object({
  // server
  NODE_ENV: NodeEnvSchema.default(DEFAULTS.NODE_ENV),
  PORT: Port("PORT").default(Number(DEFAULTS.PORT)),
  CORS_ORIGIN: z.string().trim().optional(),
  FRONTEND_URL: z.string().trim().optional(),

  // postgres — the only hard dependency at every stage of the project
  DB_HOST: RequiredString("DB_HOST"),
  DB_PORT: Port("DB_PORT"),
  DB_NAME: RequiredString("DB_NAME"),
  DB_USER: RequiredString("DB_USER"),
  DB_PASSWORD: RequiredString("DB_PASSWORD"),
  DB_SSL: BooleanFlag.default(false),
  DB_MAX_CONNECTIONS: PositiveInt("DB_MAX_CONNECTIONS").default(
    Number(DEFAULTS.DB_MAX_CONNECTIONS),
  ),

  // vector store
  VECTOR_STORE: VectorStoreSchema.default(DEFAULTS.VECTOR_STORE),
  CHROMA_HOST: z.string().trim().default(DEFAULTS.CHROMA_HOST),
  CHROMA_PORT: Port("CHROMA_PORT").default(Number(DEFAULTS.CHROMA_PORT)),
  CHROMA_SSL: BooleanFlag.default(false),
  CHROMA_COLLECTION: z.string().trim().default(DEFAULTS.CHROMA_COLLECTION),
  CHROMA_API_KEY: z.string().trim().optional(),
  CHROMA_TENANT: z.string().trim().optional(),
  CHROMA_DATABASE: z.string().trim().optional(),

  // redis — client and probe land in 05.3/05.4; nothing consumes it until TOL-03
  REDIS_URL: z.string().trim().default(DEFAULTS.REDIS_URL),
  REDIS_REQUIRED: BooleanFlag.default(false),

  // auth
  JWT_SECRET: RequiredString("JWT_SECRET"),
  TOKEN_ENCRYPTION_KEY: RequiredString("TOKEN_ENCRYPTION_KEY"),

  // runtime behaviour
  MIGRATIONS_ON_BOOT: MigrationModeSchema.optional(),
  READINESS_PROBE_TIMEOUT_MS: PositiveInt("READINESS_PROBE_TIMEOUT_MS").default(
    Number(DEFAULTS.READINESS_PROBE_TIMEOUT_MS),
  ),
  SHUTDOWN_DRAIN_TIMEOUT_MS: PositiveInt("SHUTDOWN_DRAIN_TIMEOUT_MS").default(
    Number(DEFAULTS.SHUTDOWN_DRAIN_TIMEOUT_MS),
  ),
  ENABLE_CRON_JOBS: BooleanFlag.default(true),

  // agent runtime — off by default, so AGT-07's endpoints stay unmounted and
  // the V1 chat path is the only behaviour a deploy gets until it is chosen.
  AGENT_RUNTIME_ENABLED: BooleanFlag.default(false),

  // LangGraph checkpointing. The schema name is configuration because two
  // places must agree on it: migration 0003, which creates the tables, and the
  // checkpointer that queries them. A literal in both is a literal that drifts.
  LANGGRAPH_CHECKPOINT_SCHEMA: z.string()
    .trim()
    .min(1)
    // The pinned checkpointer quotes but does not escape this identifier before
    // interpolating it into SQL. Keep the configurable test/deployment surface,
    // but limit it to ordinary unquoted PostgreSQL identifiers.
    .regex(
      /^[a-z_][a-z0-9_]*$/,
      "LANGGRAPH_CHECKPOINT_SCHEMA must be a lowercase PostgreSQL identifier",
    )
    .default(DEFAULTS.LANGGRAPH_CHECKPOINT_SCHEMA),
  AGENT_MAX_CHECKPOINT_BYTES: PositiveInt("AGENT_MAX_CHECKPOINT_BYTES").default(
    Number(DEFAULTS.AGENT_MAX_CHECKPOINT_BYTES),
  ),

  // run budgets — mirrors RunBudgetLimitsSchema (FND-02) field for field, by
  // hand rather than by import: src/config is shared infrastructure and must
  // not take a dependency on a V2 module boundary.
  AGENT_MAX_STEPS: PositiveInt("AGENT_MAX_STEPS").default(Number(DEFAULTS.AGENT_MAX_STEPS)),
  AGENT_MAX_RETRIES: NonNegativeInt("AGENT_MAX_RETRIES").default(
    Number(DEFAULTS.AGENT_MAX_RETRIES),
  ),
  AGENT_MAX_DURATION_MS: PositiveInt("AGENT_MAX_DURATION_MS").default(
    Number(DEFAULTS.AGENT_MAX_DURATION_MS),
  ),
  AGENT_MAX_TOKENS: PositiveInt("AGENT_MAX_TOKENS").default(Number(DEFAULTS.AGENT_MAX_TOKENS)),
  AGENT_MAX_COST_USD: NonNegativeMoney("AGENT_MAX_COST_USD").default(
    Number(DEFAULTS.AGENT_MAX_COST_USD),
  ),
  AGENT_MAX_PARALLEL_WORKERS: PositiveInt("AGENT_MAX_PARALLEL_WORKERS").default(
    Number(DEFAULTS.AGENT_MAX_PARALLEL_WORKERS),
  ),
  AGENT_MAX_EXTERNAL_ACTIONS: NonNegativeInt("AGENT_MAX_EXTERNAL_ACTIONS").default(
    Number(DEFAULTS.AGENT_MAX_EXTERNAL_ACTIONS),
  ),

  // loop bounds — ceilings, not starting values. §8.6 permits "at most two
  // verification-driven research retries"; diagram 01 caps the replan loop at
  // three. Configuration may lower either; nothing may raise them.
  AGENT_MAX_REPLAN_ITERATIONS: BoundedPositiveInt(
    "AGENT_MAX_REPLAN_ITERATIONS",
    3,
    "the replan loop is capped at three iterations",
  ).default(Number(DEFAULTS.AGENT_MAX_REPLAN_ITERATIONS)),
  AGENT_MAX_VERIFICATION_RETRIES: BoundedPositiveInt(
    "AGENT_MAX_VERIFICATION_RETRIES",
    2,
    "the graph permits at most two verification-driven retries",
  ).default(Number(DEFAULTS.AGENT_MAX_VERIFICATION_RETRIES)),

  // interrupt expiry — an approval that never expires is an approval that can
  // be executed against a stale world.
  AGENT_CLARIFICATION_TTL_MS: PositiveInt("AGENT_CLARIFICATION_TTL_MS").default(
    Number(DEFAULTS.AGENT_CLARIFICATION_TTL_MS),
  ),
  AGENT_APPROVAL_TTL_MS: PositiveInt("AGENT_APPROVAL_TTL_MS").default(
    Number(DEFAULTS.AGENT_APPROVAL_TTL_MS),
  ),

  // model tiers — "cheap, mid, strong" (diagram 01). Pinned per run in traces
  // and evaluation records, so they are configuration rather than call sites.
  AGENT_MODEL_PROVIDER: AgentModelProviderSchema.default(DEFAULTS.AGENT_MODEL_PROVIDER),
  AGENT_MODEL_CHEAP: z.string().trim().min(1).default(DEFAULTS.AGENT_MODEL_CHEAP),
  AGENT_MODEL_MID: z.string().trim().min(1).default(DEFAULTS.AGENT_MODEL_MID),
  AGENT_MODEL_STRONG: z.string().trim().min(1).default(DEFAULTS.AGENT_MODEL_STRONG),

  // tool gateway
  TOOL_DEFAULT_TIMEOUT_MS: PositiveInt("TOOL_DEFAULT_TIMEOUT_MS").default(
    Number(DEFAULTS.TOOL_DEFAULT_TIMEOUT_MS),
  ),
  TOOL_MAX_RESULT_BYTES: PositiveInt("TOOL_MAX_RESULT_BYTES").default(
    Number(DEFAULTS.TOOL_MAX_RESULT_BYTES),
  ),
});

/* -------------------------------------------------------------------------- */
/* shaped config                                                               */
/* -------------------------------------------------------------------------- */

export interface RuntimeConfig {
  readonly schemaVersion: typeof RUNTIME_CONFIG_SCHEMA_VERSION;
  readonly server: {
    readonly nodeEnv: NodeEnvName;
    readonly isDevelopment: boolean;
    readonly isProduction: boolean;
    readonly isTest: boolean;
    readonly port: number;
    readonly corsOrigins: string[];
  };
  readonly postgres: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
    readonly ssl: boolean;
    readonly maxConnections: number;
  };
  readonly vector: {
    readonly provider: VectorStoreName;
    /** True when a Chroma API key selects Chroma Cloud over a local container. */
    readonly chromaCloud: boolean;
    readonly chromaHost: string;
    readonly chromaPort: number;
    readonly chromaSsl: boolean;
    readonly chromaCollection: string;
    readonly chromaApiKey?: string;
    readonly chromaTenant?: string;
    readonly chromaDatabase?: string;
  };
  readonly redis: {
    readonly url: string;
    /** Declarative requiredness: false until TOL-03 introduces locks and queues. */
    readonly required: boolean;
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly tokenEncryptionKey: string;
  };
  readonly runtime: {
    readonly migrationsOnBoot: MigrationMode;
    readonly readinessProbeTimeoutMs: number;
    readonly shutdownDrainTimeoutMs: number;
    readonly cronEnabled: boolean;
  };
  readonly agents: {
    /** Off by default: AGT-07's endpoints stay unmounted until this is chosen. */
    readonly enabled: boolean;
    readonly checkpointing: {
      /** Must match the schema created by migration 0003. */
      readonly schema: string;
      readonly maxStateBytes: number;
    };
    /** Field-for-field mirror of the FND-02 RunBudgetLimits shape. */
    readonly budgets: {
      readonly maxSteps: number;
      readonly maxRetries: number;
      readonly maxDurationMs: number;
      readonly maxTokens: number;
      readonly maxCostUsd: number;
      readonly maxParallelWorkers: number;
      readonly maxExternalActions: number;
    };
    readonly loops: {
      readonly maxReplanIterations: number;
      readonly maxVerificationRetries: number;
    };
    readonly interrupts: {
      readonly clarificationTtlMs: number;
      readonly approvalTtlMs: number;
    };
    readonly models: {
      readonly provider: AgentModelProvider;
      readonly cheap: string;
      readonly mid: string;
      readonly strong: string;
    };
  };
  readonly tools: {
    readonly defaultTimeoutMs: number;
    readonly maxResultBytes: number;
  };
}

function parseCorsOrigins(raw: string | undefined, fallback: string | undefined): string[] {
  const source = raw ?? fallback ?? "http://localhost:5173";
  return source
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Map a zod issue onto the environment variable a reader can act on, keeping the
 * message but discarding any received value (zod echoes values for some codes).
 */
function toConfigIssues(error: z.ZodError): ConfigIssue[] {
  return error.issues.map((issue) => {
    const variable = issue.path.length > 0 ? String(issue.path[0]) : "(config)";
    const message = issue.code === "invalid_type" && "received" in issue &&
        issue.received === "undefined"
      ? "is required but was not set"
      : issue.message;

    return { variable, message };
  });
}

/**
 * Requirements that depend on other values, expressed after the shape parse so
 * that a missing `DB_HOST` and a missing `CHROMA_TENANT` are reported together
 * rather than one boot attempt at a time.
 */
function validateConditionalRequirements(raw: z.infer<typeof RawEnvSchema>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const usesChroma = raw.VECTOR_STORE === "chroma";
  const usesChromaCloud = Boolean(raw.CHROMA_API_KEY);

  if (usesChroma && usesChromaCloud) {
    if (!raw.CHROMA_TENANT) {
      issues.push({
        variable: "CHROMA_TENANT",
        message: "is required when CHROMA_API_KEY selects Chroma Cloud",
      });
    }
    if (!raw.CHROMA_DATABASE) {
      issues.push({
        variable: "CHROMA_DATABASE",
        message: "is required when CHROMA_API_KEY selects Chroma Cloud",
      });
    }
  }

  if (raw.NODE_ENV === "production" && raw.MIGRATIONS_ON_BOOT === "auto") {
    issues.push({
      variable: "MIGRATIONS_ON_BOOT",
      message: 'must not be "auto" in production; migrations are applied explicitly',
    });
  }

  return issues;
}

/**
 * Validate an environment and build the runtime configuration.
 * Pure: no I/O, no process mutation, no exit. Throws `ConfigValidationError`
 * carrying every problem found.
 */
export function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): RuntimeConfig {
  const parsed = RawEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new ConfigValidationError(toConfigIssues(parsed.error));
  }

  const raw = parsed.data;
  const conditionalIssues = validateConditionalRequirements(raw);
  if (conditionalIssues.length > 0) {
    throw new ConfigValidationError(conditionalIssues);
  }

  const isDevelopment = raw.NODE_ENV === "development";

  return Object.freeze({
    schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
    server: Object.freeze({
      nodeEnv: raw.NODE_ENV,
      isDevelopment,
      isProduction: raw.NODE_ENV === "production",
      isTest: raw.NODE_ENV === "test",
      port: raw.PORT,
      corsOrigins: Object.freeze(parseCorsOrigins(raw.CORS_ORIGIN, raw.FRONTEND_URL)) as string[],
    }),
    postgres: Object.freeze({
      host: raw.DB_HOST,
      port: raw.DB_PORT,
      database: raw.DB_NAME,
      user: raw.DB_USER,
      password: raw.DB_PASSWORD,
      ssl: raw.DB_SSL,
      maxConnections: raw.DB_MAX_CONNECTIONS,
    }),
    vector: Object.freeze({
      provider: raw.VECTOR_STORE,
      chromaCloud: Boolean(raw.CHROMA_API_KEY),
      chromaHost: raw.CHROMA_HOST,
      chromaPort: raw.CHROMA_PORT,
      chromaSsl: raw.CHROMA_SSL,
      chromaCollection: raw.CHROMA_COLLECTION,
      chromaApiKey: raw.CHROMA_API_KEY,
      chromaTenant: raw.CHROMA_TENANT,
      chromaDatabase: raw.CHROMA_DATABASE,
    }),
    redis: Object.freeze({
      url: raw.REDIS_URL,
      required: raw.REDIS_REQUIRED,
    }),
    auth: Object.freeze({
      jwtSecret: raw.JWT_SECRET,
      tokenEncryptionKey: raw.TOKEN_ENCRYPTION_KEY,
    }),
    runtime: Object.freeze({
      // Confirmed FND-05 decision: apply automatically in development only.
      migrationsOnBoot: raw.MIGRATIONS_ON_BOOT ?? (isDevelopment ? "auto" : "verify"),
      readinessProbeTimeoutMs: raw.READINESS_PROBE_TIMEOUT_MS,
      shutdownDrainTimeoutMs: raw.SHUTDOWN_DRAIN_TIMEOUT_MS,
      cronEnabled: raw.ENABLE_CRON_JOBS,
    }),
    agents: Object.freeze({
      enabled: raw.AGENT_RUNTIME_ENABLED,
      checkpointing: Object.freeze({
        schema: raw.LANGGRAPH_CHECKPOINT_SCHEMA,
        maxStateBytes: raw.AGENT_MAX_CHECKPOINT_BYTES,
      }),
      budgets: Object.freeze({
        maxSteps: raw.AGENT_MAX_STEPS,
        maxRetries: raw.AGENT_MAX_RETRIES,
        maxDurationMs: raw.AGENT_MAX_DURATION_MS,
        maxTokens: raw.AGENT_MAX_TOKENS,
        maxCostUsd: raw.AGENT_MAX_COST_USD,
        maxParallelWorkers: raw.AGENT_MAX_PARALLEL_WORKERS,
        maxExternalActions: raw.AGENT_MAX_EXTERNAL_ACTIONS,
      }),
      loops: Object.freeze({
        maxReplanIterations: raw.AGENT_MAX_REPLAN_ITERATIONS,
        maxVerificationRetries: raw.AGENT_MAX_VERIFICATION_RETRIES,
      }),
      interrupts: Object.freeze({
        clarificationTtlMs: raw.AGENT_CLARIFICATION_TTL_MS,
        approvalTtlMs: raw.AGENT_APPROVAL_TTL_MS,
      }),
      models: Object.freeze({
        provider: raw.AGENT_MODEL_PROVIDER,
        cheap: raw.AGENT_MODEL_CHEAP,
        mid: raw.AGENT_MODEL_MID,
        strong: raw.AGENT_MODEL_STRONG,
      }),
    }),
    tools: Object.freeze({
      defaultTimeoutMs: raw.TOOL_DEFAULT_TIMEOUT_MS,
      maxResultBytes: raw.TOOL_MAX_RESULT_BYTES,
    }),
  }) as RuntimeConfig;
}

/* -------------------------------------------------------------------------- */
/* safe summary                                                                */
/* -------------------------------------------------------------------------- */

export interface RuntimeConfigSummary {
  schemaVersion: string;
  nodeEnv: NodeEnvName;
  port: number;
  postgres: { host: string; port: number; database: string; user: string; ssl: boolean };
  vector: { provider: VectorStoreName; mode: "cloud" | "local"; host: string; port: number; collection: string };
  redis: { host: string; required: boolean };
  secrets: Record<string, "set" | "unset">;
  runtime: { migrationsOnBoot: MigrationMode; cronEnabled: boolean };
  agents: {
    enabled: boolean;
    checkpointSchema: string;
    modelProvider: AgentModelProvider;
    models: { cheap: string; mid: string; strong: string };
    budgets: RuntimeConfig["agents"]["budgets"];
    loops: RuntimeConfig["agents"]["loops"];
  };
  tools: { defaultTimeoutMs: number; maxResultBytes: number };
}

/**
 * Log-safe projection of the configuration. Secrets are reported only as
 * set/unset — never their value, length, or prefix.
 */
export function describeRuntimeConfig(config: RuntimeConfig): RuntimeConfigSummary {
  let redisHost = config.redis.url;
  try {
    const url = new URL(config.redis.url);
    redisHost = `${url.hostname}:${url.port || "6379"}`;
  } catch {
    redisHost = "(unparseable)";
  }

  return {
    schemaVersion: config.schemaVersion,
    nodeEnv: config.server.nodeEnv,
    port: config.server.port,
    postgres: {
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      ssl: config.postgres.ssl,
    },
    vector: {
      provider: config.vector.provider,
      mode: config.vector.chromaCloud ? "cloud" : "local",
      host: config.vector.chromaHost,
      port: config.vector.chromaPort,
      collection: config.vector.chromaCollection,
    },
    redis: { host: redisHost, required: config.redis.required },
    secrets: {
      DB_PASSWORD: describeSecret(config.postgres.password),
      JWT_SECRET: describeSecret(config.auth.jwtSecret),
      TOKEN_ENCRYPTION_KEY: describeSecret(config.auth.tokenEncryptionKey),
      CHROMA_API_KEY: describeSecret(config.vector.chromaApiKey),
    },
    runtime: {
      migrationsOnBoot: config.runtime.migrationsOnBoot,
      cronEnabled: config.runtime.cronEnabled,
    },
    // Model names and budget ceilings are not secrets, and they are the first
    // thing anyone reading a boot log wants when a run behaves unexpectedly.
    agents: {
      enabled: config.agents.enabled,
      checkpointSchema: config.agents.checkpointing.schema,
      modelProvider: config.agents.models.provider,
      models: {
        cheap: config.agents.models.cheap,
        mid: config.agents.models.mid,
        strong: config.agents.models.strong,
      },
      budgets: config.agents.budgets,
      loops: config.agents.loops,
    },
    tools: {
      defaultTimeoutMs: config.tools.defaultTimeoutMs,
      maxResultBytes: config.tools.maxResultBytes,
    },
  };
}

/** Names of the variables this module treats as secret. Used by tests and probes. */
export function secretVariableNames(): string[] {
  return Object.keys(RawEnvSchema.shape).filter(isSecretEnvName);
}

/* -------------------------------------------------------------------------- */
/* memoized accessor                                                           */
/* -------------------------------------------------------------------------- */

let cached: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  if (!cached) cached = loadRuntimeConfig();
  return cached;
}

export function resetRuntimeConfigForTests(): void {
  cached = undefined;
}
