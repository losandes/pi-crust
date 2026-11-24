# Run a Workflow

Run a workflow and report on it. **You run and observe — you never step into the process or do the work yourself.**

## Step 0 — translate the request

**Read [how_to_prompt_for_the_eng.md](how_to_prompt_for_the_eng.md) before you launch anything.** The prompt you pass is read by every agent in the chain, so it gets written deliberately: same intent, sharper words, verified paths, and a stated "done means". That cookbook is the whole procedure; this one starts once you have the prompt.

## The orchestrator's posture

The workflow is the worker. Your job is to launch it, watch the trace, and tell the engineer what happened. Do not read the agent's target files and "help", do not fix the code an agent was supposed to fix, do not edit an envelope. If a run fails, report the failing activity run and its violations — the fix is a config, prompt, or workflow change, made deliberately, and then a re-run.

## Launch

Which chain to launch is decided in `how_to_prompt_for_the_eng.md`, and the short version is: **the workflow the engineer named, or else the most complete composed chain the work justifies — never a single-agent one.** Read the merged catalogue with `crust list`; package definitions, machine preferences under `~/.pi-crust/config/`, and the repository's single `pi-crust.toml` together decide what is offered. The names below illustrate command shape, not a fixed menu.

```bash
crust run "add a /health endpoint" --lifecycle sdlc
crust run requests/health.md
crust run "implement the plan" --activities build --run-id a1b2c3d4
crust run "where is auth handled" --activities scout --config path/to/pi-crust.toml
```

The prompt is inline text or a file path. Launch in the background so you can poll while it works; the `run_id` is printed on startup — capture it, everything else keys off it.

### Listen for configuration

The chain says *what runs*; the config says *who runs it*. **If the engineer references a roster, a config, or a model tier, pass it — do not fall through to the default.**

```bash
crust config                 # effective settings and their layer/file sources
crust list                   # merged Activities and lifecycles
```

Configuration is read live from `<pi-crust>/runtime/config/`, then `~/.pi-crust/config/`, then `pi-crust.toml`. Each directory has `crust.config.toml`, `crust.activities.toml` and `crust.lifecycles.toml`. Tables merge field by field; arrays replace whole. There are no automatically discovered filename variants.

Pass an engineer-supplied repository-file path with `--config`; `CRUST_CONFIG` supplies it when the flag is absent. This selects the strongest file, not a replacement for the package and machine layers. If a model tier is ambiguous, resolve what the engineer means rather than editing configuration or silently changing cost. A one-run model choice can use the existing `--model <activity>=<provider/model>@<thinking>` override.

```bash
crust run "<prompt>" --lifecycle <name> --config path/to/pi-crust.toml
CRUST_CONFIG=path/to/pi-crust.toml crust run "<prompt>" --lifecycle <name>
```

Tasks come only from the selected repository file. Its inactive template examples run nothing until real commands are supplied. Machine and package edits affect the next command without re-stamping; an installer refresh never replaces an existing `pi-crust.toml`.

`--scope` says what the judging Activities judge: `review`, `code-review` and `document` all read it, and so does `crust verify`.

```bash
crust run "the stats refactor" --activities code-review --scope HEAD~3..HEAD   # a range
crust verify --scope main                                       # since a ref
crust run "the gateway" --activities code-review --scope apps/gateway         # a directory
crust verify --scope 'lib/**/*.ts'                              # a glob
```

Omit it and the judging Activities are given everything their run has changed since it started, committed or not; when the run has changed nothing they read the uncommitted working tree, as `crust verify` always does. `--base` is the old name and still works; it became `--scope` when a directory stopped being the base of anything. A ref wins when a branch and a directory share a name.

A path scope makes `crust verify` consider the tracked files in that scope, not just changed files. The same `change` tasks apply, and the command reports files no task matched without failing on that count.

`--stream` prints each agent's thinking and prose in the terminal as it arrives. Off by default, because an unattended run that writes a model's reasoning to stdout buries the one line that said what went wrong. Everything it prints is recorded either way — the visualizer's reading pane shows the same narration after the fact, and `raw_output.jsonl` holds the full text.

