#!/usr/bin/env bash
# Blocking checker for Activity prompts under prompt-engineering/.
#
# A rewritten prompt fails quietly. It renders, the agent runs, and the thing
# that changed is a variable the harness no longer substitutes, an envelope
# field the agent stops emitting, or a path it was told to read and now is not.
# This compares a prompt against its committed baseline and reports what the
# rewrite dropped.
#
# Usage:
#   check-prompt.sh                      # prompts changed against git HEAD
#   check-prompt.sh --base <ref> [...]   # compare against another ref
#   check-prompt.sh <path>...            # specific files or directories
#   check-prompt.sh --all                # every prompt in the workspace
#
# Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error
#
# This script owns scope and baselines. The analysis is in prompt-contract.ts
# beside it.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Shared helpers, found by walking up rather than by a fixed number of `..`.
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

command -v bun >/dev/null 2>&1 || { echo "error: bun is not on PATH" >&2; exit 2; }

BASE_REF="HEAD"
if [[ "${1:-}" == "--base" ]]; then
  [[ -n "${2:-}" ]] || { echo "error: --base needs a git ref" >&2; exit 2; }
  BASE_REF="$2"
  shift 2
fi

collect_changed() { changed_files 'prompt-engineering/.*\.md$' "$REPO_ROOT"; }

select_files -path '*prompt-engineering*' -name '*.md' -- "$@"

# A README beside the prompts documents the override mechanism; it is not a
# prompt and has no contract to keep. Excluded in every mode, because pruning
# during the `--all` walk would do nothing for changed-files or explicit paths.
FILES=()
for file in ${SELECTED+"${SELECTED[@]}"}; do
  case "$(basename "$file")" in README.md) continue ;; esac
  is_pruned "$file" && continue
  FILES+=("$file")
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo
  echo "check-prompt: scope=$SCOPE base=$BASE_REF checked=0 violations=0"
  echo "No prompts in scope."
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

GIT_ROOT="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)"
[[ -n "$GIT_ROOT" ]] && GIT_ROOT="$(cd "$GIT_ROOT" && pwd -P)"

# Pairs: each file followed by its baseline, or `-` when git has no copy of it
# at BASE_REF. A new prompt has nothing to be compared against, so it gets the
# structural rules only.
PAIRS=()
index=0
for file in "${FILES[@]}"; do
  baseline="-"
  if [[ -n "$GIT_ROOT" ]]; then
    rel="${file#"$GIT_ROOT"/}"
    candidate="$TMP_DIR/$index.md"
    if git -C "$GIT_ROOT" show "$BASE_REF:$rel" >"$candidate" 2>/dev/null; then
      baseline="$candidate"
    fi
  fi
  PAIRS+=("$file" "$baseline")
  index=$((index + 1))
done

bun "$SCRIPT_DIR/prompt-contract.ts" \
  --scope "$SCOPE" --base "$BASE_REF" --root "$REPO_ROOT" -- "${PAIRS[@]}"
