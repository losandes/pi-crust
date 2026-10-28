# Refactor: the Activity registry becomes configuration

## Objective

A team can add, remove or change an Activity by editing `crust.activities.yaml`, without editing any file in the pi-crust package. Every Activity is an agent; there is no second kind of registry entry and no hardcoded list of Activity names.

[REFACTOR-OPEN-CLOSED.md](completed/REFACTOR-OPEN-CLOSED.md) made Lifecycles, themes and the agent roster configurable but never mentions `STEP_NAMES` or `STEP_REGISTRY`, so the registry that decides *what an Activity is* was left in TypeScript. The result is that a team can add an agent and cannot reach it: nothing binds a step to it.

This refactor changes where the Activity registry lives. It does not change what a Stage, a Gate or a Lifecycle means.

## 1. Requirements

### 1.1 The Activity registry is configuration

1.1.1 `crust.activities.yaml` MUST define the Activities a Lifecycle can name. Each entry MUST be named for the work (`plan`, `build`), not the performer (`planner`, `builder`).

1.1.2 An Activity entry MUST carry both its agent configuration (`model`, `tools`, `writes`, `prompt_engineering`, `purpose`) and its work configuration (`output`, `gates`, `attempts`, `commit`).

1.1.3 `output` MUST name an envelope spec and `gates` MUST name gates, both from catalogues the package publishes by name. An unrecognised name MUST be refused at load, naming what was available.

1.1.4 `STEP_NAMES` and `STEP_REGISTRY` MUST be deleted. The Composer, the menu, agent validation and the concurrency check MUST read the loaded registry.

1.1.5 `performerOf` MUST be deleted. A Lifecycle names `plan` and `plan` is the entry; there is no second namespace to bridge.

1.1.6 `poc` MUST be removed. It is `build` with a different envelope — same owner, same gate, same retries, same acceptance — and no Lifecycle names it.

1.1.7 `revise` MUST leave the registry and remain inside the revise loop. No Lifecycle names it; the loop invokes the builder itself.

### 1.2 Planners are closed

1.2.1 `crust.activities.yaml` MUST carry a second top-level `planners:` key configuring Triage and the Operator.

1.2.2 The set of Planner names MUST remain fixed in code. Configuration MAY change a Planner's model, tools, writes and prompts. Configuration MUST NOT add or remove a Planner.

1.2.3 A Planner MUST NOT be nameable by a Lifecycle. This follows from 1.1.1: a Lifecycle names Activities, and a Planner is not one.

1.2.4 The Composer is the third Planner. It has no agent, so it MUST have no entry in either key.

### 1.3 `checks` is a gate

1.3.1 `verify` MUST leave the registry. It produces a verdict no code consumes: `verifyOutput` is read nowhere outside its own definition, and the revise loop keys on `review` and `code-review` alone.

1.3.2 The repository's checks MUST be available as a gate named `checks`, declared per Activity in the existing `gates:` list.

1.3.3 The gate signature MUST widen to receive the run and the changed paths. Existing gates are pure predicates over an envelope; `checks` runs commands.

1.3.4 A `checks` gate inside a concurrent Stage MUST be evaluated at the Stage boundary, not after its own Activity. A sibling may still be writing to the tree.

1.3.5 A failing `checks` gate MUST feed its failures back to the Activity it gates, which runs again, bounded by 1.4.

1.3.6 `just crust verify` MUST survive as a recipe that runs the checks directly, without a Lifecycle.

### 1.4 One ceiling

1.4.1 `attempts` MUST replace `retries`, `MAX_REVISE_ROUNDS` and `MAX_RETURNS_PER_STAGE`. All three constants MUST be deleted.

1.4.2 `attempts` MUST count **Activity Runs of one instance within one Workflow Run**, including the first. Every autonomous re-execution — a gate failure, a revision, a regression — spends from the same budget.

1.4.3 The budget MUST be per instance, not per Activity. A Lifecycle naming `test` twice gives `test` and `test_2` two each.

1.4.4 The default MUST be 2, and an Activity MAY declare lower or higher. Activities whose re-execution is expensive SHOULD declare lower; see 5.4.

1.4.5 Human-directed re-execution MUST NOT consume the budget. A `steer` and a resume past an answered gate are not attempts. A replay executes nothing and consumes nothing.

1.4.6 Exhaustion MUST report every cause that spent the budget, not only the count. One number, an itemised report.

1.4.7 **An attempt is an Activity Run.** Every re-execution MUST create its own `activity_runs` row, including a gate-failure retry, which today increments a column on the existing row instead. The `attempt` column MUST be deleted from `activity_runs`, `envelopes` and `gate_results`; an envelope or a gate result identifies the attempt that produced it by `activity_run_id` alone.

1.4.8 The table and its key MUST remain `activity_runs` and `activity_run_id`. A row describes an execution of an Activity — name, kind, owner, description, status, timings — and is named for what it is, not for the cap that limits how many of them there may be.

