#!/usr/bin/env bash
# Directories no checker should ever walk into.
#
# Sourced, never executed. Defines:
#   PRUNED_DIRS   the list
#   is_pruned <path>            true when a path lies inside one
#   find_files <root> <args...> find, with the list applied as -prune
#
# Dependencies, build output and caches are not prose, not tests, and not
# records. Every checker had its own copy of this list and they had already
# drifted apart — one pruned .turbo and .venv, another stopped at coverage.
PRUNED_DIRS=(node_modules .git dist build coverage .next .turbo .venv temp-data)

is_pruned() {
  local path="$1" dir
  for dir in "${PRUNED_DIRS[@]}"; do
    case "$path" in */"$dir"/* | "$dir"/* | */"$dir" ) return 0 ;; esac
  done
  return 1
}

# find_files <root> <find expression...>   e.g. find_files "$ROOT" -name '*.md'
find_files() {
  local root="$1"
  shift
  local prune=() dir
  for dir in "${PRUNED_DIRS[@]}"; do prune+=(-name "$dir" -o); done
  unset 'prune[${#prune[@]}-1]'
  find "$root" \( "${prune[@]}" \) -prune -o -type f \( "$@" \) -print | sort
}
