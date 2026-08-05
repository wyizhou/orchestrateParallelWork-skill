import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = "1.0";
export const HARD_AGENT_LIMIT = 15;

export const PLAN_TRANSITIONS = Object.freeze({
  draft: ["graph_validated", "cancelled"],
  graph_validated: ["awaiting_user_approval", "cancelled"],
  awaiting_user_approval: ["approved", "rejected", "revision_requested", "cancelled"],
  approved: ["running", "revoked", "cancelled", "superseded"],
  running: ["validating", "failed", "cancelled", "revoked"],
  validating: ["completed", "running", "failed", "cancelled"],
  completed: [], rejected: [], revision_requested: ["superseded"], revoked: [],
  failed: [], cancelled: [], superseded: [],
});

export const NODE_TRANSITIONS = Object.freeze({
  blocked: ["ready", "skipped", "cancelled", "stale"],
  ready: ["active", "skipped", "cancelled", "stale"],
  active: ["submitted", "failed", "cancelled", "stale"],
  submitted: ["accepted", "failed", "stale"],
  accepted: ["integrated", "stale"],
  integrated: ["stale"],
  failed: ["ready", "cancelled", "stale"],
  stale: ["ready", "cancelled"],
  skipped: [], cancelled: [],
});

export class ContractError extends Error {
  constructor(errors) {
    super(errors.map((item) => `${item.path}: ${item.message}`).join("\n"));
    this.name = "ContractError";
    this.errors = errors;
  }
}

const err = (errors, code, at, message) => errors.push({ code, path: at, message });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const list = (value) => Array.isArray(value) ? value : [];

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contractProjection(bundle) {
  const plan = structuredClone(bundle.graphPlan ?? {});
  delete plan.plan_hash;
  delete plan.status;
  delete plan.summary;
  delete plan.created_at;
  delete plan.updated_at;
  return {
    graph_plan: plan,
    agent_types: bundle.agentTypes ?? {},
    tasks: list(bundle.tasks).slice().sort((a, b) => String(a?.task_id).localeCompare(String(b?.task_id))),
    artifact_catalog: bundle.artifactCatalog ?? {},
  };
}

export function computePlanHash(bundle) {
  return `sha256:${createHash("sha256").update(stableStringify(contractProjection(bundle))).digest("hex")}`;
}

export function effectiveCapacity(capacity) {
  const values = [capacity?.hard_limit, capacity?.runtime_limit, capacity?.permission_limit];
  if (!values.every((value) => Number.isInteger(value) && value >= 1)) {
    throw new TypeError("capacity limits must be positive integers");
  }
  return Math.min(...values);
}

function byId(items, key, errors, at) {
  const result = new Map();
  for (const [index, item] of items.entries()) {
    const id = item?.[key];
    if (!isNonEmpty(id)) err(errors, "required", `${at}[${index}].${key}`, "must be a non-empty string");
    else if (result.has(id)) err(errors, "duplicate_id", `${at}[${index}].${key}`, `duplicate id ${id}`);
    else result.set(id, item);
  }
  return result;
}

function normalizeScope(scope) {
  let normalized = path.posix.normalize(scope.replaceAll("\\", "/").trim());
  normalized = normalized.replace(/^\.\//, "").replace(/\*.*$/, "").replace(/\/$/, "");
  return normalized || ".";
}

function scopesOverlap(left, right) {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  return a === "." || b === "." || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function topo(nodes, edges, errors) {
  const ids = nodes.map((node) => node.node_id);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) {
    const from = edge?.from?.node_id;
    const to = edge?.to?.node_id;
    if (!incoming.has(from) || !incoming.has(to)) continue;
    incoming.set(to, incoming.get(to) + 1);
    outgoing.get(from).push(to);
  }
  let ready = ids.filter((id) => incoming.get(id) === 0).sort();
  const order = [];
  const waves = [];
  while (ready.length) {
    const wave = ready;
    waves.push(wave);
    ready = [];
    for (const id of wave) {
      order.push(id);
      for (const child of outgoing.get(id).sort()) {
        incoming.set(child, incoming.get(child) - 1);
        if (incoming.get(child) === 0) ready.push(child);
      }
    }
    ready.sort();
  }
  if (order.length !== ids.length) err(errors, "cycle", "graph_plan.edges", "graph must be an acyclic DAG");
  return { order, waves, outgoing };
}

function reachable(from, target, outgoing) {
  const pending = [from];
  const seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }
  return false;
}

