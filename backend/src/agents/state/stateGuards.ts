/**
 * AGT-01 — what must be true before a state is written to a checkpoint.
 *
 * AGT-01 requires the runtime to "reject state that exceeds configured size or
 * lacks user/run ownership", and to prove that "checkpoint state contains no
 * OAuth token or raw credential". Those are three different failures and they
 * get three different errors, because "invalid state" tells an operator
 * nothing at 3am.
 *
 * The checks run before the write, not after. A checkpoint that has already
 * been persisted with another tenant's evidence in it is not something a later
 * assertion can fix.
 */

import { assertJsonSerializable } from "../contracts/index.js";
import type { MyraAgentState } from "./stateSchema.js";

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

export class StateOwnershipError extends Error {
  readonly field: string;

  constructor(field: string, expected: string, actual: string) {
    // Never echoes a user id value — this message reaches logs.
    super(`Checkpoint state ${field} does not match the run it is written for`);
    this.name = "StateOwnershipError";
    this.field = field;
    void expected;
    void actual;
  }
}

export class CheckpointTooLargeError extends Error {
  readonly bytes: number;
  readonly maxBytes: number;
  readonly largestChannels: Array<{ channel: string; bytes: number }>;

  constructor(
    bytes: number,
    maxBytes: number,
    largestChannels: Array<{ channel: string; bytes: number }>,
  ) {
    const breakdown = largestChannels
      .map((entry) => `${entry.channel}=${entry.bytes}B`)
      .join(", ");
    super(
      `Checkpoint state is ${bytes} bytes, over the ${maxBytes} byte limit. Largest channels: ${breakdown}`,
    );
    this.name = "CheckpointTooLargeError";
    this.bytes = bytes;
    this.maxBytes = maxBytes;
    this.largestChannels = largestChannels;
  }
}

export class CredentialInStateError extends Error {
  readonly findings: readonly CredentialFinding[];

  constructor(findings: readonly CredentialFinding[]) {
    const where = findings.map((finding) => `${finding.path} (${finding.reason})`).join("; ");
    super(`Credential material must never enter checkpoint state: ${where}`);
    this.name = "CredentialInStateError";
    this.findings = findings;
  }
}

/* -------------------------------------------------------------------------- */
/* size                                                                        */
/* -------------------------------------------------------------------------- */

export function estimateStateBytes(state: unknown): number {
  return Buffer.byteLength(JSON.stringify(state) ?? "", "utf8");
}

/**
 * The per-channel breakdown exists because the total is not actionable. "State
 * is 300KB" prompts a guess; "evidence=280KB" points at the node that started
 * putting bodies where references belong.
 */
export function channelSizes(
  state: Record<string, unknown>,
): Array<{ channel: string; bytes: number }> {
  return Object.entries(state)
    .map(([channel, value]) => ({ channel, bytes: estimateStateBytes(value) }))
    .sort((left, right) => right.bytes - left.bytes);
}

export function assertStateWithinSizeLimit(state: unknown, maxBytes: number): void {
  const bytes = estimateStateBytes(state);
  if (bytes <= maxBytes) return;

  const breakdown =
    state && typeof state === "object"
      ? channelSizes(state as Record<string, unknown>).slice(0, 3)
      : [];
  throw new CheckpointTooLargeError(bytes, maxBytes, breakdown);
}

/* -------------------------------------------------------------------------- */
/* ownership                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The state's own identity must match the run it is being written for. The
 * schema already checks that nested records agree with the state; this checks
 * that the state agrees with its caller, which is the direction that matters
 * when a thread config is built from a request.
 */
export function assertStateOwnership(
  state: Pick<MyraAgentState, "runId" | "userId">,
  scope: { runId: string; userId: string | number },
): void {
  if (state.runId !== scope.runId) {
    throw new StateOwnershipError("runId", scope.runId, state.runId);
  }
  if (state.userId !== scope.userId) {
    throw new StateOwnershipError("userId", String(scope.userId), String(state.userId));
  }
}

/* -------------------------------------------------------------------------- */
/* credentials                                                                 */
/* -------------------------------------------------------------------------- */

