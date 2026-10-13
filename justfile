# pi-crust: every recipe lives in the package, not in this repository.
# `just crust <recipe>` reaches them; `just crust default` lists them.
#
# `set positional-arguments` + "$@" rather than {{ARGS}}: interpolation
# re-splits on whitespace, which turns a quoted prompt into one word.
set positional-arguments

crust *ARGS:
    @bun "$(cat .pi-crust/data/pi-crust-home)/runtime/cli.ts" "$@"
