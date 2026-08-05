import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ContractError,
  activateNode,
  approvalMatches,
  assertNodeSubmission,
  assertNodeTransition,
  assertPlanTransition,
  compileBundle,
  computePlanHash,
  createExecutionState,
  effectiveCapacity,
  invalidateArtifactDescendants,
  markReadyNodes,
  readyNodeIds,
  staleDescendants,
  validateBundle,
  validateRuntimeRegistries,
} from "../skills/orchestrate-parallel-work/scripts/graph-core.mjs";

const evidenceGate = (ref) => ({
  mode: "command",
  steps: ["node --test"],
  pass_condition: "command exits 0",
  evidence_contract_ref: ref,
});

function taskBase(id, agentType, outputs) {
  return {
    schema_version: "1.0",
    task_id: id,
    node_id: id,
    goal: `Complete ${id}`,
    agent_type_id: agentType,
    feature_points: [],
    modules: [],
    authoritative_inputs: [],
    inputs: [],
    outputs,
    constraints: [],
    owned_scopes: [],
    forbidden_scopes: [],
    allowed_external_effects: [],
    completion_criteria: ["All declared outputs conform"],
    self_validation: {
      test_gate: evidenceGate(`${id}-test`),
      lint_gate: evidenceGate(`${id}-lint`),
    },
    acceptance: { required_status: "passed" },
  };
}

function artifact(id, producer, port, purpose, consumers = []) {
  return {
    artifact_contract_id: id,
    artifact_type: id.includes("lint") || id.includes("test") ? "check_result" : "json",
    schema_version: "1.0",
    purpose,
    producer: { node_id: producer, port },
    consumers,
    delivery: { format: "json", path: `artifacts/${id}.json` },
    content_schema: { type: "object" },
    acceptance_checks: ["valid JSON"],
    required: true,
  };
}

function validBundle() {
  const build = taskBase("build", "developer", [
    { port: "result", artifact_contract_ref: "build-result" },
    { port: "test", artifact_contract_ref: "build-test" },
    { port: "lint", artifact_contract_ref: "build-lint" },
  ]);
  build.feature_points = [{ id: "FEATURE-1", expected_behavior: "A result is produced" }];
  build.modules = [{ name: "core", paths: ["src/core"] }];
  build.authoritative_inputs = ["request://original"];
  build.inputs = [{ port: "request", source: "external", cardinality: "one", required: true, authoritative_input_ref: "request://original" }];
  build.owned_scopes = ["src/core"];

  const validate = taskBase("validate", "validator", [
    { port: "report", artifact_contract_ref: "validation-report" },
    { port: "test", artifact_contract_ref: "validate-test" },
    { port: "lint", artifact_contract_ref: "validate-lint" },
  ]);
  validate.inputs = [{ port: "candidate", source: "edge", cardinality: "one", required: true, artifact_contract_ref: "build-result" }];
  validate.validation_brief = {
    validation_id: "validate-core",
    feature_points: [{ id: "FEATURE-1", expected_behavior: "A result is produced" }],
    modules: [{ name: "core", paths: ["src/core"] }],
    authoritative_input_refs: ["request://original"],
    artifact_refs: ["build-result"],
    verification_steps: ["Run declared checks and record observations"],
    boundary_checks: [{ id: "BOUNDARY-1", category: "boundary", invariant: "Boundary inputs preserve the declared result contract", verification_steps: ["Exercise one valid boundary and one invalid neighbor"] }],
  };

  return {
    graphPlan: {
      schema_version: "1.0",
      plan_id: "plan-test",
      plan_version: 1,
      status: "awaiting_user_approval",
      goal_contract: { goal: "Produce and validate a result" },
      capacity: { hard_limit: 15, runtime_limit: 8, permission_limit: 3, effective_capacity: 3 },
      nodes: [
        { node_id: "build", node_type: "work", agent_type_id: "developer", task_ref: "build", input_ports: ["request"], output_ports: ["result", "test", "lint"] },
        { node_id: "validate", node_type: "validation", agent_type_id: "validator", task_ref: "validate", input_ports: ["candidate"], output_ports: ["report", "test", "lint"] },
      ],
      edges: [{ edge_id: "build-to-validate", kind: "data", from: { node_id: "build", port: "result" }, to: { node_id: "validate", port: "candidate" }, artifact_contract_ref: "build-result" }],
      terminal_outputs: ["validation-report"],
    },
    agentTypes: {
      schema_version: "1.0",
      agent_types: [
        { agent_type_id: "developer", title: "Developer", purpose: "Build scoped output", capabilities: ["implementation"], allowed_tools: ["filesystem"], permission_profile: "project-write", default_owned_scopes: ["src/core"], max_instances: 2, validator: false },
        { agent_type_id: "validator", title: "Validator", purpose: "Observe declared facts", capabilities: ["validation"], allowed_tools: ["read", "test"], permission_profile: "read-only", default_owned_scopes: [], max_instances: 1, validator: true },
      ],
    },
    tasks: [build, validate],
    artifactCatalog: {
      schema_version: "1.0",
      artifacts: [
        artifact("build-result", "build", "result", "intermediate", [{ node_id: "validate", port: "candidate" }]),
        artifact("build-test", "build", "test", "evidence"), artifact("build-lint", "build", "lint", "evidence"),
        artifact("validation-report", "validate", "report", "delivery"),
        artifact("validate-test", "validate", "test", "evidence"), artifact("validate-lint", "validate", "lint", "evidence"),
      ],
    },
  };
}