### 1.5 Delivery is a property

1.5.1 `--deliver` MUST be removed, with its `branch`, `patch` and `commit` modes. All three perform one `commitAll` at the end of the chain, so none of them delivers incremental work.

1.5.2 An Activity declaring `commit: true` MUST commit its own change after every gate on that Activity has passed, using the `commit_message` its envelope carries.

1.5.3 An Activity that does not declare `commit: true` MUST NOT be committed — not by pi-crust, and not by the agent performing it.

1.5.4 `--commit false` MUST disable committing for a whole run, whatever the registry declares. It MUST take a value rather than being a bare switch, so it joins the value-flag list; a bare flag would consume the prompt as its value.

1.5.5 There MUST NOT be a `--commit true`. The flag only subtracts. A flag granting a permission the configuration withheld would make a run behave in a way nobody reading the registry could predict.

1.5.6 `enforce-permissions` MUST treat a moved `HEAD` as a breach when the Activity was not committing, reported like any other breach. "Was not committing" means the **effective** value: under `--commit false` this includes Activities that declared `commit: true`.

## 2. The target configuration

This is the only example in this document. Where it and the prose disagree, the prose in section 1 governs.

```yaml
# crust.activities.yaml
activities:
  - name: plan                      # named for the work, which is what a Lifecycle names
    model: google/gemini-3.6-flash
    tools: [read, write]
    writes: ['{handoff}/plan.md', specs/]
    prompt_engineering:
      system: prompt-engineering/plan/system.md
      user: prompt-engineering/plan/user.md
    purpose: Turn the request into an implementable plan
    output: planOutput
    gates: [artifactsExist, filesNonEmpty]

  - name: build
    model: anthropic/claude-sonnet-4-6
    tools: [bash, edit, read, write]
    writes: ['*']
    prompt_engineering:
      system: prompt-engineering/build/system.md
      user: prompt-engineering/build/user.md
    purpose: Implement the plan exactly; report every changed file
    output: buildOutput
    gates: [diffMatchesClaims, checks]
    attempts: 2
    commit: true

planners:                           # closed set: config tunes these, config cannot add one
  - name: operator
    model: google/gemini-3.6-flash
    tools: [read, write]
    writes: ['{handoff}/plan.md']
    prompt_engineering:
      system: prompt-engineering/operator/system.md
      user: prompt-engineering/operator/user.md

  - name: triage
    model: google/gemini-3.6-flash
    tools: [read, write]
    writes: ['{handoff}/plan.md']
    prompt_engineering:
      system: prompt-engineering/triage/system.md
      user: prompt-engineering/triage/user.md
```

## 3. Out of scope

Do not change the Lifecycle schema, Stage strategies, the approval gates at Activity and Stage level, the disjoint-writes concurrency check, or write attribution by path. Those were settled in [REFACTOR-DAG-TASKS.md](completed/REFACTOR-DAG-TASKS.md) and are not reopened here.

Do not change the envelope schemas themselves, beyond deleting `pocOutput` with 1.1.6.

Do not rename the trace vocabulary. `activity_runs` and `activity_run_id` are current and stay, per 1.4.8. The only schema change here is deleting the `attempt` column, per 1.4.7.

Do not rewrite Activities, prompts or Lifecycles to be "better" while renaming them. A rename is a rename.

## 4. Work stages

Each stage is one run and lands on its own. The command named is the one that settles the stage; a different command is not evidence.

| #   | Change                                        | Proven by                                                                                                                                                                                                                        |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.6, 1.1.7 — remove `poc`, demote `revise`  | `bun test`; no Lifecycle, menu or recipe offers either; the revise loop still runs its rounds                                                                                                                                    |
| 2   | 1.3 — `checks` becomes a gate                 | `bun test` covering: a failing check feeds its Activity; a concurrent Stage evaluates at the boundary; `just crust verify` still runs                                                                                            |
| 3   | 1.4 — one ceiling                             | `bun test` covering: the three constants are gone; every retry is its own `activity_runs` row and the `attempt` column is dropped; `test` and `test_2` budget separately; a steer consumes nothing; exhaustion names every cause |
| 4   | 1.5 — delivery becomes a property             | `bun test` covering: `commit: true` commits after gates pass; `--commit false` disables a run; a moved `HEAD` from a non-committing Activity is a breach                                                                         |
| 5   | 1.1.3 — publish the catalogues                | `bun test` asserting every shipped envelope spec and gate resolves by name                                                                                                                                                       |
| 6   | 1.1.1, 1.1.2 — the Activity schema and loader | `bun test` asserting an Activity parses into a step, and an unknown `output` or `gate` is refused at load naming what was available                                                                                              |
| 7   | 1.1.1 — rename entries to the work            | `bun test`; `scripts/verify-install.sh`; prompt directories renamed with their Activities                                                                                                                                        |
| 8   | 1.1.4, 1.1.5 — delete the hardcoded registry  | `bun x tsc --noEmit`; `bun test`                                                                                                                                                                                                 |
| 9   | Absorb the type fallout                       | `bun x tsc --noEmit`; `bun test`; `bunx @biomejs/biome lint runtime`                                                                                                                                                             |
| 10  | Prove a team can extend it                    | a test that adds an Activity through a local layer only, and runs it                                                                                                                                                             |

