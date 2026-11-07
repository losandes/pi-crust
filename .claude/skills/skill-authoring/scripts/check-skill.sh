#!/usr/bin/env bash
# Blocking checker for the skills in .claude/skills/.
#
# A broken skill fails silently. It loads, reads plausibly, and instructs the
# reader to run a script that no longer exists or to follow a link that resolves
# nowhere — and nothing reports an error, because nothing is watching.
#
# Usage:
#   check-skill.sh                 # every skill
#   check-skill.sh --all           # every skill, said out loud
#   check-skill.sh <name>...       # named skills, by name or by path
#
# Exit codes: 0 = clean, 1 = violations found, 2 = usage/environment error

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Which skills to check: the project's, when the project has any, otherwise the
# ones beside this script. This skill lives outside every repository it serves,
# so a path derived from its own location would resolve to the home directory
# and check nothing a developer meant.
GLOBAL_SKILLS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="${MY_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
if [[ -d "$REPO_ROOT/.claude/skills" ]]; then
  SKILLS_DIR="$REPO_ROOT/.claude/skills"
else
  SKILLS_DIR="$GLOBAL_SKILLS_DIR"
  REPO_ROOT="$GLOBAL_SKILLS_DIR"
fi

[[ -d "$SKILLS_DIR" ]] || { echo "error: no skills directory at $SKILLS_DIR" >&2; exit 2; }

VIOLATIONS=0
CHECKED=0

report() {
  echo "  $1"
  echo "      [$2] $3"
  VIOLATIONS=$((VIOLATIONS + 1))
}

# In a project, every directory under .claude/skills/ is a skill, and one
# without SKILL.md is a broken skill worth reporting. In the user's own skills
# directory that is not true: shared records live there too, beside the skills
# that cite them, so a directory with no SKILL.md is simply not a skill and
# reporting it would train the reader to ignore this checker's output.
collect_all() {
  if [[ "$SKILLS_DIR" == "$GLOBAL_SKILLS_DIR" ]]; then
    (cd "$SKILLS_DIR" && find . -maxdepth 2 -mindepth 2 -name SKILL.md \
      | sed 's|^\./||; s|/SKILL.md$||' | sort)
  else
    (cd "$SKILLS_DIR" && find . -maxdepth 1 -mindepth 1 -type d | sed 's|^\./||' | sort)
  fi
}

