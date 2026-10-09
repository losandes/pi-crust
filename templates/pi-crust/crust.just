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
set working-directory := '..'

# Every recipe passes this through, so `CRUST_CONFIG=other.yaml just crust sdlc "..."`
# swaps the whole roster for one run.
#
# The observability UI takes two more: CRUST_BE_PORT (the API, default 4600)
# and CRUST_FE_PORT (the web app, default 4601). Both are read by `observe` and by
# every run, which prints a link to itself when the API answers.
config := env_var_or_default("CRUST_CONFIG", ".pi-crust/config/crust.config.yaml")
db     := ".pi-crust/data/crust.db"

# list every crust recipe
default:
    @just --list crust

# ── first run ───────────────────────────────────────────────────────────────

# Proves the whole path works: config validated, session minted, agent ran,
# envelope parsed, gates checked, trace written. Costs a few cents and changes
# nothing in your repo, because both workflows are read-only.
#
# (`just --list` shows only the LAST comment line, so that one is the summary.)

# start here: two cheap read-only runs, end to end
demo:
    @echo "1/2  prompt: one agent, one prompt"
    bun .pi-crust/stages/prompt.ts --config {{config}} --agent scout "reply with a one-line summary of this repo"
    @echo "\n2/2  scout: read-only recon"
    bun .pi-crust/stages/scout.ts --config {{config}} "list the top-level directories in this repo and what each is for. change nothing."
    @echo "\nboth done. now run:  just crust sessions    (or: just crust observe)"

# ── run a stage, or a whole lifecycle ───────────────────────────────────────
# Args pass straight through: "<prompt or path/to/prompt.md>" [--run-id X]

# one agent, one prompt: just crust prompt "summarize this repo"
prompt *ARGS:
    bun .pi-crust/stages/prompt.ts --config {{config}} "$@"

# read-only recon: just crust scout "where is auth handled"
scout *ARGS:
    bun .pi-crust/stages/scout.ts --config {{config}} "$@"

# 1.2 the outcome and how success is recognised: just crust identify "..."
identify *ARGS:
    bun .pi-crust/stages/identify.ts --config {{config}} "$@"

# 1.2b reproduce it and name the cause: just crust diagnose "playback stops after track 3"
diagnose *ARGS:
    bun .pi-crust/stages/diagnose.ts --config {{config}} "$@"

# 1.3 what the solution must mean and do: just crust conceptualize "..."
conceptualize *ARGS:
    bun .pi-crust/stages/conceptualize.ts --config {{config}} "$@"

# 2.2 how it physically exists here: just crust design "..."
design *ARGS:
    bun .pi-crust/stages/design.ts --config {{config}} "$@"

# 2.0 answer one hypothesis cheaply: just crust poc "..."
poc *ARGS:
    bun .pi-crust/stages/poc.ts --config {{config}} "$@"

# plan only: just crust plan "add a /health endpoint"
plan *ARGS:
    bun .pi-crust/stages/plan.ts --config {{config}} "$@"

# write the tests that would prove it: just crust test "add a /health endpoint"
test *ARGS:
    bun .pi-crust/stages/test.ts --config {{config}} "$@"

# implement only: just crust build "add a /health endpoint"
build *ARGS:
    bun .pi-crust/stages/build.ts --config {{config}} "$@"

# run the checks the changed paths select: just crust verify "pre-PR sweep"
verify *ARGS:
    bun .pi-crust/stages/verify.ts --config {{config}} "$@"

# is it what was asked for: just crust review "add a /health endpoint"
review *ARGS:
    bun .pi-crust/stages/review.ts --config {{config}} "$@"

# does it match this repo's conventions: just crust code-review "the /health work"
code-review *ARGS:
    bun .pi-crust/stages/code-review.ts --config {{config}} "$@"

# land the working tree: just crust commit "the /health work"
commit *ARGS:
    bun .pi-crust/stages/commit.ts --config {{config}} "$@"

# write it up from the diff: just crust document "the /health work"
document *ARGS:
    bun .pi-crust/stages/document.ts --config {{config}} "$@"

# plan, test, build, verify, review, code-review: just crust sdlc "add a /health endpoint"
sdlc *ARGS:
    bun .pi-crust/lifecycles/sdlc.ts --config {{config}} "$@"

# prove the risky part before building it: just crust de-risk "move sessions to redis"
de-risk *ARGS:
    bun .pi-crust/lifecycles/de-risk.ts --config {{config}} "$@"

# a reported bug, start to finish: just crust bugfix "playback stops after track 3"
bugfix *ARGS:
    bun .pi-crust/lifecycles/bugfix.ts --config {{config}} "$@"

# any ordered subset: just crust compose "..." --steps plan,build,verify
compose *ARGS:
    bun .pi-crust/lifecycles/compose.ts --config {{config}} "$@"

# Any stage or lifecycle resumes: add --run-id <id> --resume to it, e.g.
#     just crust sdlc "the original request" --run-id 9d67c31f --resume
# `just crust report` prints that exact line for the run it describes.

# ── research, design, and choosing the chain ────────────────────────────────
# None of these is in a lifecycle. Run them when the question is theirs.

# what is technically true: just crust technical-research "can we stream this"
technical-research *ARGS:
    bun .pi-crust/stages/technical-research.ts --config {{config}} "$@"

