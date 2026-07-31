#!/usr/bin/env python3
"""Dependency-free structural and behavioral-manifest validation for this skill."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "orchestrate-parallel-work"
SKILL_FILE = SKILL_DIR / "SKILL.md"
OPENAI_FILE = SKILL_DIR / "agents" / "openai.yaml"
LICENSE_FILE = SKILL_DIR / "LICENSE"
CASES_FILE = ROOT / "tests" / "cases.json"
STALE_LITERALS = ("gpt-5.6-luna", "light")


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def read(path: Path, errors: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(errors, f"cannot read {path.relative_to(ROOT)}: {exc}")
        return ""


def local_links(markdown: str, source: Path) -> list[Path]:
    """Return local Markdown link targets, ignoring anchors and external schemes."""
    result = []
    for target in re.findall(r"(?<!!)\[[^]]*\]\(([^)]+)\)", markdown):
        target = target.strip().split(maxsplit=1)[0].strip("<>")
        target = target.split("#", 1)[0]
        if not target or "://" in target or target.startswith(("mailto:", "/")):
            continue
        result.append((source.parent / target).resolve())
    return result


def validate_frontmatter(text: str, errors: list[str]) -> None:
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        fail(errors, "SKILL.md must begin with YAML frontmatter delimited by ---")
        return
    fields: dict[str, str] = {}
    field_names: list[str] = []
    for line in match.group(1).splitlines():
        field = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*):\s*(.*)", line)
        if not field:
            fail(errors, f"invalid frontmatter line: {line!r}")
            continue
        fields[field.group(1)] = field.group(2).strip().strip("'\"")
        field_names.append(field.group(1))
    if len(field_names) != len(set(field_names)):
        fail(errors, "SKILL.md frontmatter fields must not be duplicated")
    if set(fields) != {"name", "description"}:
        fail(errors, "SKILL.md frontmatter must contain only name and description")
    for key in ("name", "description"):
        if not fields.get(key):
            fail(errors, f"SKILL.md frontmatter {key!r} must be non-empty")
    if fields.get("name") != SKILL_DIR.name:
        fail(errors, "SKILL.md frontmatter name must match its containing folder")


def validate_openai(text: str, errors: list[str]) -> None:
    if not re.search(r"^interface:\s*$", text, re.MULTILINE):
        fail(errors, "agents/openai.yaml must contain an interface mapping")
    for field in ("display_name", "short_description", "default_prompt"):
        match = re.search(rf"^\s{{2}}{field}:\s*(\"[^\"]*\"|'[^']*')\s*$", text, re.MULTILINE)
        if not match:
            fail(errors, f"agents/openai.yaml interface.{field} must be a quoted value")
        elif not match.group(1)[1:-1].strip():
            fail(errors, f"agents/openai.yaml interface.{field} must be non-empty")
    prompt = re.search(r"^\s{2}default_prompt:\s*[\"'](.*)[\"']\s*$", text, re.MULTILINE)
    if not prompt or "$orchestrate-parallel-work" not in prompt.group(1):
        fail(errors, "agents/openai.yaml default_prompt must mention $orchestrate-parallel-work")


def validate_cases(errors: list[str]) -> None:
    try:
        cases = json.loads(read(CASES_FILE, errors))
    except json.JSONDecodeError as exc:
        fail(errors, f"tests/cases.json is invalid JSON: {exc}")
        return
    if not isinstance(cases, dict) or set(cases) != {"schema_version", "cases"}:
        fail(errors, "cases.json must contain only schema_version and cases")
        return
    if cases["schema_version"] != 1 or not isinstance(cases["cases"], list):
        fail(errors, "cases.json requires schema_version 1 and a cases array")
        return
    required_ids = {
        "single-output-no-split", "plan-only-no-execution", "coupled-work-serial-or-decouple",
        "independent-workstreams-may-parallelize", "agents-rule-wins", "unavailable-explicit-model-no-substitution",
        "foundation-change-stales-results", "blind-validator-no-conclusion", "worktree-cwd-isolation",
        "full-history-fork-inherits-parent",
    }
    actual_ids: set[str] = set()
    for index, case in enumerate(cases["cases"]):
        if not isinstance(case, dict) or set(case) != {"id", "scenario", "invariants"}:
            fail(errors, f"case {index} must contain only id, scenario, and invariants")
            continue
        case_id = case["id"]
        scenario = case["scenario"]
        invariants = case["invariants"]
        if not isinstance(case_id, str) or not case_id or case_id in actual_ids:
            fail(errors, f"case {index} has a missing or duplicate id")
        actual_ids.add(case_id if isinstance(case_id, str) else "")
        if not isinstance(scenario, str) or not scenario.strip():
            fail(errors, f"case {case_id!r} needs a non-empty scenario")
        if not isinstance(invariants, list) or not invariants or not all(isinstance(x, str) and x.strip() for x in invariants):
            fail(errors, f"case {case_id!r} needs a non-empty invariant string list")
    if actual_ids != required_ids:
        fail(errors, "cases.json must cover exactly the required behavioral case IDs")


def main() -> int:
    errors: list[str] = []
    for path in (SKILL_DIR, SKILL_FILE, OPENAI_FILE, LICENSE_FILE, CASES_FILE):
        if not path.exists():
            fail(errors, f"missing required path: {path.relative_to(ROOT)}")
    skill = read(SKILL_FILE, errors)
    openai = read(OPENAI_FILE, errors)
    license_text = read(LICENSE_FILE, errors)
    validate_frontmatter(skill, errors)
    validate_openai(openai, errors)
    if "MIT" not in license_text or "copyright" not in license_text.lower():
        fail(errors, "nested LICENSE must contain MIT and a copyright notice")
    for link in local_links(skill, SKILL_FILE):
        if not link.exists():
            try:
                display = link.relative_to(ROOT)
            except ValueError:
                display = link
            fail(errors, f"SKILL.md links to missing local reference: {display}")
    repository_text = "\n".join(
        read(path, errors) for path in (SKILL_FILE, OPENAI_FILE)
    )
    for literal in STALE_LITERALS:
        if literal in repository_text:
            fail(errors, f"forbidden stale runtime literal present: {literal}")
    validate_cases(errors)
    if errors:
        print("Repository validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Repository validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
