# Claude Code runtime adapter

Read this after `runtime-generic.md` when the host runtime is Claude Code.

## Instructions and capabilities

Read every applicable `CLAUDE.md` instruction source for the unit's work location and follow Claude Code's project and user precedence rules. Inspect whether the current session exposes the Agent tool, background tasks, worktree isolation, allowed models and effort levels, permission modes, and concurrency capacity.

Claude Code subagents start with a separate context and do not receive the full parent conversation automatically. Give each one a complete unit contract, authoritative inputs, accepted upstream outputs, exact ownership boundary, and validation requirements.

## Configuration and permissions

Prefer inherited model and effort settings. Override them only when the current Claude Code interface exposes the field, organization policy permits the value, and the unit contract benefits materially. Do not promise a per-subagent thinking override when the current runtime only inherits that setting.

Background subagents cannot complete actions that would require a new interactive permission prompt. Pre-authorize only actions already within the user's scope, use a foreground executor when interaction is required, or serialize the work under the coordinator.

## Delegation and isolation

Only the main Claude Code conversation coordinates work. Subagents do not spawn other subagents. Use focused subagents for independent units that report results to the coordinator.

For code-writing units, prefer native `isolation: worktree` when it starts from the accepted baseline and preserves the unit boundary. Claude Code worktree isolation may use a default-branch baseline rather than the parent session's current `HEAD`; verify the actual baseline before launch. If it is unsuitable, create and assign a manual worktree from the accepted integration commit or serialize the unit.

Do not make experimental agent teams the default execution path. Use them only when the user authorizes that coordination mode and the runtime confirms it is enabled; otherwise use ordinary subagents or serial execution.

If the callable Claude Code interface differs from these mappings, follow `runtime-generic.md`, use verified current-session behavior, and record the deviation.