function checkGate(gate, at, errors) {
  if (!isObject(gate)) return err(errors, "required", at, "validation gate is required");
  if (!["command", "manual", "schema", "source-check", "equivalent"].includes(gate.mode)) {
    err(errors, "enum", `${at}.mode`, "unsupported validation mode");
  }
  if (!Array.isArray(gate.steps) || gate.steps.length === 0 || gate.steps.some((step) => !isNonEmpty(step))) {
    err(errors, "required", `${at}.steps`, "must contain reproducible non-empty steps");
  }
  if (!isNonEmpty(gate.pass_condition)) err(errors, "required", `${at}.pass_condition`, "is required");
  if (!isNonEmpty(gate.evidence_contract_ref)) err(errors, "required", `${at}.evidence_contract_ref`, "is required");
  if (gate.mode === "equivalent" && !isNonEmpty(gate.reason)) err(errors, "required", `${at}.reason`, "equivalent checks require a reason");
}

function validateBasicDocuments(bundle, errors) {
  const { graphPlan, agentTypes, tasks, artifactCatalog } = bundle;
  for (const [name, document] of Object.entries({ graphPlan, agentTypes, artifactCatalog })) {
    if (!isObject(document)) err(errors, "type", name, "must be an object");
    else if (document.schema_version !== SCHEMA_VERSION) err(errors, "schema_version", `${name}.schema_version`, `must be ${SCHEMA_VERSION}`);
  }
  if (!Array.isArray(tasks)) err(errors, "type", "tasks", "must be an array");
  for (const [index, task] of list(tasks).entries()) {
    if (task?.schema_version !== SCHEMA_VERSION) err(errors, "schema_version", `tasks[${index}].schema_version`, `must be ${SCHEMA_VERSION}`);
  }
  if (graphPlan?.capacity?.hard_limit !== HARD_AGENT_LIMIT) err(errors, "capacity", "graphPlan.capacity.hard_limit", `must equal ${HARD_AGENT_LIMIT}`);
  try {
    const actual = effectiveCapacity(graphPlan?.capacity);
    if (graphPlan?.capacity?.effective_capacity !== actual) err(errors, "capacity", "graphPlan.capacity.effective_capacity", `must equal min(hard,runtime,permission) = ${actual}`);
  } catch (error) {
    err(errors, "capacity", "graphPlan.capacity", error.message);
  }
}

