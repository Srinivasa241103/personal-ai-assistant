import dotenv from "dotenv";

dotenv.config();

function envFixture(name: string, fallback: () => string): string {
  const configured = process.env[name]?.trim();
  if (configured && !configured.startsWith("<")) {
    return configured.replace(/\\n/g, "\n");
  }
  return fallback();
}

export const CREDENTIAL_SHAPE_FIXTURES = Object.freeze({
  googleAccessToken: envFixture("CHECKPOINT_TEST_GOOGLE_ACCESS_TOKEN", () =>
    ["ya", `29.${"a".repeat(32)}`].join(""),
  ),
  googleRefreshToken: envFixture("CHECKPOINT_TEST_GOOGLE_REFRESH_TOKEN", () =>
    ["1", `//${"a".repeat(36)}`].join(""),
  ),
  googleApiKey: envFixture("CHECKPOINT_TEST_GOOGLE_API_KEY", () =>
    ["AI", `za${"a".repeat(35)}`].join(""),
  ),
  openAiApiKey: envFixture("CHECKPOINT_TEST_OPENAI_API_KEY", () =>
    ["s", `k-${"a".repeat(32)}`].join(""),
  ),
  anthropicApiKey: envFixture("CHECKPOINT_TEST_ANTHROPIC_API_KEY", () =>
    ["s", `k-ant-${"a".repeat(32)}`].join(""),
  ),
  slackToken: envFixture("CHECKPOINT_TEST_SLACK_TOKEN", () =>
    ["xo", `xb-${"1".repeat(12)}-${"a".repeat(16)}`].join(""),
  ),
  bearerHeader: envFixture("CHECKPOINT_TEST_BEARER_HEADER", () =>
    ["Bearer", "a".repeat(32)].join(" "),
  ),
  pemPrivateKey: envFixture("CHECKPOINT_TEST_PEM_PRIVATE_KEY", () =>
    ["-----BEGIN RSA", "PRIVATE KEY-----\nMIIE...\n"].join(" "),
  ),
  smuggledGoogleAccessToken: envFixture("CHECKPOINT_TEST_SMUGGLED_GOOGLE_ACCESS_TOKEN", () =>
    ["ya", `29.${"b".repeat(32)}`].join(""),
  ),
});
