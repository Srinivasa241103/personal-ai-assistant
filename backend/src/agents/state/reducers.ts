/**
 * AGT-01 — the channel reducers, defined explicitly.
 *
 * LangGraph applies a reducer once per update per channel, and with a fan-out
 * it applies several in an order nobody controls. That makes the reducer — not
 * the node — the place where concurrent writes are decided. AGT-01 requires
 * append, replace, deduplicate, and error merges to be spelled out rather than
 * left to a default, because the default (last write wins) silently drops the
 * findings of every worker but one.
 *
 * Three rules every reducer here obeys:
 *
 *   1. **Pure.** `current` is never mutated. LangGraph may hold the previous
 *      value in a checkpoint that has already been serialized; mutating it
 *      would edit history.
 *   2. **Total.** An `undefined` update means "this node had nothing to say"
 *      and returns `current` unchanged, so a node can return a partial object
 *      without erasing channels it did not touch.
 *   3. **Bounded where it matters.** Anything a loop can append to takes a cap.
 *      An unbounded channel is an unbounded checkpoint.
 */

import type { AgentRunStatus } from "../contracts/index.js";
import type { AgentRunError } from "./stateSchema.js";
import { assertStatusTransition } from "./statusTransitions.js";
import type { RunBudgetUsage } from "../contracts/index.js";

/** LangGraph's reducer shape: fold an update into the current value. */
export type Reducer<Value, Update = Value> = (
  current: Value,
  update: Update,
) => Value;

export class ImmutableChannelError extends Error {
  readonly channel: string;

  constructor(channel: string) {
    super(
      `Channel "${channel}" is set once at run creation and cannot be reassigned`,
    );
    this.name = "ImmutableChannelError";
    this.channel = channel;
  }
}

export class ChannelCapacityError extends Error {
  readonly channel: string;
  readonly cap: number;

  constructor(channel: string, cap: number) {
    super(`Channel "${channel}" exceeded its cap of ${cap} entries`);
    this.name = "ChannelCapacityError";
    this.channel = channel;
    this.cap = cap;
  }
}

function toArray<T>(update: T | readonly T[]): readonly T[] {
  return Array.isArray(update) ? update : [update as T];
}

/* -------------------------------------------------------------------------- */
/* scalar channels                                                             */
/* -------------------------------------------------------------------------- */

/** Last write wins. Correct only where exactly one node writes the channel. */
export function replaceReducer<T>(): Reducer<T, T | undefined> {
  return (current, update) => (update === undefined ? current : update);
}

/**
 * The identity channels — `runId`, `userId`, `conversationId`, `request`.
 *
 * Rewriting one of these is how a merged update from the wrong run, or a node
 * that "helpfully" normalizes a user ID, turns into a cross-tenant checkpoint.
 * Re-writing the *same* value is fine and common (a node echoing state back);
 * writing a different one throws.
 */