export function validateBundle(bundle, { requireApproval = false } = {}) {
  const errors = [];
  validateBasicDocuments(bundle, errors);
  const plan = bundle.graphPlan ?? {};
  const nodes = list(plan.nodes);
  const edges = list(plan.edges);
  const roles = list(bundle.agentTypes?.agent_types);
  const tasks = list(bundle.tasks);
  const contracts = list(bundle.artifactCatalog?.artifacts);
  const nodeMap = byId(nodes, "node_id", errors, "graphPlan.nodes");
  const edgeMap = byId(edges, "edge_id", errors, "graphPlan.edges");
  const roleMap = byId(roles, "agent_type_id", errors, "agentTypes.agent_types");
  const taskMap = byId(tasks, "task_id", errors, "tasks");
  const contractMap = byId(contracts, "artifact_contract_id", errors, "artifactCatalog.artifacts");
  void edgeMap;

  if (!isNonEmpty(plan.plan_id)) err(errors, "required", "graphPlan.plan_id", "is required");
  if (!Number.isInteger(plan.plan_version) || plan.plan_version < 1) err(errors, "required", "graphPlan.plan_version", "must be a positive integer");
  if (!roles.some((role) => role.validator === true)) err(errors, "validator", "agentTypes.agent_types", "must define a validator role");

  const referencedRoles = new Set();
  const referencedTasks = new Set();
  const taskUseCount = new Map();
  for (const [index, node] of nodes.entries()) {
    if (!roleMap.has(node.agent_type_id)) err(errors, "unknown_ref", `graphPlan.nodes[${index}].agent_type_id`, "unknown agent type");
    else referencedRoles.add(node.agent_type_id);
    if (!taskMap.has(node.task_ref)) err(errors, "unknown_ref", `graphPlan.nodes[${index}].task_ref`, "unknown task");
    else {
      referencedTasks.add(node.task_ref);
      taskUseCount.set(node.task_ref, (taskUseCount.get(node.task_ref) ?? 0) + 1);
    }
    if (!Array.isArray(node.input_ports) || !Array.isArray(node.output_ports)) err(errors, "required", `graphPlan.nodes[${index}]`, "input_ports and output_ports are required arrays");
    const role = roleMap.get(node.agent_type_id);
    if (node.node_type === "validation" && role && role.validator !== true) err(errors, "validator", `graphPlan.nodes[${index}]`, "validation nodes require a validator role");
    if (node.node_type !== "validation" && role?.validator === true) err(errors, "validator", `graphPlan.nodes[${index}]`, "validator roles may only own validation nodes");
  }
  for (const role of roles) if (!referencedRoles.has(role.agent_type_id)) err(errors, "unused", `agentTypes.${role.agent_type_id}`, "agent type is unused");
  for (const role of roles) if (role.validator === true) {
    if (role.permission_profile !== "read-only" || list(role.default_owned_scopes).length !== 0) err(errors, "validator", `agentTypes.${role.agent_type_id}`, "validator role must be read-only with no owned write scopes");
    if (list(role.allowed_tools).some((tool) => /(spawn|delegate|subagent|agent-tool)/i.test(tool))) err(errors, "validator", `agentTypes.${role.agent_type_id}.allowed_tools`, "validator role may not delegate");
  }
  for (const task of tasks) if (!referencedTasks.has(task.task_id)) err(errors, "orphan", `tasks.${task.task_id}`, "task has no node");
  for (const [taskId, count] of taskUseCount) if (count !== 1) err(errors, "mapping", `tasks.${taskId}`, "must map to exactly one node");

  const edgeForInput = new Map();
  for (const [index, edge] of edges.entries()) {
    const fromNode = nodeMap.get(edge?.from?.node_id);
    const toNode = nodeMap.get(edge?.to?.node_id);
    if (!fromNode) err(errors, "unknown_ref", `graphPlan.edges[${index}].from.node_id`, "unknown node");
    if (!toNode) err(errors, "unknown_ref", `graphPlan.edges[${index}].to.node_id`, "unknown node");
    if (edge.kind === "data") {
      if (!isNonEmpty(edge?.from?.port) || !fromNode?.output_ports?.includes(edge.from.port)) err(errors, "port", `graphPlan.edges[${index}].from.port`, "unknown output port");
      if (!isNonEmpty(edge?.to?.port) || !toNode?.input_ports?.includes(edge.to.port)) err(errors, "port", `graphPlan.edges[${index}].to.port`, "unknown input port");
      if (!contractMap.has(edge.artifact_contract_ref)) err(errors, "unknown_ref", `graphPlan.edges[${index}].artifact_contract_ref`, "unknown artifact contract");
      const key = `${edge?.to?.node_id}:${edge?.to?.port}`;
      if (!edgeForInput.has(key)) edgeForInput.set(key, []);
      edgeForInput.get(key).push(edge);
    } else if (edge.kind === "control") {
      if (edge.artifact_contract_ref || edge?.from?.port || edge?.to?.port) err(errors, "control_edge", `graphPlan.edges[${index}]`, "control edges must not bind ports or artifacts");
    } else err(errors, "enum", `graphPlan.edges[${index}].kind`, "must be data or control");
  }

  for (const [index, task] of tasks.entries()) {
    const node = nodes.find((candidate) => candidate.task_ref === task.task_id);
    if (task.node_id !== node?.node_id) err(errors, "mapping", `tasks[${index}].node_id`, "must match its node");
    if (task.agent_type_id !== node?.agent_type_id) err(errors, "mapping", `tasks[${index}].agent_type_id`, "must match node agent type");
    checkGate(task?.self_validation?.test_gate, `tasks[${index}].self_validation.test_gate`, errors);
    checkGate(task?.self_validation?.lint_gate, `tasks[${index}].self_validation.lint_gate`, errors);
    for (const [gateName, gate] of Object.entries(task?.self_validation ?? {})) {
      if (gate?.evidence_contract_ref && !contractMap.has(gate.evidence_contract_ref)) err(errors, "unknown_ref", `tasks[${index}].self_validation.${gateName}.evidence_contract_ref`, "unknown evidence contract");
      if (gate?.evidence_contract_ref && !list(task.outputs).some((output) => output.artifact_contract_ref === gate.evidence_contract_ref)) err(errors, "evidence_binding", `tasks[${index}].self_validation.${gateName}.evidence_contract_ref`, "evidence must be an output of the same task");
    }
    for (const [inputIndex, input] of list(task.inputs).entries()) {
      if (!node?.input_ports?.includes(input.port)) err(errors, "port", `tasks[${index}].inputs[${inputIndex}].port`, "not declared by node");
      if (input.source === "edge") {
        const matches = edgeForInput.get(`${node?.node_id}:${input.port}`) ?? [];
        const required = input.required !== false;
        if ((input.cardinality === "many" && required && matches.length < 1)
          || (input.cardinality !== "many" && ((required && matches.length !== 1) || (!required && matches.length > 1)))) {
          err(errors, "cardinality", `tasks[${index}].inputs[${inputIndex}]`, "edge input cardinality is not satisfied");
        }
        if (matches.some((edge) => edge.artifact_contract_ref !== input.artifact_contract_ref)) err(errors, "artifact_binding", `tasks[${index}].inputs[${inputIndex}]`, "edge artifact does not match task input");
      } else if (input.source === "external") {
        if (!isNonEmpty(input.authoritative_input_ref)) err(errors, "required", `tasks[${index}].inputs[${inputIndex}].authoritative_input_ref`, "external input requires an authoritative reference");
      } else err(errors, "enum", `tasks[${index}].inputs[${inputIndex}].source`, "must be edge or external");
    }
    for (const [outputIndex, output] of list(task.outputs).entries()) {
      if (!node?.output_ports?.includes(output.port)) err(errors, "port", `tasks[${index}].outputs[${outputIndex}].port`, "not declared by node");
      if (!contractMap.has(output.artifact_contract_ref)) err(errors, "unknown_ref", `tasks[${index}].outputs[${outputIndex}].artifact_contract_ref`, "unknown artifact contract");
    }
    const taskInputs = list(task.inputs).map((input) => input.port).sort();
    const taskOutputs = list(task.outputs).map((output) => output.port).sort();
    if (stableStringify(taskInputs) !== stableStringify(list(node?.input_ports).slice().sort())) err(errors, "port", `tasks[${index}].inputs`, "must bind every node input port exactly once");
    if (stableStringify(taskOutputs) !== stableStringify(list(node?.output_ports).slice().sort())) err(errors, "port", `tasks[${index}].outputs`, "must bind every node output port exactly once");
    const role = roleMap.get(task.agent_type_id);
    if (role?.validator) {
      validateValidatorBrief(task, `tasks[${index}]`, errors);
      if (list(task.owned_scopes).length || list(task.allowed_external_effects).length) err(errors, "validator", `tasks[${index}]`, "validator task must be read-only and have no external effects");
      for (const artifactRef of list(task.validation_brief?.artifact_refs)) if (!contractMap.has(artifactRef)) err(errors, "unknown_ref", `tasks[${index}].validation_brief.artifact_refs`, `unknown artifact contract ${artifactRef}`);
    }
  }

  const terminal = new Set(list(plan.terminal_outputs));
  const terminalProducers = new Set();
  for (const [index, contract] of contracts.entries()) {
    const producerNode = nodeMap.get(contract?.producer?.node_id);
    if (!producerNode || !producerNode.output_ports?.includes(contract?.producer?.port)) err(errors, "producer", `artifactCatalog.artifacts[${index}].producer`, "must reference a declared node output port");
    const producingTasks = tasks.filter((task) => list(task.outputs).some((out) => out.artifact_contract_ref === contract.artifact_contract_id));
    if (producingTasks.length !== 1 || producingTasks[0]?.node_id !== contract?.producer?.node_id) err(errors, "producer", `artifactCatalog.artifacts[${index}]`, "must have exactly one matching task producer");
    const actualConsumers = edges.filter((edge) => edge.kind === "data" && edge.artifact_contract_ref === contract.artifact_contract_id).map((edge) => `${edge.to.node_id}:${edge.to.port}`).sort();
    const declaredConsumers = list(contract.consumers).map((consumer) => `${consumer.node_id}:${consumer.port}`).sort();
    if (stableStringify(actualConsumers) !== stableStringify(declaredConsumers)) err(errors, "consumer", `artifactCatalog.artifacts[${index}].consumers`, "must exactly match data edges");
    if (actualConsumers.length === 0 && contract.purpose !== "evidence" && !terminal.has(contract.artifact_contract_id)) err(errors, "orphan_artifact", `artifactCatalog.artifacts[${index}]`, "unconsumed non-evidence artifact must be a terminal output");
    if (terminal.has(contract.artifact_contract_id)) terminalProducers.add(contract?.producer?.node_id);
  }
  for (const terminalId of terminal) if (!contractMap.has(terminalId)) err(errors, "unknown_ref", "graphPlan.terminal_outputs", `unknown terminal artifact ${terminalId}`);

  const topology = topo(nodes, edges, errors);
  if (topology.order.length === nodes.length) {
    for (const node of nodes) {
      if (![...terminalProducers].some((producer) => reachable(node.node_id, producer, topology.outgoing))) err(errors, "orphan_node", `graphPlan.nodes.${node.node_id}`, "does not contribute to a terminal output");
    }
    for (let left = 0; left < nodes.length; left++) for (let right = left + 1; right < nodes.length; right++) {
      const a = nodes[left]; const b = nodes[right];
      if (reachable(a.node_id, b.node_id, topology.outgoing) || reachable(b.node_id, a.node_id, topology.outgoing)) continue;
      const aTask = taskMap.get(a.task_ref); const bTask = taskMap.get(b.task_ref);
      const writeConflict = list(aTask?.owned_scopes).some((x) => list(bTask?.owned_scopes).some((y) => scopesOverlap(x, y)));
      const effectConflict = list(aTask?.allowed_external_effects).some((x) => list(bTask?.allowed_external_effects).some((y) => scopesOverlap(x, y)));
      if (writeConflict || effectConflict) err(errors, "parallel_conflict", `graphPlan.nodes.${a.node_id},${b.node_id}`, "unordered nodes have overlapping write or external-effect scopes");
    }
  }

  const validationCoverage = new Set();
  for (const task of tasks) if (roleMap.get(task.agent_type_id)?.validator) {
    for (const feature of list(task.validation_brief?.feature_points)) validationCoverage.add(`feature:${feature.id}:${feature.expected_behavior}`);
    for (const module of list(task.validation_brief?.modules)) validationCoverage.add(`module:${module.name}:${list(module.paths).slice().sort().join("|")}`);
  }
  for (const task of tasks) if (!roleMap.get(task.agent_type_id)?.validator) {
    for (const feature of list(task.feature_points)) if (!validationCoverage.has(`feature:${feature.id}:${feature.expected_behavior}`)) err(errors, "validator_coverage", `tasks.${task.task_id}.feature_points.${feature.id}`, "is not covered exactly by an independent validator");
    for (const module of list(task.modules)) if (!validationCoverage.has(`module:${module.name}:${list(module.paths).slice().sort().join("|")}`)) err(errors, "validator_coverage", `tasks.${task.task_id}.modules.${module.name}`, "is not covered exactly by an independent validator");
  }

  let summary = null;
  try { summary = deriveSummary(bundle, topology.waves); } catch (error) { err(errors, "summary", "graphPlan.summary", error.message); }
  if (plan.summary && summary && stableStringify(plan.summary) !== stableStringify(summary)) err(errors, "summary", "graphPlan.summary", "must equal the compiler-derived summary");
  const hash = computePlanHash(bundle);
  if (plan.plan_hash && plan.plan_hash !== hash) err(errors, "hash", "graphPlan.plan_hash", "does not match canonical contract hash");
  if (requireApproval) validateApproval(bundle, hash, errors);
  return { valid: errors.length === 0, errors, hash, summary, topology };
}

