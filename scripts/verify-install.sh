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
#   config/   the roster and routing belong to the repository; the template
#             ships empty lists with commented examples
#   data/     runtime — sessions and the trace database
#   *.test.ts never stamped (install.ts skips them), so they live only in the
#             template, which is where `bun test` runs them
#
# Exit 0 when they agree, 1 on drift, 2 when nothing is installed to compare.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$SKILL_DIR/templates/pi-crust"
ROOT="${1:-$(pwd)}"
INSTALLED="$ROOT/.pi-crust"

if [[ ! -d "$INSTALLED" ]]; then
  echo "verify-install: nothing installed at $INSTALLED" >&2
  echo "  run: bun $SKILL_DIR/scripts/install.ts" >&2
  exit 2
fi

skip_find=(-not -path './node_modules/*' -not -path './data/*'
           -not -path './config/*' -not -name '*.test.ts' -not -name 'bun.lock')

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