function approved(bundle, hash = computePlanHash(bundle)) {
  return {
    schema_version: "1.0", plan_id: bundle.graphPlan.plan_id, plan_version: bundle.graphPlan.plan_version,
    plan_hash: hash, status: "approved", approved_by: "user", approved_at: "2026-01-01T00:00:00Z",
    approved_capacity: 3, approved_external_effects: [], approved_validation_exceptions: [],
  };
}

function hybridBundle() {
  const bundle = validBundle();
  const docs = taskBase("docs", "developer", [
    { port: "result", artifact_contract_ref: "docs-result" },
    { port: "test", artifact_contract_ref: "docs-test" },
    { port: "lint", artifact_contract_ref: "docs-lint" },
  ]);
  docs.inputs = [{ port: "request", source: "external", cardinality: "one", required: true, authoritative_input_ref: "request://original" }];
  docs.authoritative_inputs = ["request://original"];
  docs.owned_scopes = ["docs"];
  bundle.tasks.splice(1, 0, docs);
  bundle.graphPlan.nodes.splice(1, 0, { node_id: "docs", node_type: "work", agent_type_id: "developer", task_ref: "docs", input_ports: ["request"], output_ports: ["result", "test", "lint"] });
  bundle.graphPlan.nodes[2].input_ports.push("documentation");
  bundle.tasks[2].inputs.push({ port: "documentation", source: "edge", cardinality: "one", required: true, artifact_contract_ref: "docs-result" });
  bundle.tasks[2].validation_brief.artifact_refs.push("docs-result");
  bundle.graphPlan.edges.push({ edge_id: "docs-to-validate", kind: "data", from: { node_id: "docs", port: "result" }, to: { node_id: "validate", port: "documentation" }, artifact_contract_ref: "docs-result" });
  bundle.artifactCatalog.artifacts.push(
    artifact("docs-result", "docs", "result", "intermediate", [{ node_id: "validate", port: "documentation" }]),
    artifact("docs-test", "docs", "test", "evidence"),
    artifact("docs-lint", "docs", "lint", "evidence"),
  );
  return bundle;
}

function parallelBundle() {
  const makeValidator = (id) => {
    const task = taskBase(id, "validator", [
      { port: "report", artifact_contract_ref: `${id}-report` },
      { port: "test", artifact_contract_ref: `${id}-test` },
      { port: "lint", artifact_contract_ref: `${id}-lint` },
    ]);
    task.validation_brief = {
      validation_id: id,
      feature_points: [],
      modules: [],
      authoritative_input_refs: ["request://original"],
      artifact_refs: [],
      verification_steps: ["Observe the assigned external facts"],
      boundary_checks: [{ id: `${id}-boundary`, category: "determinism", invariant: "Repeated observations are stable", verification_steps: ["Repeat the observation twice and compare raw results"] }],
    };
    return task;
  };
  const tasks = [makeValidator("validate-left"), makeValidator("validate-right")];
  return {
    graphPlan: {
      schema_version: "1.0",
      plan_id: "plan-parallel",
      plan_version: 1,
      status: "awaiting_user_approval",
      capacity: { hard_limit: 15, runtime_limit: 6, permission_limit: 6, effective_capacity: 6 },
      nodes: tasks.map((task) => ({ node_id: task.node_id, node_type: "validation", agent_type_id: "validator", task_ref: task.task_id, input_ports: [], output_ports: ["report", "test", "lint"] })),
      edges: [],
      terminal_outputs: tasks.map((task) => `${task.task_id}-report`),
    },
    agentTypes: {
      schema_version: "1.0",
      agent_types: [{ agent_type_id: "validator", title: "Validator", purpose: "Observe declared facts", capabilities: ["validation"], allowed_tools: ["read", "test"], permission_profile: "read-only", default_owned_scopes: [], max_instances: 2, validator: true }],
    },
    tasks,
    artifactCatalog: {
      schema_version: "1.0",
      artifacts: tasks.flatMap((task) => [
        artifact(`${task.task_id}-report`, task.task_id, "report", "delivery"),
        artifact(`${task.task_id}-test`, task.task_id, "test", "evidence"),
        artifact(`${task.task_id}-lint`, task.task_id, "lint", "evidence"),
      ]),
    },
  };
}

