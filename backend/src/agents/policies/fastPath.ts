/**
 * AGT-03 — the `simple_lookup` skip gate.
 *
 * `simple_lookup`'s own contract says it plainly (`flowContracts.ts`,
 * `nonGoals[1]`): "No multi-agent planning when the fast-path contract is
 * sufficient." Diagram 02 puts the saving at roughly 70% of real traffic. A
 * bounded question against one source does not need a model to tell us it is a
 * bounded question against one source.
 *
 * **Conservative by construction.** The gate fires only on a positive match of
 * every condition; anything it cannot settle falls through to the model. The
 * two errors are not symmetric: a wrong fast-path route degrades an answer the
 * user then has to re-ask for, while a wrong fall-through costs one model call.
 * When in doubt, pay for the call.
 */

import type { RequestSignals } from "./requestSignals.js";
import { isImperativeLookup } from "./requestSignals.js";
import type { WriteIntent } from "./writeIntent.js";

export interface FastPathMatch {
  matched: boolean;
  /** The rule that fired, or the condition that blocked it. */
  rule: string | null;
}

/**
 * Long requests carry qualifiers, multiple clauses, and implicit second
 * sources. The threshold is a heuristic, and it is deliberately tight.
 */
const MAX_FAST_PATH_LENGTH = 120;

export function detectFastPathLookup(
  signals: RequestSignals,
  writeIntent: WriteIntent,
): FastPathMatch {
  // Ordered so the returned `rule` names the *first* disqualifying condition,
  // which is what a developer reading a trace wants to know.
  if (writeIntent.hasWriteIntent) return { matched: false, rule: "blocked_write_intent" };
  if (signals.hasBriefingNoun) return { matched: false, rule: "blocked_briefing" };
  if (signals.hasCrossSourceConjunction) return { matched: false, rule: "blocked_cross_source" };
  if (signals.namedSources.length > 1) return { matched: false, rule: "blocked_multiple_sources" };
  if (signals.length > MAX_FAST_PATH_LENGTH) return { matched: false, rule: "blocked_length" };

  // A date range means the answer depends on a window the index may not cover
  // freshly; `oldest` is rare enough that it is not worth a fast path.
  if (signals.temporalIntent === "date_range" || signals.temporalIntent === "oldest") {
    return { matched: false, rule: "blocked_temporal_intent" };
  }

  const asksSomething = signals.isQuestionForm || isImperativeLookup(signals);
  if (!asksSomething) return { matched: false, rule: "blocked_not_a_lookup" };

  return {
    matched: true,
    rule: signals.namedSources.length === 1 ? "single_source_lookup" : "bounded_question",
  };
}
