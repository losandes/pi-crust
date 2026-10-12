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
│   ├── crust.activities.yaml     the Activity registry — what a Lifecycle may name
│   ├── crust.lifecycles.yaml     the Lifecycles, their Stages, and each Stage's strategy
│   ├── crust.config.yaml         defaults and routing
│   └── crust.observe.yaml        the trace db, the ports, the themes
├── report.ts                    where did a run stop, and what resumes it
├── checks.ts                    routing.checks on their own, with no Lifecycle
├── stages/                      the two Planners with an agent: operator, triage
├── lifecycles/
│   └── compose.ts               --lifecycle <name>, or --activities a,b+c
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
│       ├── activity-registry.ts  configuration → something runnable, by name
│       ├── attempts.ts          the one ceiling: Activity Runs per instance, per run
│       ├── deliver.ts           an Activity commits its own change, in its own words
│       ├── activities/          one Activity made runnable, and the Planners
│       ├── run-activities.ts    fold a context through an ordered chain
│       ├── revise-loop.ts       the bounded loop a chain ending in a review gets
│       ├── dispute-ledger.ts    counts repeated findings, so neither agent does
│       ├── select-range.ts      --scope: which change the reviews judge
│       ├── run-workflow.ts      the body every workflow shares
│       ├── resume.ts            skipIfDone: run the activity run, or replay it
│       ├── replay.ts            how a hand-written workflow's activity runs replay
│       ├── read-run-state.ts    the ONE answer to "what is already done"
│       ├── route-by-path.ts     which skills load, which checks run, by changed path
│       ├── gates/               gate.check(envelope, run, changedPaths) -> TGateReport
│       ├── enforce-permissions.ts   what an agent may change, checked after the fact
│       ├── run-checks.ts       the deterministic lint/typecheck/build/test blocks
│       └── capture-changes.ts   git diff vs a resolved base → envelope
├── prompt-engineering/{agent}/{system.md,user.md}   tracked — edit prompts HERE
│                                plan · build · scout · test
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
- **code** — deterministic Activities that stand alone (git commit, quality blocks, change capture). Never buried inside an agent activity run.

**Success must be earned — every activity run defaults to `fail`.** A clean exit flips it to success; agent activity runs additionally require the envelope to parse and all gates to come back green. A throw keeps it failed, records an error event, and aborts the run. A failed gate is not a throw while the Activity has budget: it runs again, as its own Activity Run, against its `attempts`.

## The Activity model

An **Activity** is a discrete unit of work and the agent that performs it — one entry in `config/crust.activities.yaml`, carrying both halves:

| Key                  | Says                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `model`, `thinking`, `tools`, `writes`, `prompt_engineering` | who performs it, and what it may reach |
| `output`             | the envelope contract it answers, by published name                |
| `gates`              | what its envelope must survive, by published name                  |
| `input`              | `upstream` (the default), or `changes` for the run's own diff      |
| `attempts`           | Activity Runs of one instance this run may spend, the first included |
| `commit`             | land its own change, in its envelope's words, once its gates pass  |

There is no registry in TypeScript. A team adds an Activity by adding an entry, removes one by deleting it, and reaches it immediately: a Lifecycle names `plan`, and `plan` IS the entry. An `output` or a gate nothing publishes is refused at load, with the list of what was available — that refusal is what replaced the compiler's old union of Activity names.

Three things are NOT Activities, deliberately:

- **The Planners** — `operator`, `triage`, and the Composer. They decide what happens and perform none of it, they are a closed set in code, and a Lifecycle cannot name one. Configuration tunes their model, tools, writes and prompts under `planners:`.
- **The repository's checks** — a known command is the `checks` gate, declared per Activity. It used to be a `verify` Activity producing a verdict nothing read.
- **Delivery** — an Activity with `commit: true` lands its own change once its gates pass, so granularity follows the chain. `--commit false` turns it off for a whole run; there is no flag that turns it on.

A chain whose LAST Activity is `review` or `code-review` gets the bounded revise loop from `use-cases/revise-loop.ts`: the blocking findings go back to the Activity that wrote the work, which fixes each or disputes it with evidence, and the reviewer rules again. The bound is that Activity's `attempts` — one ceiling covers the gate retry, the revise round and the regression, because the three failure modes are correlated. The builder may dispute a finding instead of fixing it, with evidence the `disputes_supported` gate insists on; a finding a declared check decides may not be disputed at all; and a finding repeated with nothing new on either side ends the loop and writes `context_handoff/disputes.md` for the developer.

## Envelopes

Agents have exactly two output channels: reference files written into `context_handoff/`, and a **final valid-JSON response** parsed against the output type the call declared. Code persists it as `envelope.json` and injects it into the next agent's `user.md` via `{{previous_envelope}}`. Bad JSON is never a restart — the harness re-prompts the *same session, context intact*, until it parses (bounded). See `references/handoff.md`.

**The output contract is a synced triad**: the schema in `modules/typedefs/envelope.ts` ↔ the `## Report` JSON example in the agent's `user.md` ↔ `outputType:` at the call site. Editing any one of the three means editing all three in the same change — drift between them taxes every call with correction retries.

## Running a workflow

```bash
just crust run "add a /health endpoint" --activities plan
just crust run requests/health.md --lifecycle sdlc --run-id a1b2c3d4
just crust run "the /health work" --activities review+code-review
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
