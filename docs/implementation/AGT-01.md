# AGT-01 — Define LangGraph state and reducers

```yaml
id: AGT-01
status: complete
contracts_changed:
  - src/agents/contracts/domain/supervisor.ts (new; SupervisorDecision, FreshnessDirective,
    ClarificationRequest, SupervisorRationale — additive to FND-02)
  - src/agents/contracts/domain/index.ts (exports the above)
  - src/agents/contracts/domain/run.ts (added the missing RunBudgetLimits / RunBudgetUsage
    type exports; no schema change)
  - src/agents/index.ts (the module's first public surface: state schema, status transitions,
    checkpoint guards, projections)
migrations: []
tests_run:
  - npm run test:agt-01 (70/70 passed)
  - npm run test:fnd-07 (32/32 passed — the new files land inside the declared boundary)
  - npm run test:fnd-01, npm run test:fnd-02 (passed — the additive contract did not disturb them)
  - npm run test:fnd-06 (140/140 passed)
  - FND_TEST_DATABASE_URL=... npm run test:foundation (171/171 passed)
  - npm run typecheck:v2, npm run typecheck, npm run build (clean)
manual_validation:
  - Proved the three load-bearing guards reject real violations, by mutating production code and
    reverting each. (1) Evidence channel switched to LangGraph's default last-write-wins → 2 tests
    red, including the fan-out merge. (2) Credential key denylist emptied → 3 security tests red.
    (3) Cross-tenant nested-record check disabled in the state schema → 1 test red. 70/70 green
    after each revert, with all three files byte-identical to their originals.
  - Exercised the annotation in a real compiled StateGraph rather than only unit-testing the
    reducer functions: a three-worker fan-out, a checkpoint round trip through MemorySaver, a node
    attempting to reassign userId, and a node reporting an out-of-order status.
known_limitations:
  - The credential value scan is deliberately narrow (eight provider-specific shapes). A bespoke
    internal token format would pass it. The key denylist is the load-bearing half; the value
    patterns are the backstop for credentials arriving inside an error message.
  - `replaceOnceReducer` compares objects with JSON.stringify, so two structurally equal objects
    with different key order would be treated as different. Every value it guards is produced by a
    Zod parse, which fixes key order, so this cannot fire in practice today.
  - The state schema's superRefine is not run by the reducers — LangGraph channels hold plain
    values. AGT-02 parses the state at the checkpoint boundary via `assertCheckpointSafe`; between
    those boundaries an individual channel can hold a value the whole-state schema would reject.
  - `errors` drops overflow past 50 entries silently and keeps the earliest. Deliberate, argued in
    the reducer's comment, but it does mean the state's error list is not a complete log — the
    complete log is agent_steps and tool_calls.
follow_up_packages:
  - AGT-02 — consumes statusTransitions, assertCheckpointSafe, and the AGENT_STATE_SCHEMA_VERSION
  - AGT-03 — fills the `supervisor` channel; the SupervisorDecision contract is already frozen
  - AGT-04 — must call assertUsableNodeName; "plan" and "supervisor" are reserved
  - AGT-05 — consumes evaluateProgress, replanIterations, verificationRetries, budgetUsage
  - QLT-01 — consumes toTrajectorySnapshot
```

## What was created

| File | Role |
| --- | --- |
| `src/agents/state/stateSchema.ts` | The state, mapped onto FND-02 contracts; `EvidenceRef`, `CompletedSubtask`, `OpenQuestion`, `AgentRunError`, `createInitialState`, `toEvidenceRef` |
| `src/agents/state/statusTransitions.ts` | The legal-transition table over the fourteen run statuses |
| `src/agents/state/reducers.ts` | Nine reducers: replace, replace-once, append, dedupe-by-id, error-append, budget, monotonic counter, latch, status |
| `src/agents/state/channels.ts` | The LangGraph annotation, per-channel caps, and the reserved-node-name guard |
| `src/agents/state/stateGuards.ts` | Ownership, size (with per-channel breakdown), credential scan, and the composed `assertCheckpointSafe` |
| `src/agents/state/stateProjection.ts` | `toRunStatusView` (AGT-07), `toTrajectorySnapshot` (QLT-01), `evaluateProgress` (AGT-05) |
| `test/fixtures/agt01-state-fixtures.ts` | Built on the FND-02 fixtures rather than duplicating them |
| `test/unit/agents/*.test.ts`, `test/security/checkpointCredentials.test.ts` | 70 cases |

