import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";

const JSON_LIMIT = 5 * 1024 * 1024;
const EVENT_LIMIT = 200;
const ROOT_FILES = [
  "run.json",
  "state.json",
  "graph-plan.json",
  "agent-types.json",
  "artifacts/catalog.json",
  "artifact-registry.json",
  "node-runs.json",
  "approval.json",
  "events.ndjson",
];
const COLLECTIONS = ["tasks", "artifact-payloads"];

async function readText(file) {
  const stat = await fs.stat(file);
  if (stat.size > JSON_LIMIT) throw new Error(`${path.basename(file)} exceeds the 5 MiB dashboard limit`);
  return fs.readFile(file, "utf8");
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readText(file));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`Cannot read ${path.basename(file)}: ${error.message}`);
  }
}

async function readCollection(runDir, name) {
  const directory = path.join(runDir, name);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const values = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    const value = await readJson(path.join(directory, entry.name));
    if (value && typeof value === "object") values.push(value);
  }
  return values;
}

async function readEvents(file) {
  let text;
  try {
    text = await readText(file);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const lines = text.split("\n");
  const events = [];
  for (const line of lines.filter(Boolean).slice(-EVENT_LIMIT)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // This also ignores a partially appended final line.
    }
  }
  return events;
}

function arrayValue(value, ...keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function idOf(value, ...keys) {
  for (const key of keys) if (value?.[key] !== undefined) return String(value[key]);
  return "";
}

export function deriveEdgeStatus(edge, nodesById, artifactsById) {
  const sourceId = String(edge.from?.node_id ?? edge.from?.node ?? edge.from ?? "");
  const targetId = String(edge.to?.node_id ?? edge.to?.node ?? edge.to ?? "");
  const artifactId = String(edge.artifact_contract_ref ?? edge.artifact_id ?? edge.artifact ?? edge.from?.output ?? "");
  const source = nodesById.get(sourceId) ?? {};
  const target = nodesById.get(targetId) ?? {};
  const artifact = artifactsById.get(artifactId) ?? {};
  const sourceStatus = source.status ?? "planned";
  const targetStatus = target.status ?? "planned";
  const artifactStatus = artifact.status ?? artifact.state ?? "planned";

  if (artifactStatus === "stale" || sourceStatus === "stale") return "stale";
  if (sourceStatus === "failed" || artifactStatus === "failed") return "failed";
  if (sourceStatus === "active" || sourceStatus === "running") return "producing";
  if (["accepted", "available", "integrated"].includes(artifactStatus) && ["active", "running"].includes(targetStatus)) return "flowing";
  if (["accepted", "available", "integrated"].includes(artifactStatus)) return "delivered";
  if (targetStatus === "blocked") return "blocked";
  return "waiting";
}

function graphIssues(nodes, edges) {
  const issues = [];
  const ids = new Set();
  for (const node of nodes) {
    const id = idOf(node, "id", "node_id");
    if (!id) issues.push("A node has no id");
    else if (ids.has(id)) issues.push(`Duplicate node id: ${id}`);
    ids.add(id);
  }
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, []]));
  for (const edge of edges) {
    const from = String(edge.from?.node_id ?? edge.from?.node ?? edge.from ?? "");
    const to = String(edge.to?.node_id ?? edge.to?.node ?? edge.to ?? "");
    if (!ids.has(from) || !ids.has(to)) {
      issues.push(`Dangling edge: ${from || "?"} -> ${to || "?"}`);
      continue;
    }
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (ids.size && visited !== ids.size) issues.push("Graph contains a cycle");
  return issues;
}

