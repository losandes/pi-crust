# pi-crust Overview

The system map the orchestrator reads on startup: the package, the repository file, and the cookbook to load next.

## What pi-crust is

pi-crust builds repeatable **agents plus code** workflows. Deterministic TypeScript owns sequencing, retries and acceptance; agents work inside bounded Activity Runs. A `run_id` identifies the same run in the trace, session directories and visualizer.

Your job as orchestrator is to run and observe the system and help the engineer interact with it, not do the work inside its workflow.

## Package layout

Runtime code, default configuration and shipped prompts stay in the package. This directory tree shows their homes:

```text
<pi-crust>/
├── runtime/
│   ├── cli.ts                    crust: definitions dispatch to bun processes
│   ├── commands/                 Command programs and their tests
│   ├── config/
│   │   ├── crust.config.toml     Defaults, polling, ports and added themes
│   │   ├── crust.activities.toml Activity, Planner and terminal tables
│   │   └── crust.lifecycles.toml Ordered lifecycle stages
│   ├── domains/                  Capability-owned logic
│   ├── lib/                      Contracts, system and terminal primitives
│   ├── prompts/                  One directory per prompt pair
│   ├── extensions/               Package path-policy adapter
│   └── testing/                  Shared test fixtures
├── apps/visualizer/              Trace API and browser UI
├── templates/pi-crust.toml       Comment-only repository template
├── cookbooks/                    Task procedures and TOML examples
└── references/                   Configuration, handoff and trace contracts
```

Each domain exposes `index.ts` over `src/{data,typedefs,use-cases}`. Cross-domain production imports use that index, not another domain's private source directory.

## Repository layout

Setup writes `pi-crust.toml` when absent, the credential example `.env.pi-crust.example`, and the `.pi-crust/data/` entry in `.gitignore`: exactly three files on a fresh setup. It writes nothing under the repository's `.pi-crust/`, no `justfile` and no machine record, and leaves an existing `justfile` untouched. Runs create `crust.db`, [repository-grouped session directories](../references/observability.md#where-a-runs-files-are) and command logs under `~/.pi-crust/data/` by default, shared across repositories.

Configuration is read on every command in three layers: package `runtime/config/`, machine `~/.pi-crust/config/`, repository `pi-crust.toml`. The two directories each hold the same three TOML filenames. Tables merge recursively; arrays, including lifecycle stages, replace whole. The repository wins for fields it states. Lists group entries by first-declaring layer and sort names inside each group.

Machine-only Activity prompts normally live under `~/.pi-crust/prompts/<name>/`. An entry names one directory; relative paths resolve against the first-declaring layer's root. Both required prompt files are validated when a run uses them. Shipped prompt changes belong in a package fork, not repository override lookup.

The installer never replaces an existing `pi-crust.toml`, even with `--refresh` or its deprecated `--force` alias. It creates no configuration or prompt directory; legacy directories are left untouched and no longer read for runtime configuration or prompt overrides. Viewer settings and added themes live in the machine configuration. A leftover `.pi-crust/config/crust.observe.yaml` or `.pi-crust/data/pi-crust-home` is not read or deleted. Package updates and machine edits need no re-stamp. See [Install](install.md) and the [configuration reference](../references/config.md).

`data/` is execution history and is not migrated or deleted by a configuration update. Keep it intact.

**v1 runs Pi only.** The package ships `anthropic/claude-haiku-5-5` with thinking `max`; `claude_code` remains unimplemented.

## The activity run model

Every run is a sequence of **activity runs**, each one `await activity run(activityRunParams({...}), body)`. Three kinds, three swim lanes:

- **engineer** — the human lane; today the system-input activity run (who asked, and for what).
- **agent** — `callAgent(run, ph, {...})`: prompt in → typed envelope out → gates verified.
- **code** — deterministic Activities that stand alone (git commit, quality blocks, change capture). Never buried inside an agent activity run.

**Success must be earned — every activity run defaults to `fail`.** A clean exit flips it to success; agent activity runs additionally require the envelope to parse and all gates to come back green. A throw keeps it failed, records an error event, and aborts the run. A failed gate is not a throw while the Activity has budget: it runs again, as its own Activity Run, against its `attempts`.

## The Activity model

An **Activity** is a discrete unit of work and the agent that performs it — one `[activities.<name>]` table in the merged TOML layers, carrying both halves:

| Key                                               | Says                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `model`, `thinking`, `tools`, `writes`, `prompts` | who performs it, and what it may reach                               |
| `output`                                          | the envelope contract it answers, by published name                  |
| `input`                                           | `upstream` (the default), or `changes` for the run's own diff        |
| `attempts`                                        | Activity Runs of one instance this run may spend, the first included |
| `commit`                                          | land its own change, in its envelope's words, once its gates pass    |

