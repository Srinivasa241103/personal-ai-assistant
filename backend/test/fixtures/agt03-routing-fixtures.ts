/**
 * AGT-03 fixtures — the routing table.
 *
 * This table is the specification. Every row states a request and the flow it
 * must reach, and whether a deterministic gate or the model is expected to
 * settle it. Deterministic rows are proven, not asserted: the test passes a
 * decider that throws if the model is consulted at all.
 *
 * The scripted helpers below let the retry and validation suites exercise the
 * real policy with no provider, no network, and no graph.
 */

import { AIMessage } from "@langchain/core/messages";
import type { SupportedFlow } from "../../src/agents/contracts/index.js";
import type { StructuredToolAttempt } from "../../src/agents/models/structuredCall.js";
import type { ProposalRequester } from "../../src/agents/policies/supervisorPolicy.js";
import type { SupervisorRequestContext } from "../../src/agents/policies/supervisorPolicy.js";
import { SUPERVISOR_ERROR_CODES } from "../../src/agents/policies/supervisorErrors.js";

export const RUN_ID = "run-agt03";
export const USER_ID = 42;
export const CONVERSATION_ID = "conversation-agt03";
export const NOW = "2026-08-10T09:00:00.000+05:30";

export type ExpectedGate = "deterministic" | "model" | "refused";

export interface RoutingFixture {
  id: string;
  input: string;
  timezone?: string;
  expected: {
    gate: ExpectedGate;
    flow?: SupportedFlow;
    refusalCode?: string;
    /** Set when the fixture exists to prove write intent, not just routing. */
    hasWriteIntent?: boolean;
  };
}

export function buildContext(
  overrides: Partial<SupervisorRequestContext> = {},
): SupervisorRequestContext {
  return {
    runId: RUN_ID,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    input: "what did Priya say about the launch?",
    timezone: "Asia/Kolkata",
    now: NOW,
    cancellationRequested: false,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* the routing table                                                           */
/* -------------------------------------------------------------------------- */

export const ROUTING_FIXTURES: readonly RoutingFixture[] = [
  /* simple_lookup — the deterministic fast path -------------------------- */
  {
    id: "lookup/last-email",
    input: "what's my last email from Priya",
    expected: { gate: "deterministic", flow: "simple_lookup" },
  },
  {
    id: "lookup/next-1on1",
    input: "when is my 1:1 with Arjun",
    expected: { gate: "deterministic", flow: "simple_lookup" },
  },
  {
    id: "lookup/find-doc",
    input: "find the Q3 budget doc",
    expected: { gate: "deterministic", flow: "simple_lookup" },
  },

  /* cross_source_answer — needs the model -------------------------------- */
  {
    id: "cross/project-status",
    input: "what's the status of Project X across email and slack",
    expected: { gate: "model", flow: "cross_source_answer" },
  },
  {
    id: "cross/decision",
    input: "what did we decide about the pricing change, and where was it discussed",
    expected: { gate: "model", flow: "cross_source_answer" },
  },

  /* meeting_brief -------------------------------------------------------- */
  {
    id: "brief/tomorrow-review",
    input: "prepare me for tomorrow's Project X review with Rahul",
    expected: { gate: "model", flow: "meeting_brief" },
  },
  {
    id: "brief/board-sync",
    input: "what do I need to know before the board sync",
    expected: { gate: "model", flow: "meeting_brief" },
  },

  /* schedule_meeting — model only; no deterministic gate enters a write --- */
  {
    id: "schedule/sync-with-rahul",
    input: "schedule a 30 min sync with Rahul tomorrow",
    expected: { gate: "model", flow: "schedule_meeting", hasWriteIntent: true },
  },
  {
    id: "schedule/book-design-team",
    input: "book time with the design team next week",
    expected: { gate: "model", flow: "schedule_meeting", hasWriteIntent: true },
  },

  /* refusals ------------------------------------------------------------- */
  {
    id: "refuse/delete-emails",
    input: "delete all emails from marketing",
    expected: { gate: "refused", refusalCode: SUPERVISOR_ERROR_CODES.requestProhibited },
  },
  {
    id: "refuse/revoke-access",
    input: "remove Priya's access to the roadmap doc",
    expected: { gate: "refused", refusalCode: SUPERVISOR_ERROR_CODES.requestProhibited },
  },
  {
    id: "refuse/email-everyone",
    input: "email everyone in the company about the outage",
    expected: { gate: "refused", refusalCode: SUPERVISOR_ERROR_CODES.requestProhibited },
  },
  {
    id: "refuse/slack-post",
    input: "post a message to slack telling the team we shipped",
    expected: { gate: "refused", refusalCode: SUPERVISOR_ERROR_CODES.capabilityUnsupported },
  },
];

/* -------------------------------------------------------------------------- */
/* write-intent table — the negatives matter more than the positives          */
/* -------------------------------------------------------------------------- */

export const WRITE_INTENT_FIXTURES: ReadonlyArray<{
  id: string;
  input: string;
  hasWriteIntent: boolean;
  note: string;
}> = [
  { id: "noun/schedule", input: "what's on my schedule tomorrow", hasWriteIntent: false, note: "schedule is a noun here" },
  { id: "noun/the-invite", input: "did the invite go out for the review?", hasWriteIntent: false, note: "invite is a noun" },
  { id: "negated/dont", input: "don't schedule anything on Friday", hasWriteIntent: false, note: "explicit negation" },
  { id: "negated/no-need", input: "no need to send a reply, just summarise it", hasWriteIntent: false, note: "negation window" },
  { id: "question/did-anyone", input: "did anyone schedule the review?", hasWriteIntent: false, note: "informational interrogative" },
  { id: "question/when-was", input: "when was the sync booked?", hasWriteIntent: false, note: "asking about a past write" },
  { id: "quoted/pasted", input: "here's what Priya wrote: \"can you send the deck to legal\" — what is she asking for?", hasWriteIntent: false, note: "informational frame around pasted text" },

  { id: "imperative/schedule", input: "schedule a 30 min sync with Rahul tomorrow", hasWriteIntent: true, note: "verb first" },
  { id: "imperative/book", input: "book time with the design team next week", hasWriteIntent: true, note: "verb first" },
  { id: "polite/can-you", input: "can you schedule a meeting with Rahul on Friday", hasWriteIntent: true, note: "request opener" },
  { id: "polite/please", input: "please send Priya the launch summary", hasWriteIntent: true, note: "request opener" },
  { id: "first-person/i-need", input: "I need to set up a review with the platform team", hasWriteIntent: true, note: "first-person request" },
];

/* -------------------------------------------------------------------------- */
/* scripted model attempts                                                     */
/* -------------------------------------------------------------------------- */

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };
const SOME_USAGE = { inputTokens: 900, outputTokens: 120 };

function assistantWithToolCall(args: unknown, toolName = "select_agent_flow"): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ name: toolName, args: args as Record<string, unknown>, id: "call-1" }],
  });
}

