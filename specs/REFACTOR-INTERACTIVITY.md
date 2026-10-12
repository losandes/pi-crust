# Refactor: the surfaces a developer touches name things that exist

## Objective

Every command pi-crust prints can be pasted and run, and every command pi-crust spawns resolves to a file that is there — in the terminal and in the visualizer alike. The developer-facing vocabulary is the model's vocabulary: Activities and Stages, named with `--activities`, with a concurrent Stage written `a+b`. `crust.just` names no Activity and no Lifecycle: what can run is read from configuration at run time, by one generic recipe. Nothing here changes the engine: Lifecycles, Stages, strategies, gates, attempts and delivery are as [FIX-INCOMPLETE-OPEN-CLOSED.md](completed/FIX-INCOMPLETE-OPEN-CLOSED.md) and [REFACTOR-DAG-TASKS.md](completed/REFACTOR-DAG-TASKS.md) left them.

## 1. Requirements

### 1.1 Printed and spawned commands resolve

1.1.1 `resumeCommand` in `runtime/report.ts:135` MUST print the generic recipe form in section 2, carrying `--lifecycle <name>` or `--activities <chain>`. It composes `bun .pi-crust/<stages|lifecycles>/<name>.ts`, which names a directory the installer deletes and a per-Lifecycle file that has not existed since the DAG landed.

1.1.2 Every CLI usage string MUST name the recipe rather than an install path: `runtime/report.ts:6,51`, `decide.ts:6,39`, `checks.ts:6`, `prune.ts:6,31`, `consult.ts:5,41`, `steer.ts:5,43`, `workspaces.ts:9`, `please.ts:19`, `lifecycles/compose.ts:7`, `stages/operator.ts:6,36`, `stages/triage.ts:6,63`, and the `script` default in `parse-cli.ts:120`.

1.1.3 Every command the visualizer server spawns MUST resolve through the rule in section 2. `apps/visualizer/server/writes.ts:172` spawns `.pi-crust/steer.ts`, `:210` spawns `.pi-crust/consult.ts` and `:310` spawns `.pi-crust/lifecycles/<lifecycle>.ts`. None of those paths is stamped, so steer, ask, amend and start-a-run are broken in the UI today.

1.1.4 `startRun` MUST start a Lifecycle through the Composer by name rather than by naming a file per Lifecycle.

1.1.5 A missing or unusable `pi-crust-home` MUST be refused with the message the recipes already use — what was looked for and how to repair it — rather than spawning a path that cannot exist and reporting `started: true`.

1.1.6 `runArgv` in `compose-request.ts:135` MUST compose the recipe form directly. It builds `.pi-crust/stages/<operator>.ts` and `.pi-crust/lifecycles/compose.ts` and then rewrites them into recipes in `justArgv`, so a path nothing can run is the intermediate representation of the one thing that can.

1.1.9 `recipeFor` in `compose-request.ts:210` MUST stop deriving a recipe name from a Lifecycle or an Activity. `LIFECYCLE_PATH` and `STAGE_PATH` turn `sdlc` into `just crust sdlc`, which is the recipe 1.2.1 removes.

1.1.7 The `protected_files` default in `modules/typedefs/config.ts:89` MUST defend only what the stamp still contains. It lists `.pi-crust/modules/`, `.pi-crust/stages/`, `.pi-crust/lifecycles/` and `.pi-crust/package.json`, all of which the installer removes; the shipped `crust.config.yaml:34` already names `config/` alone.

1.1.8 After this stage, no file under `runtime/`, `apps/` or `scripts/` MUST name `.pi-crust/` followed by anything other than `config/`, `data/` or `prompt-engineering/`. Comments and test fixtures included: a fixture asserting a dead path is a test that defends the defect.

### 1.2 The recipes stop naming Activities and Lifecycles

1.2.1 `crust.just` MUST NOT contain a recipe named for an Activity or for a Lifecycle. The seventeen Activity recipes (`scout`, `identify`, `diagnose`, `conceptualize`, `design`, `plan`, `test`, `build`, `review`, `code-review`, `document`, `technical-research`, `ux-research`, `domain-research`, `security-research`, `data-research`, `ux-design`) and the three Lifecycle recipes (`sdlc`, `de-risk`, `bugfix`) MUST be deleted.

1.2.2 `run` MUST be the one recipe that runs a chain, taking `--lifecycle <name>` or `--activities <chain>`. It is today's `compose` renamed: the recipe takes the name of what a developer is doing, now that it is the only route to doing it.

