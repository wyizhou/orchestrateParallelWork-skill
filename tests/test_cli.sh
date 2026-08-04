#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "test_cli.sh failed at line %s\n" "$LINENO" >&2' ERR

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

skill="orchestrate-parallel-work"
before_status="$(git status --porcelain)"

list_output="$(npx --yes skills add . --list)"
printf '%s\n' "$list_output" | grep -F 'orchestrate-parallel-work' >/dev/null

use_output="$(npx --yes skills use . --skill "$skill")"
printf '%s\n' "$use_output" | grep -F 'orchestrate-parallel-work' >/dev/null

support_dir="$(printf '%s\n' "$use_output" | sed -n '/Supporting files for this skill were downloaded to:/{n;p;}' | tr -d '\r')"
if [ -z "$support_dir" ] || [ ! -d "$support_dir" ]; then
  printf '%s\n' "Could not identify a temporary supporting-files directory from skills use output." >&2
  exit 1
fi

[ -f "$support_dir/SKILL.md" ]
[ -f "$support_dir/LICENSE" ]
[ -f "$support_dir/agents/openai.yaml" ]
[ -f "$support_dir/scripts/graphctl.mjs" ]
[ -f "$support_dir/scripts/graph-core.mjs" ]
[ -f "$support_dir/scripts/dashboard-server.mjs" ]
[ -f "$support_dir/scripts/dashboard-state.mjs" ]
[ -f "$support_dir/assets/schemas/graph-plan.schema.json" ]
[ -f "$support_dir/assets/schemas/task-contract.schema.json" ]
[ -f "$support_dir/assets/schemas/artifact-catalog.schema.json" ]
[ -f "$support_dir/assets/schemas/artifact-registry.schema.json" ]
[ -f "$support_dir/assets/schemas/approval.schema.json" ]
[ -f "$support_dir/assets/schemas/node-run-registry.schema.json" ]
[ -f "$support_dir/assets/dashboard/index.html" ]
[ -f "$support_dir/assets/dashboard/styles.css" ]
[ -f "$support_dir/assets/dashboard/app.js" ]
[ -f "$support_dir/references/graph-contracts.md" ]
[ -f "$support_dir/references/dashboard.md" ]
[ -f "$support_dir/references/runtime-generic.md" ]
[ -f "$support_dir/references/runtime-codex.md" ]
[ -f "$support_dir/references/runtime-claude-code.md" ]
[ -f "$support_dir/references/validation.md" ]
[ ! -e "$support_dir/references/codex-runtime.md" ]
[ ! -e "$support_dir/README.md" ]

migration_tmp="$(mktemp -d)"
cleanup_migration_tmp() {
  rm -rf -- "$migration_tmp"
}
trap cleanup_migration_tmp EXIT

fresh_project="$migration_tmp/fresh-project"
fresh_target="$fresh_project/.agents/skills/$skill"
fresh_claude_target="$fresh_project/.claude/skills/$skill"
git init -q "$fresh_project"

(
  cd "$fresh_project"
  npx --yes skills add "$repo_root/skills/$skill" --agent codex claude-code --yes >/dev/null
  installed_json="$(npx --yes skills list --agent codex claude-code --json)"
  printf '%s\n' "$installed_json" | grep -F 'orchestrate-parallel-work' >/dev/null
)

diff -qr "$support_dir" "$fresh_target" >/dev/null
diff -qr "$support_dir" "$fresh_claude_target" >/dev/null

migration_project="$migration_tmp/project"
target_dir="$migration_project/.agents/skills/$skill"
claude_target_dir="$migration_project/.claude/skills/$skill"
unrelated_dir="$migration_project/.agents/skills/unrelated-skill"
mkdir -p "$target_dir" "$claude_target_dir" "$unrelated_dir"
git init -q "$migration_project"

printf '%s\n' "legacy payload that must be replaced" >"$target_dir/legacy-only.txt"
printf '%s\n' "legacy Claude payload that must be replaced" >"$claude_target_dir/legacy-only.txt"
printf '%s\n' "unrelated payload that must survive" >"$unrelated_dir/keep.txt"

(
  cd "$migration_project"
  npx --yes skills add "$repo_root/skills/$skill" --agent codex claude-code --yes >/dev/null
)

[ ! -e "$target_dir/legacy-only.txt" ]
[ ! -e "$claude_target_dir/legacy-only.txt" ]
[ -f "$target_dir/SKILL.md" ]
[ -f "$target_dir/LICENSE" ]
[ -f "$target_dir/agents/openai.yaml" ]
[ -f "$target_dir/scripts/graphctl.mjs" ]
[ -f "$target_dir/scripts/dashboard-server.mjs" ]
[ -f "$target_dir/assets/schemas/graph-plan.schema.json" ]
[ -f "$target_dir/assets/dashboard/index.html" ]
[ -f "$target_dir/references/graph-contracts.md" ]
[ -f "$target_dir/references/dashboard.md" ]
[ -f "$target_dir/references/runtime-generic.md" ]
[ -f "$target_dir/references/runtime-codex.md" ]
[ -f "$target_dir/references/runtime-claude-code.md" ]
[ -f "$target_dir/references/validation.md" ]
[ ! -e "$target_dir/README.md" ]
grep -F 'name: orchestrate-parallel-work' "$target_dir/SKILL.md" >/dev/null
grep -Fx 'unrelated payload that must survive' "$unrelated_dir/keep.txt" >/dev/null
diff -qr "$support_dir" "$target_dir" >/dev/null
diff -qr "$support_dir" "$claude_target_dir" >/dev/null

after_status="$(git status --porcelain)"
[ "$before_status" = "$after_status" ]