export function toolCallAttempt(args: unknown): StructuredToolAttempt {
  return {
    outcome: "tool_call",
    args,
    toolCallId: "call-1",
    raw: assistantWithToolCall(args),
    usage: SOME_USAGE,
    durationMs: 120,
  };
}

export function noToolCallAttempt(): StructuredToolAttempt {
  return {
    outcome: "no_tool_call",
    raw: new AIMessage({ content: "I think you want the calendar." }),
    usage: SOME_USAGE,
    durationMs: 90,
  };
}

export function wrongToolAttempt(calledName = "search_everything"): StructuredToolAttempt {
  return {
    outcome: "wrong_tool",
    calledName,
    raw: assistantWithToolCall({}, calledName),
    usage: SOME_USAGE,
    durationMs: 95,
  };
}

export function transportErrorAttempt(): StructuredToolAttempt {
  return {
    outcome: "transport_error",
    error: new Error("socket hang up"),
    usage: NO_USAGE,
    durationMs: 30,
  };
}

/**
 * A requester that returns the given attempts in order and records how many
 * times it was called — the assertion that bounds the retry.
 */
export function scriptedRequester(attempts: readonly StructuredToolAttempt[]): ProposalRequester & {
  callCount: () => number;
  lastMessages: () => unknown[];
} {
  let index = 0;
  let calls = 0;
  let last: unknown[] = [];

  const requester = (async (request) => {
    calls += 1;
    last = request.messages as unknown[];
    const attempt = attempts[Math.min(index, attempts.length - 1)];
    index += 1;
    return attempt;
  }) as ProposalRequester & { callCount: () => number; lastMessages: () => unknown[] };

  requester.callCount = () => calls;
  requester.lastMessages = () => last;
  return requester;
}

/** A requester that fails the test if the model is consulted at all. */
export const forbiddenRequester: ProposalRequester = async () => {
  throw new Error("the model must not be called for this request");
};

/* -------------------------------------------------------------------------- */
/* valid proposals                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Source sets chosen to satisfy each flow's own contract: `simple_lookup`
 * declares `index` as its only evidence source, `meeting_brief` needs three
 * distinct sources to be able to succeed, and `schedule_meeting` can only
 * *reach* calendar and gmail through its allowed tools.
 */
export const VALID_PROPOSALS = {
  simple_lookup: {
    mode: "answer",
    flow: "simple_lookup",
    risk: "low",
    sources: ["index"],
    freshnessEscalations: [],
    successCriteria: ["The indexed answer names the message and its sender."],
    rationale: { signals: ["single source named"], rejectedFlows: [] },
  },
  cross_source_answer: {
    mode: "answer",
    flow: "cross_source_answer",
    risk: "low",
    sources: ["gmail", "slack"],
    freshnessEscalations: [],
    successCriteria: ["The answer states the current status and cites both sources."],
    rationale: { signals: ["two sources named"], rejectedFlows: [] },
  },
  meeting_brief: {
    mode: "briefing",
    flow: "meeting_brief",
    risk: "low",
    sources: ["calendar", "gmail", "slack"],
    freshnessEscalations: [
      { source: "calendar", mode: "live", reason: "the meeting may have moved since the last sync" },
    ],
    successCriteria: [
      "The brief names the meeting, its participants, and the open items.",
    ],
    rationale: { signals: ["explicit meeting reference", "temporal word: tomorrow"], rejectedFlows: [] },
  },
  schedule_meeting: {
    mode: "action",
    flow: "schedule_meeting",
    risk: "medium",
    sources: ["calendar", "gmail"],
    freshnessEscalations: [],
    successCriteria: ["A slot free for every attendee is proposed for approval."],
    rationale: { signals: ["imperative: schedule"], rejectedFlows: [] },
  },
  clarification: {
    mode: "briefing",
    flow: "meeting_brief",
    risk: "low",
    sources: ["calendar", "gmail", "slack"],
    freshnessEscalations: [],
    successCriteria: ["The brief covers the meeting the user meant."],
    clarification: {
      prompt: "Which meeting did you mean?",
      missingFields: ["meeting"],
      options: ["Project X review, 10:30", "Board sync, 15:00"],
    },
    rationale: { signals: ["ambiguous meeting reference"], rejectedFlows: [] },
  },
} as const;