export interface CredentialFinding {
  /** JSON path to the offending node. Never carries the value itself. */
  path: string;
  reason: string;
}

/**
 * Key names that mean "the value beside me is a credential". Compared after
 * stripping separators and lowercasing, so `refresh_token`, `refreshToken`, and
 * `Refresh-Token` are one entry.
 */
const CREDENTIAL_KEYS: ReadonlySet<string> = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "bearertoken",
  "authorization",
  "apikey",
  "apisecret",
  "clientsecret",
  "clientid",
  "privatekey",
  "secret",
  "password",
  "passphrase",
  "credentials",
  "credential",
  "cookie",
  "setcookie",
  "authheader",
]);

/**
 * Value shapes that are credentials and essentially nothing else.
 *
 * Deliberately short. A value scan is the risky half of this check: user text
 * is in this state, and a pattern that fires on ordinary prose would refuse to
 * run a legitimate request. Each entry here is a provider-specific prefix long
 * enough that a false positive would itself be suspicious — if a user's message
 * really does contain `ya29.` followed by sixty token characters, a Google
 * access token really is about to be written to a checkpoint.
 */
const CREDENTIAL_VALUE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bya29\.[A-Za-z0-9._-]{20,}/, reason: "Google OAuth access token" },
  { pattern: /\b1\/\/[A-Za-z0-9._-]{30,}/, reason: "Google OAuth refresh token" },
  { pattern: /\bAIza[A-Za-z0-9_-]{35}\b/, reason: "Google API key" },
  { pattern: /\bsk-[A-Za-z0-9]{20,}/, reason: "OpenAI-style secret key" },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/, reason: "Anthropic secret key" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, reason: "Slack token" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: "PEM private key" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/, reason: "bearer credential" },
];

function normalizeKey(key: string): string {
  return key.replace(/[\s_-]/g, "").toLowerCase();
}

/**
 * Walk the state and report every place credential material appears. Returns
 * findings rather than throwing so a caller can log them, and so the assertion
 * below can report all of them at once instead of one boot-fix-boot at a time.
 */
export function findCredentialMaterial(value: unknown, path = "$"): CredentialFinding[] {
  const findings: CredentialFinding[] = [];
  const seen = new Set<object>();

  const walk = (node: unknown, nodePath: string, keyName: string | null): void => {
    if (keyName !== null && CREDENTIAL_KEYS.has(normalizeKey(keyName))) {
      findings.push({
        path: nodePath,
        reason: `key "${keyName}" names a credential`,
      });
      // Do not descend: the subtree is reported, and walking it would only
      // repeat the same finding at deeper paths.
      return;
    }

    if (typeof node === "string") {
      for (const { pattern, reason } of CREDENTIAL_VALUE_PATTERNS) {
        if (pattern.test(node)) findings.push({ path: nodePath, reason });
      }
      return;
    }

    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${nodePath}[${index}]`, null));
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      walk(child, `${nodePath}.${key}`, key);
    }
  };

  walk(value, path, null);
  return findings;
}

export function assertNoCredentialMaterial(value: unknown): void {
  const findings = findCredentialMaterial(value);
  if (findings.length > 0) throw new CredentialInStateError(findings);
}

/* -------------------------------------------------------------------------- */
/* composed gate                                                               */
/* -------------------------------------------------------------------------- */

export interface CheckpointGuardOptions {
  runId: string;
  userId: string | number;
  maxBytes: number;
}

/**
 * The single call AGT-02 makes before persisting a checkpoint. Ordered
 * cheapest-and-most-specific first, so the error a developer sees names the
 * actual problem rather than a downstream symptom of it.
 */
export function assertCheckpointSafe(
  state: MyraAgentState,
  options: CheckpointGuardOptions,
): void {
  assertStateOwnership(state, options);
  // Cycles, accessors, `__proto__`, non-finite numbers, class instances — the
  // FND-02 serialization guard already rejects every one, and a checkpoint that
  // cannot round-trip is a run that cannot resume.
  assertJsonSerializable(state);
  assertNoCredentialMaterial(state);
  assertStateWithinSizeLimit(state, options.maxBytes);
}
