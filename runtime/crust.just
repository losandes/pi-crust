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
crust  := env_var_or_default("CRUST_HOME", `cat .pi-crust/data/pi-crust-home 2>/dev/null || echo ""` / "runtime")
config := env_var_or_default("CRUST_CONFIG", ".pi-crust/config/crust.config.yaml")
db     := ".pi-crust/data/crust.db"

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
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "list the top-level directories in this repo and what each is for. change nothing." --steps scout
    @echo "\n2/2  identify: the outcome and how success is recognised"
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "state the outcome a newcomer to this repo would want from it, and how they would know they had it" --steps identify
    @echo "\nboth done. now run:  just crust sessions    (or: just crust observe)"

# ── run a stage, or a whole lifecycle ───────────────────────────────────────
# Args pass straight through: "<prompt or path/to/prompt.md>" [--run-id X]

# read-only recon: just crust scout "where is auth handled"
scout *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps scout

# 1.2 the outcome and how success is recognised: just crust identify "..."
identify *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps identify

# 1.2b reproduce it and name the cause: just crust diagnose "playback stops after track 3"
diagnose *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps diagnose

# 1.3 what the solution must mean and do: just crust conceptualize "..."
conceptualize *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps conceptualize

# 2.2 how it physically exists here: just crust design "..."
design *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps design

# plan only: just crust plan "add a /health endpoint"
plan *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps plan

# write the tests that would prove it: just crust test "add a /health endpoint"
test *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps test

# implement only: just crust build "add a /health endpoint"
build *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps build

# Runs the commands routing.checks selects for what you changed, with no
# Lifecycle, no agent and no session. The same checks run as the `checks`
# gate inside a run; this is them on their own, for a pre-PR sweep.
# run the checks the changed paths select: just crust verify
verify *ARGS:
    @bun "{{crust}}/checks.ts" --config {{config}} "$@"

# is it what was asked for: just crust review "add a /health endpoint"
review *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps review

# does it match this repo's conventions: just crust code-review "the /health work"
code-review *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps code-review

# write it up from the diff: just crust document "the /health work"
document *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps document

# the whole lifecycle, identify through code-review: just crust sdlc "add a /health endpoint"
sdlc *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --lifecycle sdlc

# prove the risky part before building it: just crust de-risk "move sessions to redis"
de-risk *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --lifecycle de-risk

# a reported bug, start to finish: just crust bugfix "playback stops after track 3"
bugfix *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --lifecycle bugfix

# any ordered subset: just crust compose "..." --steps plan,test,build
compose *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@"

# Any stage or lifecycle resumes: add --run-id <id> --resume to it, e.g.
#     just crust sdlc "the original request" --run-id 9d67c31f --resume
# `just crust report` prints that exact line for the run it describes.

# ── research, design, and choosing the chain ────────────────────────────────
# None of these is in a lifecycle. Run them when the question is theirs.

# what is technically true: just crust technical-research "can we stream this"
technical-research *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps technical-research

# what users need: just crust ux-research "why do they abandon upload"
ux-research *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps ux-research

# the domain's own rules: just crust domain-research "what is an episode"
domain-research *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps domain-research

# how it could be attacked: just crust security-research "the webhook endpoint"
security-research *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps security-research

# what the data shows: just crust data-research "did p95 move after the change"
data-research *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps data-research

# an interface somebody can build: just crust ux-design "the retry screen"
ux-design *ARGS:
    bun "{{crust}}/lifecycles/compose.ts" --config {{config}} "$@" --steps ux-design

# let it choose the steps: just crust operator "the webhook drops retries"
operator *ARGS:
    bun "{{crust}}/stages/operator.ts" --config {{config}} "$@"

# Prints the compose command and the reasoning behind it; starts nothing.
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

# ask a finished step a question — it still remembers the whole conversation.
# just crust ask <run_id> <step> "why did you choose a registry table?"
ask RUN_ID STEP *QUESTION:
    @bun "{{crust}}/consult.ts" ask {{RUN_ID}} {{STEP}} "$@"

# send a run back to a step with new instructions: that step and every step
# after it run again. --overwrite or --branch is REQUIRED; neither is default.
# just crust steer <run_id> <step> --overwrite "use the registry, not the map"
steer RUN_ID STEP *ARGS:
    @bun "{{crust}}/steer.ts" {{RUN_ID}} {{STEP}} "$@"

# have a finished step revise ITS OWN document. Every other step's stays
# read-only. just crust amend <run_id> <step> "shorten the migration section"
amend RUN_ID STEP *INSTRUCTION:
    @bun "{{crust}}/consult.ts" amend {{RUN_ID}} {{STEP}} "$@"

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
    home="${CRUST_HOME:-$(cat .pi-crust/data/pi-crust-home 2>/dev/null || true)}"
    if [[ -z "$home" || ! -f "$home/scripts/install.ts" ]]; then
      echo "update: cannot find pi-crust${home:+ at $home}." >&2
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
    home="${CRUST_HOME:-$(cat .pi-crust/data/pi-crust-home 2>/dev/null || true)}"
    if [[ -z "$home" || ! -f "$home/scripts/observe.ts" ]]; then
      echo "observe: cannot find pi-crust${home:+ at $home}." >&2
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
    CRUST_DB="$PWD/{{db}}" \
    exec bun "$home/scripts/observe.ts" "$@"
