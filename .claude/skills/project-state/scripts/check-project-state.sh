#!/usr/bin/env bash
# Blocking checker for project-state artifacts under .context/project-state/.
#
# An artifact fails quietly. It is read by a future session that has no way to
# tell curated state from an appended session transcript, and no way to tell that
# the metadata block names an owner who does not own the directory it sits in.
# This checks the shape that makes an artifact retrievable and attributable. It
# cannot check whether what it says is true.
#
# Usage:
#   check-project-state.sh                # artifacts changed against git HEAD
#
# With no arguments the comparison is against HEAD, so it covers the working
# tree and nothing else — artifacts committed earlier on a branch are NOT
# included. For the whole branch, pass paths, or run the pre-PR gate, which
# diffs against the merge base and hands this script the resulting list.
#   check-project-state.sh <path>...      # explicit files
#   check-project-state.sh --all          # every artifact in the workspace
#
# Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Derived from this script's own location: this workspace is nested inside a
# larger repository, so the git root is an ancestor and must not be used here.
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
WORKSPACE_ROOT="$(workspace_root)"
STATE_ROOT="$WORKSPACE_ROOT/.context/project-state"
MAX_LINES=400
MAX_CODE_BLOCK_LINES=20
# `Recently Completed` is the section that rots into a changelog first. The cap is
# a smell test, not a budget to fill.
MAX_COMPLETED_ITEMS=8

VIOLATIONS=0
CHECKED=0

report() {
  echo "  $1"
  echo "      [$2] $3"
  VIOLATIONS=$((VIOLATIONS + 1))
}


collect_changed() {
  changed_files '\.md$' "$WORKSPACE_ROOT" | grep "^$STATE_ROOT/" || true
}