Committing is a property of each Activity, not a mode of the run. An Activity that declares `commit = true` in its merged Activity table lands its own change once every gate on it has passed, in the words its envelope carried — so a chain with several writing Activities produces several commits rather than one squashed one at the end. A refused or timed-out commit — an unanswered signing prompt, a hook that exits non-zero — leaves the work in the tree, raises an `uncommitted` warning, and does not stop the chain. A run ending in a terminal Activity retries each refused commit once before delivering. Any still refused stops the run `waiting` before anything is pushed; `decision-request.md` names the blocker, and `--resume` retries it without requiring an answer.

`--commit false` turns committing off for a whole run, whatever the registry says. A Lifecycle ending in a terminal Activity that requires commits rejects it at startup. There is no `--commit true`: a flag granting a permission the configuration withheld would make a run behave in a way nobody reading the registry could predict.

```bash
crust run "add a /health endpoint" --lifecycle sdlc --commit false   # leave it in the working tree
```

An Activity that was not committing and moved `HEAD` anyway is reported as a permission breach, like any other overstep. No prompt asks an agent to commit, but a prompt is advice.

Two things that bite:

- **Never swap rosters on your own.** A different roster is a different cost and a different result. If the default's model looks wrong for the work, say so and let the engineer choose.
- **Switching rosters mid-session breaks resumption.** `agent_map.json` records the model each coding-agent session was created with, so a joined run (`--run-id`) whose config now names a different model starts that agent **fresh** instead of resuming its context window. That is deliberate — a bad resume is worse — but it means "plan on the frontier roster, then build on the default" costs the builder its accumulated context. Say so when you report it.

`--run-id` is optional on **every** workflow. Given one, the run joins that session if it exists or creates it pinned to exactly that id: same `sessions/{run_id}/` dirs, same `context_handoff/`, envelopes appended, and each agent resumes its existing coding-agent context window via `agent_map.json`. That is how you chain workflows — plan under one id, then build under the same id.

`--handoff <path>` moves where THIS run's `context_handoff/` documents land, without moving `sessions/{run_id}/` itself — `events.jsonl`, `invocation.json` and the rest stay exactly where they are. `{session_id}` (or `{run_id}`, an exact synonym) expands to the run id in the value:

```bash
crust run "the payments rewrite" --lifecycle sdlc --handoff specs/{session_id}
```

Omit it and the directory is exactly what it has always been: `<data_dir>/sessions/{run_id}/context_handoff`. A relative value resolves against the repository root, not the directory you ran the command from. A resumed run keeps the directory it started with; passing a DIFFERENT `--handoff` on resume is refused rather than splitting one run's documents across two places.

`--name "<label>"` gives the run a label shown instead of the lifecycle name on `crust report`, the `please` picker, and the visualizer's session card — useful when `--activities plan,build` would otherwise read as the script that ran it. The lifecycle is still recorded and still shown, one line further down on the report.

## Run one Activity, or any subset

Every Activity also runs on its own, which is what an engineer usually wants when the ask is narrow:

```bash
crust run "the /health work" --activities code-review   # just the conventions review
crust verify                                # just the declared change tasks, no run
crust run "<prompt>" --activities test,build,outcome-review
```

`compose` takes any ordered subset of whatever the merged TOML registry defines, repeats allowed (`build,outcome-review,build,outcome-review` — the second becomes `build_2`, which is also the instance its attempt budget is kept against). An unknown name exits 2 and lists the ones this repository offers; a Planner is refused, because a chain does not contain the thing that chooses it.

A chain that ENDS in reviewing Activities — any whose merged entry declares `output = "reviewOutput"` — ends in the bounded revise loop: the blocking findings go back to the Activity that wrote the work, every reviewer the chain ended in rules again, and the bound is that Activity's `attempts`. A chain ending in `outcome-review + code-review` re-asks both. That applies to a lone `--activities outcome-review` as much as to `sdlc`, so a roster without a writing Activity fails up front.

Still prefer a composed chain when the work is real: a lone `build` has nothing checking it. A single Activity is for a narrow ask, or for picking a stopped run up by hand.

## Where did it stop, and how do I pick it up

This is the normal recovery path. Do not re-run a chain from the top because one activity run failed: the earlier activity runs cost money, and their envelopes are on disk.

