/**
 * AGT-02 — stable, opaque LangGraph thread identity.
 *
 * A conversation can contain many runs, so conversation ID alone would load
 * whichever run happened to checkpoint last. Run ID alone is globally unique,
 * but including the tenant and conversation turns an accidental mismatch into
 * a different thread instead of a shared checkpoint. Hashing keeps the key
 * bounded and avoids copying application identifiers into every checkpoint
 * table and index.
 */

import { createHash } from "node:crypto";

export const RUN_THREAD_ID_VERSION = "v1" as const;

export interface RunCheckpointScope {
  runId: string;
  userId: string | number;
  conversationId: string;
}

export function buildRunThreadId(scope: RunCheckpointScope): string {
  const identity = JSON.stringify([
    RUN_THREAD_ID_VERSION,
    String(scope.userId),
    scope.conversationId,
    scope.runId,
  ]);
  const digest = createHash("sha256").update(identity).digest("hex");
  return `myra:${RUN_THREAD_ID_VERSION}:${digest}`;
}