1.2.9 `lifecycles/compose.ts` MUST keep its name. The Composer is engine vocabulary settled by [REFACTOR-OPEN-CLOSED.md](completed/REFACTOR-OPEN-CLOSED.md); only the recipe in front of it is renamed.

1.2.3 Every surviving recipe MUST name a capability the package owns rather than a registry entry: `default`, `list`, `run`, `demo`, `verify`, `operator`, `triage`, `please`, `approve`, `reject`, `answer`, `report`, `report-json`, `sessions`, `activity-runs`, `tail`, `procs`, `prune`, `ask`, `steer`, `amend`, `trees`, `forget-tree`, `observe`, `update`. Planners are a closed set in code, so `operator` and `triage` are capabilities, not registry entries.

1.2.4 `just crust list` MUST print what this repository offers — Lifecycles, Planners, Activities, each with its description — read from the merged configuration at run time. It is the replacement for reading `just crust default` to find out what can run.

1.2.5 `recipes.test.ts` MUST be replaced by a test that fails when `crust.just` names any Activity or Lifecycle from the shipped configuration. Its current second assertion filters the file for `.pi-crust/stages/`, a string the file no longer contains, so it passes on an empty set and would pass on any file at all.

1.2.6 `demo` MUST keep working without naming an Activity in a recipe name. It MAY pass `--activities scout` in its body: it is a fixed first-run script, not a route to an Activity.

1.2.7 `shipped-config.test.ts:57` and `:135` MUST be reconciled with the Lifecycles that now ship. Both assert a list of five names against a file holding eight, and both fail on `main` today.

1.2.8 The orphan heading at `crust.config.yaml:38` MUST go. It introduces a `steps:` block that holds no keys, and describes an ordering and hiding mechanism that moved into `crust.activities.yaml`.

### 1.3 Stages and strategy reach the command line

1.3.1 `--activities` MUST accept the grammar in section 2: `,` ends a Stage, `+` joins Activities into one concurrent Stage.

1.3.2 A run of consecutive single-name groups MUST fold into one serial Stage, so `--activities plan,build,test` behaves exactly as `--steps plan,build,test` does today.

1.3.3 Stage names MUST be derived rather than typed. Nothing a developer reads needs a name for an ad-hoc Stage, and a flag that let them name one would make the name a second thing to keep true.

1.3.4 An unrecognised Activity name MUST be refused at parse, listing the Activities the merged configuration offers — the same refusal `resolveSteps` already gives.

1.3.5 A concurrent group whose Activities declare overlapping `writes` MUST be refused by the existing check in `concurrency-faults.ts`, naming both Activities, before anything runs.

1.3.6 `please` MUST NOT offer concurrency when a chain is assembled by hand. It emits `+` only when the Lifecycle it chose contains a concurrent Stage.

1.3.7 `--approve-after` MUST keep naming Activities. Its meaning — that Activity runs, then the run stops — is unchanged by derived Stages.

### 1.4 The rename is a clean break

1.4.1 `--steps` MUST be removed, with no alias. It MUST NOT fall through to "unknown flag": it MUST fail naming its replacement and the concurrent form, and the run MUST NOT start.

1.4.2 The identifiers MUST follow the flag: `parse-cli.ts:28,76,92,178`, `step.ts`, `step-catalogue.ts`, `step-order.ts`, `run-steps.ts`, `use-cases/steps/`, `menu-options.ts`, and the `STEP` positional in `consult`, `steer` and their recipes.

1.4.3 `asSingleStage` in `plan-units.ts` MUST stop naming its Stage `steps`. That name reaches the trace and the UI.

1.4.4 Prose MUST stop using "stage" for the unit of work. `envelope.ts`, `decide.ts` and `please.ts` use it for what the model calls an Activity — the exact word now reserved for the grouping.

1.4.5 Any surviving use of "step" MUST be deliberate and listed in the stage's report. A sweep that ends in silence is indistinguishable from one that was not run.

### 1.5 The visualizer tells the truth about concurrent Activity Runs

1.5.1 Nothing in the UI MUST read `seq` as "what ran after what". It is assigned `MAX(seq)+1` at insert (`trace-db.ts:354`), so two Activities running concurrently get distinct values in whatever order they happened to insert. `use-trace.ts:122`, `ActivityRunDots.tsx:12`, `consult.ts:83,90` and `ActivityRunDetail.tsx:197` all order or filter by it.