export function replaceOnceReducer<T>(channel: string): Reducer<T, T | undefined> {
  return (current, update) => {
    if (update === undefined) return current;
    if (current === undefined || current === null) return update;
    if (!sameValue(current, update)) throw new ImmutableChannelError(channel);
    return current;
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (left === null || right === null) return false;
  // Both sides are JSON-only by construction, so a structural compare is exact
  // rather than a heuristic.
  return JSON.stringify(left) === JSON.stringify(right);
}

/* -------------------------------------------------------------------------- */
/* list channels                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Append, accepting either one item or a batch. Used where duplicates are
 * meaningful — there is no such channel today, but a reducer that quietly
 * deduplicates when the caller wanted an append is worse than two functions.
 */
export function appendReducer<T>(
  channel: string,
  options: { cap: number },
): Reducer<T[], T | readonly T[] | undefined> {
  return (current, update) => {
    if (update === undefined) return current;
    const next = [...current, ...toArray(update)];
    if (next.length > options.cap) throw new ChannelCapacityError(channel, options.cap);
    return next;
  };
}

/**
 * Append, ignoring items already present by identity.
 *
 * This is the reducer that makes parallel research safe. Four workers finding
 * the same calendar event must produce one evidence reference, and a worker
 * retried after a timeout must not append its findings twice. `keep` decides
 * which copy survives a collision:
 *
 *   `first` — the earliest observation wins. Right for evidence: the retrieval
 *             that happened first is the one whose `retrievedAt` and
 *             `contentHash` other records already cite.
 *   `last`  — the newest observation wins. Right for subtask results, where a
 *             retry supersedes the attempt that failed.
 */
export function dedupeByIdReducer<T>(
  channel: string,
  identify: (item: T) => string,
  options: { cap: number; keep: "first" | "last" },
): Reducer<T[], T | readonly T[] | undefined> {
  return (current, update) => {
    if (update === undefined) return current;

    const byId = new Map<string, T>();
    for (const item of current) byId.set(identify(item), item);

    for (const item of toArray(update)) {
      const id = identify(item);
      if (options.keep === "first" && byId.has(id)) continue;
      byId.set(id, item);
    }

    const next = [...byId.values()];
    if (next.length > options.cap) throw new ChannelCapacityError(channel, options.cap);
    return next;
  };
}

/**
 * Errors, capped by keeping the *earliest*.
 *
 * Keeping the newest would be the reflex, and it is wrong here. Every failure
 * is already persisted in full to `agent_steps` and `tool_calls`; this channel
 * exists so the graph can route on what went wrong, and a cascade's tenth error
 * is a consequence of its first. The terminal reason is not lost either — it
 * travels in the flow result, not in this list. Overflow is dropped silently
 * rather than thrown: a run that is already failing must not fail differently
 * because its error list filled up.
 */
export function errorAppendReducer(
  cap: number,
): Reducer<AgentRunError[], AgentRunError | readonly AgentRunError[] | undefined> {
  return (current, update) => {
    if (update === undefined) return current;
    if (current.length >= cap) return current;

    const incoming = toArray(update);
    return [...current, ...incoming].slice(0, cap);
  };
}

/* -------------------------------------------------------------------------- */
/* counters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Budget usage, folded from deltas.
 *
 * Nodes report what they consumed, not a running total — that is what makes
 * concurrent workers add up correctly instead of overwriting each other.
 * `durationMs` is the exception and takes a max: four workers running in
 * parallel for ten seconds have consumed ten seconds of the run's wall clock,
 * not forty, and summing it would exhaust the duration budget four times too
 * fast.
 */
export function budgetUsageReducer(): Reducer<
  RunBudgetUsage,
  Partial<RunBudgetUsage> | undefined
> {
  return (current, update) => {
    if (update === undefined) return current;

    return {
      steps: current.steps + (update.steps ?? 0),
      retries: current.retries + (update.retries ?? 0),
      durationMs: Math.max(current.durationMs, update.durationMs ?? 0),
      tokens: current.tokens + (update.tokens ?? 0),
      costUsd: roundCost(current.costUsd + (update.costUsd ?? 0)),
      externalActions: current.externalActions + (update.externalActions ?? 0),
    };
  };
}

/**
 * Six decimal places — a hundredth of a cent. Repeated float addition of
 * per-call costs otherwise drifts into values like 0.30000000000000004, which
 * fail an exact-equality assertion in an evaluation report for no real reason.
 */
function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A counter that may only rise. Used for the replan and verification loops. */
export function monotonicCounterReducer(
  channel: string,
): Reducer<number, number | undefined> {
  return (current, update) => {
    if (update === undefined) return current;
    if (update < current) throw new ImmutableChannelError(channel);
    return update;
  };
}

/**
 * Cancellation latches. Once requested, no later update can clear it — a node
 * that returns a full state object from before the cancellation must not
 * resurrect the run.
 */
export function latchReducer(): Reducer<boolean, boolean | undefined> {
  return (current, update) => {
    if (update === undefined) return current;
    return current || update;
  };
}

/* -------------------------------------------------------------------------- */
/* status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Status, checked against the transition table on every write. The graph's
 * edges already decide what runs next; this catches the case where a node
 * *reports* a status its position could not have produced — the symptom of a
 * stale checkpoint being merged, or of a resumed run re-entering a node it had
 * already left.
 */
export function statusTransitionReducer(): Reducer<
  AgentRunStatus,
  AgentRunStatus | undefined
> {
  return (current, update) => {
    if (update === undefined) return current;
    assertStatusTransition(current, update);
    return update;
  };
}
