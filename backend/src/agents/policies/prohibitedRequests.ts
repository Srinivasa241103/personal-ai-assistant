/**
 * AGT-03 — requests the system refuses before spending a model call.
 *
 * Two families, both from the master plan:
 *
 *   §12.5 "strong approval or prohibited in V2" — delete external content,
 *   change access permissions, message large groups, bulk writes.
 *
 *   Capabilities the flow contracts name as non-goals — posting to Slack,
 *   writing to Notion or Drive. The product cannot do them, so routing a
 *   request there would produce a confident failure three nodes later.
 *
 * Every rule matches a **verb applied to an object**, never a keyword bag.
 * "delete" alone appears in "which emails did I delete last week" — a perfectly
 * ordinary read. Matching the pair is what keeps a refusal from swallowing
 * legitimate questions, and it is why each pattern below names both halves.
 *
 * A match short-circuits the whole policy: no model call, no flow, a `failed`
 * run carrying one `policy` error. That was a deliberate product decision —
 * clarification would imply "tell me more and I'll do it", which is false.
 */

import type { RequestSignals } from "./requestSignals.js";
import { detectWriteIntent } from "./writeIntent.js";

export type ProhibitedKind =
  | "destructive"
  | "permission_change"
  | "bulk_messaging"
  | "bulk_write"
  | "unsupported_capability";

export interface ProhibitedMatch {
  kind: ProhibitedKind;
  /** The rule that fired, for the trace. Never the user's text. */
  rule: string;
}

interface ProhibitedRule {
  kind: ProhibitedKind;
  rule: string;
  pattern: RegExp;
}

const DESTRUCTIVE_VERB = String.raw`(?:delete|remove|erase|wipe|purge|trash|discard|clear\s+out)`;
const DESTRUCTIVE_OBJECT = String.raw`(?:e-?mails?|mails?|messages?|threads?|events?|meetings?|invites?|files?|docs?|documents?|pages?|channels?|calendars?|inbox)`;

const SEND_VERB = String.raw`(?:send|e-?mail|message|blast|announce|notify|post)`;
const LARGE_AUDIENCE = String.raw`(?:everyone|every\s?one|all\s+staff|all\s+employees|the\s+whole\s+company|entire\s+company|all\s+contacts|mailing\s+list|the\s+entire\s+team|all\s+of\s+the\s+team|#general)`;

const WRITE_VERB = String.raw`(?:delete|remove|send|e-?mail|reply|archive|update|move|reschedule|cancel)`;

const RULES: readonly ProhibitedRule[] = [
  {
    kind: "destructive",
    rule: "destructive_verb_on_external_object",
    pattern: new RegExp(String.raw`\b${DESTRUCTIVE_VERB}\b(?:\s+\w+){0,3}\s+\b${DESTRUCTIVE_OBJECT}\b`),
  },
  {
    kind: "destructive",
    rule: "empty_or_clear_container",
    pattern: /\b(?:empty|clean\s+out|clear)\s+(?:my\s+|the\s+)?(?:inbox|trash|calendar|drive)\b/,
  },
  {
    kind: "permission_change",
    rule: "access_or_permission_change",
    pattern:
      /\b(?:revoke|remove|grant|change|update|restrict|transfer)\b(?:\s+\w+){0,3}\s+\b(?:access|permissions?|sharing|ownership)\b|\bunshare\b|\bmake\s+(?:it\s+|this\s+)?(?:public|private)\b/,
  },
  {
    kind: "bulk_messaging",
    rule: "send_to_large_audience",
    pattern: new RegExp(String.raw`\b${SEND_VERB}\b(?:\s+\w+){0,4}\s+\b${LARGE_AUDIENCE}\b`),
  },
  {
    kind: "bulk_messaging",
    rule: "large_audience_receives",
    pattern: new RegExp(String.raw`\b${LARGE_AUDIENCE}\b(?:\s+\w+){0,3}\s+\b(?:about|regarding|that)\b`),
  },
  {
    kind: "bulk_write",
    rule: "write_verb_over_every_record",
    pattern: new RegExp(String.raw`\b(?:all\s+(?:of\s+)?(?:my|the)|every|each)\b(?:\s+\w+){0,3}\s+\b${WRITE_VERB}\b|\b${WRITE_VERB}\b(?:\s+\w+){0,2}\s+\b(?:all\s+(?:of\s+)?(?:my|the)|every)\b`),
  },
  {
    kind: "unsupported_capability",
    rule: "slack_write_not_supported",
    pattern: /\b(?:post|send|write|reply|drop)\b(?:\s+\w+){0,3}\s+\b(?:to\s+)?slack\b|\bslack\s+(?:message|post)\s+(?:to|for)\b/,
  },
  {
    kind: "unsupported_capability",
    rule: "notion_write_not_supported",
    pattern: /\b(?:create|update|edit|write|add|append)\b(?:\s+\w+){0,3}\s+\b(?:notion|wiki)\b|\bnotion\s+page\s+(?:for|about)\b(?=.*\b(?:create|update|add)\b)/,
  },
  {
    kind: "unsupported_capability",
    rule: "drive_write_not_supported",
    pattern: /\b(?:create|upload|edit|update|rename|share)\b(?:\s+\w+){0,3}\s+\b(?:drive|doc|document|spreadsheet|folder)\b/,
  },
];

/**
 * Returns the first matching rule, or null.
 *
 * The write-intent guard on the destructive and unsupported families matters:
 * "which files did I delete last week" contains a destructive verb and an
 * object, but no write intent, and refusing it would be wrong. Bulk messaging
 * and permission change are refused regardless — asking *about* revoking
 * someone's access is not a request this router should be routing either way,
 * and the phrasing that reaches these patterns is imperative in practice.
 */
export function classifyProhibited(
  input: string,
  signals: RequestSignals,
): ProhibitedMatch | null {
  const text = signals.normalizedInput;
  const writeIntent = detectWriteIntent(input, signals);

  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;

    const needsWriteIntent =
      rule.kind === "destructive" || rule.kind === "unsupported_capability";
    if (needsWriteIntent && !writeIntent.hasWriteIntent && signals.isInformationalQuestion) {
      continue;
    }

    return { kind: rule.kind, rule: rule.rule };
  }

  return null;
}
