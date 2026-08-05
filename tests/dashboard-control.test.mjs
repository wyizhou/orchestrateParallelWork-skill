import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { dashboardStatus, parseArgs } from "../skills/orchestrate-parallel-work/scripts/dashboardctl.mjs";

const execFileAsync = promisify(execFile);
const controller = path.resolve("skills/orchestrate-parallel-work/scripts/dashboardctl.mjs");

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "graph-dashboard-control-"));
  await writeFile(path.join(directory, "graph-plan.json"), JSON.stringify({ plan_id:"control-plan", nodes:[{node_id:"one"}], edges:[] }));
  await writeFile(path.join(directory, "state.json"), JSON.stringify({ revision:1, phase:"running" }));
  return directory;
}

test("dashboard controller parses only lifecycle commands and loopback port options", () => {
  assert.deepEqual(parseArgs(["start","--run-dir","/tmp/run"]),{command:"start",port:8088,runDir:"/tmp/run"});
  assert.deepEqual(parseArgs(["status","--run-dir","/tmp/run","--port","9000"]),{command:"status",port:9000,runDir:"/tmp/run"});
  assert.throws(()=>parseArgs(["restart","--run-dir","/tmp/run"]),/start, status, or stop/);
  assert.throws(()=>parseArgs(["start","--run-dir","/tmp/run","--host","0.0.0.0"]),/Unknown/);
});

test("detached dashboard survives its start command and can be verified and stopped", async (t) => {
  const directory = await fixture();
  const port = await availablePort();
  t.after(async () => {
    await execFileAsync(process.execPath,[controller,"stop","--run-dir",directory]).catch(()=>{});
    await rm(directory,{recursive:true,force:true});
  });

  const started = JSON.parse((await execFileAsync(process.execPath,[controller,"start","--run-dir",directory,"--port",String(port)],{timeout:12_000})).stdout);
  assert.equal(started.running,true);
  assert.equal(started.identity_matches,true);
  assert.equal(started.already_running,false);

  const status = JSON.parse((await execFileAsync(process.execPath,[controller,"status","--run-dir",directory],{timeout:5_000})).stdout);
  assert.equal(status.running,true);
  assert.equal(status.pid,started.pid);
  assert.equal((await (await fetch(`${started.url}/api/snapshot`)).json()).graph.plan_id,"control-plan");

  const stopped = JSON.parse((await execFileAsync(process.execPath,[controller,"stop","--run-dir",directory],{timeout:8_000})).stdout);
  assert.equal(stopped.stopped,true);
  assert.equal(stopped.running,false);
});