Stage 10 is the one that makes the rest true. Without it, "a team can add an Activity" is a claim rather than a fact, which is how the original refactor came to be reported complete.

## 5. Rationale

### 5.1 Why the registry was missed

The file named `crust.activities.yaml` contained agents, not Activities. A reader checking whether Activities were configurable would open it, see a registry, and conclude yes. Two symptoms followed: `performerOf` existed only to bridge the two namespaces, and `hidden` sat on the performer while describing the work.

### 5.2 Why every Activity is an agent

Four entries made the mapping look complicated, and each leaves for a different reason: `poc` duplicates `build`, `revise` is loop machinery, `verify` is a gate, `commit` is delivery. With those gone, every Activity a Lifecycle can name maps to exactly one agent. The split registry considered earlier is unnecessary and was rejected.

### 5.3 Why `checks` is opt-in

Gating every Activity automatically fails in two ways. After `test` the suite is red on purpose — TDD order. After `plan` the only change is `specs/plan.md`, and `run-checks.ts` treats "paths changed and no rule matched them" as a failure rather than a no-op. Both failures are failures of automatic gating, not of gating; declaring it per Activity resolves them.

### 5.4 Why one ceiling, and why the default is low

The failure modes are correlated, not independent: one bad input or one bad prompt expresses itself as a gate failure, then a revision, then a regression. Three separate budgets let that burn three times before a person is asked.

The two caps being replaced were argued down on cost, in the same words. The revise loop: *"Bounded at TWO revise rounds, not three. Each round costs a build-sized agent call, and a third round of a disagreement nobody can settle is worse value than putting it in front of the developer."* Regression: *"One. A stage returned to twice is two agents disagreeing at a build-sized price per lap."*

Unification also makes the expensive paths more expensive: a regression re-runs its destination and everything downstream, where a gate retry continues one agent session. The same number buys very different amounts of work, which is why 1.4.4 asks expensive Activities to declare lower rather than inheriting the default.

### 5.5 Why an attempt is an Activity Run

The two were different things, and the distinction was invisible. A regression or a steer created a new `activity_runs` row; a gate-failure retry updated `attempt` on the existing one. So a budget counting Activity Runs would have missed gate failures entirely — the case it most obviously governs.

Collapsing them leaves one countable thing. `latestByName` already selects the highest `seq` per name, so resume needs no change, and the trace gains an honest record: a build that retried twice shows three rows rather than one row with `attempt=3` in a column nobody reads.

The alternative — summing rows and column rounds — keeps the schema unchanged and leaves the cap counting two different kinds of thing, which is the muddle that produced the defect.

### 5.6 Why the budget is per instance

Repeats are already distinct by name — `stepActivityRunName` produces `test`, `test_2` — so per-instance is the simpler implementation, not a special case.

Sharing would make `build, verify, build, verify`, described in the registry as a fix loop written longhand, arrive at its second pass carrying whatever the first spent, with *which* pass got starved depending on position. It would also mean adding a third `test` silently reduced the retries available to the first two. Editing a Lifecycle must not change the behaviour of an instance it did not touch.

### 5.7 Why `--deliver` goes

`branch` and `patch` were added so work could be handed over when nobody is at the machine. Neither does that: all three modes perform one `commitAll` at the end, so a large body of work arrives squashed whatever is chosen. The limitation is the shape of the step, not the mode. With `commit: true` per Activity, granularity follows the chain — several writing Activities produce several commits, each in its own words.

### 5.8 Why a moved `HEAD` is a breach

No prompt asks an agent to commit today, but a prompt is advice. `enforce-permissions` already compares the tree before and after an Activity; without the companion check, `--commit false` would stop the engine while leaving an agent free to commit with `bash`, and the run would be reported as having made no commits while carrying one.

### 5.9 The cost of 1.1.4

`TStepName` is a compile-time union, used in `TUpstream`, in step params, and in the registry's own key type. When the registry becomes configuration it becomes `string`, and "is this a real Activity name" moves from the compiler to load-time validation.

That is a real loss, and it is the price of the capability. It is payable only because 1.1.3 requires the loader to refuse an unknown name with the same loudness the compiler had.

The rejected alternative is generating the union from the shipped configuration, which keeps the types and puts a build step between editing a YAML file and running it. Recorded so the question is not reopened without new evidence.
