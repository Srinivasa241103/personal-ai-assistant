/**
 * AGT-02 — PostgreSQL restart/resume proof.
 *
 * A fresh Pool, PostgresSaver, lifecycle, and compiled graph stand in for a
 * restarted backend. The only things allowed to survive are PostgreSQL rows.
 *
 *   FND_TEST_DATABASE_URL=postgresql://localhost/myra_fnd_test npm run test:agt-02:db
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import {
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { Pool } from "pg";

import type { RuntimeConfig } from "../../../src/config/runtimeConfig.js";
import { createAgentRuntimePersistence } from "../../../src/agents/runtime/persistence.js";
import {
  IncompatibleRunVersionError,
  RunNotFoundError,
  RunNotResumableError,
} from "../../../src/agents/runtime/runErrors.js";
import { AGENT_GRAPH_VERSION } from "../../../src/agents/runtime/graphVersion.js";
import { buildRunThreadId } from "../../../src/agents/runtime/threadIdentity.js";
import { AgentStateAnnotation } from "../../../src/agents/state/channels.js";
import { runMigrations } from "../../../src/database/migrations/migrationRunner.js";

const connectionString = process.env.FND_TEST_DATABASE_URL;
const USER_ID = 101;
const OTHER_USER_ID = 202;
const CONVERSATION_ID = "agt-02-conversation";

const agentConfig = {
  enabled: true,
  checkpointing: { schema: "langgraph", maxStateBytes: 262_144 },
  budgets: {
    maxSteps: 40,
    maxRetries: 2,
    maxDurationMs: 90_000,
    maxTokens: 120_000,
    maxCostUsd: 1,
    maxParallelWorkers: 4,
    maxExternalActions: 3,
  },
  loops: { maxReplanIterations: 3, maxVerificationRetries: 2 },
  interrupts: { clarificationTtlMs: 900_000, approvalTtlMs: 900_000 },
  models: {
    provider: "anthropic",
    cheap: "fixture-cheap",
    mid: "fixture-mid",
    strong: "fixture-strong",
  },
} as const satisfies RuntimeConfig["agents"];

interface ExecutionCounters {
  beforePause: number;
  enterWait: number;
  interruptNode: number;
  finish: number;
}

function emptyCounters(): ExecutionCounters {
  return { beforePause: 0, enterWait: 0, interruptNode: 0, finish: 0 };
}

function buildFixtureGraph(
  checkpointer: Awaited<ReturnType<typeof createAgentRuntimePersistence>>["checkpointer"],
  counters: ExecutionCounters,
) {
  return new StateGraph(AgentStateAnnotation)
    .addNode("enterPlanning", () => {
      counters.beforePause += 1;
      return { status: "planning" as const };
    })
    .addNode("enterClarificationWait", () => {
      counters.enterWait += 1;
      return { status: "waiting_for_clarification" as const };
    })
    .addNode("awaitClarification", () => {
      counters.interruptNode += 1;
      const answer = interrupt<{ prompt: string }, string>({
        prompt: "Which project?",
      });
      return { status: "planning" as const, candidateAnswer: answer };
    })
    .addNode("draftResponse", () => ({ status: "synthesizing" as const }))
    .addNode("verifyResponse", () => ({ status: "verifying" as const }))
    .addNode("finishRun", () => {
      counters.finish += 1;
      return { status: "completed" as const };
    })
    .addEdge(START, "enterPlanning")
    .addEdge("enterPlanning", "enterClarificationWait")
    .addEdge("enterClarificationWait", "awaitClarification")
    .addEdge("awaitClarification", "draftResponse")
    .addEdge("draftResponse", "verifyResponse")
    .addEdge("verifyResponse", "finishRun")
    .addEdge("finishRun", END)
    .compile({ checkpointer });
}

function request(requestId: string) {
  return {
    requestId,
    input: "Prepare a short project update.",
    receivedAt: "2026-08-10T09:00:00.000Z",
    timezone: "Asia/Kolkata",
  };
}

if (!connectionString) {
  test(
    "AGT-02 run lifecycle PostgreSQL integration suite",
    { skip: "Set FND_TEST_DATABASE_URL" },
    () => {},
  );
} else {
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.startsWith("myra_fnd_test")) {
    throw new Error("FND_TEST_DATABASE_URL must target a database named myra_fnd_test*");
  }

  let pool = new Pool({ connectionString });

  before(async () => {
    await pool.query('DROP SCHEMA IF EXISTS "langgraph" CASCADE');
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await runMigrations({ pool });
  });

  after(async () => {
    await pool.end();
  });

  test("a waiting run resumes after a backend restart without repeating completed nodes", async () => {
    const runId = randomUUID();
    const counters = emptyCounters();
    const firstRuntime = await createAgentRuntimePersistence({ pool, agentConfig });
    const firstGraph = buildFixtureGraph(firstRuntime.checkpointer, counters);
    const firstExecution = await firstRuntime.lifecycle.startRun({
      runId,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      request: request(`request-${runId}`),
    });

    try {
      await firstGraph.invoke(firstExecution.state, firstExecution.config);
    } finally {
      firstExecution.release();
    }

    assert.equal(
      (await firstRuntime.lifecycle.getRunState(USER_ID, runId)).status,
      "waiting_for_clarification",
    );
    assert.deepEqual(counters, {
      beforePause: 1,
      enterWait: 1,
      interruptNode: 1,
      finish: 0,
    });

    // Nothing in memory survives this boundary: new pool, saver, lifecycle,
    // and compiled graph, matching a real backend process restart.
    await pool.end();
    pool = new Pool({ connectionString });
    const secondRuntime = await createAgentRuntimePersistence({ pool, agentConfig });
    const secondGraph = buildFixtureGraph(secondRuntime.checkpointer, counters);
    // Auth and pg can represent the same BIGINT owner differently. The stable
    // thread identity and resume authorization must accept that representation
    // change across a process boundary.
    const resumed = await secondRuntime.lifecycle.resumeRun(String(USER_ID), runId);

    try {
      await secondGraph.invoke(
        new Command({ resume: "Project Atlas" }),
        resumed.config,
      );
    } finally {
      resumed.release();
    }

    const completed = await secondRuntime.lifecycle.getRunState(USER_ID, runId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.candidateAnswer, "Project Atlas");
    assert.deepEqual(counters, {
      beforePause: 1,
      enterWait: 1,
      // The interrupted node restarts by LangGraph design; nodes completed
      // before it must not.
      interruptNode: 2,
      finish: 1,
    });

    const row = await pool.query(
      `SELECT status, started_at, completed_at
         FROM agent_runs
        WHERE id = $1 AND user_id = $2`,
      [runId, USER_ID],
    );
    assert.equal(row.rows[0].status, "completed");
    assert.ok(row.rows[0].started_at);
    assert.ok(row.rows[0].completed_at);

    const threadId = buildRunThreadId({
      runId,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    });
    const checkpointVersions = await pool.query(
      `SELECT DISTINCT metadata ->> 'myra_graph_version' AS graph_version
         FROM langgraph.checkpoints
        WHERE thread_id = $1`,
      [threadId],
    );
    assert.deepEqual(
      checkpointVersions.rows.map((checkpoint) => checkpoint.graph_version),
      [AGENT_GRAPH_VERSION],
      "every checkpoint in the resumable run must pin the graph version",
    );

    const transitions = await pool.query(
      `SELECT details ->> 'to' AS status
         FROM audit_events
        WHERE user_id = $1 AND run_id = $2 AND event_type = 'run.status_changed'
        ORDER BY id`,
      [USER_ID, runId],
    );
    assert.deepEqual(
      transitions.rows.map((event) => event.status),
      [
        "planning",
        "waiting_for_clarification",
        "planning",
        "synthesizing",
        "verifying",
        "completed",
      ],
      "status history must survive outside the latest agent_runs projection",
    );
  });

  test("another tenant receives the same non-disclosing not-found result", async () => {
    const runId = randomUUID();
    const runtime = await createAgentRuntimePersistence({ pool, agentConfig });
    const execution = await runtime.lifecycle.startRun({
      runId,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      request: request(`request-${runId}`),
    });
    execution.release();

    await assert.rejects(
      () => runtime.lifecycle.getRunState(OTHER_USER_ID, runId),
      RunNotFoundError,
    );
  });

  test("an incompatible graph version executes no resumed node", async () => {
    const runId = randomUUID();
    const counters = emptyCounters();
    const runtime = await createAgentRuntimePersistence({ pool, agentConfig });
    const graph = buildFixtureGraph(runtime.checkpointer, counters);
    const execution = await runtime.lifecycle.startRun({
      runId,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      request: request(`request-${runId}`),
    });
    try {
      await graph.invoke(execution.state, execution.config);
    } finally {
      execution.release();
    }

    const before = { ...counters };
    await pool.query(
      "UPDATE agent_runs SET graph_version = '1.0.0' WHERE id = $1 AND user_id = $2",
      [runId, USER_ID],
    );

    await assert.rejects(
      () => runtime.lifecycle.resumeRun(USER_ID, runId),
      IncompatibleRunVersionError,
    );
    assert.deepEqual(counters, before);
  });

  test("cancellation is durable and a new runtime cannot resume the run", async () => {
    const runId = randomUUID();
    const counters = emptyCounters();
    const runtime = await createAgentRuntimePersistence({ pool, agentConfig });
    const graph = buildFixtureGraph(runtime.checkpointer, counters);
    const execution = await runtime.lifecycle.startRun({
      runId,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      request: request(`request-${runId}`),
    });
    try {
      await graph.invoke(execution.state, execution.config);
    } finally {
      execution.release();
    }

    const cancelled = await runtime.lifecycle.cancelRun(USER_ID, runId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.cancellationRequested, true);
    assert.equal(cancelled.errors.at(-1)?.code, "run_cancelled");

    const restarted = await createAgentRuntimePersistence({ pool, agentConfig });
    await assert.rejects(
      () => restarted.lifecycle.resumeRun(USER_ID, runId),
      RunNotResumableError,
    );
  });
}
