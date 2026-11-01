# pi-crust starter recipes. Stamped by the crust skill, then yours to edit.
#
# Reached from the repo root justfile through `mod crust '.pi-crust/crust.just'`, so
# every recipe here is `just crust <recipe>`. The namespace is deliberate: a repo
# usually already has a justfile, and `just crust plan` says which factory you
# are driving.

set dotenv-load
set positional-arguments

# just runs a MODULE's recipes in the module's own directory, so without this
# every `.pi-crust/...` path below resolves to `.pi-crust/.pi-crust/...` and nothing runs.
# The paths are spelled from the workspace root because that is where a
# developer stands and what the config's own paths are relative to.

# Every recipe passes this through, so `CRUST_CONFIG=other.yaml just crust sdlc "..."`
# swaps the whole roster for one run.
#
# The observability UI takes two more: CRUST_BE_PORT (the API) and
# CRUST_FE_PORT (the web app). Both are read by `observe` and by every run,
# which prints a link to itself when the API answers. Unset, the ports come
# from `ports:` in .pi-crust/config/crust.observe.yaml (4600 and 4601), which
# is where to move them for good rather than for one shell.
# Where pi-crust itself is installed. The runtime ships with the package
# rather than with the stamp, so every recipe resolves it rather than
# assuming a path. The installer writes it down; CRUST_HOME overrides.
#
# Resolution chain (1.6.1): CRUST_HOME; this tree's own stamp pointer at
# .pi-crust/data/pi-crust-home; then the pointer beside the shared git
# directory every worktree of one clone names through
# `git rev-parse --git-common-dir` — so a linked worktree that was never
# re-stamped still finds the package through the clone it came from.
#
# The backtick below is evaluated EAGERLY by `just`, even when CRUST_HOME is
# already set (proven: a `just` backtick runs before `env_var_or_default`
# gets to look at its first argument) — which is why it checks CRUST_HOME
# itself and exits 0 with nothing to say when it is set, rather than failing
# a run that would never have used its answer anyway.
crust := env_var_or_default("CRUST_HOME", `
  if [ -n "${CRUST_HOME:-}" ]; then
    exit 0
  fi
  if [ -f .pi-crust/data/pi-crust-home ]; then
    cat .pi-crust/data/pi-crust-home
    exit 0
  fi
  common="$(git rev-parse --git-common-dir 2>/dev/null || true)"
  if [ -n "$common" ]; then
    root="$(cd "$(dirname "$common")" && pwd)"
    if [ -f "$root/.pi-crust/data/pi-crust-home" ]; then
      cat "$root/.pi-crust/data/pi-crust-home"
      exit 0
    fi
  fi
  echo "pi-crust: cannot find the package home." >&2
  echo "  checked CRUST_HOME, .pi-crust/data/pi-crust-home, and \$(git rev-parse --git-common-dir)/../.pi-crust/data/pi-crust-home." >&2
  echo "  set CRUST_HOME to repair it." >&2
  exit 2
` / "runtime")
config := env_var_or_default("CRUST_CONFIG", ".pi-crust/config/crust.config.yaml")
# Resolved from the configuration in force (1.6.5) rather than assumed, so
# `sessions`, `activity-runs`, `tail`, `procs` and `observe` agree with every
# other reader of `observability.db` once a store is relocated or pooled.
#
# This, like `crust` above, is evaluated EAGERLY by every recipe in this
# file, including ones that never read {{db}} — so a failure here falls
# back to the old literal default rather than taking down `list`, `run` and
# everything else that does not touch the trace database at all.
db := shell('bun "$1/print-db-path.ts" --config "$2" 2>/dev/null || echo ".pi-crust/data/crust.db"', crust, config)

# list every crust recipe
default:
    @just --justfile "{{justfile()}}" --list

# ── first run ───────────────────────────────────────────────────────────────

# Proves the whole path works: config validated, session minted, agent ran,
# envelope parsed, gates checked, trace written. Costs a few cents and changes
# nothing in your repo, because both workflows are read-only.
#
# (`just --list` shows only the LAST comment line, so that one is the summary.)