function validateApproval(bundle, hash, errors) {
  const approval = bundle.approval;
  if (!approvalMatches(approval, { ...bundle.graphPlan, plan_hash: hash })) {
    err(errors, "approval", "approval", "exact plan id, version, hash and capacity are not approved");
    return;
  }
  const plannedEffects = new Set(bundle.tasks.flatMap((task) => list(task.allowed_external_effects)));
  const approvedEffects = new Set(list(approval.approved_external_effects));
  for (const effect of plannedEffects) if (!approvedEffects.has(effect)) err(errors, "approval_scope", "approval.approved_external_effects", `missing planned effect ${effect}`);
  const plannedExceptions = [];
  for (const task of bundle.tasks) for (const [gate, contract] of Object.entries(task.self_validation ?? {})) {
    if (contract?.mode === "equivalent") plannedExceptions.push(`${task.task_id}:${gate}:${contract.reason}`);
  }
  const approvedExceptions = new Set(list(approval.approved_validation_exceptions).map((item) => `${item.task_id}:${item.gate}:${item.reason}`));
  for (const exception of plannedExceptions) if (!approvedExceptions.has(exception)) err(errors, "approval_scope", "approval.approved_validation_exceptions", `missing planned exception ${exception}`);
}

function validateValidatorBrief(task, at, errors) {
  const brief = task.validation_brief;
  if (!isObject(brief)) return err(errors, "validator_brief", `${at}.validation_brief`, "validator tasks require a fact-only validation brief");
  const allowed = new Set(["validation_id", "feature_points", "modules", "authoritative_input_refs", "artifact_refs", "verification_steps", "boundary_checks"]);
  for (const key of Object.keys(brief)) if (!allowed.has(key)) err(errors, "validator_bias", `${at}.validation_brief.${key}`, "field is not permitted in a fact-only validator brief");
  if (!isNonEmpty(brief.validation_id)) err(errors, "required", `${at}.validation_brief.validation_id`, "is required");
  for (const [index, feature] of list(brief.feature_points).entries()) {
    if (!isNonEmpty(feature?.id) || !isNonEmpty(feature?.expected_behavior)) err(errors, "required", `${at}.validation_brief.feature_points[${index}]`, "requires id and expected_behavior");
    for (const key of Object.keys(feature ?? {})) if (!["id", "expected_behavior"].includes(key)) err(errors, "validator_bias", `${at}.validation_brief.feature_points[${index}].${key}`, "field is not permitted");
  }
  for (const [index, module] of list(brief.modules).entries()) {
    if (!isNonEmpty(module?.name) || !Array.isArray(module?.paths)) err(errors, "required", `${at}.validation_brief.modules[${index}]`, "requires name and paths");
    for (const key of Object.keys(module ?? {})) if (!["name", "paths"].includes(key)) err(errors, "validator_bias", `${at}.validation_brief.modules[${index}].${key}`, "field is not permitted");
  }
  for (const key of ["authoritative_input_refs", "artifact_refs", "verification_steps", "boundary_checks"]) if (!Array.isArray(brief[key])) err(errors, "required", `${at}.validation_brief.${key}`, "must be an array");
  if (Array.isArray(brief.boundary_checks) && brief.boundary_checks.length === 0) err(errors, "boundary_coverage", `${at}.validation_brief.boundary_checks`, "must declare at least one independently generated boundary or invariant check");
  const categories = new Set(["partition", "boundary", "precision", "overflow", "ordering", "determinism", "idempotence", "equivalence", "concurrency", "resource", "security", "compatibility"]);
  for (const [index, check] of list(brief.boundary_checks).entries()) {
    const checkAt = `${at}.validation_brief.boundary_checks[${index}]`;
    for (const key of Object.keys(check ?? {})) if (!["id", "category", "invariant", "verification_steps"].includes(key)) err(errors, "validator_bias", `${checkAt}.${key}`, "field is not permitted");
    if (!isNonEmpty(check?.id) || !isNonEmpty(check?.invariant)) err(errors, "required", checkAt, "requires id and invariant");
    if (!categories.has(check?.category)) err(errors, "enum", `${checkAt}.category`, "is not a supported boundary category");
    if (!Array.isArray(check?.verification_steps) || check.verification_steps.length === 0 || check.verification_steps.some((step) => !isNonEmpty(step))) err(errors, "required", `${checkAt}.verification_steps`, "requires at least one reproducible step");
  }
}

