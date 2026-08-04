const $ = (selector) => document.querySelector(selector);
let snapshot;
let polling;

function element(name, attributes = {}, text) {
  const node = document.createElement(name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgElement(name, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function idOf(item, ...keys) {
  for (const key of keys) if (item?.[key] !== undefined) return String(item[key]);
  return "unknown";
}

function openDrawer(title, value) {
  $("#drawer-title").textContent = title;
  $("#drawer-content").textContent = JSON.stringify(value, null, 2);
  $("#drawer").classList.add("open");
}

function cards(target, values, detail) {
  target.replaceChildren();
  const shell = element("div", { class: "cards" });
  for (const value of values) {
    const id = idOf(value, "task_id", "artifact_id", "node_id", "id", "event_id");
    const card = element("button", { class: "card" });
    card.append(element("strong", {}, id), element("small", {}, value.status ?? value.artifact_type ?? value.agent_role ?? value.type ?? ""));
    card.addEventListener("click", () => openDrawer(id, detail(value)));
    shell.append(card);
  }
  target.append(shell);
}

function layout(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const from = String(edge.from?.node_id ?? edge.from?.node ?? edge.from ?? "");
    const to = String(edge.to?.node_id ?? edge.to?.node ?? edge.to ?? "");
    if (ids.has(from) && ids.has(to)) { incoming.set(to, incoming.get(to) + 1); outgoing.get(from).push(to); }
  }
  const levels = new Map();
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  for (const id of queue) levels.set(id, 0);
  while (queue.length) {
    const id = queue.shift();
    for (const target of outgoing.get(id)) {
      levels.set(target, Math.max(levels.get(target) ?? 0, levels.get(id) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  for (const node of nodes) if (!levels.has(node.id)) levels.set(node.id, 0);
  const columns = new Map();
  for (const node of nodes) { const level = levels.get(node.id); if (!columns.has(level)) columns.set(level, []); columns.get(level).push(node.id); }
  const positions = new Map();
  for (const [level, column] of columns) column.forEach((id, row) => positions.set(id, { x: 60 + level * 260, y: 60 + row * 150 }));
  return positions;
}

function drawGraph(graph) {
  const svg = $("#dag");
  svg.replaceChildren();
  const nodes = graph.nodes ?? [], edges = graph.edges ?? [], positions = layout(nodes, edges);
  const width = Math.max(760, ...[...positions.values()].map((p) => p.x + 240));
  const height = Math.max(520, ...[...positions.values()].map((p) => p.y + 130));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const defs = svgElement("defs");
  const marker = svgElement("marker", { id:"arrow", viewBox:"0 0 10 10", refX:"9", refY:"5", markerWidth:"6", markerHeight:"6", orient:"auto-start-reverse" });
  marker.append(svgElement("path", { d:"M 0 0 L 10 5 L 0 10 z", fill:"#64748b" })); defs.append(marker); svg.append(defs);
  for (const edge of edges) {
    const fromId = String(edge.from?.node_id ?? edge.from?.node ?? edge.from ?? ""), toId = String(edge.to?.node_id ?? edge.to?.node ?? edge.to ?? "");
    const from = positions.get(fromId), to = positions.get(toId); if (!from || !to) continue;
    const line = svgElement("path", { class:`edge ${edge.status ?? "waiting"}`, d:`M ${from.x + 180} ${from.y + 42} C ${from.x + 220} ${from.y + 42}, ${to.x - 40} ${to.y + 42}, ${to.x} ${to.y + 42}`, tabindex:"0" });
    line.addEventListener("click", () => {
      const artifactId = String(edge.artifact_contract_ref ?? edge.artifact_id ?? edge.artifact ?? edge.from?.output ?? "");
      const artifact = snapshot.artifact_contracts.find((item) => idOf(item,"artifact_contract_id","artifact_id","id") === artifactId);
      openDrawer(`Edge ${fromId} → ${toId}`, { edge, artifact });
    }); svg.append(line);
  }
  for (const node of nodes) {
    const point = positions.get(node.id), group = svgElement("g", { class:`node ${node.status ?? "planned"}`, transform:`translate(${point.x} ${point.y})`, tabindex:"0", role:"button" });
    group.append(svgElement("rect", { width:"180", height:"84" }), svgElement("text", { x:"14", y:"27" }, node.id), svgElement("text", { x:"14", y:"48", class:"role" }, node.agent_type_id ?? node.agent_type ?? node.agent_role ?? "unassigned"), svgElement("text", { x:"14", y:"69", class:"badge" }, `test:${node.test_status ?? "–"}  lint:${node.lint_status ?? "–"}  validator:${node.validator_status ?? "–"}`));
    const show = () => { const taskId = String(node.task_ref ?? node.task_id ?? node.id); openDrawer(node.id, { node, task: snapshot.tasks.find((task) => idOf(task,"task_id","id") === taskId), run: snapshot.node_runs.find((run) => idOf(run,"node_id","task_id","id") === node.id) }); };
    group.addEventListener("click", show); group.addEventListener("keydown", (event) => { if (["Enter"," "].includes(event.key)) show(); }); svg.append(group);
  }
}

function render(value) {
  snapshot = value;
  const summary = $("#summary"); summary.replaceChildren();
  const metrics = [["Agent roles",value.counts.agent_roles],["Active agents",value.counts.agent_instances],["Nodes",value.counts.nodes],["Edges",value.counts.edges],["Tasks",value.counts.tasks],["Planned artifacts",value.counts.planned_artifacts],["Generated artifacts",value.counts.generated_artifacts],["Capacity",value.capacity.effective === null ? "unknown" : `${value.capacity.effective}/15`],["Phase",value.phase]];
  for (const [label, metric] of metrics) { const card=element("div",{class:"metric"}); card.append(element("strong",{},metric),element("span",{},label)); summary.append(card); }
  drawGraph(value.graph);
  cards($("#tasks"), value.tasks, (item) => item);
  const artifactIds = new Set([...value.artifact_contracts, ...value.artifact_registry, ...value.artifacts].map((item) => idOf(item,"artifact_contract_id","artifact_id","id")));
  const artifacts = [...artifactIds].map((id) => ({
    ...(value.artifact_contracts.find((item) => idOf(item,"artifact_contract_id","artifact_id","id")===id) ?? {}),
    artifact_id:id,
    registry:value.artifact_registry.find((item) => idOf(item,"artifact_contract_id","artifact_id","id")===id) ?? null,
    payload:value.artifacts.find((item) => idOf(item,"artifact_contract_id","artifact_id","id")===id) ?? null,
  }));
  cards($("#artifacts"), artifacts, (item) => item);
  cards($("#runs"), value.node_runs, (item) => item);
  cards($("#events"), value.events, (item) => item);
  const notice = $("#notice"); const messages = [...(value.issues ?? []), value.health?.last_error].filter(Boolean); notice.textContent = messages.join(" · "); notice.classList.toggle("show", messages.length > 0);
}

async function refresh() {
  try {
    const response = await fetch("/api/snapshot", { cache:"no-store" });
    if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
    render(await response.json()); $("#connection").textContent="Live"; $("#connection").classList.add("live");
  } catch (error) { $("#connection").textContent="Waiting"; $("#connection").classList.remove("live"); $("#notice").textContent=error.message; $("#notice").classList.add("show"); }
}

function startPolling() { if (!polling) polling=setInterval(refresh,2000); }
function stopPolling() { if (polling) clearInterval(polling); polling=undefined; }
const events = new EventSource("/api/events");
events.addEventListener("revision", () => { stopPolling(); void refresh(); });
events.onopen = () => { stopPolling(); $("#connection").classList.add("live"); };
events.onerror = () => { $("#connection").textContent="Reconnecting"; $("#connection").classList.remove("live"); startPolling(); };
document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("nav button,.view").forEach((item)=>item.classList.remove("active")); button.classList.add("active"); $(`#${button.dataset.view}`).classList.add("active"); }));
$("#close-drawer").addEventListener("click",()=>$("#drawer").classList.remove("open"));
void refresh();