test("compiler accepts a complete approval-gated serial DAG and derives counts", () => {
  const bundle = validBundle();
  const compiled = compileBundle(bundle);
  assert.deepEqual(compiled.topology.waves, [["build"], ["validate"]]);
  assert.deepEqual(compiled.summary, {
    agent_role_count: 2, node_count: 2, edge_count: 1, task_count: 2,
    planned_artifact_count: 6, estimated_peak_agents: 2, execution_shape: "serial",
  });
  assert.match(compiled.hash, /^sha256:[0-9a-f]{64}$/);
});

test("DAG topology naturally compiles a hybrid parallel-then-serial plan", () => {
  const compiled = compileBundle(hybridBundle());
  assert.deepEqual(compiled.topology.waves, [["build", "docs"], ["validate"]]);
  assert.equal(compiled.summary.execution_shape, "hybrid");
  assert.equal(compiled.summary.estimated_peak_agents, 3);
  assert.equal(compiled.summary.node_count, 3);
  assert.equal(compiled.summary.planned_artifact_count, 9);
});

test("independent validation nodes compile as a pure parallel plan", () => {
  const compiled = compileBundle(parallelBundle());
  assert.deepEqual(compiled.topology.waves, [["validate-left", "validate-right"]]);
  assert.equal(compiled.summary.execution_shape, "parallel");
  assert.equal(compiled.summary.estimated_peak_agents, 3);
});

test("canonical hash ignores lifecycle and derived fields but covers contracts", () => {
  const bundle = validBundle();
  const hash = computePlanHash(bundle);
  bundle.graphPlan.status = "approved";
  bundle.graphPlan.summary = compileBundle(validBundle()).summary;
  bundle.graphPlan.updated_at = "later";
  assert.equal(computePlanHash(bundle), hash);
  bundle.tasks[0].goal = "Changed goal";
  assert.notEqual(computePlanHash(bundle), hash);
});

test("exact approval is mandatory before nodes become ready", () => {
  const bundle = validBundle();
  const compiled = compileBundle(bundle);
  const state = createExecutionState(compiled);
  assert.deepEqual(readyNodeIds(compiled, state, null), []);
  const approval = approved(bundle, compiled.hash);
  assert.equal(approvalMatches(approval, { ...bundle.graphPlan, plan_hash: compiled.hash }), true);
  assert.deepEqual(readyNodeIds(compiled, state, approval), ["build"]);
  approval.plan_hash = `sha256:${"0".repeat(64)}`;
  assert.deepEqual(readyNodeIds(compiled, state, approval), []);
});

test("scheduler rechecks approval and capacity when activating a node", () => {
  const bundle = validBundle();
  const compiled = compileBundle(bundle);
  const state = createExecutionState(compiled);
  const approval = approved(bundle, compiled.hash);
  const registry = { schema_version: "1.0", execution_run_id: state.execution_run_id, coordinator_agent_instance_id: "coordinator", entries: [] };
  assert.deepEqual(markReadyNodes(compiled, state, approval), ["build"]);
  assert.throws(() => activateNode(compiled, state, { ...approval, status: "revoked" }, registry, "build", "worker-1"), /approval/);
  const entry = activateNode(compiled, state, approval, registry, "build", "worker-1");
  assert.equal(entry.status, "active");
  assert.equal(state.plan_status, "running");

  const constrained = validBundle();
  constrained.graphPlan.capacity.runtime_limit = 1;
  constrained.graphPlan.capacity.permission_limit = 1;
  constrained.graphPlan.capacity.effective_capacity = 1;
  const serial = compileBundle(constrained);
  const serialState = createExecutionState(serial);
  const serialApproval = { ...approved(constrained, serial.hash), approved_capacity: 1 };
  const serialRegistry = { coordinator_agent_instance_id: "coordinator", entries: [] };
  markReadyNodes(serial, serialState, serialApproval);
  assert.throws(() => activateNode(serial, serialState, serialApproval, serialRegistry, "build", "worker-1"), /capacity/);
  assert.doesNotThrow(() => activateNode(serial, serialState, serialApproval, serialRegistry, "build", "coordinator"));
});