There is no registry in TypeScript. A new keyed table registers an Activity without changing a code registry: a Lifecycle names `plan`, and `plan` IS the entry. An `output` nothing publishes is refused at load, with the list of what was available — that refusal is what replaced the compiler's old union of Activity names. The engine derives [output checks](../references/config.md#output-checks) from each Activity's `output`; a registry entry does not list them.

Three things are NOT Activities, deliberately:

- **The Planners** — `operator`, `triage`, and the Composer. They decide what happens and perform none of it, they are a closed set in code, and a Lifecycle cannot name one. Configuration tunes their model, tools, writes and prompts under `[planners.<name>]`.
- **Repository tasks** — a command declared under `[tasks.<name>]` in `pi-crust.toml` runs at `change` when it selects paths the Activity changed. A failure goes back to the Activity that changed them.
- **Delivery** — an Activity with `commit = true` lands its own change once its gates pass, so granularity follows the chain. `--commit false` turns it off for a whole run; there is no flag that turns it on.

A chain that ENDS in reviewing Activities — any declaring `output = "reviewOutput"` — gets the bounded revise loop from `use-cases/revise-loop.ts`, which re-asks all of them each round: the blocking findings go back to the Activity that wrote the work, which fixes each or disputes it with evidence, and the reviewer rules again. The bound is that Activity's `attempts` — one ceiling covers the gate retry, the revise round and the regression, because the three failure modes are correlated. The builder may dispute a finding instead of fixing it, with evidence the `disputes_supported` gate insists on; a finding a declared check decides may not be disputed at all; and a finding repeated with nothing new on either side ends the loop and writes `context_handoff/disputes.md` for the developer.

## Envelopes

Agents have exactly two output channels: reference files written into `context_handoff/`, and a **final valid-JSON response** parsed against the output type the call declared. Code persists it as `envelope.json` and injects it into the next agent's `user.md` via `{{previous_envelope}}`. Bad JSON is never a restart — the harness re-prompts the *same session, context intact*, until it parses (bounded). See `references/handoff.md`.

**The output contract is a synced triad**: the schema in `lib/contracts/src/envelope.ts` ↔ the `## Report` JSON example in the agent's `user.md` ↔ `outputType:` at the call site. Editing any one of the three means editing all three in the same change — drift between them taxes every call with correction retries.

## Running a workflow

```bash
crust run "add a /health endpoint" --activities plan
crust run requests/health.md --lifecycle sdlc --run-id a1b2c3d4
crust run "the /health work" --activities review+code-review
```

The prompt is inline text or a file path. `--run-id` is optional on every workflow: given one, the run joins that session (same dirs, same `context_handoff/`, agents resume their existing context windows); omitted, a fresh id is minted and printed.

A run that stopped is picked up, not restarted:

```bash
crust report                      # where did the last run stop?
crust run "<the original request>" --lifecycle sdlc --run-id a1b2c3d4 --resume
```

`--resume` skips every activity run already recorded successful for that session and starts at the first that is not. It works on every workflow, and `crust report` prints the exact command for the run it describes.

## When you have finished reading this

You are done with startup. List the available Activities and Lifecycles with `crust list`, and **wait for the engineer's request.**

Do not survey anything else — not the trace db, not the config, not past runs, not the repo tree. You do not yet know what the request is, so anything you gather now is a guess about what will matter, spent from the context the real work needs. Every cookbook and reference below is lazy-loaded, one per request, and that is the whole design.

## Where to go next

Load one cookbook per request — this overview is the only one you read up front.

| Request                                        | Cookbook                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Turn a request into the prompt a workflow gets | `how_to_prompt_for_the_eng.md` — **read before every launch** |
| Set the system up in a repo                    | `install.md`                                                  |
| Add a lifecycle                                | `create_lifecycle.md`                                         |
| Change a lifecycle's stages or concurrency     | `update_lifecycle.md`                                         |
| Generate `pi-crust.toml`                       | `create_config.md`                                            |
| Add or retune an agent                         | `update_config.md`                                            |
| Add low-level logic or a gate                  | `update_modules.md`                                           |
| Run and monitor a workflow                     | `how_to_prompt_for_the_eng.md`, then `run_lifecycle.md`       |

References, loaded when you need the spec: `references/config.md` (full config schema), `references/handoff.md` (envelope + session layout), `references/observability.md` (events, db tables, polling).