1.5.2 Two Activity Runs executing at once MUST both read as running — in the detail pane's selection, the dots, the narration and the polling.

1.5.3 The waterfall MUST NOT fabricate separation between blocks that genuinely overlapped. `MIN_BLOCK_PCT` widens a short block and moves its neighbours, which is correct for a sequence and a lie for a concurrent Stage.

1.5.4 Lists of Activity Runs MUST order concurrent members so they read as concurrent rather than as an arbitrary sequence.

1.5.5 A concurrency fault MUST surface in the UI as a failure. The run is refused at load, so today it is a run that never appears.

1.5.6 Stage, strategy and Stage-level gates MUST stay invisible in the UI. This is a deliberate exclusion and MUST be recorded in `apps/visualizer/README.md` so the next reader does not treat it as a gap.

### 1.6 The visualizer's vocabulary follows the rename

1.6.1 `/api/sessions/:run_id/steps/:step/consult` and `/steer` (`server/index.ts:472,509`) MUST be renamed with their client.

1.6.2 `src/lib/{api,consult,ledger,artifacts,format}.ts`, `RunControls.tsx`, `SteerDialog.tsx`, `ActivityRunDetail.tsx`, `NarrationPane.tsx`, `SessionContext.tsx`, `DecisionLedger.tsx`, `ArtifactList.tsx` and their CSS modules MUST follow, in parameters, labels and class names.

1.6.3 The route and its client MUST change in the same commit. The API has one consumer, shipped in this repository, and `observe` boots the server on demand, so there is no deprecation window worth building.

### 1.7 The documents describe the interface that exists

1.7.1 `SKILL.md`, `README.md`, `runtime/README.md`, `references/*.md` and `cookbooks/*.md` MUST teach `--activities`, the `a+b` form, and `just crust` rather than install paths. Every `just crust <activity>` and `just crust <lifecycle>` example MUST become the generic form, and `just crust list` MUST be how a reader is told to find out what exists.

1.7.2 Documented commands naming an Activity that no longer exists MUST be corrected. `cookbooks/install.md:79` runs `--steps prompt`; `cookbooks/run_lifecycle.md:101` and `cookbooks/crust_overview.md:29` name `.pi-crust/lifecycles/compose.ts`.

1.7.3 The next-steps block in `scripts/install.ts:277` MUST print a command a reader can type. It offers the raw `bun "$(cat .pi-crust/data/pi-crust-home)/runtime/lifecycles/compose.ts" … --steps scout` as the no-`just` fallback.

1.7.4 The header of `runtime/crust.just:1-14` MUST describe how it is actually reached. It says the file is stamped and loaded through `mod crust '.pi-crust/crust.just'`; it ships with the package and is reached through `runtime/cli.ts`.

1.7.5 The `routing` example at `crust.config.yaml:74` MUST stop naming `revise` as an Activity Run. `revise` left the registry under 1.1.7 of the completed fix and is loop machinery.

## 2. Target state

This is the only place these three rules appear. Where this section and the prose in section 1 disagree, section 1 governs.

**Resolving a command pi-crust spawns or prints.** There is one rule, and `crust.just:27` already states it:

```text
CRUST_HOME, else the contents of <workspace>/.pi-crust/data/pi-crust-home, then /runtime/<entry>.
Neither available            -> refuse, naming what was looked for and how to repair it.
Shown to a developer         -> never this path. `just crust <recipe> …`, always.
```

**The recipe surface.** Nothing in `crust.just` is named for a registry entry:

```sh
just crust list                              what this repository offers
just crust run "<prompt>" --lifecycle sdlc   a configured Lifecycle, by name
just crust run "<prompt>" --activities plan  one Activity, or any chain
```

**The grammar for an ad-hoc chain.** One flag, two separators:

```sh
just crust run "add a /health endpoint" --activities plan,build,test,review+code-review
```

```text
,          ends a Stage
+          joins Activities into ONE concurrent Stage
plan,build,test        -> one serial Stage of three, in that order
review+code-review     -> one concurrent Stage of two
unknown name           -> refused at parse, listing what the configuration offers
overlapping `writes`   -> refused at load, naming both Activities
```

## 3. Out of scope

