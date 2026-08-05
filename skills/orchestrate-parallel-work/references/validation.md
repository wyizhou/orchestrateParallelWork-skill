# Task delivery gates and fact-only independent validation

Read this reference while compiling every Task Contract and again before accepting a Node or launching a Validator.

## Require two self-check gates

Every executable Node declares both a test gate and a lint gate before approval. Each gate records reproducible steps, pass conditions, and an evidence Artifact Contract. A conventional command is preferred; when it is genuinely inapplicable, declare an equivalent check, reason, steps, pass condition, and evidence in the plan so the user approves the exception.

Execution Agents cannot add, weaken, skip, or reinterpret an exception. A gate that is missing, not run, failed, or lacks raw evidence prevents `submitted`, `accepted`, and downstream release.

| Task type | Test gate | Lint gate or equivalent |
| --- | --- | --- |
| Software | Focused behavior/regression tests | Applicable lint, type, build, package, or static check |
| Data | Assertions and key-result recomputation | Schema, missing-value, anomaly, denominator, and definition checks |
| Research | Key-fact cross-check and source reproduction | Source authenticity, citation mapping, and evidence-completeness check |
| Documentation | Render or sample-review procedure | Structure, terminology, link, citation, and format check |
| Operations | Dry-run and before/after assertion | Permission, configuration, rollback, and audit check |

Store the exact command or step, exit code or observation, timestamp, result, and evidence reference. Completion prose is never evidence.

## Generate a fact-only Validator brief

Generate Validator input from approved contracts, never from implementer or coordinator narrative. Permit only:

- feature point IDs and factual expected behavior;
- module names and paths;
- authoritative input references;
- Artifact references; and
- reproducible conformance verification steps; and
- factual boundary invariants with independently chosen inputs and reproducible steps.

Reject extra prose or fields containing implementation summaries, self-assessments, rationale, recommendations, expected conclusions, suspected defects, known-issue steering, or repair narratives. Do not give the Validator another Agent's conclusion or claimed test status before its blind first pass.

The Validator must not be an Agent instance that produced an Artifact under test. It defaults to read-only, cannot delegate, and cannot fix the deliverable.

## Require conformance and boundary validation

Do not limit independent validation to replaying implementer tests or checking only the examples named in the requirement. For every Validator Task, derive at least one applicable `boundary_checks` entry from the data types, state transitions, interfaces, and invariants of the covered feature/module. Each entry contains only `id`, `category`, `invariant`, and `verification_steps`.

Consider these categories and include every materially applicable one:

- valid, invalid, empty, missing, minimum, maximum, and just-outside input partitions;
- numeric precision, accumulation overflow, underflow, units, rounding, and non-finite results;
- timestamp precision, offsets, ordering, equality, and tie-breaking;
- deterministic ordering, repeatability, idempotence, and cross-interface equivalence;
- concurrency, partial failure, stale state, bounded resources, and size limits;
- permission boundaries, untrusted text, path handling, compatibility, and recovery.

The Planner states the invariant, not the expected conclusion or suspected defect. The Validator chooses concrete cases without receiving implementer summaries. A check is not satisfied merely because the existing suite is green: preserve the independently generated input, observed output, and exit code as evidence.

Use two independent Validator Nodes—contract conformance and boundary/property probing—when the deliverable is high-risk, spans multiple trust boundaries, or has enough surface area that one context would dilute coverage. For smaller work, one Validator Node may run both sections, but its brief must still contain `verification_steps` and non-empty `boundary_checks`.

## Require factual Validator output

For each checked feature/module, require:

```text
Feature ID and module:
Status:
Verification command or step:
Exit code when applicable:
Expected fact:
Observed fact:
Evidence reference:
Coverage gap, if any:
```

For each boundary check, additionally report its boundary-check ID, category, generated input or fixture reference, invariant, and observed result. A Validator that omits a declared boundary check cannot be accepted.

Route failures to the Coordinator. After repair, rerun affected self-checks, integration checks, and a targeted independent recheck. Mark the plan complete only when terminal deliverables and required Validator nodes are accepted.
