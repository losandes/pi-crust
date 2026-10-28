#!/usr/bin/env bash
# Prove an installed .pi-crust/ is the tree this skill ships.
#
# The skill's template is the source; `install.ts` stamps it into a repository
# as `.pi-crust/`. A file edited in one and not the other ships a factory that
# behaves differently from the one it was tested in, and nothing about that is
# visible until a run does something unexpected.
#
# Run it after installing, and after any change to the template:
#
#     bun <pi-crust>/scripts/install.ts
#     <pi-crust>/scripts/verify-install.sh
#
# Three things legitimately differ, and nothing else may:
#   config/   the registries belong to the repository; the template ships
#             starting points a team then edits
#   data/     runtime — sessions and the trace database
#   prompt-engineering/
#             a team's own prompts. The template stamps only a README and an
#             example, and anything else there was written by the repository.
#
# Everything the runtime is made of lives in the package rather than in the
# stamp, so there is far less to compare than there once was.
#
# Exit 0 when they agree, 1 on drift, 2 when nothing is installed to compare.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$SKILL_DIR/templates/stamp"
ROOT="${1:-$(pwd)}"
INSTALLED="$ROOT/.pi-crust"

# A template directory that is not there must stop the run.
#
# The comparison below walks the template and asks what the install is
# missing. An absent template walks nothing, finds nothing missing, and then
# reports every installed file as unexpected — a wrong answer that reads like
# a finding. This is how a renamed directory presented itself as drift=40.
if [[ ! -d "$TEMPLATE" ]]; then
  echo "verify-install: no template at $TEMPLATE" >&2
  echo "  the pi-crust package is incomplete or has moved" >&2
  exit 2
fi

if [[ ! -d "$INSTALLED" ]]; then
  echo "verify-install: nothing installed at $INSTALLED" >&2
  echo "  run: bun $SKILL_DIR/scripts/install.ts" >&2
  exit 2
fi

skip_find=(-not -path './node_modules/*' -not -path './data/*'
           -not -path './config/*' -not -path './prompt-engineering/*'
           -not -name '*.test.ts' -not -name 'bun.lock')

drift=0
while IFS= read -r rel; do
  rel="${rel#./}"
  if [[ ! -f "$INSTALLED/$rel" ]]; then
    echo "  missing from the install: $rel"
    drift=$((drift + 1))
  elif ! cmp -s "$TEMPLATE/$rel" "$INSTALLED/$rel"; then
    echo "  differs: $rel"
    drift=$((drift + 1))
  fi
done < <(cd "$TEMPLATE" && find . -type f "${skip_find[@]}")

while IFS= read -r rel; do
  rel="${rel#./}"
  if [[ ! -f "$TEMPLATE/$rel" ]]; then
    echo "  present in the install but not in the template: $rel"
    drift=$((drift + 1))
  fi
done < <(cd "$INSTALLED" && find . -type f "${skip_find[@]}")

echo "verify-install: drift=$drift"
[[ $drift -eq 0 ]] || exit 1
echo "The installed tree is the one this skill ships."
