# Task-type validation and independent validation

Read this reference before freezing a unit's verification plan and again before arranging or evaluating independent final validation.

## Match checks to the change

State observable behavior, exact commands or reproducible steps, pass/fail conditions, and evidence to return. Reuse relevant project checks; follow applicable `AGENTS.md`; do not add tests merely as ceremony.

| Task type | Minimum relevant evidence |
| --- | --- |
| Software | Run focused behavior/regression tests; run type, lint, build, package, or integration checks when the change makes each applicable. |
| Data analysis | Run data assertions and key-result recomputation; reconcile sources and inspect missing values, anomalies, denominators, and metric definitions. |
| Research / information analysis | Verify source authenticity, map citations to claims, cross-check key facts, and assess evidence completeness without prescribing a conclusion. |
| Documentation / content | Check structure, terminology, links, citations, rendering, and an appropriate sample review. |
| Operations / audit / process | Prefer dry-runs, before/after state comparison, permission checks, and rollback verification. |

When no automated check exists, specify a reproducible manual procedure and preserve its raw evidence. Make shared fixtures or acceptance tools a shared-foundation unit with one writer.

## Preserve independent validation

After integration, use a Validator who did not implement the work and defaults to read-only. Give the first pass only:

- the original user goal, frozen overall contract, and acceptance criteria;
- authoritative inputs and the final integrated artifact; and
- the minimum interfaces, data definitions, boundaries, and steps needed to check it.

Withhold implementer reports, coordinator conclusions, hoped-for answers, suspected defects, and repair narratives until that first pass concludes. Permit direct inspection of raw evidence when necessary, but never treat completion reports as evidence.

Ask the Validator to report reproducible evidence, failed checks, coverage gaps, and unresolved risk; prohibit it from changing deliverables. Route repairs through the coordinator, then rerun affected checks and a targeted independent recheck. If a separate Validator is impossible, perform the same protocol yourself and disclose the lack of independence.