export function deriveSummary(bundle, suppliedWaves) {
  const waves = suppliedWaves ?? topo(list(bundle.graphPlan?.nodes), list(bundle.graphPlan?.edges), []).waves;
  const maxWave = Math.max(0, ...waves.map((wave) => wave.length));
  const capacity = effectiveCapacity(bundle.graphPlan.capacity);
  const hasParallel = waves.some((wave) => wave.length > 1);
  const hasSerial = waves.length > 1;
  return {
    agent_role_count: list(bundle.agentTypes?.agent_types).length,
    node_count: list(bundle.graphPlan?.nodes).length,
    edge_count: list(bundle.graphPlan?.edges).length,
    task_count: list(bundle.tasks).length,
    planned_artifact_count: list(bundle.artifactCatalog?.artifacts).length,
    estimated_peak_agents: Math.min(capacity, maxWave > 0 ? maxWave + 1 : 1),
    execution_shape: hasParallel && hasSerial ? "hybrid" : hasParallel ? "parallel" : "serial",
  };
}

export function compileBundle(bundle, options = {}) {
  const result = validateBundle(bundle, options);
  if (!result.valid) throw new ContractError(result.errors);
  return { ...result, bundle };
}

export function approvalMatches(approval, plan) {
  return approval?.status === "approved"
    && approval.plan_id === plan.plan_id
    && approval.plan_version === plan.plan_version
    && approval.plan_hash === plan.plan_hash
    && Number.isInteger(approval.approved_capacity)
    && approval.approved_capacity >= plan.capacity.effective_capacity;
}