Do not change the engine. Lifecycles, Stages, strategies, the disjoint-writes check, gates, the `checks` gate, `attempts`, `commit: true` and write attribution by path are settled by [REFACTOR-DAG.md](completed/REFACTOR-DAG.md), [REFACTOR-DAG-TASKS.md](completed/REFACTOR-DAG-TASKS.md) and [FIX-INCOMPLETE-OPEN-CLOSED.md](completed/FIX-INCOMPLETE-OPEN-CLOSED.md). If a requirement here appears to need an engine change, stop and raise it rather than taking the decision inside the stage.

Do not change the trace schema. `activity_runs` keeps `(seq, name, kind, owner, status)`; section 1.5 is about how the UI reads those columns, not about what they are. There is no migration verb in this work.

Do not add Stage grouping, strategy or Stage-level gates to the visualizer. 1.5.6 makes that exclusion explicit and documented.

Do not reopen which Activities exist. `poc` was removed, `revise` is loop machinery, `verify` became the `checks` gate plus `just crust verify`, and `commit` became a property — all four by the completed fix. `prompt` is gone from the registry and from the recipes; only documentation still names it, and 1.7.2 covers that.

Do not improve an Activity, prompt or Lifecycle while renaming it. A rename is a rename.

Do not take on `bunx @biomejs/biome lint`. That backlog has its own plan in [REFACTOR-LINT-GREEN-PLAN.md](REFACTOR-LINT-GREEN-PLAN.md) and mixing the two makes both unreviewable.

## 4. Work stages

Each stage is one run and lands on its own. The command named is the one that settles it; a different command is not evidence.

| #   | Change                                                 | Proven by                                                                                                                                                      |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1 — every printed and spawned command resolves       | `rg -n '\.pi-crust/(stages\|lifecycles\|modules\|[a-z-]+\.ts)' runtime apps scripts --glob '!node_modules'` is empty, and `cd runtime && bun test` passes      |
| 2   | 1.1.3, 1.1.4, 1.1.5 — the UI's write actions run again | against a real run in `just crust observe`: ask, amend, steer and start-a-run each spawn and appear in the trace                                               |
| 3   | 1.3 — the grammar                                      | `cd runtime && bun test` covering: folding, a concurrent group, a derived name, an unknown name, and `build+test` refused by its overlapping `writes`          |
| 4   | 1.2 — the recipes stop naming registry entries         | `cd runtime && bun test`, with a test that fails when `crust.just` names an Activity or a Lifecycle, and `just crust list` naming all eight Lifecycles         |
| 5   | 1.4 — the clean break                                  | `cd runtime && bun x tsc --noEmit && bun test`; `--steps` exits non-zero naming `--activities`; `rg -nw 'step\|steps' runtime --glob '!node_modules'` reviewed |
| 6   | 1.5 — concurrent Activity Runs render truly            | a real run of the `accept` Stage read in `observe`: both members show running at once, overlap draws as overlap, and a refused Stage shows as a failure        |
| 7   | 1.6 — the visualizer's vocabulary                      | `(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)`, plus one consult driven through the UI against a real run                        |
| 8   | 1.7 — the documents, then the stamp                    | `probe="$(mktemp -d)" && (cd "$probe" && bun "$OLDPWD/scripts/install.ts" && "$OLDPWD/scripts/verify-install.sh"); rm -rf "$probe"` reporting `drift=0`        |

Stages 1 and 6 are independent of everything else and can start now. Stage 2 depends on stage 1's resolution rule. Stage 4 depends on stage 3, because deleting the recipe per Activity before `--activities` exists leaves a chain nobody can name, and stage 5 depends on stage 4 for the same reason in reverse: `--steps` cannot be removed while a recipe still passes it. Stage 7 depends on stage 5. Stage 8 is last, because every earlier stage changes what the documents should say.

`bun test` and `tsc` cannot settle stages 2 and 6. Both are read against a live run, and a stage reported complete on a green suite alone has not been verified.

## 5. Rationale

### 5.1 What the completed fix already did, and what it left

This plan was drafted before [FIX-INCOMPLETE-OPEN-CLOSED.md](completed/FIX-INCOMPLETE-OPEN-CLOSED.md) was executed. Five of its findings are now false, and they are recorded here so they are not re-investigated:

