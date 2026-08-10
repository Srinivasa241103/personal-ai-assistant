/**
 * AGT-03 — deterministic feature extraction over a request.
 *
 * Everything the Supervisor can know about a request without asking a model.
 * The gates in `supervisorPolicy` read these; the prompt is handed them as data
 * so the model starts from the deterministic result rather than re-deriving it.
 *
 * This is a small reimplementation of the *spirit* of
 * `src/RAG/retrieval/retrievalPlanner.ts` — which does the same job for
 * retrieval, and which `agents` cannot import (FND-07 gives this module no
 * `legacyAllowlist`). The duplication is deliberate and narrow: the planner
 * decides filters and date ranges for a query, this decides which flow a
 * request belongs to. They answer different questions from the same sentence.
 *
 * Pure: no I/O, no clock of its own, no model. `now` is injected so a fixture
 * is reproducible.
 */

import type { EvidenceSource } from "../contracts/index.js";

export type TemporalIntent = "latest" | "date_range" | "oldest" | "none";

export interface RequestSignals {
  /** Lower-cased, whitespace-collapsed. Every pattern below matches this. */
  normalizedInput: string;
  length: number;
  isQuestionForm: boolean;
  /** True only for informational interrogatives — "can you…" is a request. */
  isInformationalQuestion: boolean;
  temporalIntent: TemporalIntent;
  /** Connector sources the request names explicitly, deduplicated, in registry order. */
  namedSources: EvidenceSource[];
  hasCrossSourceConjunction: boolean;
  hasBriefingNoun: boolean;
  hasMeetingReference: boolean;
}

export interface RequestSignalInput {
  input: string;
  timezone?: string | undefined;
  now?: Date | undefined;
}

/**
 * Connector sources only. `memory`, `index`, `user_input`, and `action_receipt`
 * are never *named* by a user — they are how the system answers, not what the
 * user asks for.
 */
const SOURCE_PATTERNS: ReadonlyArray<{ source: EvidenceSource; pattern: RegExp }> = [
  { source: "gmail", pattern: /\b(?:e-?mails?|mails?|inbox|gmail|threads?)\b/ },
  { source: "calendar", pattern: /\b(?:calendars?|events?|meetings?|invites?|1:1s?|standups?|syncs?)\b/ },
  { source: "slack", pattern: /\b(?:slack|channels?|dms?)\b/ },
  { source: "notion", pattern: /\b(?:notion|wikis?|pages?)\b/ },
  { source: "drive", pattern: /\b(?:drive|docs?|documents?|files?|spreadsheets?|decks?|slides?)\b/ },
];

const CROSS_SOURCE_PATTERN = /\b(?:across|both|as well as|and also|everywhere|all sources|everything about)\b/;

const BRIEFING_PATTERN =
  /\b(?:brief|briefing|prep(?:are)?\s+me|get\s+me\s+up\s+to\s+speed|catch\s+me\s+up|what\s+do\s+i\s+need\s+to\s+know|rundown|before\s+(?:the|my|tomorrow'?s))\b/;

const MEETING_PATTERN =
  /\b(?:meetings?|1:1s?|one[\s-]on[\s-]ones?|syncs?|standups?|reviews?|calls?|catch[\s-]ups?|interviews?|board\s+sync)\b/;

const LATEST_PATTERN = /\b(?:latest|last|most\s+recent|recent|newest|current)\b/;
const OLDEST_PATTERN = /\b(?:oldest|earliest|first)\b/;
const DATE_RANGE_PATTERN =
  /\b(?:today|tomorrow|yesterday|tonight|this\s+(?:week|month|morning|afternoon|evening)|next\s+(?:week|month)|last\s+(?:week|month)|between|since|until|on\s+(?:mon|tue|wed|thu|fri|sat|sun)|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/;

/** Interrogatives that ask for information rather than for an action. */
const INFORMATIONAL_PATTERN =
  /^(?:what|when|who|whom|whose|where|which|why|how|is|are|was|were|did|does|do|has|have|had)\b/;

/** Openers that make a question a *request*, so they are not informational. */
const REQUEST_OPENER_PATTERN =
  /^(?:can\s+you|could\s+you|would\s+you|will\s+you|please|i\s+(?:want|need)\s+to|i'?d\s+like|let'?s)\b/;

const IMPERATIVE_LOOKUP_PATTERN = /^(?:find|show|get|search|look\s+up|pull\s+up|list|tell\s+me)\b/;

export function normalizeRequestText(input: string): string {
  return input
    // Control characters would let a request smuggle structure past the fence.
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveTemporalIntent(text: string): TemporalIntent {
  // A named date beats a vague "recent": "last week's emails" is a range, not
  // a most-recent lookup, and the two lead to different retrieval behaviour.
  if (DATE_RANGE_PATTERN.test(text)) return "date_range";
  if (OLDEST_PATTERN.test(text)) return "oldest";
  if (LATEST_PATTERN.test(text)) return "latest";
  return "none";
}

function resolveNamedSources(text: string): EvidenceSource[] {
  const found: EvidenceSource[] = [];
  for (const { source, pattern } of SOURCE_PATTERNS) {
    if (pattern.test(text) && !found.includes(source)) found.push(source);
  }
  return found;
}

export function deriveRequestSignals(input: RequestSignalInput): RequestSignals {
  const normalizedInput = normalizeRequestText(input.input);
  const namedSources = resolveNamedSources(normalizedInput);
  const isRequestOpener = REQUEST_OPENER_PATTERN.test(normalizedInput);
  const isInformational = !isRequestOpener && INFORMATIONAL_PATTERN.test(normalizedInput);

  return {
    normalizedInput,
    length: normalizedInput.length,
    isQuestionForm: isInformational || normalizedInput.endsWith("?"),
    isInformationalQuestion: isInformational,
    temporalIntent: resolveTemporalIntent(normalizedInput),
    namedSources,
    // Two named sources is itself a cross-source signal; the conjunction words
    // catch the case where the second source is implied ("everything about X").
    hasCrossSourceConjunction:
      namedSources.length > 1 || CROSS_SOURCE_PATTERN.test(normalizedInput),
    hasBriefingNoun: BRIEFING_PATTERN.test(normalizedInput),
    hasMeetingReference: MEETING_PATTERN.test(normalizedInput),
  };
}

export function isImperativeLookup(signals: RequestSignals): boolean {
  return IMPERATIVE_LOOKUP_PATTERN.test(signals.normalizedInput);
}
