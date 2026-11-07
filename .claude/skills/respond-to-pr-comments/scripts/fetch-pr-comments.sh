#!/usr/bin/env bash
# Collects every comment surface on a pull request into one list.
#
# A pull request holds feedback in four places, and reading one of them is the
# usual way to miss half of it:
#
#   review threads   inline comments on a file and line, which carry resolved
#                    and outdated state
#   review bodies    the summary a reviewer writes when submitting
#   issue comments   top-level conversation, where most bots post
#   review state     APPROVED / CHANGES_REQUESTED / COMMENTED
#
# Resolved and outdated threads are reported, not hidden: a resolved thread may
# have been resolved without the change being made, and an outdated one points
# at a line that has since moved.
#
# Usage:
#   fetch-pr-comments.sh <pr-number|url> [--repo owner/name] [--unresolved]
#
# Exit codes: 0 = ok, 2 = usage/environment error

set -uo pipefail

command -v gh >/dev/null || { echo "error: gh is not installed" >&2; exit 2; }

PR=""
REPO=""
ONLY_UNRESOLVED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --unresolved) ONLY_UNRESOLVED=1; shift ;;
    --help | -h) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "error: unknown option $1" >&2; exit 2 ;;
    *) PR="$1"; shift ;;
  esac
done

[[ -n "$PR" ]] || { echo "error: a pull request number or URL is required" >&2; exit 2; }

# Accept a URL, a #-prefixed number, or a bare number. A URL also carries the
# repository, so it wins over --repo rather than being silently ignored.
if [[ "$PR" =~ ^https?://[^/]+/([^/]+/[^/]+)/pull/([0-9]+) ]]; then
  REPO="${BASH_REMATCH[1]}"
  PR="${BASH_REMATCH[2]}"
fi
PR="${PR#\#}"
[[ "$PR" =~ ^[0-9]+$ ]] || { echo "error: '$PR' is not a pull request number" >&2; exit 2; }

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" || {
    echo "error: no repository; pass --repo owner/name" >&2; exit 2
  }
fi

OWNER="${REPO%%/*}"
NAME="${REPO##*/}"

gh api graphql -f owner="$OWNER" -f name="$NAME" -F number="$PR" -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      state
      isDraft
      headRefName
      baseRefName
      reviews(first: 50) {
        nodes {
          author { login }
          state
          submittedAt
          body
        }
      }
      comments(first: 100) {
        nodes { author { login } createdAt body }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 20) {
            nodes { author { login } createdAt body }
          }
        }
      }
    }
  }
}' --jq '
  .data.repository.pullRequest as $pr
  | "PR #\($pr.number) — \($pr.title)\nstate: \($pr.state)  draft: \($pr.isDraft)  head: \($pr.headRefName) -> \($pr.baseRefName)\n"
  + "\n==== review threads ====\n"
  + ([$pr.reviewThreads.nodes[]
      | select('"$ONLY_UNRESOLVED"' == 0 or .isResolved == false)
      | "\n--- \(.path):\(.line // "?")  resolved=\(.isResolved) outdated=\(.isOutdated)\n"
        + ([.comments.nodes[] | "  @\(.author.login // "unknown") \(.createdAt)\n\(.body)\n"] | join("\n"))
     ] | join(""))
  + "\n==== review summaries ====\n"
  + ([$pr.reviews.nodes[]
      | select((.body // "") != "" or .state != "COMMENTED")
      | "\n--- @\(.author.login // "unknown") \(.state) \(.submittedAt)\n\(.body)\n"
     ] | join(""))
  + "\n==== conversation ====\n"
  + ([$pr.comments.nodes[]
      | "\n--- @\(.author.login // "unknown") \(.createdAt)\n\(.body)\n"
     ] | join(""))
'