export function assertPlanTransition(from, to) {
  if (!PLAN_TRANSITIONS[from]?.includes(to)) throw new Error(`illegal plan transition: ${from} -> ${to}`);
}

export function assertNodeTransition(from, to) {
  if (!NODE_TRANSITIONS[from]?.includes(to)) throw new Error(`illegal node transition: ${from} -> ${to}`);
}

export function createExecutionState(compiled) {
  return {
    schema_version: SCHEMA_VERSION,
    execution_run_id: `${compiled.bundle.graphPlan.plan_id}-v${compiled.bundle.graphPlan.plan_version}`,
    plan_status: "awaiting_user_approval",
    plan_hash: compiled.hash,
    nodes: Object.fromEntries(compiled.bundle.graphPlan.nodes.map((node) => [node.node_id, { status: "blocked", attempt: 0 }])),
  };
}

export function readyNodeIds(compiled, state, approval, artifactRegistry = { artifacts: [] }) {
  const plan = { ...compiled.bundle.graphPlan, plan_hash: compiled.hash };
  if (!approvalMatches(approval, plan)) return [];
  const acceptedArtifacts = new Set(list(artifactRegistry.artifacts).filter((artifact) => artifact.status === "accepted").map((artifact) => artifact.artifact_contract_id));
  const predecessors = new Map(plan.nodes.map((node) => [node.node_id, []]));
  for (const edge of plan.edges) predecessors.get(edge.to.node_id)?.push(edge);
  return compiled.topology.order.filter((nodeId) => {
    if (!["blocked", "failed", "stale"].includes(state.nodes?.[nodeId]?.status)) return false;
    return predecessors.get(nodeId).every((edge) => {
      const upstream = state.nodes?.[edge.from.node_id]?.status;
      return ["accepted", "integrated"].includes(upstream)
        && (edge.kind !== "data" || acceptedArtifacts.has(edge.artifact_contract_ref));
    });
  });
}

