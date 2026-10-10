# `.pi-crust/` — the pi-crust in this repository

`.pi-crust/` is a software factory: repeatable **agents plus code** workflows. Deterministic TypeScript owns sequencing, retries, and acceptance; coding agents work inside bounded phases; typed JSON envelopes carry context between them; every event streams into SQLite as it happens. Agent proposes, code disposes.

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
- understand a trace — which phase failed, what a gate rejected, what a run cost

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
├── stages/           one per step — each runnable on its own
├── lifecycles/       compositions of stages: sdlc, bugfix, compose
├── modules/
│   ├── typedefs/     types and zod schemas only
│   ├── data/         everything that touches the outside world — git, sqlite, pi, disk
│   └── use-cases/    orchestration and policy — phases, gates, permissions, quality
├── prompt-engineering/   what each agent is told              (tracked — edit here)
├── harness-engineering/  pi extensions each agent can load    (tracked)
└── data/                 runtime only; nothing here is authored
    ├── sessions/         one directory per run                (gitignored)
    └── crust.db           the SQLite trace                     (gitignored)
```

## Running something

```bash
just crust demo                                  # two cheap read-only runs, end to end
just crust plan "add a /health endpoint"         # one step, by name
just crust sdlc "add a /health endpoint"         # plan → test → build → verify → review → code-review
just crust report                                # where the last run got to
just crust sessions                              # what just happened
```

Eleven steps run on their own — `prompt`, `scout`, `plan`, `test`, `build`, `verify`, `review`, `code-review`, `revise`, `commit`, `document` — and `compose` runs any ordered subset of them:

```bash
bun <pi-crust>/runtime/lifecycles/compose.ts "<prompt>" --steps build,verify,code-review
```

A chain whose last step is `review` or `code-review` ends in a bounded revise loop: the blocking findings go back to the builder, who fixes each or disputes it with evidence, and the reviewer rules again — at most twice. A finding repeated with nothing new on either side stops the loop and is written to `context_handoff/disputes.md` for you.

`verify`, `review` and `code-review` also take `--base <ref|range>`, so committed work can be judged:

```bash
bun <pi-crust>/runtime/stages/verify.ts "pre-PR sweep" --base main...HEAD
```

The raw form, which every recipe wraps:

```bash
bun <pi-crust>/runtime/stages/prompt.ts --agent scout "say hello"
bun <pi-crust>/runtime/lifecycles/sdlc.ts requests/health.md --run-id a1b2c3d4
```

The prompt is inline text or a path to a file. `--run-id` is optional on every workflow: given one, the run joins that session and each agent resumes its existing context window; omitted, a fresh id is minted and printed.

A run that stopped is picked up rather than restarted. `just crust report` names the phase it stopped at and prints the command that continues it:

```bash
bun <pi-crust>/runtime/lifecycles/sdlc.ts "<the original request>" --run-id a1b2c3d4 --resume
```

`--resume` works on every workflow and skips the phases already recorded successful for that session.

## Where to edit what

| Change                                                      | File                                             |
| ----------------------------------------------------------- | ------------------------------------------------ |
| What an agent is told                                       | `prompt-engineering/<agent>/{system.md,user.md}` |
| Which model an agent runs, what it may write                | `config/crust.config.yaml`                       |
| Which checks `verify` runs, and which skills an agent loads | `config/crust.config.yaml`, under `routing:`     |
| The fallback lint / typecheck / build commands              | `modules/use-cases/run-checks.ts`                |
| A lifecycle's steps                                         | `lifecycles/<name>.ts`                           |

**Edit prompts here, never inside the skill.** `prompt-engineering/` is the user-owned home for them; the copies in the skill are templates for the next repository, and changing those does nothing for this one.

Authored files and runtime files are kept apart on purpose: everything under `data/` is written by a run and is yours to read, never to edit.

## What is gitignored, and why

`data/sessions/`, `data/crust.db*`, and `node_modules/` are runtime, not source. Sessions hold full agent transcripts and are large; the trace db is rebuildable from them; `node_modules/` is `node_modules/`. Everything else in `.pi-crust/` is meant to be committed — the roster, the prompts, the workflows, and the modules are the factory, and a teammate who clones without them has nothing.

## The one prohibition

**Do not hand-edit anything under `data/sessions/`.** That is the run record: the exact prompts sent, the raw agent stream, the parsed envelopes, and the files agents handed each other. Editing it does not change what happened, it only makes the trace lie.

## Where to read more

pi-crust itself carries the rest — `cookbooks/` for how to do a thing, `references/` for the config schema, the envelope contract, and the trace tables. `cat .pi-crust/data/pi-crust-home` says where to find them.