FILES=()
select_files -name '*.md' -- "$@"
FILES=()
for abs in ${SELECTED+"${SELECTED[@]}"}; do
  case "$abs" in "$STATE_ROOT"/*) FILES+=("$abs") ;; esac
done

for file in "${FILES[@]}"; do
  [[ -f "$file" ]] || continue
  CHECKED=$((CHECKED + 1))

  rel="${file#"$WORKSPACE_ROOT"/}"
  base="$(basename "$file" .md)"

  path_owner=""
  path_project=""
  path_year=""

  # --- Path convention ------------------------------------------------------
  # Only artifacts living under .context/project-state/ are held to the path
  # convention; an explicitly named file elsewhere is checked on content alone,
  # so examples and drafts can still be validated.
  if [[ "$file" == "$STATE_ROOT"/* ]]; then
    suffix="${file#"$STATE_ROOT"/}"
    # Capture indices skip, because each segment's hyphen repetition is itself a
    # group: 1=year, 2=project, (3=project's hyphen tail), 4=owner,
    # (5=owner's hyphen tail), 6=artifact, (7=artifact's hyphen tail).
    if [[ "$suffix" =~ ^([0-9]{4})/([a-z0-9]+(-[a-z0-9]+)*)/([a-z0-9]+(-[a-z0-9]+)*)/([a-z0-9]+(-[a-z0-9]+)*)\.md$ ]]; then
      path_year="${BASH_REMATCH[1]}"
      path_project="${BASH_REMATCH[2]}"
      path_owner="${BASH_REMATCH[4]}"
    else
      report "$rel" "bad-path" \
        "artifacts live at .context/project-state/<year>/<project>/<owner>/<artifact>.md, lowercase and hyphenated"
    fi
  fi

  # --- Artifact name --------------------------------------------------------
  # A name taken from a session, PR, or calendar period describes when the work
  # happened, which is the one thing the artifact is not organised by.
  if [[ "$base" =~ (^|-)(session|sessions|pr|prs|issue|issues|sprint|week|notes|q[1-4]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)([0-9-]|$) ]] \
    || [[ "$base" =~ [0-9]{4}-[0-9]{2} ]] \
    || [[ "$base" =~ ^[0-9]+$ ]]; then
    report "$rel" "incidental-artifact-name" \
      "name the body of knowledge, not the session, PR, sprint, or date that produced it"
  fi

  # --- Heading and metadata -------------------------------------------------
  grep -qE '^# .+' "$file" || report "$rel" "no-title" \
    "the artifact needs a '# <Body of Work>' heading"

  # The block is a list, not four stacked lines: consecutive lines of prose
  # render as one wrapped line, and the markdown record forbids writing them
  # that way. A bare `**Owner:**` line is still accepted so artifacts written
  # before that record keep validating.
  for field in Owner Project Year 'Last updated'; do
    grep -qE "^(- )?\*\*${field}:\*\*[[:space:]]*[^[:space:]]" "$file" || report "$rel" "missing-metadata" \
      "the metadata block needs '- **${field}:**' with a value"
  done

  meta_field() {
    grep -m1 -E "^(- )?\*\*$1:\*\*" "$file" | sed -E "s/^(- )?\*\*$1:\*\*[[:space:]]*//;s/[[:space:]]*\$//"
  }
  meta_owner="$(meta_field Owner)"
  meta_project="$(meta_field Project)"
  meta_year="$(meta_field Year)"
  meta_date="$(meta_field 'Last updated')"

  if [[ -n "$meta_date" && ! "$meta_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    report "$rel" "bad-date" "'Last updated' must be an ISO date, YYYY-MM-DD, not '$meta_date'"
  fi

  # Provenance is the point of the path. Metadata that disagrees with it makes
  # the owner of a piece of knowledge ambiguous, which is the thing single
  # ownership exists to prevent.
  if [[ -n "$path_owner" ]]; then
    [[ "$meta_owner" == "$path_owner" ]] || report "$rel" "metadata-path-mismatch" \
      "Owner '$meta_owner' does not match the directory '$path_owner'"
    [[ "$meta_project" == "$path_project" ]] || report "$rel" "metadata-path-mismatch" \
      "Project '$meta_project' does not match the directory '$path_project'"
    [[ "$meta_year" == "$path_year" ]] || report "$rel" "metadata-path-mismatch" \
      "Year '$meta_year' does not match the directory '$path_year'"
  fi

  # --- Sections -------------------------------------------------------------
  grep -qE '^## Objective' "$file" || report "$rel" "no-objective" \
    "add '## Objective' — a reader must learn what the work is for before anything else"

  # Organising by where knowledge came from defeats reconciliation: the same
  # decision then appears once per source instead of once.
  while IFS= read -r hit; do
    line="${hit%%:*}"
    text="${hit#*:}"
    report "$rel:$line" "source-shaped-section" \
      "section organised by source or chronology, not by knowledge: '$text'"
  done < <(grep -nE '^#{2,} .*([Ss]lack|[Ss]ession|[Tt]ranscript|[Cc]hat [Ll]og|[Mm]eeting [Nn]otes|PR [Nn]otes|PR #|[Ss]ource [Mm]aterial|[Tt]imeline|[Cc]hangelog|[Hh]istory|[Dd]iary|[Ll]og of)' "$file" \
    | sed -E 's/^([0-9]+):#+ /\1:/')

  # --- Implementation metadata ----------------------------------------------
  # Git and GitHub are authoritative for diffs, hashes, and review threads. An
  # artifact that restates them is redundant on the day it is written and wrong
  # the day either changes.
  while IFS= read -r hit; do
    report "$rel:${hit%%:*}" "activity-metadata" \
      "implementation metadata belongs in Git/GitHub, not here: '${hit#*:}'"
  done < <(grep -noE '\+[0-9]+/-[0-9]+|[0-9]+ files? changed|[0-9]+ (files|insertions|deletions)\b|[0-9]+ (tests?|specs?) (pass|passing|failed)|[0-9]+ pass(ing)?, ?[0-9]+ fail|coverage [0-9.]+%' "$file")

  # A commit hash is a pointer to history nobody asks for later; `git log` answers
  # it. Letters-only tokens like "facade" are excluded by requiring a digit.
  while IFS= read -r hit; do
    line="${hit%%:*}"
    tok="${hit#*:}"
    [[ "$tok" =~ [0-9] && "$tok" =~ [a-f] ]] || continue
    report "$rel:$line" "commit-hash" \
      "drop the commit hash '$tok' unless resuming requires it; Git holds the history"
  done < <(grep -nboE '\b[0-9a-f]{7,40}\b' "$file" | sed -E 's/^([0-9]+):[0-9]+:/\1:/')

  # --- Changelog drift --------------------------------------------------------
  completed_items="$(awk '
    /^## / { inblk = ($0 ~ /Completed/) ? 1 : 0; next }
    inblk && /^[[:space:]]*[-*] / { n++ }
    END { print n + 0 }
  ' "$file")"
  if (( completed_items > MAX_COMPLETED_ITEMS )); then
    report "$rel" "changelog-drift" \
      "$completed_items completed entries; keep only what stops a reader redoing work"
  fi

  # --- Size -----------------------------------------------------------------
  lines="$(wc -l < "$file" | tr -d ' ')"
  if (( lines > MAX_LINES )); then
    report "$rel" "artifact-too-large" \
      "$lines lines; the limit is $MAX_LINES — split by scope, or cut what no future session needs"
  fi

  # A long excerpt is the source, pasted. The artifact points at code; it does
  # not carry it.
  # The same `^```` pattern matches both the opening and the closing fence; the
  # `inblk` flag is what tells them apart, so the awk below is a two-state
  # machine rather than two separate rules.
  while IFS=: read -r start len; do
    [[ -n "$start" ]] || continue
    report "$rel:$start" "large-code-excerpt" \
      "fenced block of $len lines; keep excerpts short and point at the file instead"
  done < <(awk -v max="$MAX_CODE_BLOCK_LINES" '
    /^```/ { if (inblk) { if (NR - start - 1 > max) print start ":" (NR - start - 1); inblk = 0 } else { inblk = 1; start = NR } ; next }
  ' "$file")
done

echo
echo "check-project-state: checked=$CHECKED violations=$VIOLATIONS"

if (( VIOLATIONS > 0 )); then
  echo
  echo "Rules: $SCRIPT_DIR/../SKILL.md"
  exit 1
fi

echo "All checked artifacts conform."