test("compiler rejects cycles", () => {
  const bundle = validBundle();
  bundle.graphPlan.edges.push({ edge_id: "cycle", kind: "control", from: { node_id: "validate" }, to: { node_id: "build" } });
  const result = validateBundle(bundle);
  assert.equal(result.valid, false);
  assert(result.errors.some((item) => item.code === "cycle"));
});

test("capacity is the strict minimum and hard limit is 15", () => {
  assert.equal(effectiveCapacity({ hard_limit: 15, runtime_limit: 4, permission_limit: 9 }), 4);
  const bundle = validBundle();
  bundle.graphPlan.capacity.effective_capacity = 8;
  const result = validateBundle(bundle);
  assert(result.errors.some((item) => item.code === "capacity"));
});

test("validator brief rejects persuasive or conclusion-bearing fields", () => {
  const bundle = validBundle();
  bundle.tasks[1].validation_brief.expected_conclusion = "The implementation is correct";
  const result = validateBundle(bundle);
  assert(result.errors.some((item) => item.code === "validator_bias"));
});

test("validator brief requires reproducible boundary coverage", () => {
  const missing = validBundle();
  delete missing.tasks[1].validation_brief.boundary_checks;
  assert(validateBundle(missing).errors.some((item) => item.code === "required" && item.path.endsWith("boundary_checks")));

  const empty = validBundle();
  empty.tasks[1].validation_brief.boundary_checks = [];
  assert(validateBundle(empty).errors.some((item) => item.code === "boundary_coverage"));

  const invalid = validBundle();
  invalid.tasks[1].validation_brief.boundary_checks = [{ id: "edge", category: "conclusion", invariant: "The result is correct", verification_steps: [] }];
  const result = validateBundle(invalid);
  assert(result.errors.some((item) => item.code === "enum"));
  assert(result.errors.some((item) => item.path.endsWith("verification_steps")));
});

test("every node requires test and lint gates with evidence", () => {
  const bundle = validBundle();
  delete bundle.tasks[0].self_validation.lint_gate;
  const result = validateBundle(bundle);
  assert(result.errors.some((item) => item.path.endsWith("lint_gate")));

  const equivalent = validBundle();
  equivalent.tasks[0].self_validation.lint_gate = { mode: "equivalent", reason: "No source syntax exists", steps: ["Validate JSON schema"], pass_condition: "schema valid", evidence_contract_ref: "build-lint" };
  assert.equal(validateBundle(equivalent).valid, true);
});

test("equivalent validation and external effects require exact approval scope", () => {
  const bundle = validBundle();
  bundle.tasks[0].self_validation.lint_gate = { mode: "equivalent", reason: "No source syntax exists", steps: ["Validate JSON schema"], pass_condition: "schema valid", evidence_contract_ref: "build-lint" };
  bundle.tasks[0].allowed_external_effects = ["github:branch-write"];
  bundle.approval = approved(bundle);
  let result = validateBundle(bundle, { requireApproval: true });
  assert(result.errors.some((item) => item.code === "approval_scope"));
  bundle.approval.approved_external_effects = ["github:branch-write"];
  bundle.approval.approved_validation_exceptions = [{ task_id: "build", gate: "lint_gate", reason: "No source syntax exists" }];
  result = validateBundle(bundle, { requireApproval: true });
  assert.equal(result.valid, true);
});

test("accepted upstream artifact releases downstream node", () => {
  const bundle = validBundle();
  const compiled = compileBundle(bundle);
  const state = createExecutionState(compiled);
  state.nodes.build.status = "accepted";
  const registry = { artifacts: [{ artifact_contract_id: "build-result", status: "accepted" }] };
  assert.deepEqual(readyNodeIds(compiled, state, approved(bundle, compiled.hash), registry), ["validate"]);
  registry.artifacts[0].status = "submitted";
  assert.deepEqual(readyNodeIds(compiled, state, approved(bundle, compiled.hash), registry), []);
});

