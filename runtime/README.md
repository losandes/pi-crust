# Runtime

This directory holds the package code for pi-crust's repeatable **agents plus code** workflows. Deterministic TypeScript owns sequencing, retries, and acceptance; coding agents work inside bounded activity runs; typed JSON envelopes carry context between them; every event streams into SQLite as it happens.

## The package and the stamp

The runtime ships with pi-crust; it is not copied into a target repository. The installer writes one comment-only `pi-crust.toml`, the credential example, the justfile passthrough and the machine record at `~/.pi-crust/pi-crust-home`, and nothing under the repository's `.pi-crust/`. It creates no configuration directory or prompt files.

Configuration is read on every command from `runtime/config/`, then `~/.pi-crust/config/`, then the repository file. Both directories hold `crust.config.toml`, `crust.activities.toml` and `crust.lifecycles.toml`. Tables merge recursively; arrays replace whole. Package updates need no re-stamp. The installer never replaces an existing `pi-crust.toml`, even with `--refresh` or its deprecated `--force` alias. See [the install cookbook](../cookbooks/install.md).

Viewer settings and added themes live in the machine configuration. Leftover `.pi-crust/config/crust.observe.yaml` and `.pi-crust/data/pi-crust-home` files are not read or deleted.

## The `/skill:crust` capability

There is a skill behind this directory, and it is how you drive it. Invoke it with `/skill:crust` (or just ask your agent to "use the crust skill").

Reach for it when you want to:

- install or re-install the factory into a repository
- create a new workflow, or change an existing chain
- add an agent, retune a model, or change what an agent is allowed to write
- run a workflow and have the run watched and reported on
- understand a trace — which activity run failed, what a gate rejected, what a run cost

The skill carries cookbooks for each of those and will load only the one your request needs. It also knows the rules this code enforces, which is why asking it beats editing by hand the first few times.

## Layout

```text
runtime/
├── cli.ts             crust command; dispatches from the CLI definitions
├── commands/          Command programs and their tests
│   ├── <command>.ts
│   └── <name>.test.ts
├── config/            Package TOML defaults
├── domains/
│   ├── activities/   Activity registration and execution
│   ├── agents/       coding-agent hosts and their I/O
│   ├── cli/          shared command-line behavior
│   ├── config/       configuration and its layers
│   ├── gates/        acceptance, disputes and regressions
│   ├── handoff/      inter-Activity artifacts and session documents
│   ├── imports/      referenced work and provenance
│   ├── planning/     Activities and Lifecycles turned into a plan
│   ├── policy/       governed paths and deterministic checks
│   ├── runs/         run execution and orchestration
│   ├── trace/        the trace store and its readers
│   └── workspace/    Git, worktrees, roots and data paths
├── lib/
│   ├── contracts/    shared types and schemas
│   ├── system/       process, filesystem, clock and ID primitives
│   └── terminal/     terminal output and clipboard integration
├── testing/
├── prompts/
├── extensions/
├── README.md
└── tsconfig.json
```

| Entry           | Holds                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| `cli.ts`        | The crust command; reads definitions and starts each program as its own bun process |
| `commands/`     | Command programs and their tests                                                    |
| `config/`       | The package's three default TOML files                                              |
| `domains/`      | Capability-owned logic exposed through domain indexes                               |
| `lib/`          | Packages used across domains                                                        |
| `testing/`      | Shared fixtures and capture helpers                                                 |
| `prompts/`      | Shipped Activity prompts and tests of their content                                 |
| `extensions/`   | Host-loaded adapters; every agent loads the package path policy                     |
| `README.md`     | Runtime usage and layout documentation                                              |
| `tsconfig.json` | The runtime compiler project; extensions are checked against pi separately          |

The [runtime layout record](../adr/runtime-layout/define-each-command-once-and-dispatch-from-cli.md) defines where new files belong and separates command composition from shared CLI behavior.

## Running something

