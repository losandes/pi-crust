#!/usr/bin/env bash
# Pre-PR gate: runs every check the branch's own changes make applicable.
#
# This owns no conventions. It decides, from the paths a branch touched, which
# of the existing checkers apply, runs each one, and reports a single verdict.
# When a check fails, fix it in the skill that owns it — the rule lives there.
#
# Usage:
#   check-pr.sh                 # compare against the default base branch
#   check-pr.sh --base <ref>    # compare against another base
#   check-pr.sh --no-tests      # skip package test suites (they are the slow part)
#   check-pr.sh --list          # show what would run, and run nothing
#
# Exit codes: 0 = ready, 1 = something failed, 2 = usage/environment error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Derived from this script's own location, never from `git rev-parse
# --show-toplevel`: this workspace is nested inside a larger repository.
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
REPO_ROOT="$(workspace_root)"
# The project's skills when it has any, otherwise the user's own.
#
# `.agents/skills/` is the Agent Skills specification's location and is what a
# non-Claude harness reads; `.claude/skills/` is Claude Code's own convention.
# Probing the specified location first and falling back to the vendor one means
# a repository that has migrated is not reported as having no skills at all.
# First match wins rather than merging the two, so which tree a check ran
# against is never ambiguous.
USER_SKILLS="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
SKILLS_REL=""
for candidate in .agents/skills .claude/skills; do
  [[ -d "$REPO_ROOT/$candidate" ]] && { SKILLS_REL="$candidate"; break; }
done
if [[ -n "$SKILLS_REL" ]]; then
  SKILLS="$REPO_ROOT/$SKILLS_REL"
else
  SKILLS="$USER_SKILLS"
fi

# A sibling skill's directory, under whichever name the tree it lives in uses.
# A project's `.claude/skills/` names a skill plainly; this machine-level tree
# prefixes the same skill `my-` to keep it distinct from a project's own copy.
# Resolving both means one script serves both layouts, and a name that matches
# neither is reported by the caller rather than silently resolving to a path
# that does not exist.
# Each checker is resolved on its own rather than the whole tree being chosen
# once. A repository having a skills directory does not mean it carries these
# checkers: a non-Claude project keeps its own skills in `.agents/skills/` and
# still expects the user's checkers to run. Picking the tree once would make
# having any skill of your own a hard failure, which would punish exactly the
# layout the probe above was added to support.
skill_dir() {
  local name="$1" root
  for root in "$SKILLS" "$USER_SKILLS"; do
    [[ -d "$root/$name" ]] && { printf '%s\n' "$root/$name"; return 0; }
    [[ -d "$root/my-$name" ]] && { printf '%s\n' "$root/my-$name"; return 0; }
  done
  printf '%s\n' "$SKILLS/$name"
}

MARKDOWN_SKILL="$(skill_dir markdown-authoring)"
ADR_SKILL="$(skill_dir adr-authoring)"
SKILL_SKILL="$(skill_dir skill-authoring)"
STATE_SKILL="$(skill_dir project-state)"
TEST_SKILL="$(skill_dir ts-test-conventions)"
FP_SKILL="$(skill_dir ts-functional-conventions)"

# The branch a PR would target, from the remote's own declaration. Repositories
# here use `main` and `latest`; asking git covers both, and whatever comes next.
BASE_REF="$(base_ref || echo main)"
RUN_TESTS=1
RUN_WIDE=1
LIST_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE_REF="${2:-}"; [[ -n "$BASE_REF" ]] || { echo "error: --base needs a ref" >&2; exit 2; }; shift 2 ;;
    --no-tests) RUN_TESTS=0; shift ;;
    --no-wide) RUN_WIDE=0; shift ;;
    --list) LIST_ONLY=1; shift ;;
    --help | -h) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "error: unknown option $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_ROOT" || exit 2
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "error: not a git repository" >&2; exit 2; }
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PREFIX="$(git rev-parse --show-prefix)"

echo "branch:  $BRANCH"
echo "base:    $BASE_REF"

if [[ "$BRANCH" == "$BASE_REF" ]]; then
  echo
  echo "error: HEAD is the base branch; there is nothing to open a pull request for" >&2
  exit 2
