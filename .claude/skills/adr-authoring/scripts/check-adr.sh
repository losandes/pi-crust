#!/usr/bin/env bash
# Blocking checker for the records in adr/.
#
# Records are portable: another repository should be able to copy adr/ wholesale
# and delete the language nests it does not use. That breaks the moment a record
# names a project, a path, a package, or a count — all of which belong in a
# CLAUDE.md instead.
#
# Usage:
#   check-adr.sh                 # records changed vs git HEAD
#   check-adr.sh <path>...       # specific files or directories
#   check-adr.sh --all           # every record
#
# Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

if [[ ! -d "$REPO_ROOT/adr" ]]; then
  echo "error: no adr/ directory at $REPO_ROOT" >&2
  exit 2
fi

# project-organization is exempt by decision: repo-specific detail aids
# comprehension there. references/ holds third-party summaries, not our records.
# context/ holds the frames a record is written against — a lifecycle, a
# taxonomy, a document template. They decide nothing on their own, so a status
# on one would assert that a decision is in force somewhere else.
is_exempt() {
  [[ "$1" == adr/project-organization/* ]] && return 0
  [[ "$1" == */references/* ]] && return 0
  [[ "$1" == adr/context/* ]] && return 0
  [[ "$1" == */README.md ]] && return 0
  [[ "$1" == adr/template.md ]] && return 0
  return 1
}


# A fenced block is not prose, and the link checks must not read one. An ASCII
# diagram writes `[Data Operation](transaction)`, which is a label and a note
# rather than a link to anything, and the raw grep reported every one of those
# as a broken link. Fenced lines are blanked rather than deleted so the line
# numbers the other checks report stay true.
#
# Only the link checks use this. A path or a count inside a fence is still a
# path or a count, and stays reportable.
blank_fenced_lines() {
  awk '
    /^[[:space:]]*(```|~~~)/ { in_fence = !in_fence; print ""; next }
    in_fence { print ""; next }
    { print }
  ' "$1"
}

# This workspace is nested inside a much larger repository, so the git root is an
# ancestor of REPO_ROOT, not equal to it. `git diff` reports paths relative to
# that outer root, which is why they are resolved against $git_root and then
# filtered back down to $REPO_ROOT/adr/ rather than used directly.
#
# REPO_ROOT itself is deliberately derived from this script's location instead of
# from git, so the workspace boundary does not move when the outer repository is
# reorganised. Do not replace it with `git rev-parse --show-toplevel`.
collect_changed() {
  changed_files '\.md$' "$REPO_ROOT" | grep "^$REPO_ROOT/adr/" | sed "s|^$REPO_ROOT/||"
}

# `select_files` applies the `-name` expression only when it walks the tree for
# `--all`. Explicit paths arrive unfiltered, so the extension is re-tested here:
# a caller that hands this script every changed path under adr/ — pr-check does
# — otherwise gets `missing-status` reported against the data files that sit
# beside a record.
select_files -name '*.md' -- "$@"
FILES=()
for abs in ${SELECTED+"${SELECTED[@]}"}; do
  case "$abs" in "$REPO_ROOT"/adr/*.md) FILES+=("${abs#"$REPO_ROOT"/}") ;; esac
done

VIOLATIONS=0
CHECKED=0
SKIPPED=0

report() {
  echo "  $1:$2"
  echo "      [$3] $4"
  VIOLATIONS=$((VIOLATIONS + 1))
}

cd "$REPO_ROOT" || exit 2

for rel in "${FILES[@]}"; do
  [[ -f "$rel" ]] || continue
  if is_exempt "$rel"; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  CHECKED=$((CHECKED + 1))

  # --- Portability ----------------------------------------------------------
  # Workspace directories named in prose mean the record cannot be lifted out.
  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "names-a-path" \
      "records name technologies, not paths; move this to a CLAUDE.md"
  done < <(grep -nE '(^|[^a-zA-Z/])(apps|reference-arch|biome-plugins)/[a-z]' "$rel")

  # Deliberately no rule against naming a package. An import statement in an
  # example is a single line an adopting repository edits, and omitting it leaves
  # a symbol with no origin and nothing to edit. That was decided explicitly.

  # Counts go stale silently and are worse wrong than absent.
  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "states-a-count" \
      "a count of files or violations goes stale; state it in a CLAUDE.md or omit it"
  done < <(grep -nEi '\b[0-9]+ (files?|modules?|packages?|call sites?|violations?|occurrences?)\b' "$rel")

  # --- Structure ------------------------------------------------------------
  if ! grep -qE '^## Status' "$rel"; then
    report "$rel" 1 "missing-status" "every record needs a '## Status' section"
  else
    status="$(grep -A2 '^## Status' "$rel" | grep -Ev '^(## Status|--|$)' | head -1 | tr -d '[:space:]')"
    case "$status" in
      proposed|accepted|superseded|deprecated) ;;
      *) report "$rel" 1 "bad-status" \
           "status is '${status:-empty}'; use proposed, accepted, superseded, or deprecated" ;;
    esac
  fi

  # Two kinds of document live here. A decision record carries `Context:`
  # frontmatter and states one decision. A conventions collection gathers many
  # settled rules and has no single decision to state. Both must say whether they
  # are in force; only the first owes a Decision section.
  if head -3 "$rel" | grep -qE '^Context:'; then
    grep -qE '^## Decision' "$rel" || report "$rel" 1 "missing-decision" \
      "a decision record needs a '## Decision' section stating what was decided"
  fi

  # --- Links ----------------------------------------------------------------
  # Every relative target is extracted, not only the ones spelled with a leading
  # `./` or `../`. A sibling link reads as `](template.md)`, and requiring the
  # dot skipped those entirely — the check looked clean because it was looking at
  # nothing. External schemes and bare anchors are filtered instead, and an
  # anchor is trimmed off a path before it is resolved.
  dir="$(dirname "$rel")"
  prose="$(blank_fenced_lines "$rel")"
  while IFS= read -r link; do
    case "$link" in
      http://* | https://* | mailto:* | '#'* | /*) continue ;;
    esac
    target="${link%%#*}"
    [[ -n "$target" ]] || continue
    [[ -e "$dir/$target" ]] || report "$rel" 1 "broken-link" "relative link does not resolve: $target"
  done < <(grep -oE '\]\([^)[:space:]]+\)' <<<"$prose" | sed 's/^](//;s/)$//')

  # A bare directory link renders inconsistently; link the file.
  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "directory-link" \
      "link a specific file, not a directory"
  done < <(grep -nE '\]\(\.\.?(/[a-z0-9-]+)*/\)' <<<"$prose")

  # Section numbers break silently when a section is inserted above them.
  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "section-number-reference" \
      "cite a quoted heading, not a section number; numbers shift silently"
  # `\b§` matched almost nothing: a word boundary needs a word character on one
  # side, and both a space and `§` are non-word, so "but §2 already answers it"
  # passed. Only a digit after the sign is required now.
  done < <(grep -nE '§[0-9]' "$rel")
done

echo
echo "check-adr: scope=$SCOPE checked=$CHECKED skipped_exempt=$SKIPPED violations=$VIOLATIONS"

if [[ $VIOLATIONS -gt 0 ]]; then
  echo
  echo "Rules: $SCRIPT_DIR/../SKILL.md"
  exit 1
fi

echo "All checked records conform."
