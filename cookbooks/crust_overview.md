# pi-crust Overview

The system map the orchestrator reads on startup — what pi-crust is, how a stamped repo is laid out, and which cookbook to load next.

## What pi-crust is

pi-crust builds repeatable **agents plus code** workflows. Deterministic TypeScript (a workflow script) owns sequencing, retries, and acceptance; agents are bounded nodes inside that graph. Agent proposes, code disposes.

Your job as orchestrator: **run the system, observe the system, help the engineer interact with it.** You do not do the work a workflow exists to do.

A run is identified by its `run_id` — the vocabulary the trace, the directory names, and the visualizer all share.

## Layout of a stamped repo

```text
.pi-crust/
├── README.md                    what this folder is, for whoever finds it next
├── package.json                 one dependency: zod
├── crust.just                    recipes, reached as `just crust <recipe>`
├── config/
│   └── crust.config.yaml         the agent roster — one agent, one prompt, one purpose
├── report.ts                    where did a run stop, and what resumes it
├── stages/                      one runnable entrypoint per step
├── lifecycles/                  compositions of stages; thin by rule
│   ├── prompt.ts · scout.ts · plan.ts · test.ts · build.ts    one step each
│   ├── verify.ts · review.ts · code-review.ts · commit.ts · document.ts
│   ├── sdlc.ts                  plan → test → build → verify → review → code-review ↻
│   ├── compose.ts               --steps a,b,c: any ordered subset of the eleven
│   ├── sdlc.ts                  the full lifecycle, from a wish
│   ├── bugfix.ts                diagnose → plan → test → build → verify → review → code-review
│   ├── de-risk.ts               identify → conceptualize → plan → design → poc
│   └── compose.ts               any ordered subset, named with --steps
├── modules/                     ALL low-level logic — workflow scripts stay thin
│   ├── typedefs/                types and zod schemas only
│   │   ├── activity run.ts             TActivityRunParams, TActivityRun
│   │   ├── envelope.ts          one output type per agent call, plus TEnvelopeSpec
│   │   ├── config.ts            TAgentConfig, TPiCrustConfig
│   │   └── gate.ts · pi.ts · quality.ts · changes.ts · trace.ts · run.ts
│   ├── data/                    everything that touches the outside world
│   │   ├── pi-agent.ts          Pi interface (v1), JSONL stream tailed live
│   │   ├── claude-code-agent.ts Claude Code (v2, a loud stub today)
│   │   ├── trace-db.ts          JSONL + SQLite, written as it happens
│   │   └── git.ts · files.ts · clock.ts · ids.ts · terminal.ts · prompt-files.ts
│   └── use-cases/               orchestration and policy
│       ├── run-activity-run.ts         runActivityRun(run)(params, body) and finish(run)
│       ├── execute-agent.ts     prompt → pi → typed parse → gates → envelope
│       ├── steps/               one file per step kind, plus the registry
│       ├── run-steps.ts         fold a context through an ordered step list
│       ├── revise-loop.ts       the bounded loop a chain ending in a review gets
│       ├── dispute-ledger.ts    counts repeated findings, so neither agent does
│       ├── select-range.ts      --base: which change verify and the reviews judge
│       ├── run-workflow.ts      the body every step-based workflow shares
│       ├── resume.ts            skipIfDone: run the activity run, or replay it
│       ├── replay.ts            how a hand-written workflow's activity runs replay
│       ├── read-run-state.ts    the ONE answer to "what is already done"
│       ├── route-by-path.ts     which skills load, which checks run, by changed path
│       ├── gates/               gate.check(envelope, run) -> TGateReport
│       ├── enforce-permissions.ts   what an agent may change, checked after the fact
│       ├── run-checks.ts       the deterministic lint/typecheck/build/test blocks
│       └── capture-changes.ts   git diff vs a resolved base → envelope
├── prompt-engineering/{agent}/{system.md,user.md}   tracked — edit prompts HERE
│                                planner · builder · scout · tester
│                                reviewer · code-reviewer · documenter
├── harness-engineering/         pi extensions an agent's harness can load
└── data/                        runtime only; nothing under here is authored
    ├── sessions/{run_id}/       gitignored runtime
    │   ├── agent_map.json       agent → coding-agent session_id + model
    │   ├── context_handoff/     the one place agents write files for those that follow
    │   └── {agent}/{prompts/, raw_output.jsonl, envelope.json}
    └── crust.db                  gitignored SQLite trace db the visualizer polls
```

**v1 runs Pi only.** `coding_agent: pi`, default model `gemini-3.6-flash`, thinking `medium`. `claude_code` is specced in the config and stubbed in the interface — it lands in v2.

## The activity run model

Every run is a sequence of **activity runs**, each one `await activity run(activityRunParams({...}), body)`. Three kinds, three swim lanes:

- **engineer** — the human lane; today the system-input activity run (who asked, and for what).
- **agent** — `callAgent(run, ph, {...})`: prompt in → typed envelope out → gates verified.
- **code** — deterministic steps that stand alone (git commit, quality blocks, change capture). Never buried inside an agent activity run.

