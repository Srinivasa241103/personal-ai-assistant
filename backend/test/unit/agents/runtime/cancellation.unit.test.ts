/** AGT-02 — process-local execution and cancellation leases. */

import assert from "node:assert/strict";
import test from "node:test";

import { RunCancellationRegistry } from "../../../../src/agents/runtime/cancellation.js";
import { RunAlreadyActiveError } from "../../../../src/agents/runtime/runErrors.js";

test("one process cannot execute the same run twice concurrently", () => {
  const registry = new RunCancellationRegistry();
  const lease = registry.acquire("run-1");

  assert.throws(() => registry.acquire("run-1"), RunAlreadyActiveError);
  lease.release();
  assert.doesNotThrow(() => registry.acquire("run-1").release());
});

test("cancellation aborts the active signal and release is idempotent", () => {
  const registry = new RunCancellationRegistry();
  const lease = registry.acquire("run-1");

  assert.equal(lease.signal.aborted, false);
  assert.equal(registry.cancel("run-1"), true);
  assert.equal(lease.signal.aborted, true);
  lease.release();
  lease.release();
  assert.equal(registry.isActive("run-1"), false);
  assert.equal(registry.cancel("run-1"), false);
});
