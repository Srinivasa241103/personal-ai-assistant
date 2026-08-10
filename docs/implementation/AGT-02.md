# AGT-02 — Implement run lifecycle and PostgreSQL checkpointing

```yaml
id: AGT-02
status: complete
contracts_changed:
  - src/agents/index.ts (exports the lifecycle service, graph version, persistence factory,
    checkpoint-safe public errors, and RunExecution contract)
  - src/database/foundation/agentRunRepository.ts (typed run records plus locked and optimistic
    lifecycle updates; existing repository methods remain compatible)
  - src/config/runtimeConfig.ts (checkpoint schema names are restricted to identifiers the pinned
    PostgreSQL checkpointer can interpolate safely)
migrations: []
tests_run:
  - npm run test:agt-02 (17/17 passed)
  - FND_TEST_DATABASE_URL=... npm run test:agt-02:db (4/4 passed)
  - npm run test:agt-01 (70/70 passed)
  - npm run test:agt-p0 (40/40 passed)
  - FND_TEST_DATABASE_URL=... npm run test:foundation (172/172 passed)
  - npm run test:fnd-01, npm run test:fnd-02 (passed)
  - npm run test:fnd-06 (140/140 passed)
  - npm run test:fnd-07 (32/32 passed)
  - npm run typecheck:v2, npm run typecheck, npm run build (clean)
  - frontend npm run build (clean; existing stale browsers-data warning only)
manual_validation:
  - Used a real isolated PostgreSQL database, applied the existing migrations to an empty schema,
    paused a compiled StateGraph at an interrupt, discarded the Pool/checkpointer/lifecycle/graph,
    rebuilt all four, and resumed from PostgreSQL.
  - Verified nodes completed before the interrupt execute once. LangGraph restarts the interrupted
    node itself by design; the test records that distinction and verifies the run then completes.
  - Verified every stored checkpoint carries the MyRA graph version, state-schema version, and
    thread-id version; a deliberately incompatible graph version executes zero resumed nodes.
  - Verified cross-user resume returns the same non-disclosing not-found error and durable
    cancellation remains non-resumable after constructing a fresh runtime.
known_limitations:
  - The immediate AbortSignal is process-local. Cancellation is durable in PostgreSQL and prevents
    a later checkpoint or restart from reviving the run, but cross-instance live signalling belongs
    with the Redis-backed locking work in TOL-03.
  - A LangGraph checkpoint and the searchable `agent_runs` projection are separate transactions.
    Resume repairs the narrow checkpoint-first crash window by replaying the validated checkpoint
    into the projection; a terminal database row always blocks resurrection.
  - Resume compatibility is exact-match in AGT-02. There is no checkpoint migration path yet, so a
    different graph or state version fails safely and must be restarted as a new run.
  - The integration graph proves lifecycle behavior with a small interrupt fixture. AGT-03 through
    AGT-05 supply the product Supervisor/planner/worker graph.
  - AGT-06 owns clarification and approval payload semantics. AGT-07 owns authenticated HTTP/SSE
    endpoints that call this lifecycle service.
follow_up_packages:
  - AGT-03 — supplies the structured Supervisor graph on this persistence runtime
  - AGT-04 and AGT-05 — use RunExecution and durable projection for bounded worker execution
  - AGT-06 — resumes waiting runs with typed clarification and approval commands
  - AGT-07 — exposes start/status/resume/cancel and streaming through authenticated APIs
  - TOL-03 — adds Redis-backed multi-instance execution locks and live coordination
```

## What was created

