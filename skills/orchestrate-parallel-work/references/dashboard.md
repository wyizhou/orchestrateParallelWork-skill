# Local Graph Dashboard

Read this reference before materializing a plan or starting, inspecting, or stopping its Dashboard.

## Start the read-only service

Require Node.js and run:

```bash
node scripts/dashboard-server.mjs --run-dir <absolute-run-directory>
```

The server binds only `127.0.0.1`, defaults to port `8088`, and accepts `--port <number>` as the only network override. It provides no authentication, TLS, login, remote bind, or write API. If the port is occupied, report the conflict and ask for an explicit alternative; do not silently move.

The Dashboard process is control-plane infrastructure, not an Agent, and does not count toward `effective_capacity`.

## Keep state synchronized

The Coordinator is the single writer for Graph state. Write each JSON file through same-directory temporary output and atomic rename, append factual events to `events.ndjson`, and update `state.json` last with a monotonically increasing revision.

The server exposes a complete snapshot plus Server-Sent Events revision and degradation notifications. The browser refetches the snapshot after an event and uses short polling only while SSE is disconnected. A transient partial update must preserve the last good snapshot and display a degraded warning rather than inventing state or stopping execution.

## Publish the final snapshot before shutdown

At the end of a run, atomically land all final Tasks, Artifacts, registries, Node Runs, and factual events first. Write `state.json` last with a higher revision and the actual terminal phase: `completed`, `failed`, `cancelled`, `rejected`, `revoked`, or `superseded`. Do not kill the Dashboard process before that revision lands.

When a running Dashboard observes the transition, it publishes a terminal SSE event. Each connected browser refetches and renders the exact final revision, then sends a transport-only acknowledgement that changes no orchestration data. After all connected browsers acknowledge, or after the five-second grace period expires, the server sends a shutdown event, closes its SSE clients, and stops itself. The rendered page must retain the final Graph and show that the server stopped instead of polling or reconnecting forever.

The run directory remains authoritative after shutdown. Refreshing the old HTTP page cannot work once the server has stopped; restart the same command later to inspect a persisted completed run. A Dashboard started after a run is already terminal stays open for retrospective inspection because automatic shutdown applies only to a terminal transition observed during that server session.

Only inspect control-plane files within the selected run directory. Display external project paths as metadata; do not read arbitrary target or system files. Render Artifact text as text, not executable markup.

## Interpret the UI

The responsive dark console provides dedicated Graph, Tasks, Artifacts, Runs / Agents, and Events views. The Graph view shows summary counts, capacity, approval, phase, and topological waves. Selecting a Node shows its Task, Agent assignment, inputs/outputs, attempts, test/lint evidence, and Validator status. Selecting an Edge shows its Artifact Contract, versions, producer, consumers, and delivery state. Task, Artifact, and Run rows open independent structured inspectors; Events remain a factual, newest-first stream.

Node state colors distinguish planned/blocked/ready/active/submitted/accepted/integrated/failed/stale/skipped. Animate only active Nodes and Edges that are producing or flowing accepted Artifacts into an active consumer. Respect reduced-motion browser preferences.

The page is read-only. User approval remains in the authoritative Agent conversation; after explicit approval, the Coordinator records the matching plan ID/version/hash and execution state changes appear automatically. The finalization acknowledgement is ephemeral delivery confirmation only: it cannot change Graph, approval, execution, or Artifact state.
