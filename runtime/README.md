# `.pi-crust/` — the pi-crust in this repository

`.pi-crust/` is a software factory: repeatable **agents plus code** workflows. Deterministic TypeScript owns sequencing, retries, and acceptance; coding agents work inside bounded activity runs; typed JSON envelopes carry context between them; every event streams into SQLite as it happens. Agent proposes, code disposes.

## Why it is here, and who put it there

Nobody hand-wrote this directory. It was stamped out of pi-crust by its installer, which copies a template tree into the repository root. Where that copy came from is recorded in `data/pi-crust-home`.

Once stamped, **it is yours.** Edit the prompts, retune the roster, rewrite a workflow, add a gate. The skill will not overwrite anything you change — a re-install skips every file that already exists, and only `--force` overwrites.

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
.pi-crust/
├── README.md         this file
├── package.json      one dependency: zod. Run `bun install` here once.
├── tsconfig.json     strict; the same compiler settings the repo uses
├── crust.just         recipes, reached as `just crust <recipe>`
├── report.ts         where did a run stop, and what picks it back up
├── config/
│   └── crust.config.yaml    the agent roster — one agent, one prompt, one purpose
├── stages/           the Planners: operator and triage
├── lifecycles/       compositions of stages: sdlc, bugfix, compose
├── domains/          business capabilities, each index.ts + src/{data,typedefs,use-cases}
│   ├── activities/   what an Activity is, which ones exist, running one
│   ├── agents/       coding-agent hosts and their I/O
│   ├── cli/          the developer-facing command surface
│   ├── config/       reading and merging crust.config.yaml and its layers
│   ├── gates/        acceptance — gates, disputes, regressions
│   ├── handoff/      the session directory and inter-activity artifacts
│   ├── planning/     activities and lifecycles turned into an ordered plan
│   ├── policy/       what an agent may touch and which checks it routes to
│   ├── runs/         the engine that executes a run and reports it
│   ├── trace/        the SQLite trace, its reader, and what observes a run
│   └── workspace/    git, worktrees, roots, the machine-local workspace registry
├── lib/              packages used across domains, each index.ts + flat src/
│   ├── contracts/    the shared domain model — types and zod schemas
│   ├── system/       process, filesystem, clock and id primitives
│   └── terminal/     writing to a terminal and to the clipboard
├── prompt-engineering/   what each agent is told              (tracked — edit here)
├── harness-engineering/  pi extensions each agent can load    (tracked)
└── data/                 runtime only; nothing here is authored
    ├── sessions/         one directory per run                (gitignored)
    └── crust.db           the SQLite trace                     (gitignored)
```

## Running something

```bash
just crust demo                                  # two cheap read-only runs, end to end
just crust run "add a /health endpoint" --activities plan      # one Activity
just crust run "add a /health endpoint" --lifecycle sdlc      # identify → … → code-review
just crust report                                # where the last run got to
just crust sessions                              # what just happened
```

Every Activity `config/crust.activities.yaml` registers runs on its own, and `compose` runs any ordered subset of them:

```bash
bun <pi-crust>/runtime/lifecycles/compose.ts "<prompt>" --activities test,build,code-review
```

The list is that file's, not this package's: add an entry and it is runnable, delete one and the capability is gone. A name nothing registers is refused before anything spawns, with the list of what was available.

A chain that ends in reviewing Activities — any whose registry entry declares `output: reviewOutput` — ends in a bounded revise loop, and every one of them is re-asked each round: the blocking findings go back to the Activity that wrote the work, which fixes each or disputes it with evidence, and the reviewer rules again. The bound is that Activity's own `attempts`, the same budget a failed gate and a regression spend from. A finding repeated with nothing new on either side stops the loop and is written to `context_handoff/disputes.md` for you.

`review` and `code-review` take `--scope <ref|range>`, so committed work can be judged, and the repository's own checks run on their own with no Lifecycle at all:

```bash
just crust run "the /health work" --activities code-review --scope main...HEAD
just crust verify                                # routing.checks, for what you changed
```

The raw form, which every recipe wraps:

```bash
bun <pi-crust>/runtime/lifecycles/compose.ts requests/health.md --lifecycle sdlc --run-id a1b2c3d4
```

The prompt is inline text or a path to a file. `--run-id` is optional on every workflow: given one, the run joins that session and each agent resumes its existing context window; omitted, a fresh id is minted and printed.

A run that stopped is picked up rather than restarted. `just crust report` names the activity run it stopped at and prints the command that continues it:

```bash
bun <pi-crust>/runtime/lifecycles/compose.ts "<the original request>" --lifecycle sdlc --run-id a1b2c3d4 --resume
```

`--resume` works on every workflow and skips the activity runs already recorded successful for that session.

## Where to edit what

| Change                                                                                       | File                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| What an Activity is told                                                                     | `prompt-engineering/<activity>/{system.md,user.md}` |
| Which model an Activity runs, what it may write                                              | `config/crust.activities.yaml`                      |
| What an Activity answers with, what gates it, how often it may run again, whether it commits | `config/crust.activities.yaml`                      |
| Which commands the `checks` gate runs, and which skills an Activity loads                    | `config/crust.config.yaml`, under `routing:`        |
| A Lifecycle's Stages and Activities                                                          | `config/crust.lifecycles.yaml`                      |

**Edit prompts here, never inside the skill.** `prompt-engineering/` is the user-owned home for them; the copies in the skill are templates for the next repository, and changing those does nothing for this one.

Authored files and runtime files are kept apart on purpose: everything under `data/` is written by a run and is yours to read, never to edit.

## What is gitignored, and why

`data/sessions/`, `data/crust.db*`, and `node_modules/` are runtime, not source. Sessions hold full agent transcripts and are large; the trace db is rebuildable from them; `node_modules/` is `node_modules/`. Everything else in `.pi-crust/` is meant to be committed — the roster, the prompts, the workflows, and the modules are the factory, and a teammate who clones without them has nothing.

## The one prohibition

**Do not hand-edit anything under `data/sessions/`.** That is the run record: the exact prompts sent, the raw agent stream, the parsed envelopes, and the files agents handed each other. Editing it does not change what happened, it only makes the trace lie.

## Where to read more

pi-crust itself carries the rest — `cookbooks/` for how to do a thing, `references/` for the config schema, the envelope contract, and the trace tables. `cat .pi-crust/data/pi-crust-home` says where to find them.
