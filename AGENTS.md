# Working on pi-crust

This file governs how work is done in this repository. Machine-specific facts — where this clone lives, how it is wired into an agent harness — belong in `AGENTS.local.md`, which is gitignored. `CLAUDE.md` is a one-line pointer at this file, so Claude Code and pi read the same source.

## Engineering stance

Code is organized by **Screaming Architecture (DDD)**: directory and file names say what the code is about, not which technical layer it belongs to. `runtime/domains/` groups code by business capability, each one split into `data/`, `use-cases/` and `typedefs/`, with `runtime/lib/` for the handful of packages used across domains; `apps/visualizer/src/` splits into `domains/`, `pages/` and `lib/`. The frontend additionally uses **Atomic Design**.

TypeScript here is functional: purity, immutability, composition, settlements rather than thrown errors, and dependency-first currying. SOLID still applies — Single Responsibility and Open/Closed most of all.

None of that is restated here, because it is written down in records that are read before the code is written.

## Read before you write

These records are authoritative. Do not infer a convention this repository has already decided, and do not derive one from the file you happen to be editing.

Two trees hold records, and they are not interchangeable:

- `.claude/skills/adr/` — portable conventions that would hold in any repository doing this kind of work. They name technologies, never projects, paths, counts or line numbers, so another repository can copy the tree and delete the nests it does not use.
- `adr/` — decisions about pi-crust itself, which may name its own files.

Read the listed record **before** producing code, prose or a plan for the matching task:

| When the task involves                                                                                                          | Read first                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Authoring or changing any `.ts` / `.tsx`                                                                                        | `.claude/skills/adr/typescript/README.md`, then its trigger table          |
| Backend layering — `data/`, `use-cases/`, `typedefs/`                                                                           | `.claude/skills/adr/project-organization/backend-domains-design-brief.md`  |
| Frontend layering — components, pages, domain boundaries                                                                        | `.claude/skills/adr/project-organization/frontend-domains-design-brief.md` |
| Deciding *where* code belongs, splitting a module, or naming a new domain                                                       | `.claude/skills/adr/project-organization/1-domains-and-atomic-design.md`   |
| Repository-wide principles — KISS, single responsibility, avoiding redundancy                                                   | `.claude/skills/adr/conventions/conventions.md`                            |
| Formatting a markdown document — wrapping, headings, lists, fences, tables                                                      | `.claude/skills/adr/conventions/format-markdown.md`                        |
| Prose carrying a finding, decision or recommendation — records, PR and issue text, review replies, commit bodies, code comments | `.claude/skills/adr/conventions/write-from-evidence.md`                    |
| CSS, styling, theme bridges, or responsive layout                                                                               | `.claude/skills/adr/css/README.md`                                         |
| SQL, schema, or query documentation                                                                                             | `.claude/skills/adr/sql/README.md`                                         |
| Writing a commit message                                                                                                        | `.claude/skills/adr/git/use-conventional-commits.md`                       |
| Why verification and skills are selected by changed path rather than by position                                                | `adr/deterministic-verification/route-verification-by-changed-paths.md`    |
| Deciding what a run reads from the issue or document its request references                                                     | `adr/activity-handoff/import-referenced-work.md`                           |
| Deciding what an Activity is handed from the Activities before it — supersede vs annotate, single input vs whole history        | `adr/activity-handoff/envelope-succession.md`                              |
| Deciding what a judging Activity is told to judge — its file list, where it reads the change, the run's start state             | `adr/activity-handoff/review-the-whole-run.md`                             |
| Assigning a model or a thinking level to an Activity, or questioning one already assigned                                       | `adr/choosing-models/choosing-the-right-model-for-an-activity.md`          |

The briefs are scope-specific rather than abridged — read the one for the side of the stack you are on. `1-domains-and-atomic-design.md` is the shared rationale behind both; reach for it when deciding structure, not when following it.

## Skills carry the verification

A record says what is expected. A skill reads the record for you, names files that are verified to conform, and runs a **blocking** check that proves you met it. Load the skill rather than working from memory of the record.

