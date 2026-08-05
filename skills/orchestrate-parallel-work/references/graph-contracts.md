# Graph Engineering contracts

Read this reference before producing, validating, approving, or changing a Graph plan. The JSON Schemas under `assets/schemas/` and `scripts/graphctl.mjs` are authoritative for machine validation; this document defines their operating meaning.

## Separate plan from runtime state

Use this run-directory layout so the compiler and Dashboard share one control plane:

```text
.orchestration/runs/<run-id>/
├── graph-plan.json
├── agent-types.json
├── tasks/<task-id>.json
├── artifacts/catalog.json
├── artifact-payloads/<optional-structured-payload>.json
├── approval.json
├── artifact-registry.json
├── node-runs.json
├── run.json
├── events.ndjson
├── state.json
├── dashboard-runtime.json
└── dashboard.log
```

- `graph-plan.json` contains the immutable, approval-bound DAG identity, goal, capacity, Nodes, Edges, terminal outputs, and derived summary. Its canonical hash also covers `agent-types.json`, every Task Contract, and `artifacts/catalog.json`.
- `approval.json` records the exact approved plan ID, version, and hash.
- `node-runs.json` records Agent instances, attempts, state transitions, input/output versions, and self-check evidence.
- `artifact-registry.json` records actual immutable Artifact versions and provenance.
- `events.ndjson` is an append-only factual event stream used by the Dashboard.
- `state.json` is the monotonically increasing revision marker written last after an atomic control-plane update.
- `dashboard-runtime.json` and `dashboard.log` are infrastructure-only lifecycle evidence managed by `dashboardctl.mjs`; they do not participate in plan hashing or orchestration state.

Plan data and runtime state must not overwrite one another. Counts in `summary` are derived and must exactly match the contracts.

## Model roles, Nodes, and Edges

Agent Types are reusable templates; Agent instances exist only in Node Run records. Include a top-level Planner/Coordinator and at least one read-only Validator type. Reject unused role types.

Each Node references exactly one Task Contract, and each Task belongs to exactly one Node. Use `work`, `integration`, or `validation` Node types. A Node is large enough to deliver a useful feature/module result but has exactly one independent reason to retry, invalidate, or reassign. Keep operations together when they enforce one tightly coupled invariant; split independently deliverable interfaces, owners, external effects, or failure domains.

Data Edges bind a producer output port to a consumer input port through one Artifact Contract. Control Edges impose order without carrying an Artifact. Keep filenames in Artifact delivery metadata, not Edge identity. Allow fan-out; require all inputs at fan-in unless the approved contract states another cardinality.

Reject cycles, self-edges, unresolved references, incompatible ports, orphan Nodes, multiple producers for one contract, missing required inputs, and Nodes that cannot reach a terminal output or Validator.

## Compile Task and Artifact contracts

Every Task freezes feature points, modules, authoritative inputs, owned and forbidden scopes, allowed external effects, constraints, completion criteria, output contracts, and both delivery gates. Validator Tasks additionally freeze conformance steps and non-empty factual boundary checks. Overlapping same-wave write or external-effect scopes require a dependency or plan rejection.

The Artifact Catalog declares planned business outputs and validation evidence. Every contract has exactly one producer. A zero-consumer Artifact must be a declared terminal output or evidence output. Report total contracts together with separate delivery/evidence counts; before approval, actual Artifact count is zero.

Runtime Artifact versions are immutable. Record the producer Node/run/attempt/Agent, relative URI, file list, digest, status, timestamps, and validation evidence. A retry creates a new version. A changed accepted input version/digest makes transitive dependent results stale.

## Bind approval to canonical content

Compute `plan_hash` from canonical Graph, Agent Type, Task, Artifact, scope, effect, validation-exception, and approved-capacity content while excluding timestamps, lifecycle status, and derived summary.

Any material content change increments `plan_version`, changes the hash, invalidates approval, and returns to `awaiting_user_approval`. A runtime capacity reduction only shrinks waves; an increase beyond the approved capacity requires new approval.

## Schedule deterministically

Compute lexical-tie-broken topological waves. A Node is ready only when the exact plan is approved, every predecessor is accepted, every required input Artifact version/digest is accepted, its scopes do not conflict with active Nodes, and capacity exists.

Use:

```text
effective_capacity = min(15, runtime_capacity, permission_capacity)
```

Count the Planner/Coordinator, Workers, and Validators; do not count the Dashboard. If effective capacity is one, coordinate serially without delegated Workers. Never claim parallelism that did not occur.