# start here: two cheap read-only runs, end to end
demo:
    @echo "1/2  scout: read-only recon"
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "list the top-level directories in this repo and what each is for. change nothing." --activities scout
    @echo "\n2/2  identify: the outcome and how success is recognised"
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "state the outcome a newcomer to this repo would want from it, and how they would know they had it" --activities identify
    @echo "\nboth done. now run:  just crust sessions    (or: just crust observe)"

# ── run something ───────────────────────────────────────────────────────────
# There is no recipe per Activity or per Lifecycle. There used to be twenty,
# hand-written, and they were a second copy of the registry in a file the
# configuration cannot reach: four Lifecycles were added and these recipes
# went on offering three. What can run is read from crust.activities.yaml and
# crust.lifecycles.yaml at run time, by `run` and by `list`.
#
# Args pass straight through: "<prompt or path/to/prompt.md>" [--run-id X]

# what this repository offers, read from its own configuration: just crust list
list *ARGS:
    @bun "{{crust}}/catalogue.ts" --config {{config}} "$@"

# Every effective defaults.* and observability.* value, and the file that set
# it \u2014 a repository's own crust.config.yaml, its gitignored .local layer, or
# ~/.pi-crust/config/crust.config.yaml's ordinary or override: section.
# what is actually in force, and where it came from: just crust config
config *ARGS:
    @bun "{{crust}}/show-config.ts" --config {{config}} "$@"

# A Lifecycle by name:
#     just crust run "add a /health endpoint" --lifecycle sdlc
# or any chain, Stage by Stage — `,` ends a Stage, `+` runs Activities at once:
#     just crust run "add a /health endpoint" --activities plan,build,review+code-review
#     just crust run "where is auth handled" --activities scout

# run a Lifecycle, or any chain of Activities: just crust run "..." --lifecycle sdlc
run *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@"

# Any run resumes: add --run-id <id> --resume to it, e.g.
#     just crust run "the original request" --lifecycle sdlc --run-id 9d67c31f --resume
# `just crust report` prints that exact line for the run it describes.

# --handoff <path> moves where this run's documents go. {session_id} (or
# {run_id}, an exact synonym) expands to the run id; a relative path resolves
# against the repository root. With no flag, nothing changes:
#     just crust run "..." --lifecycle sdlc --handoff specs/{session_id}
# --name <label> gives the run a label shown instead of the lifecycle on the
# report, the `please` picker, and the visualizer:
#     just crust run "..." --lifecycle sdlc --name "payments rewrite"

# Runs the commands routing.checks selects for what you changed, with no
# Lifecycle, no agent and no session. The same checks run as the `checks`
# gate inside a run; this is them on their own, for a pre-PR sweep.
# run the checks the changed paths select: just crust verify
verify *ARGS:
    @bun "{{crust}}/checks.ts" --config {{config}} "$@"

# ── let something else choose the chain ─────────────────────────────────────

# let it choose the chain and run it: just crust operator "the webhook drops retries"
operator *ARGS:
    bun "{{crust}}/stages/operator.ts" --config {{config}} "$@"

# Prints the run command and the reasoning behind it; starts nothing.
# recommend a lifecycle instead of running it: just crust triage "..."
triage *ARGS:
    bun "{{crust}}/stages/triage.ts" --config {{config}} "$@"

# build the command by answering questions: just crust please
please:
    @bun "{{crust}}/please.ts"

# ── watch it ────────────────────────────────────────────────────────────────
# Reads never block a running workflow, the db is WAL. Poll as hard as you like.

# continue a run that is waiting for you: just crust approve <run_id>
approve RUN_ID:
    @bun "{{crust}}/decide.ts" approve {{RUN_ID}}

# send it back with a correction: just crust reject <run_id> --note "..."
reject RUN_ID *ARGS:
    @bun "{{crust}}/decide.ts" reject {{RUN_ID}} "$@"

# answer the questions it could not: just crust answer <run_id> --file a.md
answer RUN_ID *ARGS:
    @bun "{{crust}}/decide.ts" answer {{RUN_ID}} "$@"

