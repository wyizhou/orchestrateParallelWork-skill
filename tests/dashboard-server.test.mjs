import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createDashboardServer, parseArgs } from "../skills/orchestrate-parallel-work/scripts/dashboard-server.mjs";

async function runFixture() {
  const directory=await mkdtemp(path.join(tmpdir(),"graph-dashboard-http-"));
  await Promise.all(["tasks","artifacts","artifact-payloads"].map((name)=>mkdir(path.join(directory,name))));
  await writeFile(path.join(directory,"graph-plan.json"),JSON.stringify({nodes:[{node_id:"task-1",task_ref:"task-1",agent_type_id:"developer"}],edges:[]}));
  await writeFile(path.join(directory,"state.json"),JSON.stringify({revision:7,phase:"awaiting_user_approval"}));
  await writeFile(path.join(directory,"tasks/task.json"),JSON.stringify({task_id:"task-1",goal:"A <script> stays text"}));
  await writeFile(path.join(directory,"artifacts/catalog.json"),JSON.stringify({artifacts:[{artifact_contract_id:"artifact-1",artifact_type:"report"}]}));
  return directory;
}

test("argument parsing fixes the default port and exposes no host override",()=>{
  assert.deepEqual(parseArgs(["--run-dir","/tmp/run"]),{runDir:"/tmp/run",port:8088});
  assert.deepEqual(parseArgs(["--run-dir","/tmp/run","--port","9000"]),{runDir:"/tmp/run",port:9000});
  assert.throws(()=>parseArgs(["--run-dir","/tmp/run","--host","0.0.0.0"]),/Unknown/);
  assert.throws(()=>parseArgs(["--run-dir","/tmp/run","--port","0"]),/between 1 and 65535/);
});

test("server binds only IPv4 loopback and serves read-only APIs and assets",async(t)=>{
  const directory=await runFixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  const dashboard=await createDashboardServer({runDir:directory,port:0,interval:60_000}); t.after(()=>dashboard.close());
  assert.equal(dashboard.server.address().address,"127.0.0.1");
  const page=await fetch(`${dashboard.url}/`); assert.equal(page.status,200); assert.match(await page.text(),/Orchestrate Parallel Work — Runtime Dashboard/);
  const css=await fetch(`${dashboard.url}/assets/styles.css`); assert.match(await css.text(),/prefers-reduced-motion/);
  const app=await fetch(`${dashboard.url}/assets/app.js`); const appSource=await app.text(); assert.match(appSource,/createElementNS/); assert.match(appSource,/finalization-ack/); assert.match(appSource,/renderRuns/);
  const snapshot=await fetch(`${dashboard.url}/api/snapshot`); assert.equal(snapshot.status,200); assert.equal((await snapshot.json()).revision,7);
  const task=await fetch(`${dashboard.url}/api/tasks/task-1`); assert.equal(task.status,200); assert.equal((await task.json()).task.task_id,"task-1");
  assert.equal((await fetch(`${dashboard.url}/api/artifacts/artifact-1`)).status,200);
  assert.equal((await fetch(`${dashboard.url}/api/tasks/missing`)).status,404);
  assert.equal((await fetch(`${dashboard.url}/api/tasks/%2e%2e%2fstate.json`)).status,404);
  const head=await fetch(`${dashboard.url}/api/snapshot`,{method:"HEAD"}); assert.equal(head.status,200); assert.equal(await head.text(),"");
  const post=await fetch(`${dashboard.url}/api/snapshot`,{method:"POST"}); assert.equal(post.status,405); assert.equal(post.headers.get("allow"),"GET, HEAD");
});

test("snapshot endpoint returns 503 while the first valid graph has not landed",async(t)=>{
  const directory=await mkdtemp(path.join(tmpdir(),"graph-dashboard-wait-")); t.after(()=>rm(directory,{recursive:true,force:true}));
  const dashboard=await createDashboardServer({runDir:directory,port:0,interval:60_000}); t.after(()=>dashboard.close());
  assert.equal((await fetch(`${dashboard.url}/api/snapshot`)).status,503);
  const health=await (await fetch(`${dashboard.url}/healthz`)).json(); assert.equal(health.status,"degraded");
});

test("SSE emits the current revision and a later landed revision",async(t)=>{
  const directory=await runFixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  const dashboard=await createDashboardServer({runDir:directory,port:0,interval:25}); t.after(()=>dashboard.close());
  const controller=new AbortController(); t.after(()=>controller.abort());
  const response=await fetch(`${dashboard.url}/api/events`,{signal:controller.signal});
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let text="";
  while(!text.includes("id: 7")) text+=decoder.decode((await reader.read()).value,{stream:true});
  await writeFile(path.join(directory,"state.json"),JSON.stringify({revision:8,phase:"running"}));
  const deadline=Date.now()+2000;
  while(!text.includes("id: 8")&&Date.now()<deadline) text+=decoder.decode((await reader.read()).value,{stream:true});
  assert.match(text,/event: revision/); assert.match(text,/id: 8/); controller.abort();
});

