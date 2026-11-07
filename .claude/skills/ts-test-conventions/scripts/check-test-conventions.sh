#!/usr/bin/env bash
# Blocking checker for the conventions in adr/typescript/test-conventions.md
#
# Usage:
#   check-test-conventions.sh                 # check test files changed vs git HEAD
#   check-test-conventions.sh <path>...       # check specific files or directories
#   check-test-conventions.sh --all           # check every test file in the repo
#
# Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error

set -uo pipefail

# The monorepo root is derived from this script's own location, NOT from
# `git rev-parse --show-toplevel` — this workspace is nested inside a much larger
# repository, and the git toplevel would pull in unrelated, out-of-scope codebases.
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

# No workspace-manifest requirement. The original refused to run without
# pnpm-workspace.yaml, which proved the root was the monorepo it was written
# for; here the root is whatever project is being worked in, and a project
# using another package manager still has tests worth checking.

# Files a project has agreed to leave non-conforming. Empty by default: an
# allowlist is a decision a project makes about its own debt, and one inherited
# from somewhere else silently exempts files that happen to share a path.
# Add paths here, or set MY_TEST_LEGACY to a newline-separated list.
KNOWN_LEGACY=()
if [[ -n "${MY_TEST_LEGACY:-}" ]]; then
  while IFS= read -r legacy; do
    [[ -n "$legacy" ]] && KNOWN_LEGACY+=("$legacy")
  done <<< "$MY_TEST_LEGACY"
fi

is_legacy() {
  local rel="$1"
  for known in "${KNOWN_LEGACY[@]}"; do
    [[ "$rel" == "$known" ]] && return 0
  done
  return 1
}


collect_changed() {
  changed_files '\.test\.tsx?$' "$REPO_ROOT"
}

# Paths are absolutised here, where they enter the list, because the loop below
# derives a workspace-relative path by stripping REPO_ROOT. A relative argument
# survives that strip unchanged, so `is_legacy` compares `storage/…` against
# `lib/storage/…`, never matches, and the documented legacy files are reported
# as violations from any directory but the workspace root.

select_files -name '*.test.ts' -o -name '*.test.tsx' -- "$@"
FILES=("${SELECTED[@]:-}")

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "check-test-conventions: no test files to check ($SCOPE)"
  exit 0
fi

VIOLATIONS=0
CHECKED=0
# Counted separately: a legacy file is debt to be repaid, a fixture is permanently
# out of scope. One combined number contradicts the documented legacy list.
SKIPPED_LEGACY=0
SKIPPED_FIXTURE=0

report() {
  # report <file> <line> <rule> <message>
  echo "  $1:$2"
  echo "      [$3] $4"
  VIOLATIONS=$((VIOLATIONS + 1))
}