test("runtime registry enforces active-agent capacity including coordinator", () => {
  const bundle = validBundle();
  bundle.graphPlan.capacity.runtime_limit = 2;
  bundle.graphPlan.capacity.permission_limit = 2;
  bundle.graphPlan.capacity.effective_capacity = 2;
  const compiled = compileBundle(bundle);
  const registry = { artifacts: [] };
  const runs = { entries: [
    { node_run_id: "run-1", status: "active", agent_instance_id: "worker-1" },
    { node_run_id: "run-2", status: "active", agent_instance_id: "worker-2" },
  ] };
  const result = validateRuntimeRegistries(compiled, registry, runs);
  assert.equal(result.valid, false);
  assert(result.errors.some((item) => item.code === "capacity"));
});

test("node submission requires passed test/lint evidence and all outputs", () => {
  const bundle = validBundle();
  const task = bundle.tasks[0];
  const nodeRun = {
    node_run_id: "build-attempt-1",
    self_checks: [
      { gate: "test_gate", status: "passed", evidence_ref: "build-test-v1" },
      { gate: "lint_gate", status: "passed", evidence_ref: "build-lint-v1" },
    ],
  };
  const artifacts = { artifacts: task.outputs.map((output, index) => ({ artifact_contract_id: output.artifact_contract_ref, producer: { node_run_id: nodeRun.node_run_id }, status: index ? "accepted" : "submitted" })) };
  assert.doesNotThrow(() => assertNodeSubmission(task, nodeRun, artifacts));
  nodeRun.self_checks[1].status = "failed";
  assert.throws(() => assertNodeSubmission(task, nodeRun, artifacts), /lint_gate/);
});

test("state engine rejects illegal transitions and stales transitive descendants", () => {
  assert.doesNotThrow(() => assertPlanTransition("draft", "graph_validated"));
  assert.throws(() => assertPlanTransition("draft", "running"), /illegal plan transition/);
  assert.doesNotThrow(() => assertNodeTransition("active", "submitted"));
  assert.throws(() => assertNodeTransition("blocked", "accepted"), /illegal node transition/);
  const compiled = compileBundle(validBundle());
  const state = createExecutionState(compiled);
  state.nodes.validate.status = "accepted";
  assert.deepEqual(staleDescendants(compiled, state, "build"), ["validate"]);
  assert.equal(state.nodes.validate.status, "stale");
});

test("an artifact contract change invalidates all transitive consumer nodes", () => {
  const compiled = {
    bundle: { artifactCatalog: { artifacts: [{ artifact_contract_id: "source-result", producer: { node_id: "source" } }] } },
    topology: { outgoing: new Map([["source", ["left", "right"]], ["left", ["join"]], ["right", ["join"]], ["join", []], ["unrelated", []]]) },
  };
  const state = { nodes: Object.fromEntries(["source", "left", "right", "join", "unrelated"].map((id) => [id, { status: "accepted", attempt: 1 }])) };
  assert.deepEqual(invalidateArtifactDescendants(compiled, state, "source-result"), ["left", "right", "join"]);
  assert.equal(state.nodes.left.status,"stale");
  assert.equal(state.nodes.right.status,"stale");
  assert.equal(state.nodes.join.status,"stale");
  assert.equal(state.nodes.unrelated.status,"accepted");
  assert.throws(() => invalidateArtifactDescendants(compiled, state, "missing"), /unknown artifact contract/);
});

test("CLI validates a file-backed plan and emits deterministic JSON", async () => {
  const bundle = validBundle();
  const directory = await mkdtemp(path.join(tmpdir(), "graph-contract-cli-"));
  await mkdir(path.join(directory, "tasks"));
  await mkdir(path.join(directory, "artifacts"));
  await writeFile(path.join(directory, "graph-plan.json"), JSON.stringify(bundle.graphPlan));
  await writeFile(path.join(directory, "agent-types.json"), JSON.stringify(bundle.agentTypes));
  await writeFile(path.join(directory, "tasks", "build.json"), JSON.stringify(bundle.tasks[0]));
  await writeFile(path.join(directory, "tasks", "validate.json"), JSON.stringify(bundle.tasks[1]));
  await writeFile(path.join(directory, "artifacts", "catalog.json"), JSON.stringify(bundle.artifactCatalog));
  const cli = path.resolve("skills/orchestrate-parallel-work/scripts/graphctl.mjs");
  const output = execFileSync(process.execPath, [cli, "validate", directory, "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.summary.node_count, 2);
});

test("compile throws a structured ContractError", () => {
  const bundle = validBundle();
  bundle.graphPlan.nodes[0].task_ref = "missing";
  assert.throws(() => compileBundle(bundle), (error) => error instanceof ContractError && error.errors.some((item) => item.code === "unknown_ref"));
});