test("SSE reports a degraded update while retaining the last valid revision",async(t)=>{
  const directory=await runFixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  const dashboard=await createDashboardServer({runDir:directory,port:0,interval:20}); t.after(()=>dashboard.close());
  const controller=new AbortController(); t.after(()=>controller.abort());
  const response=await fetch(`${dashboard.url}/api/events?client_id=degraded-browser`,{signal:controller.signal});
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let text="";
  while(!text.includes("id: 7")) text+=decoder.decode((await reader.read()).value,{stream:true});
  await writeFile(path.join(directory,"state.json"),"{");
  const deadline=Date.now()+2_000;
  while(!text.includes("event: degraded")&&Date.now()<deadline) text+=decoder.decode((await reader.read()).value,{stream:true});
  assert.match(text,/event: degraded/);
  assert.match(text,/"revision":7/);
  assert.equal(dashboard.store.snapshot.revision,7);
  controller.abort();
});

test("terminal revision is rendered, acknowledged, and followed by graceful shutdown",async(t)=>{
  const directory=await runFixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  const dashboard=await createDashboardServer({runDir:directory,port:0,interval:20,finalizationGraceMs:2_000}); t.after(()=>dashboard.close());
  const controller=new AbortController(); t.after(()=>controller.abort());
  const response=await fetch(`${dashboard.url}/api/events?client_id=browser-1`,{signal:controller.signal});
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let stream="";
  while(!stream.includes("id: 7")) stream+=decoder.decode((await reader.read()).value,{stream:true});

  await writeFile(path.join(directory,"state.json"),JSON.stringify({revision:8,phase:"completed",updated_at:"2026-08-04T00:00:00Z"}));
  const terminalDeadline=Date.now()+2_000;
  while(!stream.includes("event: terminal")&&Date.now()<terminalDeadline) stream+=decoder.decode((await reader.read()).value,{stream:true});
  assert.match(stream,/event: terminal/);
  assert.match(stream,/"revision":8/);

  const finalSnapshot=await (await fetch(`${dashboard.url}/api/snapshot`)).json();
  assert.equal(finalSnapshot.revision,8);
  assert.equal(finalSnapshot.phase,"completed");
  const acknowledgement=await fetch(`${dashboard.url}/api/finalization-ack`,{method:"POST",headers:{"x-dashboard-client-id":"browser-1","x-dashboard-revision":"8"}});
  assert.equal(acknowledgement.status,202);
  assert.deepEqual(await acknowledgement.json(),{acknowledged:true,revision:8});

  await Promise.race([dashboard.closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Dashboard did not stop after acknowledgement")),1_000))]);
  assert.equal(dashboard.server.listening,false);
});

test("terminal transition shuts down after the grace period when no browser is connected",async(t)=>{
  const directory=await runFixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  const dashboard=await createDashboardServer({runDir:directory,port:0,interval:20,finalizationGraceMs:60}); t.after(()=>dashboard.close());
  await writeFile(path.join(directory,"state.json"),JSON.stringify({revision:8,phase:"failed"}));
  await Promise.race([dashboard.closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Dashboard did not stop after its grace period")),1_000))]);
  assert.equal(dashboard.store.snapshot.phase,"failed");
  assert.equal(dashboard.store.snapshot.revision,8);
});

test("a dashboard opened for an already-terminal run stays available for retrospective inspection",async(t)=>{
  const directory=await runFixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(path.join(directory,"state.json"),JSON.stringify({revision:8,phase:"completed"}));
  const dashboard=await createDashboardServer({runDir:directory,port:0,interval:20,finalizationGraceMs:40}); t.after(()=>dashboard.close());
  await new Promise((resolve)=>setTimeout(resolve,100));
  assert.equal(dashboard.server.listening,true);
  assert.equal((await fetch(`${dashboard.url}/api/snapshot`)).status,200);
});

test("occupied port fails instead of silently switching ports",async(t)=>{
  const directory=await runFixture(); t.after(()=>rm(directory,{recursive:true,force:true}));
  const blocker=net.createServer(); await new Promise((resolve)=>blocker.listen(0,"127.0.0.1",resolve)); t.after(()=>new Promise((resolve)=>blocker.close(resolve)));
  await assert.rejects(createDashboardServer({runDir:directory,port:blocker.address().port}),error=>error.code==="EADDRINUSE");
});
