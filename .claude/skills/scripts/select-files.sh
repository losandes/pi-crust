#!/usr/bin/env bash
# The scope protocol every checker shares.
#
# Sourced, never executed. Defines:
#   select_files <find expression...> -- "$@"
#
# Sets SCOPE (for the summary line) and SELECTED (absolute paths). The caller
# supplies `collect_changed`, because what counts as changed differs by file
# type, and the find expression for `--all`.
#
#   --all        every matching file under the workspace
#   --help       the usage header from the calling script
#   (nothing)    what changed against git
#   <path>...    those files, and every match inside those directories
#
# One implementation because the four copies disagreed on things nobody chose:
# whether a directory argument expands, whether a missing path is an error or
# a silent skip, and whether results come back relative or absolute. Absolute
# wins — it survives a `cd`, and a caller that wants relative can strip a
# prefix it already knows.
select_files() {
  local expr=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do expr+=("$1"); shift; done
  shift || true

  SCOPE="changed vs git"
  SELECTED=()
  local root arg abs found
  root="$(workspace_root)"

  case "${1:-}" in
    --all)
      SCOPE="all files"
      while IFS= read -r found; do SELECTED+=("$found"); done < <(find_files "$root" "${expr[@]}")
      ;;
    --help | -h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    "")
      while IFS= read -r found; do SELECTED+=("$found"); done < <(collect_changed)
      ;;
    -*)
      echo "error: unknown option $1" >&2
      exit 2
      ;;
    *)
      SCOPE="given paths"
      for arg in "$@"; do
        [[ -e "$arg" ]] || { echo "error: no such path: $arg" >&2; exit 2; }
        if [[ -d "$arg" ]]; then
          abs="$(cd "$arg" && pwd -P)"
          while IFS= read -r found; do SELECTED+=("$found"); done < <(find_files "$abs" "${expr[@]}")
        else
          abs="$(cd "$(dirname "$arg")" && pwd -P)/$(basename "$arg")"
          SELECTED+=("$abs")
        fi
      done
      ;;
  esac
}
