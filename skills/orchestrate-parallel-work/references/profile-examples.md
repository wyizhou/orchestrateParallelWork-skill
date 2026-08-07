# Execution profile and contract examples

Read this reference when selecting `execution_profile` or when the first Graph compile fails because profile, evidence, or boundary fields are incomplete. These are contract fragments, not fixed plan templates; derive Nodes and partitions from the actual goal.

## Lightweight

Use only for low-risk work with no more than four non-validation Nodes:

```json
{
  "schema_version": "1.1",
  "execution_profile": {
    "mode": "lightweight",
    "risk_level": "low",
    "integration_strategy": "inline",
    "evidence_strategy": "combined"
  }
}
```

Keep both gates, but bind them to one evidence output:

```json
{
  "outputs": [
    { "port": "delivery", "artifact_contract_ref": "delivery" },
    { "port": "quality", "artifact_contract_ref": "quality-evidence" }
  ],
  "self_validation": {
    "test_gate": {
      "mode": "command",
      "steps": ["npm test"],
      "pass_condition": "exit code is 0",
      "evidence_contract_ref": "quality-evidence"
    },
    "lint_gate": {
      "mode": "command",
      "steps": ["npm run lint"],
      "pass_condition": "exit code is 0",
      "evidence_contract_ref": "quality-evidence"
    }
  }
}
```

Do not add an Integration Node unless integration has an independent failure or retry reason. The Coordinator may integrate accepted work inline.

## Standard

Use for ordinary multi-unit work:

```json
{
  "schema_version": "1.1",
  "execution_profile": {
    "mode": "standard",
    "risk_level": "medium",
    "integration_strategy": "dedicated",
    "evidence_strategy": "separate"
  }
}
```

Use a dedicated Integration Node only when multiple business Artifacts must be combined, integration owns a distinct write surface, or integration can independently fail and retry.

## Assurance

Use for high-risk work or multiple trust boundaries:

```json
{
  "schema_version": "1.1",
  "execution_profile": {
    "mode": "assurance",
    "risk_level": "high",
    "integration_strategy": "dedicated",
    "evidence_strategy": "separate"
  }
}
```

Create at least two independent Validator Nodes. Set one brief to `"validation_focus": "conformance"` and the other to `"validation_focus": "boundary"`.

## Boundary dimension to observation

Declare material partitions on the producing Task. Do not put concrete test values in the plan:

```json
{
  "boundary_dimensions": [
    {
      "id": "timestamp-precision",
      "category": "precision",
      "subject": "latest-event timestamp comparison",
      "partitions": [
        "whole-second",
        "millisecond",
        "finer-supported-precision",
        "adjacent-representable-values",
        "offset-equivalent-instants",
        "equal-instant-tie"
      ],
      "minimum_cases": 6,
      "sampling": "adjacent-pair"
    }
  ]
}
```

Reference the complete dimension from a fact-only Validator brief:

```json
{
  "validation_focus": "boundary",
  "boundary_checks": [
    {
      "id": "check-timestamp-precision",
      "category": "precision",
      "dimension_ref": "normalize-events:timestamp-precision",
      "partitions": [
        "whole-second",
        "millisecond",
        "finer-supported-precision",
        "adjacent-representable-values",
        "offset-equivalent-instants",
        "equal-instant-tie"
      ],
      "minimum_cases": 6,
      "invariant": "Timestamp comparison preserves the latest instant at every supported precision and applies the declared tie rule only to equal instants",
      "verification_steps": [
        "Generate independent adjacent values for every declared partition",
        "Record the raw input or fixture and observed retained event"
      ]
    }
  ]
}
```

At runtime, record every independently generated case rather than only claiming coverage:

```json
{
  "boundary_check_id": "check-timestamp-precision",
  "dimension_ref": "normalize-events:timestamp-precision",
  "cases": [
    {
      "case_id": "sub-ms-adjacent-1",
      "partition": "adjacent-representable-values",
      "generated_input_or_fixture_ref": "artifact-payloads/timestamp-cases.json#sub-ms-adjacent-1",
      "expected_fact": "the later instant is retained",
      "observed_fact": "event critical-2 was retained",
      "status": "passed",
      "evidence_ref": "artifact-payloads/timestamp-results.json#sub-ms-adjacent-1"
    }
  ]
}
```

The complete Node Run also includes `coverage_gaps`; it must be an empty array before an accepted or integrated Validator Run.