| Finding as drafted                                                   | State on `main`                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `STEP_NAMES` is the registry; the menu reads it, not configuration   | deleted, with `STEP_REGISTRY`, `TStepName`, `isStepName` and `performerOf`          |
| `please` prints a `.pi-crust/` path as the line to copy              | `please.ts:336` prints `just crust …` through `justArgv`                            |
| `crust.activities.local.example.yaml` still names performers         | names the work: `build`, `scout`, `review`, `plan`, `document`, `test`, `spike`     |
| `protected_files` defends paths the installer removes                | true of the Zod default only; the shipped `crust.config.yaml` names `config/` alone |
| `prompt`, `poc`, `verify`, `revise`, `commit` may be missing entries | all five settled by the fix; only documentation still names `prompt`                |

What it did not touch is the interface, which is what remains here — and two things got worse while it landed, because both are checked by nothing: four new Lifecycles arrived without routes, and `shipped-config.test.ts` has been failing since `37265da`.

### 5.2 Why spawning is worse than printing

A printed path that does not exist wastes a paste. A spawned one fails silently: `startSteer` and `startConsult` return `started: true` with a pid, the child exits immediately on a missing module, and the UI reports that the instruction went through. Every write action in the visualizer has behaved this way since the runtime left the stamp, which is why the visualizer is the first half of this work and not a polish stage at the end.

### 5.3 Why `+`, and why one flag

`+` needs no shell quoting. `|` is a pipe, `&` backgrounds the command, `()` and `[]` are subshell and glob syntax — each makes the common case require quotes, and a syntax that is wrong unquoted will be typed unquoted.

Repeated flags — `--stage plan,build --stage-concurrent review,code-review` — avoid the quoting problem and were rejected for two reasons: they double the flag count, and they make Stage order a property of argv position across two different flag names.

`--steps a,b,c` collapses to one serial Stage (`plan-units.ts`), so there has been no way to ask for a concurrent group without writing a Lifecycle, and a developer whose ad-hoc chain ends in `review` and `code-review` gets them serially and is not told. This is a missing capability, not a rename.

### 5.4 Why the break is clean and loud

There is no public release, and `just crust update` replaces the recipes, so an alias would be kept for nobody. But the break is not free: a developer's own scripts and any `crust.activities.local.yaml` are not re-stamped. So `--steps` fails naming its replacement rather than falling through to "unknown flag", and that message is cheap enough to keep indefinitely. A rejection is not an alias — the run does not start.

### 5.5 Why the UI shows Activities and not Stages

The trace records Activity Runs. Stage membership is a property of the Lifecycle that produced them, and drawing it would mean the UI either re-reads configuration that may have changed since the run, or the schema grows a column to carry it. Neither is worth it for a grouping the waterfall already shows as overlap. Recorded in the README under 1.5.6 so the absence reads as a decision rather than an omission.

### 5.6 Why the recipes stop naming Activities and Lifecycles

A recipe per registry entry is a second copy of the registry, written by hand, in a file the configuration cannot reach. It drifts in the direction nobody notices: `37265da` added four Lifecycles and `just crust default` went on listing three, because a capability with no route is invisible to anyone reading the routes.

The flag the grammar introduces makes the hand-written list unnecessary rather than merely redundant. `run --lifecycle <name>` and `run --activities <chain>` express everything the twenty deleted recipes expressed, and they express it by reading the same configuration that defines the thing being named — so a local layer adding an Activity reaches it with no edit anywhere, which is what the Open/Closed refactor was for.

The cost is real and is accepted: `just crust plan "..."` becomes `just crust run "..." --activities plan`, which is longer, and `just crust default` stops being the list of what can run. `just crust list` replaces it, and it is the honest version — it reads the registry instead of a transcription of it.

The check that remains is the opposite of the one being deleted: not "does every recipe name something real" but "does any recipe name a registry entry at all". One rule, and it cannot go quiet the way its predecessor did.

### 5.7 Why the old check could not have caught this

`recipes.test.ts` was written to stop the recipes and the registry drifting, and it checks only that a recipe names something real. Four Lifecycles were added with no route and it stayed green, because an unreachable capability is invisible to a check that starts from the routes. Its second assertion is worse: it filters for a string the file has not contained since the runtime moved, so it asserts an empty list is empty. That is the silent-zero shape — a check that cannot fail reads exactly like one that passes.

### 5.8 Why the recipes are not generated instead

Generating `crust.just` at install time from the configuration keeps a recipe per Activity and puts a build step between editing a YAML file and running it — and a stamped recipe goes stale the moment a local layer adds an Activity, which is the capability the whole Open/Closed refactor existed to deliver. Reading the catalogue at runtime, behind a few generic recipes, costs one process start and cannot drift. Recorded so the question is not reopened without new evidence.
