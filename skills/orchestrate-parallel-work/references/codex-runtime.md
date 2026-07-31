# Codex runtime, context, and worktree rules

Read this reference immediately before creating an executor or Validator, selecting a model or reasoning setting, choosing a fork strategy, creating a worktree, or launching a wave.

## Resolve runtime policy first

1. Read every applicable `AGENTS.md`, from the repository/root scope through the unit's exact workdir. Apply the most-specific applicable instruction; treat explicit higher-priority runtime policy as controlling.
2. Discover the current runtime's callable agent models, supported reasoning settings, fork constraints, and live concurrency capacity. Do not assume names or settings from another runtime are available.
3. Record the discovery result or its absence in the unit contract before launch.

If an applicable `AGENTS.md` mandates a model or reasoning setting, use it only if current runtime supports it. If it is unavailable, follow an explicit documented fallback; otherwise inherit the parent, run the unit serially under the coordinator when appropriate, or surface the blocker. Do not silently substitute a conflicting override.

## Choose a unit runtime

Choose the least-heavy available model/reasoning combination that can reliably satisfy the unit contract. Consider task difficulty, ambiguity, risk, required tools, context size, reversibility, and validation burden. Use a stronger available combination only when those factors require it.

Prefer inheriting the parent runtime whenever it is sufficient, an override adds no material benefit, or the runtime cannot safely express the requested override. Treat inheritance as a valid recorded decision, not an omission.

For every agent launch, record in the unit contract:

```text
Available capabilities checked:
Applicable AGENTS.md rules:
Chosen model and reasoning, or parent inheritance:
Why this is the least-heavy sufficient choice:
Context / fork strategy and rationale:
Concurrency capacity checked and slot reserved:
Exact branch and workdir:
```

## Couple overrides to context strategy

Use a full-history fork only when the unit needs the parent conversation and parent-runtime inheritance is acceptable. In the Codex spawn interface, omitting `fork_turns` or setting `fork_turns="all"` creates that full-history fork; it inherits the parent runtime and cannot accept explicit model or reasoning overrides.

When an explicit model or reasoning override is required, set `fork_turns="none"` or a positive bounded-turn string supported by the current interface. Supply the unit contract, authoritative inputs, relevant accepted upstream outputs, exact branch/workdir, and only the task-local context needed. Do not rely on hidden parent context.

Keep independent research, analysis, and validation context separate from other units' conclusions. Do not disclose expected answers or implementers' self-assessments to a blind Validator.

## Launch safely

Before each wave, count active agents and confirm the runtime has capacity for every launch plus coordinator responsibilities. Limit the wave, wait for capacity, or serialize work when it does not. Do not oversubscribe merely because units are independent.

For code work, resolve the baseline SHA before making a unit branch or worktree. Create each unit from the accepted shared/integration baseline, assign one owner, and pass the exact absolute workdir and branch in its prompt. Require all file operations and commands to use that workdir. Never let two units write the same checkout.

For non-code work, pass an equally exact isolation boundary: owned files or section, frozen data/input snapshot, evidence scope, and permitted external effects. Apply user authorization and applicable `AGENTS.md` rules before any external action.

On capability, context, capacity, or worktree failure, do not invent a substitute. Update the contract and either use supported parent inheritance, reduce/split/serialize the unit, or request the missing decision.