export function markReadyNodes(compiled, state, approval, artifactRegistry = { artifacts: [] }) {
  const ready = readyNodeIds(compiled, state, approval, artifactRegistry);
  for (const nodeId of ready) {
    assertNodeTransition(state.nodes[nodeId].status, "ready");
    state.nodes[nodeId].status = "ready";
  }
  if (ready.length && state.plan_status === "awaiting_user_approval") state.plan_status = "approved";
  return ready;
}

export function activateNode(compiled, state, approval, nodeRunRegistry, nodeId, agentInstanceId) {
  const plan = { ...compiled.bundle.graphPlan, plan_hash: compiled.hash };
  if (!approvalMatches(approval, plan) || state.plan_hash !== compiled.hash) throw new Error("matching plan approval is required before activation");
  if (state.nodes?.[nodeId]?.status !== "ready") throw new Error(`${nodeId} is not ready`);
  if (!isNonEmpty(agentInstanceId)) throw new Error("agent instance id is required");
  const coordinator = nodeRunRegistry.coordinator_agent_instance_id;
  if (!isNonEmpty(coordinator)) throw new Error("node run registry must identify the coordinator agent");
  const active = new Set(list(nodeRunRegistry.entries).filter((run) => run.status === "active").map((run) => run.agent_instance_id));
  active.add(coordinator);
  active.add(agentInstanceId);
  if (active.size > plan.capacity.effective_capacity) throw new Error("activation would exceed effective agent capacity");
  assertNodeTransition("ready", "active");
  const attempt = state.nodes[nodeId].attempt + 1;
  state.nodes[nodeId] = { status: "active", attempt };
  state.plan_status = "running";
  const node = plan.nodes.find((item) => item.node_id === nodeId);
  const entry = {
    node_run_id: `${state.execution_run_id}-${nodeId}-a${attempt}`,
    node_id: nodeId,
    attempt,
    agent_instance_id: agentInstanceId,
    agent_type_id: node.agent_type_id,
    status: "active",
    input_artifacts: [], output_artifacts: [], self_checks: [],
  };
  nodeRunRegistry.entries.push(entry);
  return entry;
}

