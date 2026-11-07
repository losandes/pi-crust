#!/usr/bin/env bash
# Speaks a short summary aloud. Text comes from the first argument, or stdin.
#
# Deliberately writes no files. The predecessor of this script saved an mp3 per
# invocation and never cleaned them up, which is a directory of stale audio
# nobody ever plays twice.
#
# Exit codes: 0 = spoken, 3 = no speech synthesiser available (non-fatal)

set -uo pipefail

text="${1:-}"
if [[ -z "$text" ]] && [[ ! -t 0 ]]; then
  text="$(cat)"
fi

if [[ -z "${text// /}" ]]; then
  echo "usage: speak.sh \"summary text\"   (or pipe text on stdin)" >&2
  exit 2
fi

# Guard against reading a wall of text aloud. A summary that does not fit here
# is not a summary.
limit=400
if (( ${#text} > limit )); then
  echo "speak.sh: refusing to speak ${#text} characters; keep it under ${limit}" >&2
  echo "speak.sh: shorten the summary rather than raising the limit" >&2
  exit 2
fi

# Respect a quiet environment. A machine that is muted, screen-shared, or in a
# meeting should not be made to talk.
if [[ "${SPOKEN_SUMMARY:-}" == "off" || -n "${CI:-}" ]]; then
  echo "speak.sh: speech suppressed (SPOKEN_SUMMARY=off or CI); text was:" >&2
  echo "$text"
  exit 0
fi

# Each synthesiser is exec'd rather than run-then-`exit 0`, so its exit status
# reaches the caller. Running it and exiting 0 would report success for a
# synthesiser that failed, which is indistinguishable from speech nobody heard.
#
# `set -e` would be the other way to get this, and is deliberately not used:
# the checkers in this directory all run without it because a non-zero grep is
# normal control flow, and speak.sh matches them.
if command -v say >/dev/null 2>&1; then
  # macOS. -r 190 is a little above default; a summary should not dawdle.
  exec say -r 190 "$text"
fi

if command -v spd-say >/dev/null 2>&1; then
  exec spd-say -- "$text"
fi

if command -v espeak-ng >/dev/null 2>&1; then
  exec espeak-ng "$text"
fi

echo "speak.sh: no speech synthesiser found (looked for say, spd-say, espeak-ng)" >&2
echo "$text"
exit 3
