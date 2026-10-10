# Run a Workflow

Run a workflow and report on it. **You run and observe — you never step into the process or do the work yourself.**

## Step 0 — translate the request

**Read [how_to_prompt_for_the_eng.md](how_to_prompt_for_the_eng.md) before you launch anything.** The prompt you pass is read by every agent in the chain, so it gets written deliberately: same intent, sharper words, verified paths, and a stated "done means". That cookbook is the whole procedure; this one starts once you have the prompt.

## The orchestrator's posture

The workflow is the worker. Your job is to launch it, watch the trace, and tell the engineer what happened. Do not read the agent's target files and "help", do not fix the code an agent was supposed to fix, do not edit an envelope. If a run fails, report the failing phase and its violations — the fix is a config, prompt, or workflow change, made deliberately, and then a re-run.

## Launch

Which chain to launch is decided in `how_to_prompt_for_the_eng.md`, and the short version is: **the workflow the engineer named, or else the most complete composed chain the work justifies — never a single-agent one.** Read `ls <pi-crust>/runtime/stages/*.ts <pi-crust>/runtime/lifecycles/*.ts` and the `Phases:` line in each docstring to see what this repo has; the names below are shape, not a menu.

```bash
bun <pi-crust>/runtime/lifecycles/sdlc.ts "add a /health endpoint"
bun <pi-crust>/runtime/lifecycles/compose.ts requests/health.md
bun <pi-crust>/runtime/stages/build.ts "implement the plan" --run-id a1b2c3d4
bun <pi-crust>/runtime/stages/scout.ts "where is auth handled" --config path/to/other.config.yaml
```

The prompt is inline text or a file path. Launch in the background so you can poll while it works; the `run_id` is printed on startup — capture it, everything else keys off it.

### Listen for the roster

The chain says *what runs*; the config says *who runs it*. **If the engineer references a roster, a config, or a model tier, pass it — do not fall through to the default.**

```bash
just crust rosters                            # every roster on disk, and the model each agent runs
```

That prints the path to pass and who is in it, in one read:

```text
.pi-crust/config/crust.config.yaml
    planner     fireworks/accounts/fireworks/models/kimi-k3
    builder     google/gemini-3.6-flash (inherited)
.pi-crust/config/crust.frontier.config.yaml
    planner     anthropic/claude-opus-5
```

Read those from disk every time. Rosters are the engineer's to add, rename, and retune, so a name you remember from a doc is a guess.

They will rarely say `--config`. Treat any of these as naming a roster, then resolve it to a file:

| What they say                                              | What it means                                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "run it on the frontier config", "use the frontier roster" | the roster file whose name matches                                                                                                                                |
| "run this with the big models", "use the sota roster"      | the non-default roster — confirm which if there is more than one. Each config's header comment lists the names it answers to, so `head -3` on the file settles it |
| "have opus plan this one"                                  | a roster whose planner is that model; if none exists, say so rather than editing the config mid-request                                                           |
| nothing about models at all                                | the default, `.pi-crust/config/crust.config.yaml`                                                                                                                 |

`--config` takes the path directly, and `CRUST_CONFIG` stands in for it when the flag is absent — whether a workflow is launched through the justfile or run with `bun` directly. The flag wins over the variable:

```bash
bun <pi-crust>/runtime/lifecycles/<name>.ts "<prompt>" --config .pi-crust/config/crust.frontier.config.yaml
CRUST_CONFIG=.pi-crust/config/crust.frontier.config.yaml just <recipe> "<prompt>"
```

`--scope` says what the judging steps judge: `verify`, `review`, `code-review` and `document` all read it.

```bash
just crust code-review "the stats refactor" --scope HEAD~3..HEAD    # a range
just crust verify "pre-PR sweep" --scope main                        # since a ref
just crust code-review "the gateway" --scope apps/gateway            # a directory, however old
just crust verify "the lib" --scope 'lib/**/*.ts'                    # a glob
```

Omit it and they read the uncommitted working tree, as they always have. `--base` is the old name and still works; it became `--scope` when a directory stopped being the base of anything. A ref wins when a branch and a directory share a name.

A path scope changes what rule 12 means: every file in scope must be covered by a `routing.checks` rule, not merely the files that changed. Pointing `verify` at a directory and getting a pass tells you the directory conforms, which is the point of pointing it there.

`--stream` prints each agent's thinking and prose in the terminal as it arrives. Off by default, because an unattended run that writes a model's reasoning to stdout buries the one line that said what went wrong. Everything it prints is recorded either way — the visualizer's reading pane shows the same narration after the fact, and `raw_output.jsonl` holds the full text.

`--deliver` decides how a chain hands over its work, and it does not sign by default.

| Mode                 | What lands                                                                          |
| -------------------- | ----------------------------------------------------------------------------------- |
| `branch` *(default)* | an unsigned commit on `crust/<run-id>`, your branch untouched                       |
| `patch`              | everything staged and written to `<session>/<run-id>.patch`; nothing enters history |
| `commit`             | today's behaviour, for a run you are sitting with                                   |