fi

MERGE_BASE="$(git merge-base HEAD "$BASE_REF" 2>/dev/null)" || {
  echo "error: no merge base with '$BASE_REF'" >&2
  echo "  pass --base <ref>, or set origin/HEAD: git remote set-head origin --auto" >&2
  exit 2
}
echo "merge-base: $MERGE_BASE"

# --- What changed -------------------------------------------------------------
# Committed work on the branch, plus anything still in the working tree, because
# a check that ignores uncommitted edits passes on a tree nobody will push.
# Git reports paths from the OUTER root; they are filtered back down to this
# workspace and made workspace-relative.
#
# Every command runs with `-C "$GIT_ROOT"`, which is not decoration: `git diff`
# reports paths from the repository root, but `git ls-files` reports them
# relative to the CURRENT directory. Mixing the two drops every untracked file
# from the plan, and a plan that is missing files reads exactly like a branch
# with nothing to check.
mapfile -t CHANGED < <(
  {
    git -C "$GIT_ROOT" diff --name-only --diff-filter=ACMR "$MERGE_BASE" HEAD
    git -C "$GIT_ROOT" diff --name-only --diff-filter=ACMR HEAD
    git -C "$GIT_ROOT" ls-files --others --exclude-standard
  } | sort -u | while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    case "$rel" in "$PREFIX"*) printf '%s\n' "${rel#"$PREFIX"}" ;; esac
  done
)

DIRTY="$(git status --porcelain -- . | wc -l | tr -d ' ')"

if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo
  echo "error: no changes against $BASE_REF" >&2
  exit 2
fi

matching() {
  local pattern="$1"
  local found=()
  for file in "${CHANGED[@]}"; do
    [[ -f "$file" ]] || continue
    case "$file" in $pattern) found+=("$file") ;; esac
  done
  printf '%s\n' "${found[@]}"
}

mapfile -t MD_FILES      < <(matching '*.md')
mapfile -t ADR_FILES     < <(matching 'adr/*')
# Both locations are matched regardless of which one resolved above: the
# trigger only has to notice that a skill changed, and a branch that is adding
# a repository's first skill has the directory on disk but nothing committed.
mapfile -t SKILL_FILES   < <(matching '.agents/skills/*' ; matching '.claude/skills/*')
mapfile -t STATE_FILES   < <(matching '.context/project-state/*')
mapfile -t TS_FILES      < <(matching '*.ts' ; matching '*.tsx')
mapfile -t TEST_FILES    < <(matching '*.test.ts' ; matching '*.test.tsx')