# An argument naming nothing is a usage error, not a finding. Reporting it as
# `no-skill-md` made a typo and a broken skill indistinguishable, and `--all`
# — which the sibling checkers accept — was read as the name of a skill that
# does not exist, so the run said `checked=0 violations=1` about a tree that
# was clean. Paths are accepted too, because tab completion produces one.
SCOPE="all skills"
if [[ "${1:-}" == "--all" ]]; then
  [[ $# -eq 1 ]] || { echo "error: --all takes no other arguments" >&2; exit 2; }
  mapfile -t SKILLS < <(collect_all)
elif [[ $# -gt 0 ]]; then
  SCOPE="given skills"
  SKILLS=()
  for arg in "$@"; do
    name="${arg%/}"
    name="${name##*/}"
    if [[ ! -d "$SKILLS_DIR/$name" ]]; then
      echo "error: no skill named '$name' in $SKILLS_DIR" >&2
      exit 2
    fi
    # A name given twice must not be counted twice: `checked=` is the number
    # this script asks to be believed, and a repeated argument inflates it.
    for seen in ${SKILLS+"${SKILLS[@]}"}; do
      [[ "$seen" == "$name" ]] && continue 2
    done
    SKILLS+=("$name")
  done
else
  mapfile -t SKILLS < <(collect_all)
fi

cd "$REPO_ROOT" || exit 2

for name in "${SKILLS[@]}"; do
  dir="$SKILLS_DIR/$name"
  rel="${SKILLS_DIR#"$REPO_ROOT"/}/$name"
  [[ "$rel" == "$SKILLS_DIR/$name" ]] && rel="$name"
  skill="$dir/SKILL.md"

  if [[ ! -f "$skill" ]]; then
    report "$rel" "no-skill-md" "a skill directory must contain SKILL.md"
    continue
  fi
  CHECKED=$((CHECKED + 1))

  # --- Frontmatter ----------------------------------------------------------
  if ! head -1 "$skill" | grep -qx -- '---'; then
    report "$rel/SKILL.md" "no-frontmatter" "SKILL.md must open with a --- frontmatter block"
    continue
  fi

  fm_name="$(awk '/^---$/{n++; next} n==1 && /^name:/{sub(/^name:[[:space:]]*/,""); print; exit}' "$skill")"
  fm_desc="$(awk '/^---$/{n++; next} n==1 && /^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' "$skill")"

  [[ -n "$fm_name" ]] || report "$rel/SKILL.md" "no-name" "frontmatter needs a name"
  [[ "$fm_name" == "$name" ]] || report "$rel/SKILL.md" "name-mismatch" \
    "frontmatter name '$fm_name' does not match directory '$name'"
  [[ "$fm_name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || report "$rel/SKILL.md" "bad-name" \
    "name must be lowercase letters, digits, and single hyphens"

  if [[ -z "$fm_desc" ]]; then
    report "$rel/SKILL.md" "no-description" "frontmatter needs a description"
  else
    # A YAML plain scalar ends at ': ', and ' #' starts a comment. An unquoted
    # description containing either is unparseable or silently truncated, and a
    # harness that cannot parse the frontmatter drops the whole skill without
    # reporting anything — it simply never appears.
    case "$fm_desc" in
      '"'*|"'"*) ;;
      *": "*)
        report "$rel/SKILL.md" "description-breaks-yaml" \
          "description contains ': ' in an unquoted value; YAML ends the scalar there and the skill is dropped silently — use a dash, or quote the whole value" ;;
      *" #"*)
        report "$rel/SKILL.md" "description-breaks-yaml" \
          "description contains ' #' in an unquoted value; YAML truncates it there as a comment — quote the whole value" ;;
    esac

    # The description is the only thing in context before a skill loads, so a
    # vague one means the skill is never selected. Length is a weak proxy for
    # whether it names concrete triggers, but a short one never does.
    len=${#fm_desc}
    (( len <= 1024 )) || report "$rel/SKILL.md" "description-too-long" \
      "description is $len characters; the limit is 1024"
    (( len >= 120 )) || report "$rel/SKILL.md" "description-too-thin" \
      "description is $len characters; name the file patterns, phrases, and moments that should trigger it"
  fi

  # --- Boundaries -----------------------------------------------------------
  grep -qE '^## Use this skill when' "$skill" || report "$rel/SKILL.md" "no-use-when" \
    "add a 'Use this skill when' section; selection is otherwise guesswork"
  grep -qE '^## Do not use this skill (when|for)' "$skill" || report "$rel/SKILL.md" "no-do-not-use" \
    "add a 'Do not use this skill for' section naming the skill that owns the neighbouring case"

  # --- Links ----------------------------------------------------------------
  # Every relative target is extracted, not only the ones spelled with a leading
  # `./` or `../`. A skill's own references are written `](references/tree.md)`,
  # and requiring the dot skipped all of them — the check reported clean because
  # it was looking at nothing. External schemes and bare anchors are filtered
  # instead, and an anchor is trimmed off a path before it is resolved.
  while IFS= read -r link; do
    case "$link" in
      http://* | https://* | mailto:* | '#'* | /*) continue ;;
    esac
    target="${link%%#*}"
    [[ -n "$target" ]] || continue
    [[ -e "$dir/$target" ]] || report "$rel/SKILL.md" "broken-link" "relative link does not resolve: $target"
  done < <(grep -oE '\]\([^)[:space:]]+\)' "$skill" | sed 's/^](//;s/)$//')

  # --- Referenced scripts ---------------------------------------------------
  # The failure that matters most: a skill whose one blocking step invokes a
  # path that does not exist does nothing, and reports nothing.
  # Two spellings, because a skill is invoked differently depending on where it
  # lives: a project skill names a workspace-relative path, a skill installed
  # outside any project names one relative to itself. Matching only the first
  # made this rule report nothing at all for the second — a check that is
  # disabled rather than satisfied, which is worse than no check.
  while IFS= read -r ref; do
    case "$ref" in
      .claude/skills/*) candidate="$REPO_ROOT/$ref" ;;
      *)                candidate="$dir/$ref" ;;
    esac
    [[ -e "$candidate" ]] || {
      report "$rel/SKILL.md" "missing-script" "SKILL.md invokes a path that does not exist: $ref"
      continue
    }
    if [[ "$ref" == *.sh && ! -x "$candidate" ]]; then
      report "$rel/SKILL.md" "script-not-executable" "referenced script is not executable: $ref"
    fi
  done < <(grep -oE '(\.claude/skills/[A-Za-z0-9._/-]+|(^|[^A-Za-z0-9._/-])scripts/[A-Za-z0-9._-]+)\.(sh|ts|js|py)' "$skill" \
    | sed -E 's|^[^A-Za-z.]||' | sort -u)

  # A skill that points at no check is a document with extra steps. That is a
  # legitimate choice, but it should be a deliberate one.
  if [[ -d "$dir/scripts" ]]; then
    for s in "$dir"/scripts/*; do
      [[ -f "$s" ]] || continue
      base="$(basename "$s")"
      grep -q "$base" "$skill" || report "$rel/scripts/$base" "orphan-script" \
        "script exists but SKILL.md never invokes it"
    done
  fi
done

echo
echo "check-skill: scope=$SCOPE checked=$CHECKED violations=$VIOLATIONS"

if [[ $VIOLATIONS -gt 0 ]]; then
  echo
  echo "Rules: $SCRIPT_DIR/../SKILL.md"
  exit 1
fi

echo "All checked skills conform."