```bash
crust report                      # the most recent run
crust report a1b2c3d4             # one run by id
crust report-json a1b2c3d4        # TRunState, for you to parse
```

The report names every activity run and its status, the gate that failed with its violations, the cost, the first activity run not yet successful, and the exact command that resumes it:

```text
resume from: build
  crust run "<the original request>" --lifecycle sdlc --run-id a1b2c3d4 --resume
```

Exit codes: `0` the run succeeded, `1` it failed or is incomplete, `2` no such session.

`--resume` works on every workflow. It skips the activity runs already recorded successful for that session, replaying each one's recorded result instead of re-running it, and starts at the first that is not. Resume and the report read the same function, so they cannot disagree about what is already done.

Two things to know before reaching for it:

- It needs `--run-id`. Resuming an unnamed session is resuming nothing, and it says so rather than quietly starting a new run.
- A session that finished successfully has nothing to resume, and says that too. Any other outcome is resumable, including one that died between Activities and has no row for the ones it never reached. Drop `--run-id` to start fresh.

## Observe

The trace db is `.pi-crust/data/crust.db`. It is WAL, so reads never block the running writers — poll it as often as you like.

```bash
# where the run stands
sqlite3 .pi-crust/data/crust.db \
  "select seq, name, kind, owner, status from activity_runs where run_id='a1b2c3d4' order by seq;"

# the live tail — cursor on rowid, same query the visualizer polls
sqlite3 .pi-crust/data/crust.db \
  "select rowid, type, name, started_at from events where run_id='a1b2c3d4' and rowid > 0 order by rowid limit 50;"

# why a activity run failed
sqlite3 .pi-crust/data/crust.db \
  "select activity_run_id, gate, passed, checks_json from gate_results where run_id='a1b2c3d4';"

# session-level status
sqlite3 .pi-crust/data/crust.db \
  "select run_id, request, status, total_tokens from sessions order by started_at desc limit 5;"

# what an agent actually did, slowest tool calls first
sqlite3 .pi-crust/data/crust.db \
  "select name, tokens, started_at, ended_at from events
   where run_id='a1b2c3d4' and type='tool_call' order by ended_at desc limit 20;"
```

Poll on a cursor: keep the highest `rowid` you have seen and query `where rowid > ?`. Don't re-read the whole table each pass.

`tool_call` rows carry a real span, so durations come off the columns — see `references/observability.md` for which fields each event type populates.

The workflow also narrates to stdout, and every line it prints is written to the db as a `log` event — terminal and swim lane tell the same story by construction, so tailing the background process is a valid second view rather than a competing source of truth.

Files are the raw record if you need more than the db shows: `.pi-crust/data/sessions/{run_id}/{agent}/raw_output.jsonl` (full coding-agent stream), `envelope.json` (the parsed final response), `prompts/` (exactly what was sent), and `context_handoff/` (what agents wrote for each other).

## When a run is stuck

A hung coding agent produces no events at all, so the trace goes quiet rather than red. Read it in this order:

```bash
crust activity-runs <run_id>     # which activity run is still `running`
crust procs <run_id>      # what that activity run is actually running, with pids
crust kill <run_id>       # stop it — children first, then the workflow
```

`processes` rows with `ended_at IS NULL` are the live ones. If `procs` shows a pi child but the activity run has produced no `tool_call` events and its `raw_output.jsonl` is empty, the agent never got started properly — check the model resolves and that nothing is blocking the subprocess, rather than waiting it out. `crust kill` verifies each pid still matches the command that was recorded before signalling, because pids get recycled.

A killed run marks itself `fail` and closes its process rows, so the trace never claims work is in flight that is already dead.

## Report

Tell the engineer, in order: which chain and which roster you launched (name the config whenever it was not the default), which activity run is running now (or which failed), activity run statuses in sequence, and for a failure the gate violations or the error verbatim. Remember **every activity run defaults to `fail`** — a activity run showing `fail` may simply never have completed; `queued` means it never started. Don't dress up a partial run as a success.

For a visual live view, the visualizer app in the skill (`crust observe`, or tmux sessions viz-api :4600 + viz-ui :4601) polls this same db — sessions as cards, runs as swim lanes, activity runs and tool calls drill-in. The sqlite queries above remain the headless equivalent.
