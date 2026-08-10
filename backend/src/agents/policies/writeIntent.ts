/**
 * AGT-03 — did the *user* ask for a write?
 *
 * This is the predicate the whole read-cannot-become-write guarantee rests on.
 * `SupervisorDecisionSchema` (AGT-01) already makes it impossible to run a read
 * flow in action mode or a write flow in answer mode — but a contract cannot
 * know whether the human wanted a write at all. That is what this decides, and
 * it decides it from `request.input` alone, never from retrieved content.
 *
 * It is used twice, on purpose:
 *
 *   1. **Before the prompt**, to compute `enabledFlows`. With no write intent
 *      the write flows are absent from the catalog *and* from the model-facing
 *      enum, so a model that names one produces a parse error rather than a
 *      write. The strongest form of the guarantee is not "the router refuses"
 *      but "the vocabulary does not contain the word".
 *   2. **After the model**, as the `write_without_intent` semantic check. That
 *      second call is redundant by design — it asserts step 1 was computed
 *      correctly — and it is the one the mutation test deletes to prove the
 *      guard bites.
 *
 * The hard part is English, not policy. "Schedule" is a verb in "schedule a
 * sync" and a noun in "what's on my schedule tomorrow", and the second must
 * never enter the write vertical. Three rules separate them: a determiner
 * before the word makes it a noun, a negation window suppresses it, and a
 * purely informational interrogative cannot carry an imperative.
 */

import type { RequestSignals } from "./requestSignals.js";

export interface WriteIntent {
  hasWriteIntent: boolean;
  /** Verb lemmas that matched in verb position. */
  verbs: string[];
  /** The exact substrings that matched, for the trace and for tests. */
  matchedPhrases: string[];
  /** True when a verb was found but explicitly negated. */
  negated: boolean;
}

/**
 * Closed list. Every entry is a verb this system could actually act on through
 * a flow with an approval boundary — there is no point detecting intent the
 * product cannot serve. Ordered longest-first so multi-word phrases win.
 */
const WRITE_VERBS: readonly string[] = [
  "put on my calendar",
  "add to my calendar",
  "set up",
  "schedule",
  "book",
  "arrange",
  "organise",
  "organize",
  "invite",
  "reschedule",
  "reply",
  "respond",
  "forward",
  "send",
  "email",
  "draft and send",
];

/**
 * A determiner or possessive immediately before the word makes it a noun.
 * "my schedule", "the invite", "a reply" — none of these is a request to act.
 * One optional adjective is allowed between ("my packed schedule").
 */
const NOUN_CONTEXT = String.raw`(?:my|your|his|her|their|our|the|a|an|this|that|these|those)\s+(?:\w+\s+){0,1}`;

/** Prepositional forms that are unambiguously a noun reference. */
const NOUN_PHRASE_PATTERNS: readonly RegExp[] = [
  /\bon\s+(?:my|your|his|her|their|our|the)\s+(?:\w+\s+){0,1}schedule\b/,
  /\bin\s+(?:my|your|his|her|their|our|the)\s+(?:\w+\s+){0,1}(?:calendar|inbox)\b/,
];

const NEGATION_WINDOW = String.raw`(?:don'?t|do not|never|without|no need to|rather not|instead of|avoid)\s+(?:\w+\s+){0,2}`;

/**
 * Openers that turn a question into a request. "Can you schedule…" is a write
 * request; "did anyone schedule…" is not.
 */
const REQUEST_OPENER =
  /\b(?:can\s+you|could\s+you|would\s+you|will\s+you|please|i\s+(?:want|need)\s+to|i'?d\s+like(?:\s+you)?\s+to|let'?s|go\s+ahead\s+and)\b/;

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `verb` occur somewhere that is not a noun position and not negated? */
function findVerbOccurrence(
  text: string,
  verb: string,
): { matched: string; negated: boolean } | null {
  const escaped = escapeForRegex(verb);

  if (new RegExp(`${NEGATION_WINDOW}${escaped}\\b`).test(text)) {
    return { matched: verb, negated: true };
  }

  // A noun-phrase form anywhere in the sentence disqualifies this verb even if
  // it also appears bare — "what's on my schedule, and the schedule for Friday".
  if (NOUN_PHRASE_PATTERNS.some((pattern) => pattern.test(text))
    && /^(?:schedule|calendar|invite)$/.test(verb)) {
    return null;
  }

  const occurrence = new RegExp(`(^|[^a-z])${escaped}\\b`).exec(text);
  if (!occurrence) return null;

  // Reject the occurrence if it sits directly after a determiner.
  if (new RegExp(`${NOUN_CONTEXT}${escaped}\\b`).test(text)) return null;

  return { matched: verb, negated: false };
}

/**
 * `signals` is optional so the detector can be used on a bare string in tests
 * and in the semantic post-check, where the signals are already to hand.
 */
export function detectWriteIntent(
  input: string,
  signals?: Pick<RequestSignals, "normalizedInput" | "isInformationalQuestion">,
): WriteIntent {
  const text = signals?.normalizedInput ?? input.toLowerCase().replace(/\s+/g, " ").trim();

  const verbs: string[] = [];
  const matchedPhrases: string[] = [];
  let negated = false;

  for (const verb of WRITE_VERBS) {
    const occurrence = findVerbOccurrence(text, verb);
    if (!occurrence) continue;
    if (occurrence.negated) {
      negated = true;
      continue;
    }
    // Longest-first ordering means a multi-word phrase is recorded before its
    // constituent verb; skip the constituent so "set up" is not also "up".
    if (matchedPhrases.some((phrase) => phrase.includes(verb))) continue;
    verbs.push(verb);
    matchedPhrases.push(occurrence.matched);
  }

  if (verbs.length === 0) {
    return { hasWriteIntent: false, verbs: [], matchedPhrases: [], negated };
  }

  // An informational interrogative with no request opener is asking *about* a
  // write, not asking for one: "did anyone schedule the review?".
  const isInformational = signals?.isInformationalQuestion ?? false;
  if (isInformational && !REQUEST_OPENER.test(text)) {
    return { hasWriteIntent: false, verbs, matchedPhrases, negated };
  }

  return { hasWriteIntent: true, verbs, matchedPhrases, negated };
}
