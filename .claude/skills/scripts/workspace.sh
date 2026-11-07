#!/usr/bin/env bash
# Where the work is, and what to compare it against.
#
# Sourced, never executed. Defines:
#   workspace_root   the project being worked in, as a physical path
#   base_ref         the branch a pull request would target

# The project being worked in, NOT a path derived from a script's location.
# These skills live outside every repository they serve, so walking up from the
# script reaches the home directory.
#
# `pwd -P` on both sides: `git rev-parse --show-toplevel` reports the physical
# path (/private/var/...) while `pwd` reports the symlinked one (/var/...) on
# macOS. Mixing them makes a prefix strip fail silently, which once left a
# checker reporting "conforms" about a file it never read.
#
# MY_WORKSPACE overrides, for a workspace nested inside a larger repository
# where the git root would drag in unrelated code.
workspace_root() {
  local root
  if [[ -n "${MY_WORKSPACE:-}" ]]; then
    root="$MY_WORKSPACE"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="$PWD"
  fi
  (cd "$root" 2>/dev/null && pwd -P) || printf '%s\n' "$root"
}

# The branch a pull request from here would target.
#
# Asked of git rather than guessed: `origin/HEAD` is the default branch the
# remote itself declares, so a repository using `latest`, `trunk` or anything
# else answers correctly without being listed here. The fallbacks exist for
# clones where `origin/HEAD` was never set, which is common after a bare
# `git clone` of some mirrors.
base_ref() {
  local declared candidate
  declared="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
  if [[ -n "$declared" ]]; then
    printf '%s\n' "$declared"
    return 0
  fi
  for candidate in origin/main origin/latest origin/master main latest master; do
    if git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}
