#!/usr/bin/env node
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SnapshotStore } from "./dashboard-state.mjs";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8088;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(scriptDir, "../assets/dashboard");
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/assets/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/assets/styles.css", ["styles.css", "text/css; charset=utf-8"]],
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

export async function createDashboardServer({ runDir, port = DEFAULT_PORT, interval = 600 } = {}) {
  if (!runDir) throw new Error("--run-dir is required");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be an integer between 1 and 65535");
  const store = new SnapshotStore(runDir, { interval });
  await store.start();
  const clients = new Set();
  const broadcast = (snapshot) => {
    const payload = `id: ${snapshot.revision}\nevent: revision\ndata: ${JSON.stringify({ revision: snapshot.revision, updated_at: snapshot.updated_at })}\n\n`;
    for (const client of clients) client.write(payload);
  };
  store.on("revision", broadcast);
  const server = http.createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      if (!['GET', 'HEAD'].includes(method)) {
        response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
        response.end("Method Not Allowed");
        return;
      }
      const pathname = new URL(request.url ?? "/", `http://${HOST}`).pathname;
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
        clients.add(response);
        if (store.snapshot) {
          response.write(`id: ${store.snapshot.revision}\nevent: revision\ndata: ${JSON.stringify({ revision: store.snapshot.revision, updated_at: store.snapshot.updated_at })}\n\n`);
        }
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          clients.delete(response);
        });
        return;
      }
      json(response, 404, { error: "Not found" }, head);
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  const disconnectClients = () => {
    for (const client of clients) client.end();
    clients.clear();
  };
  server.on("close", () => {
    store.stop();
    disconnectClients();
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
    close: () => {
      store.stop();
      disconnectClients();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
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
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: node dashboard-server.mjs --run-dir <path> [--port 8088]\n");
      return;
    }
    const dashboard = await createDashboardServer(options);
    process.stdout.write(`Orchestration dashboard: ${dashboard.url}\n`);
  } catch (error) {
    const detail = error?.code === "EADDRINUSE" ? `Port ${error.port ?? DEFAULT_PORT} is already in use; choose another with --port.` : error.message;
    process.stderr.write(`Dashboard failed: ${detail}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