# where a run got to, and what to run to finish it: just crust report [<run_id>]
report *ARGS:
    @bun "{{crust}}/report.ts" --config {{config}} "$@"

# the same, as JSON for an agent to parse: just crust report-json <run_id>
report-json *ARGS:
    @bun "{{crust}}/report.ts" --config {{config}} --json "$@"

# the last 10 runs
sessions:
    @sqlite3 {{db}} "select run_id, status, substr(request,1,50), total_tokens, round(total_cost,4) from sessions order by started_at desc limit 10;"

# activity run status in sequence: just crust activity-runs <run_id>
activity-runs RUN_ID:
    @sqlite3 {{db}} "select seq, name, kind, owner, status from activity_runs where run_id='{{RUN_ID}}' order by seq;"

# the live event tail: just crust tail <run_id>
tail RUN_ID:
    @sqlite3 {{db}} "select rowid, type, name, started_at from events where run_id='{{RUN_ID}}' order by rowid desc limit 25;"

# what a run has alive right now, with pids: just crust procs <run_id>
procs RUN_ID:
    @sqlite3 {{db}} "select kind, name, pid, command, started_at from processes where run_id='{{RUN_ID}}' and ended_at is null order by id;"

# forget runs older than N days, on disk and in the trace together.
# Dry by default: add --yes to actually delete. just crust prune 14d
prune AGE *ARGS:
    @bun "{{crust}}/prune.ts" --older-than {{AGE}} "$@"

# ask a finished activity a question — it still remembers the conversation.
# just crust ask <run_id> <activity> "why did you choose a registry table?"
ask RUN_ID ACTIVITY *QUESTION:
    @bun "{{crust}}/consult.ts" ask {{RUN_ID}} {{ACTIVITY}} "$@"

# send a run back to an activity with new instructions: it and every activity
# after it run again. --overwrite or --branch is REQUIRED; neither is default.
# --branch also takes --seeding fork|fresh (fork is the default) and
# --branch-id <id> to name the branch instead of minting one.
# just crust steer <run_id> <activity> --overwrite "use the registry, not the map"
# just crust steer <run_id> <activity> --branch --seeding fresh "start over"
steer RUN_ID ACTIVITY *ARGS:
    @bun "{{crust}}/steer.ts" {{RUN_ID}} {{ACTIVITY}} "$@"

# pick a stopped run back up, optionally with a note every activity from here reads.
# just crust resume <run_id> --note "I fixed the failing migration"
resume RUN_ID *ARGS:
    @bun "{{crust}}/resume.ts" {{RUN_ID}} "$@"

# have a finished activity revise ITS OWN document. Every other activity's
# stays read-only. just crust amend <run_id> <activity> "shorten section 3"
amend RUN_ID ACTIVITY *INSTRUCTION:
    @bun "{{crust}}/consult.ts" amend {{RUN_ID}} {{ACTIVITY}} "$@"

# the working trees this machine has run in — the observer watches them all
trees:
    @bun "{{crust}}/workspaces.ts" list

# Only removes it from this machine's list; nothing on disk is deleted.
# stop watching a tree: just crust forget-tree /path/to/worktree
forget-tree *PATHS:
    @bun "{{crust}}/workspaces.ts" forget "$@"

# ── observability UI ────────────────────────────────────────────────────────

# Needs bun. The db path is passed explicitly because the server runs from the
# app dir and would otherwise look for a trace db sitting next to itself.
#
# ARGS reach VITE, not the API — `--host` to listen on every interface so a
# phone or another machine can watch a run, `--open`, `--strictPort`. The API
# is configured by CRUST_BE_PORT because it is the thing behind the thing;
# flags belong to the process you are actually looking at.
#
# Pass them straight through — NO `--` separator:
#     just crust observe --host
#     just crust observe --host 127.0.0.1 --strictPort
#
# `just crust observe -- --host` does NOT work, which is the opposite of the
# habit most tools teach. Tested: with the separator vite reports "use --host
# to expose", so it never sees the flag; without it, the Network line appears.

