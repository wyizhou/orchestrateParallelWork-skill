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

migration_tmp="$(mktemp -d)"
cleanup_migration_tmp() {
  rm -rf -- "$migration_tmp"
}
trap cleanup_migration_tmp EXIT

migration_project="$migration_tmp/project"
target_dir="$migration_project/.agents/skills/$skill"
unrelated_dir="$migration_project/.agents/skills/unrelated-skill"
mkdir -p "$target_dir" "$unrelated_dir"
git init -q "$migration_project"

printf '%s\n' "legacy payload that must be replaced" >"$target_dir/legacy-only.txt"
printf '%s\n' "unrelated payload that must survive" >"$unrelated_dir/keep.txt"

(
  cd "$migration_project"
  npx --yes skills@1.5.21 add "$repo_root/skills/$skill" --agent codex --yes >/dev/null
)

[ ! -e "$target_dir/legacy-only.txt" ]
[ -f "$target_dir/SKILL.md" ]
[ -f "$target_dir/LICENSE" ]
[ -f "$target_dir/agents/openai.yaml" ]
[ -f "$target_dir/references/codex-runtime.md" ]
[ -f "$target_dir/references/validation.md" ]
[ ! -e "$target_dir/README.md" ]
grep -F 'name: orchestrate-parallel-work' "$target_dir/SKILL.md" >/dev/null
grep -Fx 'unrelated payload that must survive' "$unrelated_dir/keep.txt" >/dev/null

after_status="$(git status --porcelain)"
[ "$before_status" = "$after_status" ]