export function validateRuntimeRegistries(compiled, artifactRegistry, nodeRunRegistry) {
  const errors = [];
  const contractMap = new Map(compiled.bundle.artifactCatalog.artifacts.map((item) => [item.artifact_contract_id, item]));
  const contracts = new Set(contractMap.keys());
  const nodeMap = new Map(compiled.bundle.graphPlan.nodes.map((item) => [item.node_id, item]));
  const nodeRuns = byId(list(nodeRunRegistry?.entries), "node_run_id", errors, "nodeRunRegistry.entries");
  const versions = new Set();
  for (const [index, artifact] of list(artifactRegistry?.artifacts).entries()) {
    if (!contracts.has(artifact.artifact_contract_id)) err(errors, "unknown_ref", `artifactRegistry.artifacts[${index}].artifact_contract_id`, "unknown contract");
    if (!nodeRuns.has(artifact?.producer?.node_run_id)) err(errors, "unknown_ref", `artifactRegistry.artifacts[${index}].producer.node_run_id`, "unknown node run");
    const run = nodeRuns.get(artifact?.producer?.node_run_id);
    const contract = contractMap.get(artifact.artifact_contract_id);
    if (run && (run.node_id !== artifact?.producer?.node_id || run.attempt !== artifact?.producer?.attempt || run.agent_instance_id !== artifact?.producer?.agent_instance_id)) err(errors, "provenance", `artifactRegistry.artifacts[${index}].producer`, "must match the producing node run");
    if (contract && contract.producer.node_id !== artifact?.producer?.node_id) err(errors, "provenance", `artifactRegistry.artifacts[${index}].producer.node_id`, "must match the artifact contract producer");
    if (!isNonEmpty(artifact.digest) || !artifact.digest.startsWith("sha256:")) err(errors, "digest", `artifactRegistry.artifacts[${index}].digest`, "sha256 digest required");
    const key = `${artifact.artifact_contract_id}@${artifact.artifact_version}`;
    if (versions.has(key)) err(errors, "duplicate_version", `artifactRegistry.artifacts[${index}]`, `duplicate ${key}`);
    versions.add(key);
  }
  const attemptKeys = new Set();
  for (const [index, run] of list(nodeRunRegistry?.entries).entries()) {
    const node = nodeMap.get(run.node_id);
    if (!node) err(errors, "unknown_ref", `nodeRunRegistry.entries[${index}].node_id`, "unknown node");
    else if (node.agent_type_id !== run.agent_type_id) err(errors, "provenance", `nodeRunRegistry.entries[${index}].agent_type_id`, "must match node agent type");
    const attemptKey = `${run.node_id}@${run.attempt}`;
    if (attemptKeys.has(attemptKey)) err(errors, "duplicate_attempt", `nodeRunRegistry.entries[${index}]`, `duplicate ${attemptKey}`);
    attemptKeys.add(attemptKey);
  }
  const artifactsByContract = new Map(list(artifactRegistry?.artifacts).map((artifact) => [artifact.artifact_contract_id, artifact]));
  for (const run of list(nodeRunRegistry?.entries)) {
    const node = nodeMap.get(run.node_id);
    if (node?.node_type !== "validation") continue;
    const task = compiled.bundle.tasks.find((item) => item.task_id === node.task_ref);
    for (const artifactRef of list(task?.validation_brief?.artifact_refs)) {
      const producer = artifactsByContract.get(artifactRef)?.producer;
      if (producer?.agent_instance_id === run.agent_instance_id) err(errors, "validator_independence", `nodeRunRegistry.${run.node_run_id}`, `validator also produced ${artifactRef}`);
    }
  }
  const activeAgents = new Set(list(nodeRunRegistry?.entries).filter((run) => run.status === "active").map((run) => run.agent_instance_id));
  activeAgents.add(nodeRunRegistry?.coordinator_agent_instance_id ?? "__coordinator__");
  const capacity = compiled.bundle.graphPlan.capacity.effective_capacity;
  if (activeAgents.size > capacity) err(errors, "capacity", "nodeRunRegistry.entries", "active agents including coordinator exceed effective capacity");
  return { valid: errors.length === 0, errors };
}

export function assertNodeSubmission(task, nodeRun, artifactRegistry) {
  const checks = new Map(list(nodeRun.self_checks).map((check) => [check.gate, check]));
  for (const gate of ["test_gate", "lint_gate"]) {
    const check = checks.get(gate);
    if (check?.status !== "passed" || !isNonEmpty(check.evidence_ref)) throw new Error(`${gate} has not passed with evidence`);
  }
  const artifacts = list(artifactRegistry.artifacts);
  for (const output of task.outputs) {
    if (!artifacts.some((item) => item.artifact_contract_id === output.artifact_contract_ref && item.producer?.node_run_id === nodeRun.node_run_id && ["submitted", "accepted"].includes(item.status))) {
      throw new Error(`missing submitted output ${output.artifact_contract_ref}`);
    }
  }
}

export function staleDescendants(compiled, state, changedNodeId) {
  const descendants = [];
  const pending = [...(compiled.topology.outgoing.get(changedNodeId) ?? [])];
  const seen = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (seen.has(id)) continue;
    seen.add(id); descendants.push(id);
    pending.push(...(compiled.topology.outgoing.get(id) ?? []));
  }
  for (const id of descendants) if (!["skipped", "cancelled"].includes(state.nodes[id].status)) state.nodes[id].status = "stale";
  return descendants;
}

export function invalidateArtifactDescendants(compiled, state, artifactContractId) {
  const contract = compiled.bundle.artifactCatalog.artifacts.find((item) => item.artifact_contract_id === artifactContractId);
  if (!contract) throw new Error(`unknown artifact contract: ${artifactContractId}`);
  return staleDescendants(compiled, state, contract.producer.node_id);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function loadBundle(directory) {
  const taskDirectory = path.join(directory, "tasks");
  const taskFiles = (await readdir(taskDirectory)).filter((file) => file.endsWith(".json")).sort();
  const tasks = await Promise.all(taskFiles.map((file) => readJson(path.join(taskDirectory, file))));
  const bundle = {
    graphPlan: await readJson(path.join(directory, "graph-plan.json")),
    agentTypes: await readJson(path.join(directory, "agent-types.json")),
    tasks,
    artifactCatalog: await readJson(path.join(directory, "artifacts", "catalog.json")),
  };
  try { bundle.approval = await readJson(path.join(directory, "approval.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return bundle;
}
