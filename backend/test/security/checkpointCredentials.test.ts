/**
 * AGT-01 security — no credential material in a checkpoint.
 *
 * AGT-01's acceptance criterion is blunt: "checkpoint state contains no OAuth
 * token or raw credential". Checkpoints are the longest-lived artefact this
 * system writes — they survive restarts, they are read back verbatim on resume,
 * and they are dumped wholesale into a trace when someone debugs a run. A
 * refresh token that reaches one has effectively been written to a log.
 *
 * The check has two halves and they fail differently:
 *
 *   Keys are structural. `refreshToken` means a credential no matter what is
 *   beside it, so a key match is decisive and cheap.
 *
 *   Values are content, and the state is full of the user's own words. A
 *   value pattern that fires on ordinary prose would refuse to run a legitimate
 *   request — so the patterns are provider-specific prefixes long enough that a
 *   false positive would itself be worth investigating. The tests below pin
 *   both directions: the shapes that must be caught, and the ordinary text that
 *   must not be.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CredentialInStateError,
  assertNoCredentialMaterial,
  findCredentialMaterial,
} from "../../src/agents/state/stateGuards.js";
import { AGT01_FIXTURES, buildState } from "../fixtures/agt01-state-fixtures.js";
import { CREDENTIAL_SHAPE_FIXTURES } from "../fixtures/credential-shape-fixtures.js";

/* -------------------------------------------------------------------------- */
/* keys                                                                        */
/* -------------------------------------------------------------------------- */

test("a credential-named key is rejected wherever it appears", () => {
  const cases: Array<[string, unknown]> = [
    ["top level", { access_token: "anything" }],
    ["camelCase", { refreshToken: "anything" }],
    ["kebab-case", { "refresh-token": "anything" }],
    ["nested in metadata", { evidence: [{ metadata: { authorization: "x" } }] }],
    ["deep in a tool result", { a: { b: { c: { clientSecret: "x" } } } }],
    ["inside an array", { items: [{ apiKey: "x" }] }],
    ["a cookie header", { headers: { Cookie: "session=x" } }],
    ["a password", { connection: { password: "x" } }],
    ["a PEM key holder", { auth: { privateKey: "x" } }],
  ];

  for (const [label, value] of cases) {
    assert.throws(
      () => assertNoCredentialMaterial(value),
      CredentialInStateError,
      `${label} must be rejected`,
    );
  }
});

test("a finding names the path but never the value", () => {
  const leakedValue = CREDENTIAL_SHAPE_FIXTURES.googleAccessToken;
  let caught: unknown;
  try {
    assertNoCredentialMaterial({ google: { access_token: leakedValue } });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof CredentialInStateError);
  assert.equal(caught.findings[0].path, "$.google.access_token");
  assert.equal(
    caught.message.includes(leakedValue),
    false,
    "the error that reports a leak must not itself be the leak",
  );
});

test("a credential key is reported once, not once per nested field", () => {
  const findings = findCredentialMaterial({
    credentials: { access_token: "a", refresh_token: "b", scope: "c" },
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "$.credentials");
});

/* -------------------------------------------------------------------------- */
/* values                                                                      */
/* -------------------------------------------------------------------------- */

test("provider credential shapes are caught even under an innocent key", () => {
  // The realistic version of this: a connector error message, carrying the
  // token it failed with, appended to state as an error message.
  const cases: Array<[string, string]> = [
    ["Google access token", CREDENTIAL_SHAPE_FIXTURES.googleAccessToken],
    ["Google refresh token", CREDENTIAL_SHAPE_FIXTURES.googleRefreshToken],
    ["Google API key", CREDENTIAL_SHAPE_FIXTURES.googleApiKey],
    ["OpenAI-style key", CREDENTIAL_SHAPE_FIXTURES.openAiApiKey],
    ["Anthropic key", CREDENTIAL_SHAPE_FIXTURES.anthropicApiKey],
    ["Slack token", CREDENTIAL_SHAPE_FIXTURES.slackToken],
    ["bearer header", CREDENTIAL_SHAPE_FIXTURES.bearerHeader],
    ["PEM private key", CREDENTIAL_SHAPE_FIXTURES.pemPrivateKey],
  ];

  for (const [label, value] of cases) {
    assert.throws(
      () => assertNoCredentialMaterial({ notes: value }),
      CredentialInStateError,
      `${label} must be caught by value`,
    );
  }
});

test("ordinary user text is not mistaken for a credential", () => {
  // This is the half that would break real runs if it were over-eager. Each of
  // these is something a user could plausibly type into a chat box.
  const innocent = [
    "Can you check my API key settings in Notion?",
    "The password reset email never arrived.",
    "My token expired again — is that the sk- thing?",
    "Bearer with me, this will take a second.",
    "Schedule the review for tomorrow at 3pm with Rahul.",
    "AIza is the prefix Google uses, apparently.",
    "ya29 was mentioned in the incident postmortem.",
  ];

  for (const text of innocent) {
    assert.doesNotThrow(
      () => assertNoCredentialMaterial({ request: { input: text } }),
      `refused a legitimate request: ${text}`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* the real state                                                              */
/* -------------------------------------------------------------------------- */

test("a realistic populated state is clean", () => {
  const state = buildState({
    supervisor: AGT01_FIXTURES.supervisorDecision as never,
    flow: "meeting_brief",
    evidence: [AGT01_FIXTURES.evidenceRef as never],
    completedSubtasks: [AGT01_FIXTURES.completedSubtask as never],
    openQuestions: [AGT01_FIXTURES.openQuestion as never],
    candidateAnswer: "Your Project X review is at 10:30 with Rahul.",
    errors: [AGT01_FIXTURES.runError as never],
    status: "planning",
  });

  assert.deepEqual(findCredentialMaterial(state), []);
});

test("the scan terminates on a cyclic object", () => {
  // Reached before the serializability guard in some call orders, so it must
  // not be the thing that hangs.
  const cyclic: Record<string, unknown> = { name: "run" };
  cyclic.self = cyclic;

  assert.doesNotThrow(() => findCredentialMaterial(cyclic));
});

test("a token smuggled into a state is caught by the composed gate", async () => {
  const { assertCheckpointSafe } = await import("../../src/agents/state/stateGuards.js");

  const leaky = buildState({
    // The shape this actually takes in practice: a connector adapter stashing
    // what it used to make the call onto an evidence reference.
    evidence: [
      {
        ...AGT01_FIXTURES.evidenceRef,
        accessToken: CREDENTIAL_SHAPE_FIXTURES.smuggledGoogleAccessToken,
      },
    ] as never,
  });

  assert.throws(
    () => assertCheckpointSafe(leaky, { runId: "run-1", userId: 42, maxBytes: 262_144 }),
    CredentialInStateError,
  );
});
