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
- reproducible verification steps.

Reject extra prose or fields containing implementation summaries, self-assessments, rationale, recommendations, expected conclusions, suspected defects, known-issue steering, or repair narratives. Do not give the Validator another Agent's conclusion or claimed test status before its blind first pass.

The Validator must not be an Agent instance that produced an Artifact under test. It defaults to read-only, cannot delegate, and cannot fix the deliverable.

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

Route failures to the Coordinator. After repair, rerun affected self-checks, integration checks, and a targeted independent recheck. Mark the plan complete only when terminal deliverables and required Validator nodes are accepted.
