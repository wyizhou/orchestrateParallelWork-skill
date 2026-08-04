# Generic runtime, context, and isolation rules

Read this reference immediately before creating an executor or Validator, choosing an executor configuration or context strategy, creating an isolation boundary, or launching a wave.

## Resolve policy and capabilities first

1. Discover every instruction source that applies to the coordinator and the unit's exact work location. Follow the host runtime's precedence rules and the most specific applicable project rules.
2. Inspect the capabilities actually exposed in the current session: delegated agents or sessions, context handoff modes, executor configuration, concurrency limits, permissions, background execution, and filesystem isolation.
3. Record the discovered capabilities, controlling instructions, and any missing capability in the unit contract. Do not assume a feature or parameter from another runtime exists.

## Choose the least-heavy sufficient execution path

Prefer the parent runtime configuration when it can satisfy the unit contract. Override a model, effort, reasoning, tool, permission, or sandbox setting only when the current host explicitly supports that field, applicable policy allows it, and the override materially improves reliability or cost.

When no safe override exists, inherit the parent. When delegation, concurrency, or isolation is unavailable, execute the unit serially under the coordinator or return a plan; never pretend that parallel work occurred.

For every launch, record:

```text
Host runtime and applicable instruction sources:
Available delegation, context, isolation, and concurrency capabilities:
Chosen executor configuration or parent inheritance:
Why this is the least-heavy sufficient execution path:
Context handoff and isolation boundary:
Capacity and permissions checked:
Exact branch, workdir, or owned non-code scope:
```

## Pass context deliberately

Give every executor a self-contained unit contract, authoritative inputs, accepted upstream outputs, exact ownership boundary, required validation, and permitted external effects. Use inherited or shared history only when the host supports it and the unit genuinely needs it; otherwise pass a minimal explicit handoff.

Keep research, analysis, and independent validation contexts separate from implementer conclusions. A blind Validator receives the original goal, accepted contract, authoritative inputs, integrated artifact, and reproducible checks, but not expected conclusions or implementer self-assessments.

## Isolate work safely

For code work, resolve the accepted baseline before starting a unit. Use a native isolated checkout, a dedicated branch and worktree, or another verified mechanism that prevents concurrent writes to the same checkout. Assign one owner per write surface and require all commands to run inside that boundary.

For non-code work, isolate owned files or sections, frozen data or evidence snapshots, queries, and external effects. If two ready units cannot be isolated, serialize them.

Only the top-level coordinator launches, steers, waits for, or stops executors. Unit executors and Validators do not create nested workers. Before each wave, confirm that every requested launch fits current capacity and permission constraints; reduce the wave or serialize when it does not.

On capability, context, permission, capacity, or isolation failure, do not invent a substitute. Update the contract, inherit supported parent behavior, reduce or serialize the work, or surface the blocker.
