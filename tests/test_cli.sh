#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

skill="orchestrate-parallel-work"
before_status="$(git status --porcelain)"

list_output="$(npx --yes skills@1.5.21 add . --list)"
printf '%s\n' "$list_output" | grep -F 'orchestrate-parallel-work' >/dev/null

use_output="$(npx --yes skills@1.5.21 use . --skill "$skill")"
printf '%s\n' "$use_output" | grep -F 'orchestrate-parallel-work' >/dev/null

support_dir="$(printf '%s\n' "$use_output" | sed -n '/Supporting files for this skill were downloaded to:/{n;p;}' | tr -d '\r')"
if [ -z "$support_dir" ] || [ ! -d "$support_dir" ]; then
  printf '%s\n' "Could not identify a temporary supporting-files directory from skills use output." >&2
  exit 1
fi

[ -f "$support_dir/SKILL.md" ]
[ -f "$support_dir/LICENSE" ]
[ -f "$support_dir/agents/openai.yaml" ]
[ -f "$support_dir/references/codex-runtime.md" ]
[ -f "$support_dir/references/validation.md" ]
[ ! -e "$support_dir/README.md" ]

after_status="$(git status --porcelain)"
[ "$before_status" = "$after_status" ]
