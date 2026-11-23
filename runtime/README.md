# Runtime

This directory holds the package code for pi-crust's repeatable **agents plus code** workflows. Deterministic TypeScript owns sequencing, retries, and acceptance; coding agents work inside bounded activity runs; typed JSON envelopes carry context between them; every event streams into SQLite as it happens.

## The package and the stamp

The runtime ships with pi-crust; it is not copied into a target repository. The installer stamps configuration and prompt-override scaffolding under `.pi-crust/` and records the package location in `.pi-crust/data/pi-crust-home`.

Once stamped, **the non-example config is yours.** Retune the roster or change a Lifecycle by hand. A re-install skips existing files unless you use `--refresh`, which replaces only template-owned files, including `.example.yaml` documents under `config/`. A missing `config/` is seeded once; after that, non-example files there are neither added nor overwritten. `--force` is a deprecated alias through 0.1.x, scheduled for removal in 0.2.0. See [the install cookbook](../cookbooks/install.md) for adopting new settings deliberately.

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
├── cli.ts
├── commands/
│   ├── crust.just
│   ├── <recipe>.ts
│   ├── print-db-path.ts
│   └── <name>.test.ts
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
│   └── workspace/    Git, worktrees, roots and workspace registration
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

| Entry           | Holds                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| `cli.ts`        | The front door stamped repositories invoke                                 |
| `commands/`     | Recipe-named entry points, the recipes file and their tests                |
| `domains/`      | Capability-owned logic exposed through domain indexes                      |
| `lib/`          | Packages used across domains                                               |
| `testing/`      | Shared fixtures and capture helpers                                        |
| `prompts/`      | Shipped Activity prompts and tests of their content                        |
| `extensions/`   | Host-loaded adapters; every agent loads the package path policy            |
| `README.md`     | Runtime usage and layout documentation                                     |
| `tsconfig.json` | The runtime compiler project; extensions are checked against pi separately |

The [runtime layout record](../adr/runtime-layout/name-runtime-directories-for-what-they-hold.md) defines where new files belong and separates command composition from shared CLI behavior.

## Running something

```bash
just crust demo                                  # two cheap read-only runs, end to end
just crust run "add a /health endpoint" --activities plan      # one Activity
just crust run "add a /health endpoint" --lifecycle sdlc      # identify → … → code-review
just crust report                                # where the last run got to
just crust sessions                              # what just happened
```

Every Activity `.pi-crust/config/crust.activities.yaml` registers can run on its own, and `run` executes any ordered subset of them:

```bash
bun <pi-crust>/runtime/commands/run.ts "<prompt>" --activities test,build,code-review
```

The list is that file's, not this package's: add an entry and it is runnable, delete one and the capability is gone. A name nothing registers is refused before anything spawns, with the list of what was available.

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

| Change                                                                        | File                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------ |
| What an Activity is told                                                      | `prompts/<activity>/{system.md,user.md}`   |
| Which model an Activity runs, what it may write                               | `config/crust.activities.yaml`             |
| What an Activity answers with, how often it may run again, whether it commits | `config/crust.activities.yaml`             |
| Which repository commands run at `change`                                     | `config/crust.config.yaml`, under `tasks:` |
| A Lifecycle's Stages and Activities                                           | `config/crust.lifecycles.yaml`             |

**Package defaults live in `runtime/prompts/`; repository overrides live in `.pi-crust/prompts/`.** A relative prompt reference resolves against the repository's `.pi-crust/` first, then this runtime directory. Editing a shipped default affects repositories that have not overridden it.

Authored files and runtime files are kept apart on purpose: everything under `data/` is written by a run and is yours to read, never to edit.

The engine derives [output checks](../references/config.md#output-checks) from each Activity's envelope spec; they are not configuration fields.

## What is gitignored, and why

In a stamped repository, `.pi-crust/data/` holds execution history rather than source. Commit the repository-owned configuration and prompt overrides, not session transcripts or the trace database. Runtime code stays in the package this README describes; it is not duplicated in the stamp.

## The one prohibition

**Do not hand-edit anything under `data/sessions/`.** That is the run record: the exact prompts sent, the raw agent stream, the parsed envelopes, and the files agents handed each other. Editing it does not change what happened, it only makes the trace lie.

## Where to read more

pi-crust itself carries the rest — `cookbooks/` for how to do a thing, `references/` for the config schema, the envelope contract, and the trace tables. `cat .pi-crust/data/pi-crust-home` says where to find them.