**Success must be earned — every activity run defaults to `fail`.** A clean exit flips it to success; agent activity runs additionally require the envelope to parse and all gates to come back green. A throw keeps it failed, records an error event, and aborts the run. `retries: N` on an agent activity run buys extra gate-correction rounds through the same session before that throw happens.

## The step model

A **step** is a activity run plus the two things composition needs: the agents it requires, and how it is REPLAYED. Eleven of them, each runnable on its own:

| Step          | Kind  | Owner         | Asks                                                   |
| ------------- | ----- | ------------- | ------------------------------------------------------ |
| `prompt`      | agent | `--agent`     | whatever you asked, straight through                   |
| `scout`       | agent | scout         | where do things live?                                  |
| `plan`        | agent | planner       | what should be done?                                   |
| `test`        | agent | tester        | what would prove it was done?                          |
| `build`       | agent | builder       | do it                                                  |
| `verify`      | code  | quality       | do the declared checks pass?                           |
| `review`      | agent | reviewer      | is this what was asked for?                            |
| `code-review` | agent | code-reviewer | does it match this repo's conventions?                 |
| `revise`      | agent | builder       | answer the review: fix it, or dispute it with evidence |
| `commit`      | code  | git           | land it, in its author's words                         |
| `document`    | agent | documenter    | write up what the diff shows                           |

`test` writes tests and `verify` runs them, because writing one is judgement and running one is a command. `review` and `code-review` ask different questions: whether the ask was met, and whether the result conforms. `code-review` learns the conventions by loading the skills `routing.skills` gives it — none of them is named in `.pi-crust/`.

A chain worth repeating gets a two-line script listing its steps (`sdlc.ts`); a chain you want once is `compose --steps`. A conditional tail stays hand-written — that is control flow, and a list of names cannot express it.

One loop does not. A chain whose LAST step is `review` or `code-review` gets the bounded revise loop from `use-cases/revise-loop.ts`: the blocking findings go back to the builder as a `revise`, the reviewer rules again, at most twice. The builder may dispute a finding instead of fixing it, with evidence the `disputes_supported` gate insists on; a finding a declared check decides may not be disputed at all; and a finding repeated with nothing new on either side ends the loop and writes `context_handoff/disputes.md` for the developer. `revise` is also nameable on its own, for a single pass with no re-review.

## Envelopes

Agents have exactly two output channels: reference files written into `context_handoff/`, and a **final valid-JSON response** parsed against the output type the call declared. Code persists it as `envelope.json` and injects it into the next agent's `user.md` via `{{previous_envelope}}`. Bad JSON is never a restart — the harness re-prompts the *same session, context intact*, until it parses (bounded). See `references/handoff.md`.

**The output contract is a synced triad**: the schema in `modules/typedefs/envelope.ts` ↔ the `## Report` JSON example in the agent's `user.md` ↔ `outputType:` at the call site. Editing any one of the three means editing all three in the same change — drift between them taxes every call with correction retries.

## Running a workflow

```bash
just crust plan "add a /health endpoint"
bun <pi-crust>/runtime/lifecycles/sdlc.ts requests/health.md --run-id a1b2c3d4
just crust plan "add a /health endpoint"
```

The prompt is inline text or a file path. `--run-id` is optional on every workflow: given one, the run joins that session (same dirs, same `context_handoff/`, agents resume their existing context windows); omitted, a fresh id is minted and printed.

A run that stopped is picked up, not restarted:

```bash
bun .pi-crust/report.ts                      # where did the last run stop?
bun <pi-crust>/runtime/lifecycles/sdlc.ts "<the original request>" --run-id a1b2c3d4 --resume
```

`--resume` skips every activity run already recorded successful for that session and starts at the first that is not. It works on every workflow, and `report.ts` prints the exact command for the run it describes.

## When you have finished reading this

You are done with startup. List the workflows (`ls <pi-crust>/runtime/stages/*.ts <pi-crust>/runtime/lifecycles/*.ts`, plus each `Activity Runs:` docstring line) as a table, and **wait for the engineer's request.**

Do not survey anything else — not the trace db, not the config, not past runs, not the repo tree. You do not yet know what the request is, so anything you gather now is a guess about what will matter, spent from the context the real work needs. Every cookbook and reference below is lazy-loaded, one per request, and that is the whole design.

## Where to go next

Load one cookbook per request — this overview is the only one you read up front.

| Request                                        | Cookbook                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Turn a request into the prompt a workflow gets | `how_to_prompt_for_the_eng.md` — **read before every launch** |
| Set the system up in a repo                    | `install.md`                                                  |
| Add a lifecycle                                | `create_lifecycle.md`                                         |
| Change a lifecycle's stages or concurrency     | `update_lifecycle.md`                                         |
| Generate `crust.config.yaml`                   | `create_config.md`                                            |
| Add or retune an agent                         | `update_config.md`                                            |
| Add low-level logic or a gate                  | `update_modules.md`                                           |
| Run and monitor a workflow                     | `how_to_prompt_for_the_eng.md`, then `run_lifecycle.md`       |

References, loaded when you need the spec: `references/config.md` (full config schema), `references/handoff.md` (envelope + session layout), `references/observability.md` (events, db tables, polling).
