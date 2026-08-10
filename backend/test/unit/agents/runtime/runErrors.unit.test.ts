/** AGT-02 — only normalized, content-free failures become durable. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  IncompatibleRunVersionError,
  normalizeRunError,
} from "../../../../src/agents/runtime/runErrors.js";
import { CREDENTIAL_SHAPE_FIXTURES } from "../../../fixtures/credential-shape-fixtures.js";

const NOW = "2026-08-10T09:00:00.000Z";

test("known lifecycle failures preserve a stable code and retry decision", () => {
  const normalized = normalizeRunError(new IncompatibleRunVersionError(), NOW);

  assert.deepEqual(normalized, {
    code: "run_version_incompatible",
    category: "validation",
    message: "Run was created by an incompatible graph or state version",
    occurredAt: NOW,
    retryable: false,
  });
});

test("an unknown exception cannot copy secret or source content into the run", () => {
  const secret = CREDENTIAL_SHAPE_FIXTURES.anthropicApiKey;
  const normalized = normalizeRunError(
    new Error(`provider failed for private email body using ${secret}`),
    NOW,
  );
  const serialized = JSON.stringify(normalized);

  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private email body"), false);
  assert.equal(normalized.code, "run_internal_error");
});