| When the task involves                                                                             | Load                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Writing or editing **any** `.md` — records, specs, READMEs, skills, handoff documents, this file   | `.claude/skills/markdown-authoring/`        |
| Authoring `.ts` / `.tsx` that is not a test                                                        | `.claude/skills/ts-functional-conventions/` |
| Reviewing a change, a diff, or a pull request — any layer                                          | `.claude/skills/ts-code-review/`            |
| Anything to do with tests, writing or reviewing                                                    | `.claude/skills/ts-test-conventions/`       |
| Recording a decision, or editing anything under `adr/`                                             | `.claude/skills/adr-authoring/`             |
| Writing or revising anything in `specs/`                                                           | `.claude/skills/spec-authoring/`            |
| Writing or optimizing an Activity prompt in `runtime/prompt-engineering/`                          | `.claude/skills/prompt-authoring/`          |
| Planning or scoping work that spans more than one file or commit                                   | `.claude/skills/planning-work/`             |
| A failing test, a bug, or a result that surprised you                                              | `.claude/skills/systematic-debugging/`      |
| Evaluating a dependency, tool, or external project                                                 | `.claude/skills/technical-research/`        |
| Creating or repairing a skill                                                                      | `.claude/skills/skill-authoring/`           |
| Drawing a tree, decision tree, workflow, walkthrough, swimlane, relationship diagram or data model | `.claude/skills/ascii-diagrams/`            |
| Capturing, updating, handing off, or discovering context in `.context/project-state/`              | `.claude/skills/project-state/`             |
| Readying a branch for a pull request, or asking whether it is ready                                | `.claude/skills/pr-check/`                  |
| Addressing comments or review feedback on a pull request                                           | `.claude/skills/respond-to-pr-comments/`    |
| Announcing a long task's outcome aloud                                                             | `.claude/skills/spoken-summary/`            |
| Logging an idea or problem found in a session as a prompt for the gh-issue lifecycle               | `.claude/skills/identification-prompt/`     |

The first row is the one most often skipped, and it is the one with the widest reach. Every Activity of a run writes markdown — a handoff document, a plan, a diagnosis, an issue body — and markdown an agent improvised is markdown somebody re-formats later. A `.md` file is in scope whether it lands in the repository, in `{handoff}`, or in a GitHub text box.

There is one review skill rather than one per layer, because which records apply is decided by the paths a change touches, which is mechanical. "fp review", "be review" and "fe review" all resolve to `ts-code-review`.

An Activity in a run may be *primed* with a skill: `routing.skills` in `.pi-crust/config/crust.config.yaml` selects skills by agent and by changed path, and the engine passes each one to the coding agent as `--skill <path>`. Priming is a convenience and nothing more. Every skill in `.claude/skills/` stays discoverable whether or not it was pre-loaded, and an agent is expected to reach for the one that governs what it is about to do. A rule that matched nothing is not permission to skip the skill.

Do not report work complete without running the check the relevant skill names. A convention that is only ever read is a convention that is only sometimes followed, which is the failure these skills exist to close.

## Existing code is not precedent

Records and skills outrank the code around them. Matching the file you are editing is not a defence.

- Do not infer a convention by imitating a neighbouring file. Read the record.
- Where a file conflicts with a record, the record governs the code you are adding.
- Do not bulk-rewrite working code to comply. Migrate what you are already touching for another reason.
- If you notice a conflict you are not fixing, say so rather than propagating it silently.

## One clone, one truth

There is exactly one working copy of pi-crust per machine, and the harness that loads it as a skill points at that same copy. Two checkouts of one branch merge against each other with no remote involved, and the loser is whichever one you forgot about.

Before the first edit of a task, confirm where you are with `git rev-parse --show-toplevel`. Two trees with identical filenames is the shape of an edit that looks successful and lands nowhere.

## Editing while runs are in flight

A run executes from the **stamp** — the `.pi-crust/` directory inside the target repository — but the stamp holds no runtime code. `templates/stamp/` carries only `config/` and `prompt-engineering/{example,README.md}`; `runtime/` (including its `domains/`, `lib/` and `harness-engineering/`), `cookbooks/` and `SKILL.md` all live in this clone, and `.pi-crust/data/pi-crust-home` (or `CRUST_HOME`) is a pointer at it, not a copy. An edit to any of them is live for every process a stamped repository starts after the write — including the agent spawned for the next Activity of a run already going, and including the prompts under `runtime/prompt-engineering/`.

