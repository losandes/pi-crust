# pi-crust: every recipe lives in the package, not in this repository.
# `just crust <recipe>` reaches them; `just crust default` lists them.
#
# `set positional-arguments` + "$@" rather than {{ARGS}}: interpolation
# re-splits on whitespace, which turns a quoted prompt into one word.
set positional-arguments

crust *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    home="${CRUST_HOME:-}"
    pointer="${HOME}/.pi-crust/pi-crust-home"
    if [[ -z "$home" && -f "$pointer" ]]; then
      home="$(cat "$pointer")"
    fi
    if [[ -z "$home" ]]; then
      echo "crust: cannot find the package home." >&2
      echo "  looked at CRUST_HOME (not set) and $pointer (not found)." >&2
      echo "  repair: run 'bun <pi-crust>/scripts/install.ts' in this repository, or set CRUST_HOME to the pi-crust directory." >&2
      exit 2
    fi
    exec bun "$home/runtime/cli.ts" "$@"
