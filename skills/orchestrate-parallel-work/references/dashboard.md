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

The server exposes a complete snapshot plus Server-Sent Events revision notifications. The browser refetches the snapshot after an event and uses short polling only while SSE is disconnected. A transient partial update must preserve the last good snapshot and display a degraded warning rather than inventing state or stopping execution.

Only inspect control-plane files within the selected run directory. Display external project paths as metadata; do not read arbitrary target or system files. Render Artifact text as text, not executable markup.

## Interpret the UI

The home page is a dark Graph view with summary counts, capacity, approval, phase, waves, Tasks, Artifacts, runs, and recent events. Selecting a Node shows its Task, Agent assignment, inputs/outputs, attempts, test/lint evidence, and Validator status. Selecting an Edge shows its Artifact Contract, versions, producer, consumers, and delivery state.

Node state colors distinguish planned/blocked/ready/active/submitted/accepted/integrated/failed/stale/skipped. Animate only active Nodes and Edges that are producing or flowing accepted Artifacts into an active consumer. Respect reduced-motion browser preferences.

The page is read-only. User approval remains in the authoritative Agent conversation; after explicit approval, the Coordinator records the matching plan ID/version/hash and execution state changes appear automatically.
