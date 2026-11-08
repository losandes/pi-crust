#!/usr/bin/env bash
# Blocking checker for markdown prose.
#
# The linting is markdownlint's, configured by `.markdownlint-cli2.jsonc` beside
# this script. This wrapper owns only what that tool cannot know: which files are
# in scope, and which are exempt by the record.
#
# The configuration deliberately does NOT sit at the repository root, so an
# editor's markdownlint extension will not pick it up and lint as you type. This
# runs when the skill runs.
#
# Usage:
#   check-markdown.sh                 # markdown changed against git HEAD
#
# With no arguments the comparison is against HEAD, so it covers the working
# tree and nothing else — work committed earlier on a branch is NOT included.
# For the whole branch, pass paths, or run the pre-PR gate, which diffs against
# the merge base and hands this script the resulting list.
#   check-markdown.sh <path>...       # specific files or directories
#   check-markdown.sh --all           # every markdown file in the workspace
#
# Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# Shared helpers, found by walking up rather than by a fixed number of `..`:
# a skill may be nested under a language directory, and a hard-coded depth
# breaks silently when it moves.
shared_dir() {
  local dir="$SCRIPT_DIR"
  while [[ "$dir" != "/" ]]; do
    [[ -f "$dir/scripts/workspace.sh" ]] && { printf '%s\n' "$dir/scripts"; return 0; }
    dir="$(dirname "$dir")"
  done
  echo "error: shared scripts not found above $SCRIPT_DIR" >&2
  exit 2
}
SHARED="$(shared_dir)"
# shellcheck source=/dev/null
source "$SHARED/workspace.sh"
# shellcheck source=/dev/null
source "$SHARED/changed-files.sh"
# shellcheck source=/dev/null
source "$SHARED/ignored-paths.sh"
# shellcheck source=/dev/null
source "$SHARED/select-files.sh"
REPO_ROOT="$(workspace_root)"
CONFIG="$SKILL_DIR/.markdownlint-cli2.jsonc"
# The tool may be the project's, on PATH, or fetched on demand — in that order,
# because a project pinning a version should win over whatever is installed.
if [[ -x "$REPO_ROOT/node_modules/.bin/markdownlint-cli2" ]]; then
  CLI=("$REPO_ROOT/node_modules/.bin/markdownlint-cli2")
elif command -v markdownlint-cli2 >/dev/null 2>&1; then
  CLI=(markdownlint-cli2)
elif command -v bunx >/dev/null 2>&1; then
  CLI=(bunx markdownlint-cli2)
elif command -v npx >/dev/null 2>&1; then
  CLI=(npx --yes markdownlint-cli2)
else
  CLI=()
fi