The corollary is the trap this file used to walk a reader into: a process already running keeps the modules it imported at startup. A fix a run writes to `runtime/` does not govern the run that wrote it — it has to be re-run before it is exercised. A run that dies against the bug it is fixing in the same breath is not a sign the fix is wrong.

Two more things reach back here while a run is live, beyond the runtime code every Activity already resolves out of this clone:

- `apps/visualizer/` — the `observe` recipe runs the web app out of this repository, so an edit restarts the dev server and the API underneath a UI somebody is watching.
- Re-stamping — `install.ts --force`, and the `update` recipe that wraps it, replace the factory a run is executing from.

So the question is never "is this change big". It is "am I editing the visualizer while a run is being watched, or about to re-stamp a repository that has a run in it". Both are checkable; neither needs a forecast.

When the answer is yes and the work cannot wait, take a worktree rather than a second clone, and point `CRUST_HOME` at it so the live checkout stays frozen:

```sh
git worktree add ../pi-crust-wip -b <topic>
```

This should be rare. Most changes are invisible to a running run.

This is about working on pi-crust's own source, in THIS clone — `CRUST_HOME` is set explicitly above so the worktree deliberately does not fall back to the live checkout it was branched from. It is not the general case: a worktree of a repository pi-crust has been STAMPED INTO (an ordinary target repository, not this package) no longer needs its own stamp at all to run `just crust ...` — `crust.just`'s passthrough recipe resolves the package home through `CRUST_HOME`, then its own stamp pointer, then the pointer beside the shared git directory `git rev-parse --git-common-dir` names, which finds the main clone a linked worktree was branched from with no re-install (issue #24, `references/config.md`). `git worktree add` followed directly by `just crust run ...`, with no `bun <pi-crust>/scripts/install.ts` in between, is the supported shape for that case.

## Never destroy a user's data

`.pi-crust/data/` holds the trace database and every session directory. It is worth more than any config file, because it cannot be regenerated.

`install.ts` contains no deletion of any kind — only copies and appends — and `data/` has no counterpart in the template, so there is nothing for an update to overwrite. Keep it that way:

- An update may replace anything the template owns. It may not remove anything.
- `config/` belongs to the repository being stamped, not to the template. `--force` skips it.
- Schema migration is a separate, explicitly invoked verb. It reads the old database and writes a new one, keeping the old. It is never a step inside something people run routinely.

## Verification

Every check is a task in `mise.toml`, run from the repository root. Nothing here needs a `cd`: a `cd` into a package picks up that directory's `bunfig.toml` and `tsconfig.json` instead of the repository's, so a check run that way is not the check CI runs.

```sh
mise run check
```

That is the whole gate, in increasing order of cost, stopping at the first failure: `lint`, `typecheck`, `test:agent`, `build` and `check:install`. Run it before reporting work finished. While you are still working, run the scoped commands below instead — this one takes about a minute, and most of that is the suites.

It is one task rather than one for a developer and one for a pipeline, because two gates are how the thing CI runs and the thing you run stop being the same check. What differs between a laptop and a runner is handled inside the individual checks and said out loud: `typecheck:harness` needs a pi install, finds none on a runner, and prints that it did NOT check `harness-engineering/` rather than implying it did.

That gap is accepted rather than hidden. Installing pi on a runner is not worth it for one directory, so CI builds carry the skip and the log says so on every run. `CRUST_STRICT=1` turns the skip into a failure for anywhere that wants it to be one. It is deliberately not keyed on `CI`: every GitHub Actions step sets `CI=true` whether the workflow asks or not, so keying on it would make strictness ambient rather than chosen, and the only way to accept the gap would be to claim not to be running in CI.

`check:install` stamps `templates/stamp/` into a throwaway directory and runs `verify-install.sh` against it, expecting `drift=0`. It needs no git, no network and no cleanup of your own — an install into a bare `mktemp -d` is a legitimate install, which is what makes it runnable unchanged on a runner. Anything other than `drift=0` means the template and the stamp disagree, and that failure ships into other people's repositories.

A runner also needs `bunx playwright install --with-deps chromium`, run from `apps/visualizer`, or the browser-driven visualizer tests skip and the suite is green having not run them. Run from the root, `bunx` resolves the latest playwright rather than the version `apps/visualizer` pins, downloads a Chromium revision the pinned version never looks for, and every browser test still skips.

The test tasks run [`bunt`](https://github.com/losandes/buntap) — a bun-test runner that speaks a reporting protocol — and pipe it through `buntap`, which renders that protocol and applies the coverage gate. Both are devDependencies, and the tasks call them through `bunx`, which resolves them from `node_modules/.bin` without a global install. Typed bare, they do not resolve: neither is on `PATH`, and a shell that reaches `bunt` through a version manager's shim is reaching a different installation, or none. Call them through `bunx` outside a task too.

**Never run `bun test` without `CLAUDECODE=1`.** It is the difference between a readable result and a flood: `bun test runtime` prints 1344 lines, `CLAUDECODE=1 bun test runtime` prints 14, and the 1330 it dropped were per-test `(pass)` lines nobody reads. An agent that spends its context window on them has less left for the work.

Scope a run to what you are changing. That is the normal case while iterating, and the argument is a path from the root:

```sh
CLAUDECODE=1 bun test runtime
CLAUDECODE=1 bun test apps/visualizer/src/lib/markdown/src/markdown.test.ts
```

For two lines instead of fourteen, pipe the same scope through the reporter — identical meaning, less of it:

```sh
CLAUDECODE=1 bunx bunt runtime | bunx buntap --agent
```

**Coverage is only meaningful over the whole repository.** `--coverage` measures every file a run loads, including files imported from outside the scope whose own tests were not in it — so a scoped run reports those as uncovered and is lying. `bun test runtime --coverage` reports `lib/typedefs/src/settlement.ts` at 71.43% functions, which looks like a gap and is not: that module is imported by `runtime` and tested by `lib/typedefs/src/settlement.test.ts`, which a `runtime` scope never ran. Measured whole, the same file is at 100%.

So one command settles coverage, and it is the unscoped one:

```sh
mise run test:agent
```

It names every root — `apps/visualizer lib runtime scripts` — and that list is load-bearing in both directions. A new top-level directory that is not added to it gets its tests skipped while its source is still measured by whatever imports it, which is exactly how `settlement.ts` spent a day appearing to be 80% covered after it moved to `lib/`.

Nothing else settles it, because **`bun test --coverage` fails silently**. `bunfig.toml` sets `coverageThreshold`, bun applies it PER FILE, and a file below it makes bun exit non-zero having printed no message at all — verified again on the scoped run above, which exits 1 with no `error:` line, nothing but the ordinary coverage table and `0 fail`. Read straight, a run that failed its gate looks exactly like a run that passed. `buntap` reads the same threshold and says so:

```text
COVERAGE FAIL 2 files below the minimum (functions 90.00%, lines 90.00%)
  apps/visualizer/server/db.ts functions 62.96%, lines 66.03%
  apps/visualizer/server/writes.ts functions 38.46%, lines 40.91%
```

The exit code says which gate went red: `1` is a failing test, `3` is coverage. Both are failures. Because coverage is judged per file, a package whose total is 96% still fails on one 40% file.

A pipeline reports the last command's status, so what reaches you is `buntap`'s verdict rather than bun's own exit code. That is the trade the pipe makes for a legible failure.

A test that drives the CLI reporter — directly through `createConsole`, or through `createRun`/`startSession`, which wire it — keeps printing for real and captures the bytes with `runtime/testing/terminal-capture.ts`. Stubbing the reporter instead would stop proving that a printed line and its traced twin cannot drift, which is the whole claim `report-to-console.ts` makes about itself.

`mise run typecheck` is three checks in sequence: `typecheck:runtime`, `typecheck:harness`, and `typecheck:visualizer`. `runtime/tsconfig.json` excludes `harness-engineering/`, so the first does not check it. The second does, against the pi installed on this machine — those extensions import `@earendil-works/*` and `typebox` from the host rather than from this repository, and pinning a copy would check them against a version no agent here runs. With no pi installed it says so and exits 0, which is a skipped check, not a passed one — and under `CRUST_STRICT` it exits 1 instead, for anywhere that would rather fail than carry the gap.

`apps/visualizer`'s suite also includes a browser-driven layout test (`SessionCard.layout.test.ts`) that spins up real Chromium through Playwright to measure actual rendered geometry, because `happy-dom` has no layout engine and cannot see overflow clipping. Chromium is a ~99MB download and is not vendored, so on a machine without it that test prints a warning and skips rather than failing the suite — a skipped check, not a passed one. Run `bunx playwright install chromium` from `apps/visualizer` to make it run for real.

To prove a stamp matches its source on its own, without the rest of the gate:

```sh
mise run check:install
```

It is also the thing to run against a repository you already stamped, which `mise run check` cannot do because it works in a throwaway directory:

```sh
scripts/verify-install.sh /path/to/a/stamped/repo
```

Lint is wired up — `biome.json` at the root, with the convention plugins in `.biome/`:

```sh
mise run lint
```

That is `biome check` over `apps`, `lib`, `runtime`, `scripts` and `templates` — every root that holds source. It is the same list the test tasks name, and for the same reason: a root nobody names is a root nobody checks. mise appends anything after `--` to the command, so `mise run lint -- --max-diagnostics=500` raises the cap when it truncates the report, and `mise run lint -- --fix` applies Biome's fixes.

It is green, and it stays green: a change that reports a diagnostic is not finished. The backlog Biome found when the configuration first landed was repaid in five stages, so there is no longer a standing exception anyone can point at, and a new report is a regression rather than an inheritance.

Do not report lint as passing on a narrowed path: the claim is only ever settled by `mise run lint` with no path argument, and narrowing `includes` to make a job pass is ruled out by `.biome/README.md`. Read the exit code rather than counting lines — Biome prints a diagnostic header in several shapes, including `path format` with no line or column and `path:line:column <rule>  FIXABLE` with doubled spaces, and every pattern written to count them has missed one of those at least once.

A file in `bunfig.toml`'s `coveragePathIgnorePatterns` is not a gap in the test suite; it is a claim about what the module IS, not about the state of its tests. Each entry names a module that performs process-boundary I/O — a spawn, a raw-mode TTY, a real network call — and holds no decision logic of its own, with a comment on the line above stating what no `bun test` process can execute, and a matching comment at the top of the excluded file naming what was moved out of it so the remainder could be covered. A module is never excluded merely because covering it is difficult, slow, or unfinished — difficulty is a reason to write the test, not to exclude the file — and the threshold itself never moves to make a gate pass, because that would trade nine named problems for one invisible one.

### What `mise run check` does not settle

The gate covers source. It runs no markdown, record, skill, spec or project-state check, so those claims are settled by the skills' own blocking scripts and by nothing else:

| Claim                             | What proves it                                                               |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Markdown conforms                 | `.claude/skills/markdown-authoring/scripts/check-markdown.sh`                |
| A record conforms                 | `.claude/skills/adr-authoring/scripts/check-adr.sh`                          |
| A spec conforms                   | `.claude/skills/spec-authoring/scripts/check-spec.sh`                        |
| A skill conforms                  | `.claude/skills/skill-authoring/scripts/check-skill.sh`                      |
| Tests conform                     | `.claude/skills/ts-test-conventions/scripts/check-test-conventions.sh`       |
| Parameters are immutable          | `.claude/skills/ts-functional-conventions/scripts/check-immutable-params.ts` |
| An exported diagram conforms      | `.claude/skills/ascii-diagrams/scripts/check-ascii-diagram.ts`               |
| A project-state artifact conforms | `.claude/skills/project-state/scripts/check-project-state.sh`                |
| A branch is ready for review      | `.claude/skills/pr-check/scripts/check-pr.sh`                                |

A rule that reports nothing may be disabled rather than satisfied. Zero means nothing until a deliberate violation has been seen to fire.

## Where a correction belongs

A correction that lands only in the conversation is a correction that expires with it. Route it:

| The correction is                                                  | It goes                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| A rule that should hold in any repository doing this kind of work  | A record under `.claude/skills/adr/`, via `adr-authoring`  |
| A decision about pi-crust itself — its engine, its stamp, its data | A record under `adr/`                                      |
| A fact about how work is done in this repository                   | This file                                                  |
| A routing problem — the right document existed and was not read    | The trigger tables above                                   |
| A rule a checker should have caught                                | The skill that owns the checker                            |
| Personal style or workflow preference                              | The developer's own agent configuration, outside this repo |

## Contributing

Branching, commit messages, and pull requests are in [CONTRIBUTING.md](CONTRIBUTING.md). They apply to the maintainer too.