for file in "${FILES[@]}"; do
  [[ -f "$file" ]] || continue
  rel="${file#"$REPO_ROOT"/}"

  if is_legacy "$rel"; then
    SKIPPED_LEGACY=$((SKIPPED_LEGACY + 1))
    continue
  fi

  # Fixture files carry the .test.ts suffix only to stay out of build output.
  # They define mock factories, not tests, so test-structure rules don't apply.
  if [[ "$(basename "$file")" == *-fixture.test.* || "$(basename "$file")" == *.fixture.test.* ]]; then
    SKIPPED_FIXTURE=$((SKIPPED_FIXTURE + 1))
    continue
  fi

  CHECKED=$((CHECKED + 1))

  # --- Forbidden constructs -------------------------------------------------
  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "no-describe" \
      "'describe' is forbidden; put the subject in the 'given' line instead"
  done < <(grep -nE '(^|[^.[:alnum:]_])describe[[:space:]]*\(' "$file")

  while IFS=: read -r lineno match; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "no-lifecycle-hooks" \
      "lifecycle hooks create shared mutable state; build inputs inside each test"
  done < <(grep -nE '(^|[^.[:alnum:]_])(beforeEach|afterEach|beforeAll|afterAll)[[:space:]]*\(' "$file")

  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "no-global-override" \
      "overwriting a global is forbidden; inject the dependency instead"
  done < <(grep -nE '^[[:space:]]*(global|globalThis)\.[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=[^=]' "$file")

  # Only flags assertions that a logger *method was invoked* (the anti-pattern).
  # Assertions against captured log output are legitimate in the telemetry package,
  # where log output is the behavior under test.
  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "no-logger-assertions" \
      "never assert that a logger was called; assert on the returned value"
  done < <(grep -nE 'expect\([[:space:]]*[A-Za-z_$][A-Za-z0-9_$.]*[Ll]og(ger)?[A-Za-z0-9_$]*\.[A-Za-z][A-Za-z0-9_$]*[[:space:]]*\)[[:space:]]*\.[[:space:]]*(to|not)' "$file")

  # --- Single-string test descriptions -------------------------------------
  # A compliant description is a joined array, so the line opening the test
  # should not carry a quoted string literal. `test.todo` placeholders are exempt.
  while IFS=: read -r lineno _; do
    [[ -n "${lineno:-}" ]] && report "$rel" "$lineno" "joined-description" \
      "description must be an array of 'given …','when …','it should …' joined with ', '"
  done < <(grep -nE "(^|[^.[:alnum:]_])(test|it)(\.[A-Za-z]+(\([^)]*\))?)?[[:space:]]*\([[:space:]]*['\"\`]" "$file" \
            | grep -vE '(test|it)\.todo')

  # --- given / when / then section comments --------------------------------
  # Scoped to each test, and reported on the line that opens it. A file-wide
  # search passes ten tests because one of them is structured, which is the
  # opposite of what a blocking check is for.
  #
  # Each test runs from its opening line to the line opening the next one:
  # brace matching would be exact, but the sections are line comments in the
  # body, and no construct between two tests can produce one that belongs to
  # neither. `test.todo` has no body and is exempt, so it closes the preceding
  # test without opening one.
  #
  # '// when, then' satisfies both 'when' and 'then', as the record allows for
  # a test whose action is the assertion.
  while IFS='|' read -r lineno section; do
    [[ -n "${lineno:-}" ]] || continue
    if [[ "$section" == "all" ]]; then
      report "$rel" "$lineno" "given-when-then" \
        "body must be divided by '// given', '// when', '// then' comments"
    else
      report "$rel" "$lineno" "given-when-then" \
        "missing '// $section' section comment"
    fi
  done < <(awk '
    function flush() {
      if (start > 0) {
        if (!g && !w && !t) { printf "%d|all\n", start }
        else {
          if (!g) printf "%d|given\n", start
          if (!w) printf "%d|when\n", start
          if (!t) printf "%d|then\n", start
        }
      }
    }
    /(^|[^.[:alnum:]_])(test|it)(\.[A-Za-z]+(\([^)]*\))?)?[[:space:]]*\(/ {
      flush()
      if ($0 ~ /(test|it)\.todo/) { start = 0 } else { start = NR; g = 0; w = 0; t = 0 }
      next
    }
    /^[[:space:]]*\/\/[[:space:]]*given([[:space:],]|$)/ { g = 1 }
    /^[[:space:]]*\/\/[[:space:]]*when([[:space:],]|$)/ { w = 1 }
    /^[[:space:]]*\/\/[[:space:]]*(then|when,[[:space:]]*then)([[:space:],]|$)/ { t = 1 }
    END { flush() }
  ' "$file")
done

echo
echo "check-test-conventions: scope=$SCOPE checked=$CHECKED" \
     "skipped_legacy=$SKIPPED_LEGACY skipped_fixture=$SKIPPED_FIXTURE violations=$VIOLATIONS"

if [[ $VIOLATIONS -gt 0 ]]; then
  echo
  echo "Rules: $SCRIPT_DIR/../../../adr/typescript/test-conventions.md"
  exit 1
fi

echo "All checked test files conform."
exit 0
