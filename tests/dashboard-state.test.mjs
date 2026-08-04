import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deriveEdgeStatus, loadSnapshot, SnapshotStore } from "../skills/orchestrate-parallel-work/scripts/dashboard-state.mjs";

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "graph-dashboard-"));
  await Promise.all(["tasks", "artifacts", "artifact-payloads"].map((name) => mkdir(path.join(directory, name))));
  await writeFile(path.join(directory, "graph-plan.json"), JSON.stringify({ plan_id:"plan-1", nodes:[{node_id:"build",task_ref:"build",agent_type_id:"developer"},{node_id:"verify",task_ref:"verify",agent_type_id:"validator"}], edges:[{edge_id:"build-verify",from:{node_id:"build",port:"code"},to:{node_id:"verify",port:"code"},artifact_contract_ref:"code-1"}] }));
  await writeFile(path.join(directory, "state.json"), JSON.stringify({ revision:1, phase:"running", platform_capacity:8, permission_capacity:6 }));
  await writeFile(path.join(directory, "agent-types.json"), JSON.stringify({ agent_types:[{agent_type_id:"developer"},{agent_type_id:"validator"}] }));
  await writeFile(path.join(directory, "tasks/build.json"), JSON.stringify({task_id:"build",goal:"Build"}));
  await writeFile(path.join(directory, "tasks/verify.json"), JSON.stringify({task_id:"verify",goal:"Verify"}));
  await writeFile(path.join(directory, "artifacts/catalog.json"), JSON.stringify({artifacts:[{artifact_contract_id:"code-1",artifact_type:"source_code"}]}));
  await writeFile(path.join(directory, "artifact-payloads/code.json"), JSON.stringify({artifact_contract_id:"code-1",files:[{path:"src/a.js"}]}));
  await writeFile(path.join(directory, "artifact-registry.json"), JSON.stringify({artifacts:[{artifact_id:"code-1-v1",artifact_contract_id:"code-1",status:"accepted"}]}));
  await writeFile(path.join(directory, "node-runs.json"), JSON.stringify({coordinator_agent_instance_id:"coordinator",entries:[{node_id:"build",status:"accepted",self_checks:[{gate:"test_gate",status:"passed"},{gate:"lint_gate",status:"passed"}]},{node_id:"verify",status:"active",agent_instance_id:"validator-1"}]}));
  await writeFile(path.join(directory, "events.ndjson"), '{"event_id":"one","type":"started"}\n{"partial":');
  return directory;
}

test("loadSnapshot aggregates landed files, counts capacity, and ignores partial event", async (t) => {
  const directory = await fixture(); t.after(() => rm(directory,{recursive:true,force:true}));
  const value = await loadSnapshot(directory);
  assert.deepEqual(value.counts,{agent_roles:2,agent_instances:2,nodes:2,edges:1,tasks:2,planned_artifacts:1,generated_artifacts:1});
  assert.equal(value.capacity.effective,6);
  assert.equal(value.graph.edges[0].status,"flowing");
  assert.equal(value.graph.nodes[0].test_status,"passed");
  assert.equal(value.graph.nodes[0].lint_status,"passed");
  assert.equal(value.events.length,1);
  assert.deepEqual(value.issues,[]);
});

test("loadSnapshot reports unknown capacity instead of assuming fifteen", async (t) => {
  const directory = await fixture(); t.after(() => rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,"state.json"),JSON.stringify({revision:2,phase:"awaiting_user_approval"}));
  const value = await loadSnapshot(directory);
  assert.equal(value.capacity.effective,null);
});

test("edge status uses deterministic failure and activity precedence", () => {
  const nodes = new Map([["a",{status:"active"}],["b",{status:"running"}]]);
  const artifacts = new Map([["x",{status:"accepted"}]]);
  assert.equal(deriveEdgeStatus({from:{node_id:"a"},to:{node_id:"b"},artifact_contract_ref:"x"},nodes,artifacts),"producing");
  nodes.get("a").status="accepted";
  assert.equal(deriveEdgeStatus({from:{node_id:"a"},to:{node_id:"b"},artifact_contract_ref:"x"},nodes,artifacts),"flowing");
  artifacts.get("x").status="stale";
  assert.equal(deriveEdgeStatus({from:{node_id:"a"},to:{node_id:"b"},artifact_contract_ref:"x"},nodes,artifacts),"stale");
  artifacts.get("x").status="failed";
  assert.equal(deriveEdgeStatus({from:{node_id:"a"},to:{node_id:"b"},artifact_contract_ref:"x"},nodes,artifacts),"failed");
});

test("graph diagnostics expose cycles and dangling edges without rejecting snapshot", async (t) => {
  const directory = await fixture(); t.after(() => rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,"graph-plan.json"),JSON.stringify({nodes:[{id:"a"},{id:"b"}],edges:[{from:"a",to:"b"},{from:"b",to:"a"},{from:"missing",to:"a"}]}));
  const value=await loadSnapshot(directory);
  assert(value.issues.some((issue)=>issue.includes("cycle")));
  assert(value.issues.some((issue)=>issue.includes("Dangling")));
});

test("SnapshotStore retains last-good data when an update is malformed and recovers after atomic rename", async (t) => {
  const directory=await fixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new SnapshotStore(directory,{interval:60_000}); await store.start(); t.after(()=>store.stop());
  assert.equal(store.snapshot.revision,1);
  await writeFile(path.join(directory,"state.json"),"{");
  await store.refresh();
  assert.equal(store.snapshot.revision,1);
  assert.equal(store.health().status,"degraded");
  const temporary=path.join(directory,"state.next.json");
  await writeFile(temporary,JSON.stringify({revision:2,phase:"running"}));
  await rename(temporary,path.join(directory,"state.json"));
  await store.refresh();
  assert.equal(store.snapshot.revision,2);
  assert.equal(store.health().status,"ok");
});

test("missing graph produces waiting/degraded health rather than a fabricated snapshot", async (t) => {
  const directory=await mkdtemp(path.join(tmpdir(),"graph-dashboard-empty-")); t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new SnapshotStore(directory); await store.refresh();
  assert.equal(store.snapshot,null); assert.equal(store.health().status,"degraded"); assert.match(store.lastError,/graph-plan/);
});