```bash
just crust demo                                  # two cheap read-only runs, end to end
just crust run "add a /health endpoint" --activities plan      # one Activity
just crust run "add a /health endpoint" --lifecycle sdlc      # identify → … → code-review
just crust report                                # where the last run got to
just crust sessions                              # what just happened
```

Every Activity the merged TOML registry defines can run on its own, and `run` executes any ordered subset of them:

```bash
bun <pi-crust>/runtime/commands/run.ts "<prompt>" --activities test,build,code-review
```

There is no separate code registry: a new keyed table registers an Activity. Listings group entries by first-declaring layer and sort names within each group. A name nothing registers is refused before anything spawns, with the available names.

A chain that ends in reviewing Activities — any whose registry entry declares `output: reviewOutput` — ends in a bounded revise loop, and every one of them is re-asked each round: the blocking findings go back to the Activity that wrote the work, which fixes each or disputes it with evidence, and the reviewer rules again. The bound is that Activity's own `attempts`, the same budget a failed gate and a regression spend from. A finding repeated with nothing new on either side stops the loop and is written to `context_handoff/disputes.md` for you.

`review` and `code-review` take `--scope <ref|range>`, so committed work can be judged, and the repository's own checks run on their own with no Lifecycle at all:

```bash
just crust run "the /health work" --activities code-review --scope main...HEAD
just crust verify                                # change tasks, for what you changed
```

The raw form, which every recipe wraps:

```bash
bun <pi-crust>/runtime/commands/run.ts requests/health.md --lifecycle sdlc --run-id a1b2c3d4
```

The prompt is inline text or a path to a file. `--run-id` is optional on every workflow: given one, the run joins that session and each agent resumes its existing context window; omitted, a fresh id is minted and printed.

A run that stopped is picked up rather than restarted. `just crust report` names the activity run it stopped at and prints the command that continues it:

```bash
bun <pi-crust>/runtime/commands/run.ts "<the original request>" --lifecycle sdlc --run-id a1b2c3d4 --resume
```

`--resume` works on every workflow and skips the activity runs already recorded successful for that session.

## Where to edit what

| Change                                                                        | File                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| What an Activity is told                                                      | `prompts/<activity>/{system.md,user.md}`                  |
| Which model an Activity runs, what it may write                               | The machine's `crust.activities.toml`, or `pi-crust.toml` |
| What an Activity answers with, how often it may run again, whether it commits | `[activities.<name>]` in the chosen TOML layer            |
| Which repository commands run at `change`                                     | `pi-crust.toml`, under `[tasks.<name>]`                   |
| A Lifecycle's Stages and Activities                                           | `[lifecycles.<name>]` in the chosen TOML layer            |

**Shipped prompts live in `runtime/prompts/`.** An entry names one directory, default `prompts/<name>`, relative to the root of the layer that first declares it. Machine-only entries normally use `~/.pi-crust/prompts/<name>/`; required prompt files are validated when a run uses them. A repository prompt override directory is no longer read. Change shipped prompts in a package fork.

Authored files and runtime files are kept apart on purpose: everything under `data/` is written by a run and is yours to read, never to edit.

The engine derives [output checks](../references/config.md#output-checks) from each Activity's envelope spec; they are not configuration fields.

## What is gitignored, and why

Execution history lives at `~/.pi-crust/data/` by default, with earlier traces left in repository `.pi-crust/data/` directories. Commit the repository-owned `pi-crust.toml`, not session transcripts or the trace database. Machine preferences stay under `~/.pi-crust/config/`. Runtime code stays in the package this README describes; it is not duplicated in the stamp.

## The one prohibition

**Do not hand-edit anything under `data/sessions/`.** That is the run record: the exact prompts sent, the raw agent stream, the parsed envelopes, and the files agents handed each other. Editing it does not change what happened, it only makes the trace lie.

## Where to read more

pi-crust itself carries the rest — `cookbooks/` for how to do a thing, `references/` for the config schema, the envelope contract, and the trace tables. `cat ~/.pi-crust/pi-crust-home` says where to find them.
