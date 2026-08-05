#!/usr/bin/env node
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SnapshotStore } from "./dashboard-state.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8088;
const DEFAULT_FINALIZATION_GRACE_MS = 5_000;
const TERMINAL_PHASES = new Set(["completed", "failed", "cancelled", "rejected", "revoked", "superseded"]);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(scriptDir, "../assets/dashboard");
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/assets/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/assets/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/assets/fonts/NotoSansSC-UI.woff2", ["fonts/NotoSansSC-UI.woff2", "font/woff2"]],
]);

function json(response, status, value, head = false) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  response.end(head ? undefined : body);
}

async function staticAsset(response, pathname, head) {
  const [file, type] = ASSETS.get(pathname);
  const body = await fs.readFile(path.join(assetDir, file));
  response.writeHead(200, { "content-type": type, "cache-control": "no-store", "content-length": body.length });
  response.end(head ? undefined : body);
}

function matchId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export async function createDashboardServer({ runDir, port = DEFAULT_PORT, interval = 600, finalizationGraceMs = DEFAULT_FINALIZATION_GRACE_MS } = {}) {
  if (!runDir) throw new Error("--run-dir is required");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be an integer between 1 and 65535");
  if (!Number.isInteger(finalizationGraceMs) || finalizationGraceMs < 0) throw new Error("finalizationGraceMs must be a non-negative integer");
  const store = new SnapshotStore(runDir, { interval });
  await store.start();
  const clients = new Map();
  let finalization = null;
  let closePromise = null;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const sendEvent = (response, { id, event, data }) => {
    response.write(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const broadcast = (snapshot) => {
    for (const response of clients.keys()) sendEvent(response, { id: snapshot.revision, event: "revision", data: { revision: snapshot.revision, updated_at: snapshot.updated_at } });
  };
  const disconnectClients = () => {
    for (const client of clients.keys()) client.end();
    clients.clear();
  };
  const closeServer = () => {
    if (closePromise) return closePromise;
    store.stop();
    if (finalization?.timer) clearTimeout(finalization.timer);
    for (const response of clients.keys()) sendEvent(response, { event: "shutdown", data: { revision: finalization?.revision ?? store.snapshot?.revision ?? null, phase: finalization?.phase ?? store.snapshot?.phase ?? null, terminal: Boolean(finalization) } });
    disconnectClients();
    closePromise = new Promise((resolve, reject) => {
      if (!server.listening) { resolve(); return; }
      server.close((error) => error ? reject(error) : resolve());
    });
    return closePromise;
  };
  const maybeCloseAfterAcknowledgements = () => {
    if (finalization?.hadAcknowledgableClients && finalization.pending.size === 0 && !finalization.ackCloseScheduled) {
      finalization.ackCloseScheduled = true;
      setTimeout(() => void closeServer(), 25);
    }
  };
  const beginFinalization = (snapshot) => {
    if (finalization || !TERMINAL_PHASES.has(snapshot.phase)) return;
    finalization = {
      revision: snapshot.revision,
      phase: snapshot.phase,
      pending: new Set([...clients.values()].map((client) => client.id).filter(Boolean)),
      hadAcknowledgableClients: [...clients.values()].some((client) => client.id),
      ackCloseScheduled: false,
      timer: setTimeout(() => void closeServer(), finalizationGraceMs),
    };
    for (const response of clients.keys()) sendEvent(response, { id: snapshot.revision, event: "terminal", data: { revision: snapshot.revision, phase: snapshot.phase, grace_ms: finalizationGraceMs } });
    maybeCloseAfterAcknowledgements();
  };
  store.on("revision", (snapshot) => {
    broadcast(snapshot);
    beginFinalization(snapshot);
  });
  store.on("degraded", (error) => {
    for (const response of clients.keys()) sendEvent(response, { event: "degraded", data: { error, revision: store.snapshot?.revision ?? null } });
  });
  const server = http.createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const requestUrl = new URL(request.url ?? "/", `http://${HOST}`);
      const pathname = requestUrl.pathname;
      if (method === "POST" && pathname === "/api/finalization-ack") {
        const clientId = request.headers["x-dashboard-client-id"];
        const revision = Number(request.headers["x-dashboard-revision"]);
        if (!finalization || typeof clientId !== "string" || revision !== finalization.revision || !finalization.pending.has(clientId)) {
          json(response, 409, { acknowledged: false, error: "No matching final snapshot is awaiting acknowledgement" });
          return;
        }
        finalization.pending.delete(clientId);
        json(response, 202, { acknowledged: true, revision });
        maybeCloseAfterAcknowledgements();
        return;
      }
      if (!['GET', 'HEAD'].includes(method)) {
        response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
        response.end("Method Not Allowed");
        return;
      }
      const head = method === "HEAD";
      if (ASSETS.has(pathname)) {
        await staticAsset(response, pathname, head);
        return;
      }
      if (pathname === "/healthz") {
        json(response, 200, store.health(), head);
        return;
      }
      if (pathname === "/api/snapshot") {
        if (!store.snapshot) json(response, 503, { error: store.lastError ?? "Snapshot is not ready" }, head);
        else json(response, 200, { ...store.snapshot, health: store.health() }, head);
        return;
      }
      const taskId = matchId(pathname, "/api/tasks/");
      if (taskId !== null) {
        const value = store.task(taskId);
        json(response, value ? 200 : 404, value ?? { error: "Task not found" }, head);
        return;
      }
      const artifactId = matchId(pathname, "/api/artifacts/");
      if (artifactId !== null) {
        const value = store.artifact(artifactId);
        json(response, value ? 200 : 404, value ?? { error: "Artifact not found" }, head);
        return;
      }
      if (pathname === "/api/events") {
        if (head) {
          response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        response.write(": connected\n\n");
        const clientId = requestUrl.searchParams.get("client_id");
        clients.set(response, { id: clientId });
        if (store.snapshot) {
          sendEvent(response, { id: store.snapshot.revision, event: "revision", data: { revision: store.snapshot.revision, updated_at: store.snapshot.updated_at } });
        }
        if (finalization) {
          if (clientId) {
            finalization.pending.add(clientId);
            finalization.hadAcknowledgableClients = true;
          }
          sendEvent(response, { id: finalization.revision, event: "terminal", data: { revision: finalization.revision, phase: finalization.phase, grace_ms: finalizationGraceMs } });
        }
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(response);
          if (clientId) finalization?.pending.delete(clientId);
          maybeCloseAfterAcknowledgements();
        });
        return;
      }
      json(response, 404, { error: "Not found" }, head);
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.on("close", () => {
    store.stop();
    disconnectClients();
    resolveClosed();
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, HOST, resolve);
    });
  } catch (error) {
    store.stop();
    error.port = port;
    throw error;
  }
  const actualPort = server.address().port;
  return {
    server,
    store,
    host: HOST,
    port: actualPort,
    url: `http://${HOST}:${actualPort}`,
    closed,
    close: closeServer,
  };
}

export function parseArgs(argv) {
  const options = { port: DEFAULT_PORT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run-dir") options.runDir = argv[++index];
    else if (argument === "--port") options.port = Number(argv[++index]);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.help && !options.runDir) throw new Error("--run-dir is required");
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("--port must be an integer between 1 and 65535");
  return options;
}

async function main() {
  let dashboard;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node dashboard-server.mjs --run-dir <path> [--port 8088]\n");
      return;
    }
    dashboard = await createDashboardServer(options);
    const stop = () => void dashboard.close();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    process.stdout.write(`Orchestration dashboard: ${dashboard.url}\n`);
    await dashboard.closed;
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    process.stdout.write("Dashboard stopped after synchronizing the final run snapshot.\n");
  } catch (error) {
    const detail = error?.code === "EADDRINUSE" ? `Port ${error.port ?? DEFAULT_PORT} is already in use; choose another with --port.` : error.message;
    process.stderr.write(`Dashboard failed: ${detail}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
