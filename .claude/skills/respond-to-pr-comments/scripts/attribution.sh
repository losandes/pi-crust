#!/usr/bin/env bash
# Prints the attribution lines for anything published under the developer's
# GitHub credentials by an agent.
#
# The harness is detected rather than assumed. This skill is read by whatever
# agent is running — pi, Claude Code, Cursor, or something not listed here — and
# a hardcoded name would be a false statement the moment the skill is read by a
# different one. That is worse than no attribution, because it is confidently
# wrong about who wrote the text.
#
# The model is NOT detected. No harness exposes it reliably, and guessing at it
# would reintroduce the problem this script exists to avoid. The agent knows
# which model it is and passes it in.
#
# Usage:
#   attribution.sh header [--model <name>] [--user <login>]
#   attribution.sh footer [--model <name>] [--user <login>] [--note <text>]
#
# Exit codes: 0 = ok, 2 = usage/environment error

set -uo pipefail

WHICH="${1:-}"
shift || true

MODEL=""
USER_LOGIN=""
NOTE=""

# Each flag validates its value before shifting. Without the guard, `shift 2`
# with one argument left fails, `$1` still holds the flag, and the loop spins
# forever rather than erroring \u2014 a hang, not a usage message.
needs_value() {
  [[ -n "${2:-}" ]] || { echo "error: $1 needs a value" >&2; exit 2; }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) needs_value "$1" "${2:-}"; MODEL="$2"; shift 2 ;;
    --user) needs_value "$1" "${2:-}"; USER_LOGIN="$2"; shift 2 ;;
    --note) needs_value "$1" "${2:-}"; NOTE="$2"; shift 2 ;;
    *) echo "error: unknown option $1" >&2; exit 2 ;;
  esac
done

case "$WHICH" in
  header | footer) ;;
  *) echo "usage: attribution.sh header|footer [--model <name>] [--user <login>] [--note <text>]" >&2; exit 2 ;;
esac

# Markers are checked most-specific first. An unknown harness is named as such
# rather than guessed at.
detect_harness() {
  if [[ -n "${PI_CODING_AGENT:-}" || -n "${PI_CONFIG_DIR:-}" ]]; then
    echo "pi"
  elif [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_CODE:-}" || -n "${CLAUDE_CODE_ENTRYPOINT:-}" ]]; then
    echo "Claude Code"
  elif [[ -n "${CURSOR_TRACE_ID:-}" || "${TERM_PROGRAM:-}" == "cursor" ]]; then
    echo "Cursor"
  elif [[ -n "${AIDER_MODEL:-}" ]]; then
    echo "Aider"
  elif [[ -n "${GITHUB_COPILOT_AGENT:-}" ]]; then
    echo "Copilot"
  else
    echo ""
  fi
}

HARNESS="$(detect_harness)"

if [[ -z "$USER_LOGIN" ]]; then
  USER_LOGIN="$(gh api user --jq .login 2>/dev/null || true)"
fi
ACCOUNT="${USER_LOGIN:+@$USER_LOGIN}"
ACCOUNT="${ACCOUNT:-the account owner}"

# "an AI coding agent" is the honest floor: it is true of every harness, and it
# is what a reader needs to know even when the tool cannot name itself.
if [[ -n "$HARNESS" && -n "$MODEL" ]]; then
  WHO="$HARNESS (an AI coding agent running $MODEL)"
elif [[ -n "$HARNESS" ]]; then
  WHO="$HARNESS (an AI coding agent)"
elif [[ -n "$MODEL" ]]; then
  WHO="an AI coding agent ($MODEL)"
else
  WHO="an AI coding agent"
fi

SHORT="${HARNESS:-an AI coding agent}"

if [[ "$WHICH" == "header" ]]; then
  echo "> Written by $WHO on behalf of $ACCOUNT, who did not write this text."
else
  if [[ -n "$NOTE" ]]; then
    echo "— $SHORT, on behalf of $ACCOUNT. $NOTE"
  else
    echo "— $SHORT, on behalf of $ACCOUNT."
  fi
fi