# Packages whose source changed, so their suite is the one that proves them.
mapfile -t PACKAGES < <(
  for file in "${TS_FILES[@]}"; do
    [[ -n "$file" ]] || continue
    case "$file" in
      */*/*)  # a package directory, two levels in, whatever it is called
        pkg="$(printf '%s\n' "$file" | cut -d/ -f1-2)"
        [[ -f "$REPO_ROOT/$pkg/package.json" ]] && printf '%s\n' "$pkg"
        ;;
      */_domains/*/*)
        pkg="$(printf '%s\n' "$file" | cut -d/ -f1-3)"
        [[ -f "$REPO_ROOT/$pkg/package.json" ]] && printf '%s\n' "$pkg"
        ;;
    esac
  done | sort -u
)

# Counts the non-empty entries of the array named by $1. Passed by name rather
# than by value because `mapfile` leaves a single empty element for an empty
# result, which would otherwise count as one.
#
# The `eval` is deliberate and every call site passes a literal array name. It
# is here because `local -n` needs bash 4.3, which macOS's system bash is not.
# Do not "clean this up" into a dynamic call: a caller-supplied name would make
# the eval an injection point, which the literal-only rule is what prevents.
count() {
  local entries n=0
  entries="$(eval "printf '%s\n' \"\${$1[@]}\"")"
  while IFS= read -r entry; do [[ -n "$entry" ]] && n=$((n + 1)); done <<< "$entries"
  echo "$n"
}

# The manager the repository actually uses, from its lockfile. `pnpm` was
# hardcoded, and a bun repository with pnpm on PATH fails every suite with no
# indication that the command was wrong rather than the code.
detect_manager() {
  [[ -n "${PKG_MANAGER:-}" ]] && { printf '%s\n' "$PKG_MANAGER"; return 0; }
  [[ -f "$REPO_ROOT/bun.lock" || -f "$REPO_ROOT/bun.lockb" ]] && { echo bun; return 0; }
  [[ -f "$REPO_ROOT/pnpm-lock.yaml" ]] && { echo pnpm; return 0; }
  [[ -f "$REPO_ROOT/yarn.lock" ]] && { echo yarn; return 0; }
  [[ -f "$REPO_ROOT/package-lock.json" ]] && { echo npm; return 0; }
  return 0   # empty: every test step is reported as skipped
}

# Running a suite without entering its directory. A `cd` into a package picks
# up that directory's own tool configuration instead of the repository's.
dir_flag() {
  case "$1" in
    bun | yarn) echo "--cwd" ;;
    pnpm) echo "--dir" ;;
    npm) echo "--prefix" ;;
  esac
}

# The script name a package's own manifest declares, preferring the quieter
# named variants over a bare "test" wherever one exists. Never falls back to
# a literal "test" the manifest does not declare.
package_script() {
  local manifest="$1/package.json" candidate
  [[ -f "$manifest" ]] || return 0
  for candidate in test:claude test:ci test; do
    grep -q "\"$candidate\"" "$manifest" && { printf '%s\n' "$candidate"; return 0; }
  done
}

PKG_MANAGER="$(detect_manager)"
ROOT_SCRIPT="$(package_script "$REPO_ROOT")"

echo "changed: $(count CHANGED) file(s)  uncommitted: $DIRTY"
echo

# --- Plan ---------------------------------------------------------------------
PLAN_NAMES=()
PLAN_CMDS=()
PLAN_SKIP=()

add() { PLAN_NAMES+=("$1"); PLAN_CMDS+=("$2"); PLAN_SKIP+=(""); }
# A planned step with no command to run. Reported distinctly from a pass or a
# failure, and never counted as either.
add_skip() { PLAN_NAMES+=("$1"); PLAN_CMDS+=(""); PLAN_SKIP+=("$2"); }

# Adds a check that invokes a script this skill tree owns. A path that does not
# exist is an environment error, not a finding: the gate cannot tell a repaired
# path from a silently skipped one, so it stops here rather than reporting a
# check that never ran as though it had.
add_skill_check() {
  local name="$1" script_path="$2" cmd="$3"
  if [[ ! -e "$script_path" ]]; then
    echo "error: planned check '$name' names a missing script: $script_path" >&2
    exit 2
  fi
  add "$name" "$cmd"
}

[[ $(count MD_FILES) -gt 0 ]] && add_skill_check "markdown" \
  "$MARKDOWN_SKILL/scripts/check-markdown.sh" \
  "$MARKDOWN_SKILL/scripts/check-markdown.sh ${MD_FILES[*]}"
[[ $(count ADR_FILES) -gt 0 ]] && add_skill_check "records" \
  "$ADR_SKILL/scripts/check-adr.sh" \
  "$ADR_SKILL/scripts/check-adr.sh ${ADR_FILES[*]}"
[[ $(count SKILL_FILES) -gt 0 ]] && add_skill_check "skills" \
  "$SKILL_SKILL/scripts/check-skill.sh" \
  "$SKILL_SKILL/scripts/check-skill.sh"
[[ $(count STATE_FILES) -gt 0 ]] && add_skill_check "project-state" \
  "$STATE_SKILL/scripts/check-project-state.sh" \
  "$STATE_SKILL/scripts/check-project-state.sh ${STATE_FILES[*]}"
[[ $(count TEST_FILES) -gt 0 ]] && add_skill_check "test-conventions" \
  "$TEST_SKILL/scripts/check-test-conventions.sh" \
  "$TEST_SKILL/scripts/check-test-conventions.sh ${TEST_FILES[*]}"
if [[ $(count TS_FILES) -gt 0 ]]; then
  add "lint" "$REPO_ROOT/node_modules/.bin/biome lint ${TS_FILES[*]}"
  add_skill_check "immutable-params" \
    "$FP_SKILL/scripts/check-immutable-params.ts" \
    "bun $FP_SKILL/scripts/check-immutable-params.ts ${TS_FILES[*]}"
fi
if [[ $RUN_TESTS -eq 1 ]]; then
  if [[ -n "$ROOT_SCRIPT" ]]; then
    if [[ -n "$PKG_MANAGER" ]]; then
      add "tests: <root> ($ROOT_SCRIPT)" "$PKG_MANAGER run $ROOT_SCRIPT"
    else
      add_skip "tests: <root> ($ROOT_SCRIPT)" \
        "no package manager detected from a lockfile in $REPO_ROOT; set PKG_MANAGER to override"
    fi
  else
    for pkg in "${PACKAGES[@]}"; do
      [[ -n "$pkg" ]] || continue
      script="$(package_script "$REPO_ROOT/$pkg")"
      [[ -n "$script" ]] || continue
      if [[ -n "$PKG_MANAGER" ]]; then
        add "tests: $pkg" "$PKG_MANAGER $(dir_flag "$PKG_MANAGER") $REPO_ROOT/$pkg run $script"
      else
        add_skip "tests: $pkg" \
          "no package manager detected from a lockfile in $REPO_ROOT; set PKG_MANAGER to override"
      fi
    done
  fi
fi

if [[ ${#PLAN_NAMES[@]} -eq 0 ]]; then
  echo "no checks apply to these changes; review by hand before opening the pull request"
  exit 0
fi

# --- Blast radius -------------------------------------------------------------
# A branch can break a package it never opened, by changing one that package
# depends on. Those failures are the reason for the repository-wide pass, and
# they are reported separately from failures with no path back to this work.
ALL_PACKAGES=()
while IFS= read -r dir; do ALL_PACKAGES+=("${dir%/}"); done < <(
  # Any directory holding a package manifest is a package, whatever it is called.
  find . -maxdepth 3 -name package.json -not -path '*/node_modules/*' -exec dirname {} \; 2>/dev/null | sed 's|^\./||;s|$|/|'
)

DOWNSTREAM=()
if [[ $(count PACKAGES) -gt 0 ]]; then
  mapfile -t DOWNSTREAM < <(
    node -e '
const { readFileSync } = require("node:fs")
const [touchedCsv, allCsv] = process.argv.slice(1)
const touched = touchedCsv.split(",").filter(Boolean)
const all = allCsv.split(",").filter(Boolean)
const read = (dir) => { try { return JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) } catch { return undefined } }
const names = new Set(touched.map((d) => read(d)?.name).filter(Boolean))
for (const dir of all) {
  if (touched.includes(dir)) continue
  const pkg = read(dir)
  if (pkg === undefined) continue
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  if (Object.keys(deps).some((d) => names.has(d))) console.log(dir)
}
' "$(IFS=,; echo "${PACKAGES[*]}")" "$(IFS=,; echo "${ALL_PACKAGES[*]}")"
  )
fi

WIDE_NAMES=()
if [[ $RUN_WIDE -eq 1 ]]; then
  WIDE_NAMES+=("repo-lint")
  # When the workspace root declares its own suite, that suite already covers
  # every package, so a per-package repo-tests pass is redundant rather than
  # additional coverage — it is the same suite's packages reported twice,
  # once correctly and once under the wrong command.
  if [[ $RUN_TESTS -eq 1 && -z "$ROOT_SCRIPT" ]]; then
    for pkg in "${ALL_PACKAGES[@]}"; do
      [[ -f "$REPO_ROOT/$pkg/package.json" ]] || continue
      script="$(package_script "$REPO_ROOT/$pkg")"
      [[ -n "$script" ]] || continue
      printf '%s\n' "${PACKAGES[@]}" | grep -qx "$pkg" && continue
      WIDE_NAMES+=("repo-tests: $pkg")
    done
  fi
fi

if [[ $LIST_ONLY -eq 1 ]]; then
  echo "scoped to the change:"
  for i in "${!PLAN_NAMES[@]}"; do echo "  ${PLAN_NAMES[$i]}"; done
  if [[ ${#WIDE_NAMES[@]} -gt 0 ]]; then
    echo "repository-wide:"
    for name in "${WIDE_NAMES[@]}"; do
      case "$name" in
        "repo-tests: "*)
          pkg="${name#repo-tests: }"
          if printf '%s\n' "${DOWNSTREAM[@]}" | grep -qx "$pkg"; then
            echo "  $name  (depends on a package this branch changed)"
          else
            echo "  $name"
          fi
          ;;
        *) echo "  $name" ;;
      esac
    done
  fi
  exit 0
fi

# --- Run ----------------------------------------------------------------------
RESULTS=()
FAILED=0
SKIPPED=0

for i in "${!PLAN_NAMES[@]}"; do
  name="${PLAN_NAMES[$i]}"
  echo "──────── $name"
  if [[ -z "${PLAN_CMDS[$i]}" ]]; then
    echo "  skip — ${PLAN_SKIP[$i]}"
    RESULTS+=("skip  $name — ${PLAN_SKIP[$i]}")
    SKIPPED=$((SKIPPED + 1))
    echo
    continue
  fi
  case "$name" in
    "tests: "*)
      # A test step's output is kept rather than discarded, so a failure is
      # read from evidence instead of taken on faith.
      OUT="$(eval "${PLAN_CMDS[$i]}" 2>&1)"
      STATUS=$?
      printf '%s\n' "$OUT"
      if [[ $STATUS -eq 0 ]]; then
        RESULTS+=("pass  $name")
      else
        RESULTS+=("FAIL  $name")
        FAILED=$((FAILED + 1))
        echo "  command: ${PLAN_CMDS[$i]}"
        echo "  last 20 lines of output:"
        printf '%s\n' "$OUT" | tail -n 20 | sed 's/^/    /'
      fi
      ;;
    *)
      if eval "${PLAN_CMDS[$i]}"; then
        RESULTS+=("pass  $name")
      else
        RESULTS+=("FAIL  $name")
        FAILED=$((FAILED + 1))
      fi
      ;;
  esac
  echo
done

# --- Repository-wide ----------------------------------------------------------
# Scoped checks cannot see a change that breaks something it never touched. This
# pass runs the whole repository and sorts what fails into three buckets:
#
#   introduced  - a file this branch changed. Blocking; it is this branch's work
#   downstream  - a package depending on one this branch changed. Blocking until
#                 shown otherwise, because that is what an unintended
#                 consequence looks like
#   unrelated   - no path back to this branch. Reported, never blocking. The
#                 author is not made to fix the repository to ship their change
#
# `unrelated` is a claim about provenance, not about history: it means nothing
# here links the failure to this branch, not that the failure predates it. To
# settle that, run the same command on the base ref — see the skill.
WIDE_LINT_FILES_UNRELATED=0
WIDE_LINT_FILES_INTRODUCED=0
WIDE_LINT_SUMMARY=""
DOWNSTREAM_FAILED=()
UNRELATED_FAILED=()

if [[ $RUN_WIDE -eq 1 ]]; then
  echo "──────── repo-lint (whole repository)"
  LINT_OUT="$("$REPO_ROOT/node_modules/.bin/biome" lint --max-diagnostics=none . 2>&1)"
  # The total comes from Biome's own summary line, never from counting matches:
  # a regex over diagnostic headers also matches paths quoted inside code
  # frames, which inflates the number silently.
  WIDE_LINT_SUMMARY="$(printf '%s\n' "$LINT_OUT" | grep -E '^Found [0-9]+ (error|warning)' | tr '\n' ' ')"
  # Files, not findings, decide provenance: a diagnostic in a file this branch
  # changed is this branch's, and the rest is the repository's existing debt.
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    if printf '%s\n' "${CHANGED[@]}" | grep -qx "$path"; then
      WIDE_LINT_FILES_INTRODUCED=$((WIDE_LINT_FILES_INTRODUCED + 1))
    else
      WIDE_LINT_FILES_UNRELATED=$((WIDE_LINT_FILES_UNRELATED + 1))
    fi
  done < <(
    printf '%s\n' "$LINT_OUT" \
      | grep -oE '^[^ ]+\.(ts|tsx|js|jsx|json|jsonc):[0-9]+' | cut -d: -f1 | sort -u
  )
  echo "  ${WIDE_LINT_SUMMARY:-no findings} (Biome's own count)"
  echo "  files with findings this branch changed: $WIDE_LINT_FILES_INTRODUCED"
  echo "  files with findings elsewhere:           $WIDE_LINT_FILES_UNRELATED"
  echo

  if [[ $RUN_TESTS -eq 1 ]]; then
    for name in "${WIDE_NAMES[@]}"; do
      case "$name" in "repo-tests: "*) ;; *) continue ;; esac
      pkg="${name#repo-tests: }"
      echo "──────── $name"
      if [[ -z "$PKG_MANAGER" ]]; then
        echo "  skip — no package manager detected from a lockfile in $REPO_ROOT; set PKG_MANAGER to override"
        SKIPPED=$((SKIPPED + 1))
        echo
        continue
      fi
      script="$(package_script "$REPO_ROOT/$pkg")"
      CMD="$PKG_MANAGER $(dir_flag "$PKG_MANAGER") $REPO_ROOT/$pkg run $script"
      OUT="$(eval "$CMD" 2>&1)"
      STATUS=$?
      if [[ $STATUS -eq 0 ]]; then
        echo "  pass"
      elif printf '%s\n' "${DOWNSTREAM[@]}" | grep -qx "$pkg"; then
        echo "  FAIL — depends on a package this branch changed"
        echo "  command: $CMD"
        echo "  last 20 lines of output:"
        printf '%s\n' "$OUT" | tail -n 20 | sed 's/^/    /'
        DOWNSTREAM_FAILED+=("$pkg")
      else
        echo "  fail — no path back to this branch"
        echo "  command: $CMD"
        echo "  last 20 lines of output:"
        printf '%s\n' "$OUT" | tail -n 20 | sed 's/^/    /'
        UNRELATED_FAILED+=("$pkg")
      fi
      echo
    done
    echo
  fi
fi

# --- Verdict ------------------------------------------------------------------
BLOCKING=$((FAILED + ${#DOWNSTREAM_FAILED[@]}))

echo "════════ pre-PR summary for $BRANCH"
for line in "${RESULTS[@]}"; do echo "  $line"; done

if [[ ${#DOWNSTREAM_FAILED[@]} -gt 0 ]]; then
  echo "  FAIL  downstream packages, which depend on what this branch changed:"
  for pkg in "${DOWNSTREAM_FAILED[@]}"; do echo "          $pkg"; done
fi

if [[ ${#UNRELATED_FAILED[@]} -gt 0 ]]; then
  echo "  note  failing with no path back to this branch — not yours to fix here:"
  for pkg in "${UNRELATED_FAILED[@]}"; do echo "          $pkg"; done
fi

[[ $WIDE_LINT_FILES_UNRELATED -gt 0 ]] && \
  echo "  note  $WIDE_LINT_FILES_UNRELATED file(s) this branch did not touch carry lint findings: ${WIDE_LINT_SUMMARY:-see above}"
[[ $DIRTY -gt 0 ]] && \
  echo "  note  $DIRTY uncommitted change(s) — commit them or they will not be in the pull request"

echo
echo "check-pr: scoped=${#PLAN_NAMES[@]} failed=$FAILED skipped=$SKIPPED downstream_failed=${#DOWNSTREAM_FAILED[@]} unrelated_failed=${#UNRELATED_FAILED[@]} uncommitted=$DIRTY"

if [[ $BLOCKING -gt 0 ]]; then
  echo
  echo "Fix each failure in the skill that owns it; this script owns no rules."
  [[ ${#DOWNSTREAM_FAILED[@]} -gt 0 ]] && echo "A downstream failure is an unintended consequence until the base ref is shown to fail the same way."
  exit 1
fi

if [[ $DIRTY -gt 0 ]]; then
  echo
  echo "Checks pass, but the working tree is not clean."
  exit 1
fi

if [[ ${#UNRELATED_FAILED[@]} -gt 0 || $WIDE_LINT_FILES_UNRELATED -gt 0 ]]; then
  echo
  echo "Ready to open a pull request. Name the unrelated failures above in the description so a reviewer does not read them as yours."
  exit 0
fi

echo "Ready to open a pull request."