## New design recorded here

| Decision | Choice | Rationale |
| --- | --- | --- |
| Evidence in state | `EvidenceRef[]`, not `EvidenceItem[]` (a departure from the §9.1 sketch) | AGT-01 requires raw results out of the checkpoint. An `EvidenceItem` carries `content`; a checkpoint is written after every node, so a ten-source run would rewrite the same bodies a dozen times and a resume would deserialize them all to make one routing decision. `toEvidenceRef` is the only conversion and a test binds the two shapes |
| `keep: first` vs `keep: last` per channel | Evidence, approvals, receipts keep the first; subtasks, questions, proposals, memory keep the last | They are different failures. Evidence: the earliest retrieval owns the `retrievedAt` and `contentHash` other records cite. Subtasks: a retry must supersede the attempt that failed. Approvals: one proposal gets one answer, which the database also enforces. Receipts: a receipt records something that already happened externally |
| Budget `durationMs` takes a max, everything else sums | Four workers running ten seconds in parallel consumed ten seconds of the run's 90s budget, not forty | Summing wall clock would exhaust the duration budget four times too fast on exactly the workload the parallel dispatch exists to enable |
| Identity channels declared without a `default` | LangGraph takes the first update verbatim and only runs the reducer from the second onward | Lets `replaceOnceReducer` be strict — the run's own id seeds the channel, and every write after that must match it — without a sentinel value or a nullable state type |
| Status is checked on write | `statusTransitionReducer` runs the table on every update | The graph's edges already decide what runs next. This catches a node *reporting* a status its position could not produce — the symptom of a stale checkpoint being merged, or a resumed run re-entering a node it had left |
| `SupervisorDecision` lives in contracts | Additive new file, not in `src/agents/state` | It is a persisted, serialized shape like `Plan` and `ActionProposal`. The evaluation harness reads it out of a trajectory and the run API projects it; neither should depend on the graph runtime to name its fields |
| Read-cannot-become-write is a contract rule | `mode: "action"` is legal only for a flow whose FND-01 contract declares an approval boundary, and such a flow can only run in action mode | AGT-03's acceptance criterion says a read request must not be upgradable into a write. A schema that cannot express the upgrade is worth more than a prompt that asks the model not to |
| Freshness records its origin | Every directive is `computed` or `escalated` | §8.1 says the Supervisor may escalate a tier and never downgrade. That is only checkable if the record says which tier was the deterministic baseline |
| Per-channel caps | Nine channels carry an entry cap; overflow throws naming the channel | Not the run budget — the backstop for a planner looping or a connector paginating without end. A `ChannelCapacityError` naming `evidence` beats a checkpoint PostgreSQL refuses |
| Projections are allow-lists | `toRunStatusView` and `toTrajectorySnapshot` enumerate fields | Handing either consumer the state would leak by default: the user's question, an action's full payload, memory candidates extracted from private sources. A channel added later is invisible until reviewed |
| Error channel keeps the earliest | Cap 50, drop the overflow, never throw | A cascade's tenth error is a consequence of its first, and every failure is persisted in full to `agent_steps`/`tool_calls` regardless. A run already failing must not fail differently because its error list filled up |

## One thing found the hard way

**LangGraph refuses a node whose name collides with a state channel** — and the names AGT-03 and
AGT-04 will reach for first are all channels: `plan`, `supervisor`, `verification`, `evidence`,
`status`, `flow`, `errors`. Discovered when the fan-out test named its first node `plan` and
`addNode` threw a message about state attributes, which reads like a schema problem rather than
"rename your node".

`assertUsableNodeName` now derives the reserved list from the annotation itself, so a channel added
later joins it without anyone remembering to. A test pins the assumption to the library rather than
to a comment: if LangGraph ever permits the collision, that test fails and the guard can be dropped.

## Deviation from the Day 2 plan

The plan put the status-transition table in AGT-02 (`runStatusMachine.ts`). It landed here instead,
because the status reducer is its first consumer and "what may legally happen next" is part of the
state contract. AGT-02's lifecycle imports it rather than restating it — one table, two consumers,
no way for the checkpoint and the `agent_runs` row to disagree about what a legal run looks like.