# Re-stamps everything pi-crust owns and proves the result matches. It REPLACES
# files the template owns and REMOVES NOTHING: data/ has no counterpart in the
# template, so the trace database and every session directory are untouched.
# config/ is yours and is skipped. A breaking schema change is a separate,
# explicitly invoked migration — never part of this.

# bring this tree up to date with the pi-crust it was stamped from
update:
    #!/usr/bin/env bash
    set -euo pipefail
    home="${CRUST_HOME:-}"
    if [[ -z "$home" && -f .pi-crust/data/pi-crust-home ]]; then
      home="$(cat .pi-crust/data/pi-crust-home)"
    fi
    if [[ -z "$home" ]]; then
      common="$(git rev-parse --git-common-dir 2>/dev/null || true)"
      if [[ -n "$common" ]]; then
        root="$(cd "$(dirname "$common")" && pwd)"
        if [[ -f "$root/.pi-crust/data/pi-crust-home" ]]; then
          home="$(cat "$root/.pi-crust/data/pi-crust-home")"
        fi
      fi
    fi
    if [[ -z "$home" || ! -f "$home/scripts/install.ts" ]]; then
      echo "update: cannot find pi-crust${home:+ at $home}." >&2
      echo "  checked CRUST_HOME, .pi-crust/data/pi-crust-home, and \$(git rev-parse --git-common-dir)/../.pi-crust/data/pi-crust-home." >&2
      echo "  run its installer from this directory, or set CRUST_HOME to the package." >&2
      exit 2
    fi
    bun "$home/scripts/install.ts" --force
    "$home/scripts/verify-install.sh"

# The app itself is not in this tree. It ships with pi-crust, which may be a
# sibling checkout, a global install or a node_modules directory, so the
# installer writes down where it was and this recipe reads that back. Set
# CRUST_HOME to override it, which is also the repair when pi-crust moves.

# boot the trace UI on the ports crust.observe.yaml names (4601, api on 4600)
observe *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    home="${CRUST_HOME:-}"
    if [[ -z "$home" && -f .pi-crust/data/pi-crust-home ]]; then
      home="$(cat .pi-crust/data/pi-crust-home)"
    fi
    if [[ -z "$home" ]]; then
      common="$(git rev-parse --git-common-dir 2>/dev/null || true)"
      if [[ -n "$common" ]]; then
        root="$(cd "$(dirname "$common")" && pwd)"
        if [[ -f "$root/.pi-crust/data/pi-crust-home" ]]; then
          home="$(cat "$root/.pi-crust/data/pi-crust-home")"
        fi
      fi
    fi
    if [[ -z "$home" || ! -f "$home/scripts/observe.ts" ]]; then
      echo "observe: cannot find pi-crust${home:+ at $home}." >&2
      echo "  checked CRUST_HOME, .pi-crust/data/pi-crust-home, and \$(git rev-parse --git-common-dir)/../.pi-crust/data/pi-crust-home." >&2
      echo "  re-run its installer from this directory, or set CRUST_HOME to the package." >&2
      exit 2
    fi
    # No port defaults here: observe.ts reads crust.observe.yaml, and a
    # default spelled in this recipe would override the file every time.
    # CRUST_BE_PORT and CRUST_FE_PORT are inherited when they are set, which
    # is how a one-off clash is still answered from the shell.
    # $PWD, not justfile_directory(): these recipes live in the pi-crust
    # package, so the justfile's own directory is the package's, and the
    # trace database belongs to the repository `just` is being run against.
    # {{db}} is left unprefixed when it is already absolute: print-db-path.ts
    # returns an absolute path whenever data_dir is absolute, ~-prefixed, or
    # uses {primary_worktree}, and unconditionally prepending $PWD to an
    # absolute path would mangle it into something under the wrong tree.
    db_path="{{db}}"
    case "$db_path" in /*) ;; *) db_path="$PWD/$db_path" ;; esac
    CRUST_DB="$db_path" \
    exec bun "$home/scripts/observe.ts" "$@"
