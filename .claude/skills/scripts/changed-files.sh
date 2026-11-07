#!/usr/bin/env bash
# What git says changed, as absolute paths.
#
# Sourced, never executed. Defines:
#   changed_files <extended-regex> [root]
#
# Working tree, index and untracked files together, because a checker that
# ignored staged changes let a developer stage a violation and be told the
# tree was clean. Paths come back absolute: every caller was converting in a
# different direction, and absolute is the form that survives a `cd`.
#
# A directory that is not a git repository yields nothing and succeeds. Not
# being in a repository is a reason to pass paths explicitly, not a failure.
changed_files() {
  local pattern="$1"
  local root="${2:-$(workspace_root)}"
  local git_root rel abs

  git_root="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)" || return 0
  git_root="$(cd "$git_root" && pwd -P)"

  {
    git -C "$git_root" diff --name-only --diff-filter=ACMR HEAD 2>/dev/null
    git -C "$git_root" diff --name-only --diff-filter=ACMR --cached 2>/dev/null
    git -C "$git_root" ls-files --others --exclude-standard 2>/dev/null
  } | sort -u | while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    [[ "$rel" =~ $pattern ]] || continue
    abs="$git_root/$rel"
    [[ -f "$abs" ]] || continue
    # The git root can be an ancestor of the workspace. Anything outside the
    # workspace belongs to another project and is not ours to judge.
    case "$abs" in "$root"/*) printf '%s\n' "$abs" ;; esac
  done
}