[[ -f "$CONFIG" ]] || { echo "error: no config at $CONFIG" >&2; exit 2; }
if [[ ${#CLI[@]} -eq 0 ]]; then
  echo "error: markdownlint-cli2 is not available, and neither is bunx or npx" >&2
  exit 2
fi


# Generated and vendored content keeps the formatting of whatever produced it,
# per the record's carve-outs. A skill's own references/ is this team's writing
# and is deliberately not exempt.
is_exempt() {
  case "$1" in
    CHANGELOG.md | */CHANGELOG.md) return 0 ;;
    adr/*/references/*) return 0 ;;
    *.generated.md) return 0 ;;
  esac
  is_pruned "$1" && return 0
  return 1
}


# Paths from git are relative to the OUTER repository root, which is an ancestor
# of this workspace, so they are resolved there and filtered back down.
collect_changed() {
  changed_files '\.md$' "$REPO_ROOT" | sed "s|^$REPO_ROOT/||"
}

select_files -name '*.md' -- "$@"
REQUESTED=()
for abs in ${SELECTED+"${SELECTED[@]}"}; do REQUESTED+=("${abs#"$REPO_ROOT"/}"); done

TARGETS=()
SKIPPED=0
for rel in "${REQUESTED[@]:-}"; do
  [[ -n "$rel" ]] || continue
  if is_exempt "$rel"; then SKIPPED=$((SKIPPED + 1)); else TARGETS+=("$rel"); fi
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo
  echo "check-markdown: checked=0 skipped_exempt=$SKIPPED violations=0"
  echo "All checked markdown conforms."
  exit 0
fi

# markdownlint-cli2 honours `customRules` only from a config it DISCOVERS in the
# working directory; `--config` supplies the rule config alone and silently
# ignores the rest, which reads as a clean file. So it runs from the skill
# directory, with absolute paths, and the output is mapped back afterwards.
# Paths are passed relative to the skill directory so the tool's own output is
# relative too, and the `../../../` prefix maps cleanly back to workspace-relative.
FROM_SKILL=()
for rel in "${TARGETS[@]}"; do
  case "$rel" in /*) FROM_SKILL+=("$rel") ;; *) FROM_SKILL+=("$REPO_ROOT/$rel") ;; esac
done

cd "$SKILL_DIR" || exit 2
OUTPUT="$("${CLI[@]}" --no-globs -- "${FROM_SKILL[@]}" 2>&1)"
STATUS=$?

# The tool prints paths relative to its own working directory, which is the
# skill directory. Re-anchor them on the workspace root so a reader can paste a
# path straight into an editor.
reanchor() {
  local line path abs
  while IFS= read -r line; do
    path="${line%%:*}"
    if [[ "$path" == *.md && -f "$SKILL_DIR/$path" ]]; then
      abs="$(cd "$SKILL_DIR/$(dirname "$path")" && pwd -P)/$(basename "$path")"
      printf '%s\n' "${abs#"$REPO_ROOT"/}${line#"$path"}"
    elif [[ "$path" == *.md && -f "$path" ]]; then
      abs="$(cd "$(dirname "$path")" && pwd -P)/$(basename "$path")"
      printf '%s\n' "${abs#"$REPO_ROOT"/}${line#"$path"}"
    else
      printf '%s\n' "$line"
    fi
  done
}
OUTPUT="$(printf '%s\n' "$OUTPUT" | reanchor)"

# markdownlint-cli2 reports a summary line and its own banner on stderr; the
# findings are the lines carrying a rule name.
#
# Node's own runtime warnings arrive on that same stderr, and `(node:74031)`
# satisfies the `:<digits>` shape a finding has, so an unfiltered warning is
# counted as a violation. Loading the custom rules from `.ts` emits
# MODULE_TYPELESS_PACKAGE_JSON on every run, which inflated every count by one
# and reported `violations=1` for a file with nothing wrong with it.
FINDINGS="$(printf '%s\n' "$OUTPUT" \
  | grep -E '^[^ ].*:[0-9]+' \
  | grep -vE '^(markdownlint-cli2|Finding|Linting|Summary)' \
  | grep -vE '^\(node:[0-9]+\)' \
  || true)"
COUNT="$(printf '%s' "$FINDINGS" | grep -c . || true)"

[[ -n "$FINDINGS" ]] && printf '%s\n' "$FINDINGS" | sed 's/^/  /'

echo
echo "check-markdown: checked=${#TARGETS[@]} skipped_exempt=$SKIPPED violations=$COUNT"

if [[ $STATUS -ne 0 ]]; then
  echo
  echo "Rules: $SKILL_DIR/../adr/conventions/format-markdown.md"
  exit 1
fi

# The count is parsed out of the linter's output, the verdict comes from its
# exit code, and the two are only ever reported together. When they disagree
# the parser has stopped matching what the linter prints, which previously
# surfaced as a clean exit printed directly beneath a non-zero count. Fail
# loudly here rather than let the report contradict itself again.
if [[ $COUNT -gt 0 ]]; then
  echo
  echo "error: the linter exited 0 while $COUNT finding(s) were parsed from its output;" >&2
  echo "       the finding filter in this script no longer matches what it prints" >&2
  exit 2
fi

echo "All checked markdown conforms."
