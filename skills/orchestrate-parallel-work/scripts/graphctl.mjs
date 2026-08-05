#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  compileBundle,
  loadBundle,
  validateRuntimeRegistries,
} from "./graph-core.mjs";

function usage() {
  return `Usage:
  node graphctl.mjs validate <plan-directory> [--require-approval] [--json]
  node graphctl.mjs summary <plan-directory> [--json]
  node graphctl.mjs hash <plan-directory>
  node graphctl.mjs check-state <plan-directory> --artifact-registry <file> --node-run-registry <file> [--json]

The tool is read-only. It never starts workers or changes plan state.`;
}

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) positional.push(value);
    else if (["--json", "--require-approval", "--help"].includes(value)) flags.set(value, true);
    else {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value`);
      flags.set(value, next);
    }
  }
  return { positional, flags };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function print(value, json) {
  if (json || typeof value !== "string") process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, directoryValue] = positional;
  if (!command || !directoryValue || flags.has("--help")) {
    process.stdout.write(`${usage()}\n`);
    return flags.has("--help") ? 0 : command ? 0 : 2;
  }
  const directory = path.resolve(directoryValue);
  const bundle = await loadBundle(directory);
  const compiled = compileBundle(bundle, { requireApproval: flags.has("--require-approval") });
  const json = flags.has("--json");

  if (command === "validate") {
    print(json ? { valid: true, plan_hash: compiled.hash, summary: compiled.summary, waves: compiled.topology.waves } : `valid ${compiled.hash}`, json);
    return 0;
  }
  if (command === "summary") {
    print({ ...compiled.summary, waves: compiled.topology.waves }, true);
    return 0;
  }
  if (command === "hash") {
    print(compiled.hash, false);
    return 0;
  }
  if (command === "check-state") {
    const artifactFile = flags.get("--artifact-registry");
    const nodeRunFile = flags.get("--node-run-registry");
    if (!artifactFile || !nodeRunFile) throw new Error("check-state requires both registry files");
    const result = validateRuntimeRegistries(compiled, await readJson(path.resolve(artifactFile)), await readJson(path.resolve(nodeRunFile)));
    if (!result.valid) {
      const error = new Error("runtime registries are invalid");
      error.errors = result.errors;
      throw error;
    }
    print(json ? result : "runtime registries valid", json);
    return 0;
  }
  throw new Error(`unknown command: ${command}`);
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  const payload = { valid: false, error: error.message, errors: error.errors ?? [] };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
