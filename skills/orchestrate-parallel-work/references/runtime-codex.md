# Codex runtime adapter

Read this after `runtime-generic.md` when the host runtime is Codex.

## Instructions and capabilities

Read the applicable Codex instruction chain, including global and project `AGENTS.md` or `AGENTS.override.md` files and any configured fallback instruction filenames. Apply the most specific instruction for the unit's exact workdir.

Inspect the current session's callable subagent tools, configured or live concurrency limit, available models and reasoning settings, sandbox and approval policy, and worktree support. Current-session capabilities take precedence over remembered interface details.

## Configuration and context

Prefer parent inheritance. Set an explicit model or reasoning override only when the current spawn interface exposes it, the value is available, and applicable instructions allow it. Never substitute an unavailable explicit requirement silently.

When the current Codex collaboration interface uses `fork_turns`, omitting it or using `"all"` creates a full-history fork that inherits the parent runtime and cannot take explicit model or reasoning overrides. Use `"none"` or a supported positive bounded-turn value when an explicit override is necessary, and provide a complete task-local handoff instead of relying on hidden parent context.

Subagents inherit parent permission and sandbox constraints unless the current interface explicitly documents a supported narrower configuration. Actions requiring unavailable approval fail rather than expanding authority.

## Delegation and isolation

Use Codex subagents only from the top-level coordinator. Check live thread capacity before every wave and reserve enough coordinator capacity to integrate and validate results.

For write-heavy code units, create separate branches and worktrees from the accepted integration baseline unless the current Codex surface already provides an equivalent verified isolation mechanism. Pass each executor the exact absolute workdir and branch, and prohibit writes to the coordinator checkout.

If the callable Codex interface differs from these mappings, follow `runtime-generic.md`, use verified current-session behavior, and record the deviation.
