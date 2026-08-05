#!/usr/bin/env python3
"""Dependency-free repository, documentation, and skill-payload validation."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "orchestrate-parallel-work"
README = ROOT / "README.md"
SKILL_MD = SKILL / "SKILL.md"
OPENAI = SKILL / "agents" / "openai.yaml"
CASES = ROOT / "tests" / "cases.json"
PACKAGE = ROOT / "package.json"
MAIN_URL = "https://github.com/wyizhou/orchestrateParallelWork-skill/tree/main/skills/orchestrate-parallel-work"
GLOBAL_ADD = f'npx --yes skills add "{MAIN_URL}" --agent codex claude-code --global --yes'
PROJECT_ADD = f'npx --yes skills add "{MAIN_URL}" --agent codex claude-code --yes'

SCHEMAS = (
    "agent-types.schema.json",
    "approval.schema.json",
    "artifact-catalog.schema.json",
    "artifact-registry.schema.json",
    "graph-plan.schema.json",
    "node-run-registry.schema.json",
    "task-contract.schema.json",
)

REQUIRED = (
    README,
    SKILL_MD,
    OPENAI,
    SKILL / "LICENSE",
    PACKAGE,
    CASES,
    SKILL / "scripts" / "graph-core.mjs",
    SKILL / "scripts" / "graphctl.mjs",
    SKILL / "scripts" / "dashboard-state.mjs",
    SKILL / "scripts" / "dashboard-server.mjs",
    SKILL / "assets" / "dashboard" / "index.html",
    SKILL / "assets" / "dashboard" / "styles.css",
    SKILL / "assets" / "dashboard" / "app.js",
    SKILL / "references" / "graph-contracts.md",
    SKILL / "references" / "dashboard.md",
    SKILL / "references" / "runtime-generic.md",
    SKILL / "references" / "runtime-codex.md",
    SKILL / "references" / "runtime-claude-code.md",
    SKILL / "references" / "validation.md",
) + tuple(SKILL / "assets" / "schemas" / name for name in SCHEMAS)

CASE_IDS = {
    "single-output-no-graph",
    "plan-only-no-execution",
    "initial-execute-request-still-awaits-approval",
    "approval-binds-plan-identity",
    "material-change-invalidates-approval",
    "serial-dag",
    "parallel-dag",
    "hybrid-fan-out-join",
    "effective-capacity-hard-limit",
    "unknown-capacity-no-assumption",
    "write-conflict-serializes",
    "node-task-one-to-one",
    "node-delivery-gates",
    "approved-equivalent-check",
    "fact-only-validator-input",
    "validator-independent-read-only",
    "artifact-version-stales-descendants",
    "dashboard-loopback-read-only",
    "dashboard-state-from-files",
    "platform-rules-win",
}


def read(path: Path, errors: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        errors.append(f"cannot read {path.relative_to(ROOT)}: {exc}")
        return ""


def require(text: str, fragments: tuple[str, ...], label: str, errors: list[str]) -> None:
    for fragment in fragments:
        if fragment not in text:
            errors.append(f"{label} must contain {fragment!r}")


def validate_frontmatter(text: str, errors: list[str]) -> None:
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        errors.append("SKILL.md must begin with YAML frontmatter")
        return
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        field = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*):\s*(.*)", line)
        if not field:
            errors.append(f"invalid frontmatter line: {line!r}")
            continue
        if field.group(1) in fields:
            errors.append(f"duplicate frontmatter field: {field.group(1)}")
        fields[field.group(1)] = field.group(2).strip().strip("'\"")
    if set(fields) != {"name", "description"}:
        errors.append("SKILL.md frontmatter must contain only name and description")
    if fields.get("name") != SKILL.name or not fields.get("description"):
        errors.append("SKILL.md name must match its directory and description must be non-empty")


def validate_links(text: str, errors: list[str]) -> None:
    for target in re.findall(r"(?<!!)\[[^]]*\]\(([^)]+)\)", text):
        target = target.strip().split(maxsplit=1)[0].strip("<>").split("#", 1)[0]
        if not target or "://" in target or target.startswith(("mailto:", "/")):
            continue
        resolved = (SKILL_MD.parent / target).resolve()
        if not resolved.exists():
            errors.append(f"SKILL.md links to missing local file: {target}")


def validate_readme(text: str, errors: list[str]) -> None:
    require(
        text,
        (
            "Graph Engineering",
            "awaiting_user_approval",
            "effective_capacity = min(15",
            "http://127.0.0.1:8088",
            "Node.js",
            "Validator",
            "scripts/graphctl.mjs",
            "scripts/dashboard-server.mjs",
            "assets/schemas/",
        ),
        "README",
        errors,
    )
    installation = re.search(r"^## 安装\n(.*?)^## 许可证\n", text, re.MULTILINE | re.DOTALL)
    if not installation:
        errors.append("README must contain installation and license sections")
        return
    body = installation.group(1)
    if re.findall(r"^### (.+)$", body, re.MULTILINE) != ["全局安装", "项目安装", "给 AI 的安装 Prompt"]:
        errors.append("README installation section must contain exactly the three supported entries")
    if re.search(r"\bskills@\d", body) or re.search(r"/tree/v\d", body):
        errors.append("README installation guidance must not pin CLI or skill versions")
    if body.count(GLOBAL_ADD) != 1 or body.count(PROJECT_ADD) != 1:
        errors.append("README must contain the exact unversioned global and project commands once")
    require(
        body,
        (
            "npx --yes skills list --global --agent <agent-id> --json",
            f'npx --yes skills use "{MAIN_URL}" --skill orchestrate-parallel-work',
            f'npx --yes skills add "{MAIN_URL}" --agent <agent-id> --global --yes',
            "recursively compare the installed directory",
            "If they are identical, do not reinstall or update anything",
            "Do not use `skills update`",
            "`scripts/graphctl.mjs`",
            "`scripts/dashboard-server.mjs`",
            "`assets/schemas/graph-plan.schema.json`",
            "`assets/dashboard/index.html`",
        ),
        "README AI installation prompt",
        errors,
    )


def validate_cases(errors: list[str]) -> None:
    try:
        payload = json.loads(read(CASES, errors))
    except json.JSONDecodeError as exc:
        errors.append(f"tests/cases.json is invalid JSON: {exc}")
        return
    if not isinstance(payload, dict) or set(payload) != {"schema_version", "cases"} or payload.get("schema_version") != 2:
        errors.append("cases.json must contain schema_version 2 and cases only")
        return
    cases = payload.get("cases")
    if not isinstance(cases, list):
        errors.append("cases.json cases must be an array")
        return
    ids: list[str] = []
    for index, case in enumerate(cases):
        if not isinstance(case, dict) or set(case) != {"id", "scenario", "invariants"}:
            errors.append(f"case {index} must contain id, scenario, and invariants only")
            continue
        ids.append(case["id"])
        if not isinstance(case["scenario"], str) or not case["scenario"].strip():
            errors.append(f"case {index} needs a scenario")
        if not isinstance(case["invariants"], list) or not case["invariants"] or not all(isinstance(item, str) and item.strip() for item in case["invariants"]):
            errors.append(f"case {index} needs invariant strings")
    if len(ids) != len(set(ids)) or set(ids) != CASE_IDS:
        errors.append("cases.json must cover exactly the required Graph Engineering cases")


def validate_schemas(errors: list[str]) -> None:
    for name in SCHEMAS:
        path = SKILL / "assets" / "schemas" / name
        try:
            schema = json.loads(read(path, errors))
        except json.JSONDecodeError as exc:
            errors.append(f"{name} is invalid JSON: {exc}")
            continue
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            errors.append(f"{name} must use JSON Schema draft 2020-12")
        if schema.get("type") != "object" or schema.get("additionalProperties") is not False:
            errors.append(f"{name} must define a closed top-level object")


def main() -> int:
    errors: list[str] = []
    for path in REQUIRED:
        if not path.exists():
            errors.append(f"missing required path: {path.relative_to(ROOT)}")
    readme = read(README, errors)
    skill = read(SKILL_MD, errors)
    openai = read(OPENAI, errors)
    generic = read(SKILL / "references" / "runtime-generic.md", errors)
    codex = read(SKILL / "references" / "runtime-codex.md", errors)
    claude = read(SKILL / "references" / "runtime-claude-code.md", errors)
    validation = read(SKILL / "references" / "validation.md", errors)
    dashboard_server = read(SKILL / "scripts" / "dashboard-server.mjs", errors)
    graph_core = read(SKILL / "scripts" / "graph-core.mjs", errors)
    dashboard_css = read(SKILL / "assets" / "dashboard" / "styles.css", errors)
    dashboard_js = read(SKILL / "assets" / "dashboard" / "app.js", errors)

    validate_frontmatter(skill, errors)
    validate_links(skill, errors)
    validate_readme(readme, errors)
    validate_cases(errors)
    validate_schemas(errors)
    require(skill, ("awaiting_user_approval", "plan_hash", "effective_capacity = min(15", "graphctl.mjs", "dashboard-server.mjs", "Validator"), "SKILL.md", errors)
    for literal in ("AGENTS.md", "CLAUDE.md", "fork_turns", "isolation: worktree"):
        if literal in f"{skill}\n{generic}":
            errors.append(f"generic core contains platform-specific literal: {literal}")
    require(codex, ("AGENTS.md", "fork_turns", "runtime-generic.md"), "Codex adapter", errors)
    require(claude, ("CLAUDE.md", "Agent tool", "isolation: worktree", "runtime-generic.md"), "Claude adapter", errors)
    require(validation, ("test gate", "lint gate", "fact-only", "Expected fact", "Observed fact"), "validation reference", errors)
    require(graph_core, ("HARD_AGENT_LIMIT = 15", "computePlanHash", "validateBundle", "validateValidatorBrief", "readyNodeIds"), "graph-core.mjs", errors)
    require(dashboard_server, ('const HOST = "127.0.0.1"', "const DEFAULT_PORT = 8088", "GET", "HEAD", "text/event-stream"), "dashboard-server.mjs", errors)
    require(dashboard_css, ("prefers-reduced-motion", "stroke-dasharray", "stroke-dashoffset", "@keyframes producing", "@keyframes flowing", "@keyframes nodePulse"), "Dashboard CSS", errors)
    require(dashboard_js, ("createElementNS", "EventSource", "setInterval", "textContent"), "Dashboard app", errors)
    require(openai, ("display_name:", "short_description:", "default_prompt:", "$orchestrate-parallel-work"), "agents/openai.yaml", errors)
    try:
        package = json.loads(read(PACKAGE, errors))
        if package.get("private") is not True or not {"test", "lint"}.issubset(package.get("scripts", {})):
            errors.append("package.json must be private and provide test and lint scripts")
    except json.JSONDecodeError as exc:
        errors.append(f"package.json is invalid JSON: {exc}")
    license_text = read(SKILL / "LICENSE", errors)
    if "MIT" not in license_text or "copyright" not in license_text.lower():
        errors.append("nested LICENSE must contain MIT and a copyright notice")

    if errors:
        print("Repository validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