# what users need: just crust ux-research "why do they abandon upload"
ux-research *ARGS:
    bun .pi-crust/stages/ux-research.ts --config {{config}} "$@"

# the domain's own rules: just crust domain-research "what is an episode"
domain-research *ARGS:
    bun .pi-crust/stages/domain-research.ts --config {{config}} "$@"

# how it could be attacked: just crust security-research "the webhook endpoint"
security-research *ARGS:
    bun .pi-crust/stages/security-research.ts --config {{config}} "$@"

# what the data shows: just crust data-research "did p95 move after the change"
data-research *ARGS:
    bun .pi-crust/stages/data-research.ts --config {{config}} "$@"

# an interface somebody can build: just crust ux-design "the retry screen"
ux-design *ARGS:
    bun .pi-crust/stages/ux-design.ts --config {{config}} "$@"

# let it choose the steps: just crust operator "the webhook drops retries"
operator *ARGS:
    bun .pi-crust/stages/operator.ts --config {{config}} "$@"

# Prints the compose command and the reasoning behind it; starts nothing.
# recommend the steps instead of running them: just crust advise "..."
advise *ARGS:
    bun .pi-crust/stages/advisor.ts --config {{config}} "$@"

# build the command by answering questions: just crust please
please:
    @bun .pi-crust/please.ts

# ── watch it ────────────────────────────────────────────────────────────────
# Reads never block a running workflow, the db is WAL. Poll as hard as you like.

# continue a run that is waiting for you: just crust approve <run_id>
approve RUN_ID:
    @bun .pi-crust/decide.ts approve {{RUN_ID}}

# send it back with a correction: just crust reject <run_id> --note "..."
reject RUN_ID *ARGS:
    @bun .pi-crust/decide.ts reject {{RUN_ID}} "$@"

# answer the questions it could not: just crust answer <run_id> --file a.md
answer RUN_ID *ARGS:
    @bun .pi-crust/decide.ts answer {{RUN_ID}} "$@"

# where a run got to, and what to run to finish it: just crust report [<run_id>]
report *ARGS:
    @bun .pi-crust/report.ts --config {{config}} "$@"

# the same, as JSON for an agent to parse: just crust report-json <run_id>
report-json *ARGS:
    @bun .pi-crust/report.ts --config {{config}} --json "$@"

# the last 10 runs
sessions:
    @sqlite3 {{db}} "select run_id, status, substr(request,1,50), total_tokens, round(total_cost,4) from sessions order by started_at desc limit 10;"

# phase status in sequence: just crust phases <run_id>
phases RUN_ID:
    @sqlite3 {{db}} "select seq, name, kind, owner, status, attempt from phases where run_id='{{RUN_ID}}' order by seq;"

# the live event tail: just crust tail <run_id>
tail RUN_ID:
    @sqlite3 {{db}} "select rowid, type, name, started_at from events where run_id='{{RUN_ID}}' order by rowid desc limit 25;"

# what a run has alive right now, with pids: just crust procs <run_id>
procs RUN_ID:
    @sqlite3 {{db}} "select kind, name, pid, command, started_at from processes where run_id='{{RUN_ID}}' and ended_at is null order by id;"

# forget runs older than N days, on disk and in the trace together.
# Dry by default: add --yes to actually delete. just crust prune 14d
prune AGE *ARGS:
    @bun .pi-crust/prune.ts --older-than {{AGE}} "$@"

# ask a finished step a question — it still remembers the whole conversation.
# just crust ask <run_id> <step> "why did you choose a registry table?"
ask RUN_ID STEP *QUESTION:
    @bun .pi-crust/consult.ts ask {{RUN_ID}} {{STEP}} "$@"

# send a run back to a step with new instructions: that step and every step
# after it run again. --overwrite or --branch is REQUIRED; neither is default.
# just crust steer <run_id> <step> --overwrite "use the registry, not the map"
steer RUN_ID STEP *ARGS:
    @bun .pi-crust/steer.ts {{RUN_ID}} {{STEP}} "$@"

# have a finished step revise ITS OWN document. Every other step's stays
# read-only. just crust amend <run_id> <step> "shorten the migration section"
amend RUN_ID STEP *INSTRUCTION:
    @bun .pi-crust/consult.ts amend {{RUN_ID}} {{STEP}} "$@"

# the working trees this machine has run in — the observer watches them all
trees:
    @bun .pi-crust/workspaces.ts list

# Only removes it from this machine's list; nothing on disk is deleted.
# stop watching a tree: just crust forget-tree /path/to/worktree
forget-tree *PATHS:
    @bun .pi-crust/workspaces.ts forget "$@"

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

# boot the trace UI, http://localhost:4601 (api on :4600)
observe *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    home="${CRUST_HOME:-$(cat .pi-crust/data/pi-crust-home 2>/dev/null || true)}"
    if [[ -z "$home" || ! -f "$home/scripts/observe.ts" ]]; then
      echo "observe: cannot find pi-crust${home:+ at $home}." >&2
      echo "  re-run its installer from this directory, or set CRUST_HOME to the package." >&2
      exit 2
    fi
    CRUST_DB="{{justfile_directory()}}/{{db}}" \
    CRUST_BE_PORT="${CRUST_BE_PORT:-4600}" \
    CRUST_FE_PORT="${CRUST_FE_PORT:-4601}" \
    exec bun "$home/scripts/observe.ts" "$@"