async function signature(runDir) {
  const parts = [];
  for (const name of ROOT_FILES) {
    try {
      const stat = await fs.stat(path.join(runDir, name));
      parts.push(`${name}:${stat.size}:${stat.mtimeMs}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  for (const name of COLLECTIONS) {
    const directory = path.join(runDir, name);
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
        const stat = await fs.stat(path.join(directory, entry.name));
        parts.push(`${name}/${entry.name}:${stat.size}:${stat.mtimeMs}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return parts.join("|");
}

export async function loadSnapshot(runDir) {
  const graph = await readJson(path.join(runDir, "graph-plan.json"));
  if (!graph) throw new Error("graph-plan.json has not landed yet");
  const [run, state, agentTypesRaw, tasks, artifactCatalogRaw, artifactPayloads, registryRaw, nodeRunsRaw, approval, events] = await Promise.all([
    readJson(path.join(runDir, "run.json"), {}),
    readJson(path.join(runDir, "state.json"), {}),
    readJson(path.join(runDir, "agent-types.json"), []),
    readCollection(runDir, "tasks"),
    readJson(path.join(runDir, "artifacts", "catalog.json"), { artifacts: [] }),
    readCollection(runDir, "artifact-payloads"),
    readJson(path.join(runDir, "artifact-registry.json"), []),
    readJson(path.join(runDir, "node-runs.json"), []),
    readJson(path.join(runDir, "approval.json"), {}),
    readEvents(path.join(runDir, "events.ndjson")),
  ]);
  const nodes = arrayValue(graph.nodes);
  const edges = arrayValue(graph.edges);
  const agentTypes = arrayValue(agentTypesRaw, "agent_types", "types");
  const artifactContracts = arrayValue(artifactCatalogRaw, "artifacts", "contracts");
  const registry = arrayValue(registryRaw, "artifacts", "entries");
  const nodeRuns = arrayValue(nodeRunsRaw, "entries", "node_runs", "runs");
  const runsByNode = new Map(nodeRuns.map((item) => [idOf(item, "node_id", "task_id", "id"), item]));
  const normalizedNodes = nodes.map((node) => {
    const runRecord = runsByNode.get(idOf(node, "id", "node_id")) ?? {};
    const checks = new Map(arrayValue(runRecord.self_checks).map((check) => [check.gate, check.status]));
    return {
      ...node,
      id: idOf(node, "id", "node_id"),
      status: runRecord.status ?? node.status ?? "planned",
      test_status: runRecord.test_status ?? checks.get("test_gate") ?? runRecord.validation?.tests?.status ?? node.test_status,
      lint_status: runRecord.lint_status ?? checks.get("lint_gate") ?? runRecord.validation?.lint?.status ?? node.lint_status,
      validator_status: runRecord.validator_status ?? runRecord.validation?.validator?.status ?? node.validator_status,
    };
  });
  const nodesById = new Map(normalizedNodes.map((node) => [node.id, node]));
  const artifactsById = new Map();
  for (const item of [...artifactContracts, ...registry, ...artifactPayloads]) {
    const id = idOf(item, "artifact_contract_id", "artifact_id", "id");
    if (id) artifactsById.set(id, { ...(artifactsById.get(id) ?? {}), ...item });
  }
  const normalizedEdges = edges.map((edge, index) => ({
    ...edge,
    id: idOf(edge, "edge_id", "id") || `edge-${index + 1}`,
    status: deriveEdgeStatus(edge, nodesById, artifactsById),
  }));
  const platformCapacity = Number(graph.capacity?.runtime_limit ?? run.platform_capacity ?? state.platform_capacity);
  const permissionCapacity = Number(graph.capacity?.permission_limit ?? run.permission_capacity ?? state.permission_capacity);
  const capacityKnown = Number.isInteger(platformCapacity) && platformCapacity > 0 && Number.isInteger(permissionCapacity) && permissionCapacity > 0;
  const effectiveCapacity = capacityKnown ? Math.min(15, platformCapacity, permissionCapacity) : null;
  const activeAgentIds = new Set(nodeRuns.filter((item) => item.status === "active").map((item) => item.agent_instance_id).filter(Boolean));
  if (nodeRunsRaw?.coordinator_agent_instance_id) activeAgentIds.add(nodeRunsRaw.coordinator_agent_instance_id);
  return {
    revision: state.revision ?? run.revision ?? 0,
    updated_at: state.updated_at ?? run.updated_at ?? null,
    phase: state.phase ?? run.phase ?? "draft",
    run,
    state,
    approval,
    capacity: { hard_limit: 15, platform: platformCapacity, permission: permissionCapacity, effective: effectiveCapacity },
    counts: {
      agent_roles: agentTypes.length,
      agent_instances: activeAgentIds.size,
      nodes: normalizedNodes.length,
      edges: normalizedEdges.length,
      tasks: tasks.length,
      planned_artifacts: artifactContracts.length,
      generated_artifacts: registry.filter((item) => ["accepted", "available", "integrated"].includes(item.status ?? "accepted")).length,
    },
    agent_types: agentTypes,
    graph: { ...graph, nodes: normalizedNodes, edges: normalizedEdges },
    tasks,
    artifact_contracts: artifactContracts,
    artifact_registry: registry,
    artifacts: artifactPayloads,
    node_runs: nodeRuns,
    events,
    issues: graphIssues(normalizedNodes, normalizedEdges),
  };
}

export class SnapshotStore extends EventEmitter {
  constructor(runDir, { interval = 600 } = {}) {
    super();
    this.runDir = path.resolve(runDir);
    this.interval = interval;
    this.snapshot = null;
    this.lastError = null;
    this.lastSignature = null;
    this.timer = null;
    this.refreshing = null;
  }

  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const currentSignature = await signature(this.runDir);
        if (this.snapshot && currentSignature === this.lastSignature) return false;
        let loaded;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const before = await signature(this.runDir);
          loaded = await loadSnapshot(this.runDir);
          const after = await signature(this.runDir);
          if (before === after) {
            this.lastSignature = after;
            break;
          }
          if (attempt === 2) throw new Error("Run files changed repeatedly while creating a snapshot");
        }
        this.snapshot = loaded;
        this.lastError = null;
        this.emit("revision", loaded);
        return true;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emit("degraded", this.lastError);
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.interval);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  health() {
    return {
      status: this.lastError ? "degraded" : this.snapshot ? "ok" : "waiting",
      revision: this.snapshot?.revision ?? null,
      last_error: this.lastError,
    };
  }

  task(id) {
    const task = this.snapshot?.tasks.find((item) => idOf(item, "task_id", "id") === id);
    if (!task) return null;
    const nodeId = idOf(task, "node_id", "task_id", "id");
    return {
      task,
      node_run: this.snapshot.node_runs.find((item) => idOf(item, "node_id", "task_id", "id") === nodeId) ?? null,
      inputs: task.inputs ?? task.input ?? [],
      outputs: task.outputs ?? task.output ?? [],
    };
  }

  artifact(id) {
    const registry = this.snapshot?.artifact_registry.find((item) => [idOf(item, "artifact_id", "id"), idOf(item, "artifact_contract_id")].includes(id)) ?? null;
    const contractId = registry?.artifact_contract_id ?? id;
    const contract = this.snapshot?.artifact_contracts.find((item) => idOf(item, "artifact_contract_id", "artifact_id", "id") === contractId) ?? null;
    const payload = this.snapshot?.artifacts.find((item) => [idOf(item, "artifact_id", "id"), idOf(item, "artifact_contract_id")].includes(id)) ?? null;
    return contract || registry || payload ? { contract, registry, payload } : null;
  }
}
