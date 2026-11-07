#!/usr/bin/env bash

# Blocking checker for the specifications in specs/.
#
# A spec is handed whole to an agent as its prompt, so its defects are not
# caught by a reader — they are carried out. The failures this looks for are
# the ones observed in practice: requirements that cannot be cited, stages
# that cannot be proven, cross-references pointing at clauses that were
# renumbered, and escape sequences written literally by a tool.
#
# Usage:
#   check-spec.sh                    # every spec in specs/
#   check-spec.sh <path>...          # named files
#
# Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error

set -uo pipefail

REPO_ROOT="${MY_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

VIOLATIONS=0
CHECKED=0

report() {
  echo "  $1:$2"
  echo "      [$3] $4"
  VIOLATIONS=$((VIOLATIONS + 1))
}

targets() {
  if [[ $# -gt 0 ]]; then
    printf '%s\n' "$@"
    return
  fi
  if [[ -d "$REPO_ROOT/specs" ]]; then
    find "$REPO_ROOT/specs" -maxdepth 1 -name '*.md' | sort
  fi
}

check_file() {
  local file="$1"
  [[ -f "$file" ]] || { echo "error: no such file: $file" >&2; exit 2; }
  CHECKED=$((CHECKED + 1))

  # ── Required sections ─────────────────────────────────────────────────────
  # A spec missing one of these is missing a job, not a heading: no Objective
  # is no definition of done, no Out of scope is an open invitation.
  local section
  for section in 'Objective' 'Requirements' 'Out of scope' 'Work stages' 'Rationale'; do
    grep -qiE "^## (${section}|[0-9]+\. ${section})" "$file" ||
      report "$file" 1 "missing-section" "no '## $section' section"
  done

  # ── Requirements must be numbered and normative ───────────────────────────
  local numbered
  numbered="$(grep -cE '^[0-9]+\.[0-9]+\.[0-9]+ ' "$file" || true)"
  if [[ "$numbered" -eq 0 ]]; then
    report "$file" 1 "unnumbered-requirements" \
      "no x.y.z requirements found; prose cannot be cited by a work stage"
  fi

  local normative
  normative="$(grep -cE '^[0-9]+\.[0-9]+\.[0-9]+ .*(MUST|MUST NOT|SHOULD|MAY)' "$file" || true)"
  if [[ "$numbered" -gt 0 && "$normative" -lt "$numbered" ]]; then
    report "$file" 1 "non-normative-requirement" \
      "$((numbered - normative)) of $numbered requirements state no MUST/SHOULD/MAY"
  fi

  # ── Cross-references must resolve ─────────────────────────────────────────
  # Renumbering is the common edit and the silent breakage: a stage citing a
  # clause that no longer exists reads exactly like one that does.
  local declared refs ref
  declared="$(grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' "$file" | sort -u)"
  refs="$(grep -oE '(^|[^0-9.])([0-9]+\.[0-9]+\.[0-9]+)' "$file" |
    grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -u)"
  for ref in $refs; do
    grep -qx "$ref" <<<"$declared" ||
      report "$file" 1 "dangling-reference" "cites $ref, which no requirement declares"
  done

  # ── Headings must not repeat a number ─────────────────────────────────────
  # Inserting a section without renumbering produces two '### 5.5', which no
  # markdown linter objects to and every reader trips over.
  local dupes
  dupes="$(grep -oE '^#{2,4} [0-9]+(\.[0-9]+)* ' "$file" | sort | uniq -d || true)"
  if [[ -n "$dupes" ]]; then
    report "$file" 1 "duplicate-heading-number" \
      "repeated heading number(s): $(tr '\n' ' ' <<<"$dupes")"
  fi

  # ── Work stages must name a command ───────────────────────────────────────
  # "Done when it is clean" is not evidence. A command with an exit code is.
  local stages_with_code
  stages_with_code="$(awk 'f && /^## /{exit} /^## .*Work stages/{f=1} f' "$file" |
    grep -cE '^\|.*`[^`]+`.*\|' || true)"
  if [[ "$stages_with_code" -eq 0 ]]; then
    report "$file" 1 "unprovable-stages" \
      "no work stage names a command in backticks"
  fi

  # ── Literal escape sequences ──────────────────────────────────────────────
  # Written by a tool that emitted a payload rather than text. Invisible to a
  # markdown linter, and nonsense to a reader.
  local escapes
  escapes="$(grep -nE '\\u[0-9a-fA-F]{4}|\\n[a-z]' "$file" | head -3 || true)"
  if [[ -n "$escapes" ]]; then
    report "$file" "$(head -1 <<<"$escapes" | cut -d: -f1)" "literal-escape" \
      "escape sequence written literally rather than as text"
  fi

  # ── Relative links must resolve ───────────────────────────────────────────
  local dir target
  dir="$(dirname "$file")"
  while IFS= read -r target; do
    [[ -z "$target" ]] && continue
    [[ "$target" =~ ^(https?:|#) ]] && continue
    [[ -e "$dir/${target%%#*}" ]] ||
      report "$file" 1 "broken-link" "relative link does not resolve: $target"
  done < <(grep -oE '\]\([^)[:space:]]+\)' "$file" | sed 's/^](//;s/)$//')
}

mapfile -t FILES < <(targets "$@")

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "error: no specs found; pass a path or run from a repo with specs/" >&2
  exit 2
fi

for file in "${FILES[@]}"; do
  check_file "$file"
done

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo
  echo "$VIOLATIONS violation(s) across $CHECKED spec(s)"
  exit 1
fi

echo "$CHECKED spec(s) clean"
exit 0