An unattended run that signs as you puts your name on work no human read. It is also the failure that killed a finished run at its last step: `git commit` waited sixty seconds for a signing touch nobody was there to give.

Two things that bite:

- **Never swap rosters on your own.** A different roster is a different cost and a different result. If the default's model looks wrong for the work, say so and let the engineer choose.
- **Switching rosters mid-session breaks resumption.** `agent_map.json` records the model each coding-agent session was created with, so a joined run (`--run-id`) whose config now names a different model starts that agent **fresh** instead of resuming its context window. That is deliberate — a bad resume is worse — but it means "plan on the frontier roster, then build on the default" costs the builder its accumulated context. Say so when you report it.

`--run-id` is optional on **every** workflow. Given one, the run joins that session if it exists or creates it pinned to exactly that id: same `sessions/{run_id}/` dirs, same `context_handoff/`, envelopes appended, and each agent resumes its existing coding-agent context window via `agent_map.json`. That is how you chain workflows — plan under one id, then build under the same id.

## Run one step, or any subset

Every step of a workflow also runs on its own, which is what an engineer usually wants when the ask is narrow:

```bash
just crust code-review "the /health work"        # just the conventions review
just crust verify "pre-PR sweep"                 # just the declared checks
bun <pi-crust>/runtime/lifecycles/compose.ts "<prompt>" --steps build,verify,review
```

`compose` takes any ordered subset of `prompt, scout, plan, test, build, verify, review, code-review, revise, commit, document`, repeats allowed (`build,verify,build,verify` — the second becomes `build_2`). An unknown name exits 2 and lists the valid ones.

A chain whose LAST step is `review` or `code-review` ends in the bounded revise loop: the blocking findings go back to the builder, the reviewer rules again, at most twice. That applies to a lone `just crust review` as much as to `sdlc`, so a roster without a builder fails up front. Name `revise` yourself (`--steps review,revise`) when you want one pass and no re-review.

Still prefer a composed chain when the work is real: a lone `build` has nothing checking it. Single steps are for a narrow ask, or for picking a stopped run up by hand.

## Where did it stop, and how do I pick it up

This is the normal recovery path. Do not re-run a chain from the top because one phase failed: the earlier phases cost money, and their envelopes are on disk.

```bash
just crust report                      # the most recent run
just crust report a1b2c3d4             # one run by id
just crust report-json a1b2c3d4        # TRunState, for you to parse
```

The report names every phase and its status, the gate that failed with its violations, the cost, the first phase not yet successful, and the exact command that resumes it:

```text
resume from: build
  bun <pi-crust>/runtime/lifecycles/sdlc.ts --run-id a1b2c3d4 --resume "<the original request>"
```

Exit codes: `0` the run succeeded, `1` it failed or is incomplete, `2` no such session.

`--resume` works on every workflow. It skips the phases already recorded successful for that session, replaying each one's recorded result instead of re-running it, and starts at the first that is not. Resume and the report read the same function, so they cannot disagree about what is already done.

Two things to know before reaching for it:

- It needs `--run-id`. Resuming an unnamed session is resuming nothing, and it says so rather than quietly starting a new run.
- A session whose every phase succeeded has nothing to resume, and says that too. Drop `--run-id` to start fresh.

## Observe

The trace db is `.pi-crust/data/crust.db`. It is WAL, so reads never block the running writers — poll it as often as you like.

```bash
# where the run stands
sqlite3 .pi-crust/data/crust.db \
  "select seq, name, kind, owner, status, attempt from phases where run_id='a1b2c3d4' order by seq;"

# the live tail — cursor on rowid, same query the visualizer polls
sqlite3 .pi-crust/data/crust.db \
  "select rowid, type, name, started_at from events where run_id='a1b2c3d4' and rowid > 0 order by rowid limit 50;"

# why a phase failed
sqlite3 .pi-crust/data/crust.db \
  "select attempt, gate, passed, checks_json from gate_results where run_id='a1b2c3d4';"

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
just crust phases <run_id>     # which phase is still `running`
just crust procs <run_id>      # what that phase is actually running, with pids
just crust kill <run_id>       # stop it — children first, then the workflow
```

`processes` rows with `ended_at IS NULL` are the live ones. If `procs` shows a pi child but the phase has produced no `tool_call` events and its `raw_output.jsonl` is empty, the agent never got started properly — check the model resolves and that nothing is blocking the subprocess, rather than waiting it out. `just crust kill` verifies each pid still matches the command that was recorded before signalling, because pids get recycled.

A killed run marks itself `fail` and closes its process rows, so the trace never claims work is in flight that is already dead.

## Report

Tell the engineer, in order: which chain and which roster you launched (name the config whenever it was not the default), which phase is running now (or which failed), phase statuses in sequence, and for a failure the gate violations or the error verbatim. Remember **every phase defaults to `fail`** — a phase showing `fail` may simply never have completed; `queued` means it never started. Don't dress up a partial run as a success.

For a visual live view, the visualizer app in the skill (`just crust observe`, or tmux sessions viz-api :4600 + viz-ui :4601) polls this same db — sessions as cards, runs as swim lanes, phases and tool calls drill-in. The sqlite queries above remain the headless equivalent.
