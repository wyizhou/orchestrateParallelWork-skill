#!/usr/bin/env node
import { closeSync, openSync } from "node:fs";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8088;
const START_TIMEOUT_MS = 8_000;
const STOP_TIMEOUT_MS = 5_000;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(scriptDir, "dashboard-server.mjs");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function runtimePath(runDir) { return path.join(runDir, "dashboard-runtime.json"); }
function logPath(runDir) { return path.join(runDir, "dashboard.log"); }

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.next`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(700) });
    if (!response.ok) return null;
    return response.json();
  } catch { return null; }
}

export async function dashboardStatus(runDirectory) {
  const runDir = path.resolve(runDirectory);
  const runtime = await readJson(runtimePath(runDir));
  if (!runtime) return { configured: false, running: false, run_dir: runDir };
  const graph = await readJson(path.join(runDir, "graph-plan.json"), {});
  const [health, snapshot] = await Promise.all([fetchJson(`${runtime.url}/healthz`), fetchJson(`${runtime.url}/api/snapshot`)]);
  const pidAlive = processExists(runtime.pid);
  const identityMatches = Boolean(snapshot && (!graph.plan_id || snapshot.graph?.plan_id === graph.plan_id));
  return {
    configured: true,
    running: pidAlive && Boolean(health) && identityMatches,
    pid_alive: pidAlive,
    health: health?.status ?? "unreachable",
    identity_matches: identityMatches,
    run_dir: runDir,
    pid: runtime.pid,
    host: runtime.host,
    port: runtime.port,
    url: runtime.url,
    log_path: runtime.log_path,
    started_at: runtime.started_at,
    stopped_at: runtime.stopped_at ?? null,
  };
}

async function waitFor(runDir, predicate, timeout) {
  const deadline = Date.now() + timeout;
  let status;
  do {
    status = await dashboardStatus(runDir);
    if (predicate(status)) return status;
    await delay(80);
  } while (Date.now() < deadline);
  return status;
}

export async function startDashboard({ runDir: runDirectory, port = DEFAULT_PORT } = {}) {
  if (!runDirectory) throw new Error("--run-dir is required");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer between 1 and 65535");
  const runDir = path.resolve(runDirectory);
  const graph = await readJson(path.join(runDir, "graph-plan.json"));
  if (!graph) throw new Error("graph-plan.json must exist before starting the Dashboard");
  const current = await dashboardStatus(runDir);
  if (current.running) return { ...current, already_running: true };

  const output = openSync(logPath(runDir), "a");
  const child = spawn(process.execPath, [serverScript, "--run-dir", runDir, "--port", String(port)], {
    cwd: runDir,
    detached: true,
    stdio: ["ignore", output, output],
  });
  child.unref();
  closeSync(output);
  const runtime = {
    schema_version: "1.0",
    pid: child.pid,
    host: HOST,
    port,
    url: `http://${HOST}:${port}`,
    run_dir: runDir,
    log_path: logPath(runDir),
    started_at: new Date().toISOString(),
  };
  await writeJsonAtomic(runtimePath(runDir), runtime);
  const status = await waitFor(runDir, (value) => value.running, START_TIMEOUT_MS);
  if (!status?.running) {
    if (processExists(child.pid)) process.kill(child.pid, "SIGTERM");
    const log = await fs.readFile(logPath(runDir), "utf8").catch(() => "");
    throw new Error(`Dashboard did not become healthy on ${runtime.url}${log ? `: ${log.trim().split("\n").at(-1)}` : ""}`);
  }
  return { ...status, already_running: false };
}

export async function stopDashboard(runDirectory) {
  const runDir = path.resolve(runDirectory);
  const status = await dashboardStatus(runDir);
  if (!status.configured) return status;
  if (!status.running) return { ...status, stopped: true, already_stopped: true };
  process.kill(status.pid, "SIGTERM");
  const stopped = await waitFor(runDir, (value) => !value.running && value.health === "unreachable", STOP_TIMEOUT_MS);
  if (stopped?.running || stopped?.health !== "unreachable") throw new Error(`Dashboard service ${status.pid} did not stop`);
  const runtime = await readJson(runtimePath(runDir), {});
  await writeJsonAtomic(runtimePath(runDir), { ...runtime, stopped_at: new Date().toISOString() });
  return { ...(await dashboardStatus(runDir)), stopped: true, already_stopped: false };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, port: DEFAULT_PORT };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--run-dir") options.runDir = rest[++index];
    else if (argument === "--port") options.port = Number(rest[++index]);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (!['start', 'status', 'stop'].includes(command)) throw new Error("command must be start, status, or stop");
  if (!options.runDir) throw new Error("--run-dir is required");
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("--port must be an integer between 1 and 65535");
  return options;
}

function usage() {
  return "Usage: node dashboardctl.mjs <start|status|stop> --run-dir <path> [--port 8088]";
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(`${usage()}\n`); return; }
    const result = options.command === "start"
      ? await startDashboard(options)
      : options.command === "stop"
        ? await stopDashboard(options.runDir)
        : await dashboardStatus(options.runDir);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (options.command === "status" && !result.running) process.exitCode = 3;
  } catch (error) {
    process.stderr.write(`Dashboard control failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
