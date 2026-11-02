#!/usr/bin/env bash
# check-stdout — prove the test output belongs to the runner and nobody else.
#
# Usage:
#     bash scripts/check-stdout.sh [<path> ...]      # default: runtime
#
# bun writes its own lines to stderr and exactly one banner line to stdout,
# so anything else on stdout came from the code under test. A suite that
# prints CLI banners hides the one failure a reader opened the log for, and a
# test that drives the real reporter is supposed to capture those bytes with
# `runtime/modules/testing/terminal-capture.ts` rather than let them out.
#
# This is the one check that must NOT go through `bunt | buntap`: the pipe
# folds stderr into stdout, which is exactly the distinction being measured.
# `CLAUDECODE=1` is left off for the same reason — it changes what bun prints.
#
# A local gitignored scratch test that prints is a real failure of this check
# and a false alarm about the repository. Delete the scratch test, or pass a
# narrower path while you are using it.
#
# Exit codes: 0 stdout is the banner and nothing else, 1 something printed.
set -uo pipefail

roots=("$@")
if [[ ${#roots[@]} -eq 0 ]]; then
  roots=(runtime)
fi

# shellcheck disable=SC2312 # the pipeline's own status is not what is measured
stray="$(bun test "${roots[@]}" 2>/dev/null | tail -n +2)"
count="$(printf '%s' "$stray" | grep -c . || true)"

if [[ "$count" -eq 0 ]]; then
  echo "check-stdout: clean — ${roots[*]} printed nothing but bun's banner"
  exit 0
fi

echo "check-stdout: ${count} line(s) on stdout that bun did not write:" >&2
printf '%s\n' "$stray" | sed 's/^/  /' >&2
exit 1