| File | Role |
| --- | --- |
| `src/agents/runtime/runLifecycle.ts` | Creates durable runs and provides tenant-scoped start, resume, read, cancel, and fail operations |
| `src/agents/runtime/checkpointer.ts` | Wraps PostgreSQL checkpointing so AGT-01's ownership, credential, serialization, and size guards run before every durable write |
| `src/agents/runtime/runProjection.ts` | Keeps `agent_runs` and `run.status_changed` audit events synchronized with valid checkpoints |
| `src/agents/runtime/threadIdentity.ts` | Derives a stable opaque LangGraph thread ID from user, conversation, and run ownership |
| `src/agents/runtime/graphVersion.ts` | Pins graph, state-schema, and thread-id versions and rejects incompatible resumes |
| `src/agents/runtime/cancellation.ts` | Prevents duplicate same-process execution and aborts an active execution when cancelled |
| `src/agents/runtime/runErrors.ts` | Defines stable lifecycle error codes and redacts unknown failure details before persistence |
| `src/agents/runtime/persistence.ts` | Builds the Pool, guarded saver, projection, and lifecycle as one runtime; the singleton remains lazy while agents are disabled |
| `test/unit/agents/runtime/*.test.ts`, `test/security/checkpointPersistence.test.ts` | Covers thread identity, versions, cancellation, error redaction, ownership, and guarded writes |
| `test/integration/agents/runLifecycle.integration.test.ts` | Proves PostgreSQL restart/resume, no repeated completed nodes, isolation, version rejection, and durable cancellation |

## How it works in simple terms

1. Starting a run creates its `agent_runs` row and audit record before any graph work begins.
2. The graph receives an opaque thread ID and three pinned versions, so PostgreSQL always knows
   which exact run and code contract a checkpoint belongs to.
3. Before a checkpoint is written, AGT-01 validates the complete state. Invalid ownership,
   credentials, oversized data, or an illegal status transition never reach checkpoint storage.
4. After a valid checkpoint is written, its small searchable projection and status audit event are
   stored in the application tables.
5. Resume loads both records, checks ownership and versions, requires a real waiting state, and then
   lets LangGraph continue from the saved checkpoint rather than beginning again.
6. Cancel and fail lock the run row, apply AGT-01's transition table, store a normalized error, and
   make the terminal result durable. A running process also receives an abort signal immediately.

## Decisions that keep AGT-02 aligned with the existing code

| Decision | Choice | Reason |
| --- | --- | --- |
| Checkpoint schema ownership | Reuse migration `0003_agt_02_langgraph_checkpoints.sql`; verify its tables and migration ledger before calling the library's `setup()` | The application migration system remains the only schema author, while `setup()` becomes a verified no-op |
| Thread identity | SHA-256 of versioned ownership fields | Stable across restarts, unique per user/conversation/run, and does not expose raw IDs in checkpoint tables |
| State authority | Full checkpoint is the execution source; `agent_runs.state` is the searchable projection | LangGraph can resume correctly while existing repositories and future status APIs keep an efficient row to read |
| Status rules | Import AGT-01's transition table | One legal-transition definition governs reducers, checkpoints, cancellation, and failure |
| Version handling | Exact graph and state-schema match | Running old bytes with new graph code is less safe than refusing the resume clearly |
| Error persistence | Stable public code/message; unknown exceptions become a generic redacted error | Driver, provider, user-content, or credential details cannot leak into durable run state |
| Disabled runtime | Lazy construction | Existing direct RAG startup behavior performs no new database I/O while the agent runtime flag is off |

## Changes made after reviewing completed AGT-01

AGT-01 had already moved the status machine into the state package, so AGT-02 imports it instead of
creating the duplicate `runStatusMachine.ts` named in the master-plan sketch. Its composed
`assertCheckpointSafe` guard is now enforced at the actual checkpointer boundary, including the
special initial `__start__` checkpoint and LangGraph's pending writes. The existing evidence-by-ID
state design also meant AGT-02 needed no raw-result persistence exception or larger checkpoint
limit.

One additional ownership check was added during final review: a stored state must match the
database row's user as well as its run and conversation. The comparison deliberately accepts a
PostgreSQL `BIGINT` returned as a string when the state contains the same numeric user ID.
