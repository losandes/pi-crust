# Refactor: configuration-driven extension

A plan, not a record. Delete it when the work lands and the decisions move into records and READMEs.

Companion to [REFACTOR_DAG.md](REFACTOR_DAG.md), which governs orchestration. This plan governs ownership: what belongs to the core skill, what belongs to the stamp, and how a team extends the former without modifying it. It uses that document's vocabulary throughout.

One point of that vocabulary decides several filenames here. An **Activity** is a discrete unit of work — what the current implementation calls an agent, and what each file in `stages/` currently runs. A **Stage** is a grouping of Activities within a Lifecycle, ending in a Gate, and appears only inside a Lifecycle definition. There is therefore no stage configuration file; `crust.activities.yaml` registers the units of work, and Stages are structure inside `crust.lifecycles.yaml`.

## Objective

A stamped tree contains only what a team or developer owns. Every extension point is configuration or an additive file. The core skill can replace everything it owns, on every install, without a team losing work — and without tracking modifications, diffing against the template, or relying on git history.

Convention supplies the defaults. Configuration supplies every deviation.

## Ownership

| Belongs to                        | Where it lives | Replaced by install |
| --------------------------------- | -------------- | ------------------- |
| Orchestration engine              | core skill     | yes                 |
| Lifecycle Planners                | core skill     | yes                 |
| The single Activity runner        | core skill     | yes                 |
| Default prompts                   | core skill     | yes                 |
| Default themes                    | core skill     | yes                 |
| pi extensions                     | core skill     | yes                 |
| Activity, Lifecycle, theme config | stamp          | never               |
| Custom prompts                    | stamp          | never               |
| Run data                          | stamp          | never               |

Nothing executable is stamped. A team changes behaviour by writing configuration, not by editing code the core skill also ships.

## Target stamp

```text
.pi-crust/
├── config/
│   ├── crust.config.yaml             tracked   defaults, observability
│   ├── crust.config.local.yaml       ignored   personal override
│   ├── crust.activities.yaml         tracked   every available Activity
│   ├── crust.activities.local.yaml   ignored   personal override
│   ├── crust.lifecycles.yaml         tracked   every available Lifecycle
│   ├── crust.lifecycles.local.yaml   ignored   personal override
│   ├── crust.themes.yaml             tracked   every registered theme
│   └── *.scss                        tracked   custom theme definitions
├── data/                             ignored   this developer's runs
└── prompt-engineering/
    ├── README.md                     tracked   how to add or override a prompt
    └── example/                      ignored   illustrative only
```

The gitignore the installer writes:

```gitignore
# crust runtime
.pi-crust/data/
.pi-crust/config/*.local.yaml
.pi-crust/prompt-engineering/example/
```

Adding an Activity, a Lifecycle, a theme, or a prompt requires no gitignore edit, because every directory that receives one is already tracked.

## What stops being a file

### Activities

Twenty-one of the twenty-three files in `stages/` are identical but for an array of one. Each defines one Activity, not a Stage: a Stage is the grouping of Activities inside a Lifecycle, and exists only in a Lifecycle definition. They become rows in `crust.activities.yaml` and are executed by a single core runner.

The two exceptions are not Activities and are reclassified below.

### Lifecycles

`bugfix`, `de-risk` and `sdlc` are sequences, which is configuration. They become entries in `crust.lifecycles.yaml`, expressed as the DAG definition that [REFACTOR_DAG.md](REFACTOR_DAG.md) requires: Stages, the Activities in each, dependencies between them, and Gate criteria.

A Lifecycle definition therefore replaces both the file and the implicit ordering, in one move. This is the point at which the two refactors meet, and the reason they share a configuration schema rather than arriving at one twice.

### Prompts

Defaults ship in the core skill. An agent's `prompt_engineering` entry already accepts any path, so overriding a prompt means writing a file and naming it. The stamped `prompt-engineering/` directory exists to hold a team's own prompts and to carry an example of how; the example is ignored so it never becomes something to maintain.

## Lifecycle Planners

Three capabilities decide or initiate work rather than perform it. None is an Activity, none is configurable, and none may be overridden or removed by a team.

| Planner      | Authority                                                                  | Replaces      |
| ------------ | -------------------------------------------------------------------------- | ------------- |
| **Composer** | Validate and execute a given Lifecycle Plan                                | `compose.ts`  |
| **Triage**   | Recommend a Lifecycle Plan that the caller can use the Composer to execute | `advisor.ts`  |
| **Operator** | Recommend a Lifecycle Plan and execute it via the Composer                 | `operator.ts` |

The Composer does not choose what is appropriate for an objective; it executes the plan it is handed, after validating its configuration and its dependencies.

`advisor` is renamed to `triage` throughout: the step, the registry entry, the prompt directory, the recipe, and the trace rows it writes.

## Configuration

Every file has a base and an optional `.local` sibling. The base is the team's agreement and is committed; the local file is one developer's deviation and is ignored. Merge is per-key with the local file winning, which is how `crust.config.local.yaml` already behaves.

A local layer may do anything a base file may do, including adding an Activity and setting any key on it. The implementation currently restricts local overrides to four keys and forbids adding an agent, on the grounds that an unreviewed file should not be able to move a safety boundary. That reasoning does not hold: the developer who writes the local file can equally write the committed one, and runs the result on their own machine against their own checkout. There is no second principal to protect, so the restriction buys friction in the one file whose purpose is to have none. Remove it.

The cost is a run that works for one developer and fails for everyone else, when a Lifecycle in the committed file names an Activity that exists only in a local layer. That is the developer's mistake to make. A validation that reports a committed Lifecycle referencing an uncommitted Activity is worth having if it stays to a few lines; it is not worth a mechanism.

| File                    | Holds                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `crust.config.yaml`     | Defaults and observability. **`steps` is removed** — see visibility below                            |
| `crust.activities.yaml` | Every available Activity: model, thinking, colour, purpose, prompts, tools, writes boundaries, gates |
| `crust.lifecycles.yaml` | Every available Lifecycle, as Stages, Activities, dependencies and Gates                             |
| `crust.themes.yaml`     | Every registered theme, including the defaults, so a team can remove one                             |

Shipping the default themes as registrations rather than as built-ins is what lets a team delete one. The same argument applies to Activities and Lifecycles: the stamped file lists everything the core skill offers, so removing an entry removes the capability rather than merely leaving the default in place.

`*.scss` in `config/` defines custom themes only. Default theme styles stay in the core skill and are referenced by registration.

### Activity visibility and order

`crust.config.yaml` carries a `steps` block holding two keys that survive this refactor as concepts but lose their home when the block is removed.

`hidden` is a list of Activity names the `please` menu does not offer. Its semantics are already right — hiding is a preference rather than a permission, a hidden Activity stays runnable by name, by a Lifecycle, and by a Planner — and `merge-config.ts` already lets one developer's local file override it. Keep the word and the behaviour; move it from a list in a deleted block onto the Activity it describes:

```yaml
- name: security-research
  hidden: true
```

It defaults to `false`, so registering an Activity offers it without further ceremony. On the Activity, hiding is a statement about that Activity rather than an omission from a list elsewhere, and `crust.activities.local.yaml` hides it for one developer without changing what the team ships.

`order` is the other key in that block: the sequence a hand-picked chain runs in. It is removed rather than rehomed. Execution order comes from one of two places — implicitly from the list a developer passes to `--compose`, or explicitly from the Stages and dependencies of a Lifecycle in `crust.lifecycles.yaml`. Neither needs a configured sequence, and an Activity cannot hold one because it does not know what runs around it.

Presentation order is separate and also needs no key: interactive lists display Activities in the order they appear in `crust.activities.yaml`. A team reorders the menu by reordering the file, and there is no second place recording a sequence that can drift out of step with the Activities that exist.

## Work stages

Each leaves the tree working and is independently verifiable.

| #   | Stage                             | Done when                                                                                   |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Activity config schema            | `crust.activities.yaml` round-trips every current agent; schema rejects a malformed entry   |
| 2   | One Activity runner               | 21 stage files deleted; every recipe runs through the runner with identical traces          |
| 3   | Lifecycle config schema           | `crust.lifecycles.yaml` expresses `bugfix`, `de-risk`, `sdlc`; cycles rejected              |
| 4   | Composer executes configuration   | The three lifecycle files are deleted; runs are trace-identical to before                   |
| 5   | Triage rename                     | No `advisor` identifier remains; existing trace rows still parse                            |
| 6   | Planners become core entry points | Nothing in `stages/` or `lifecycles/` is stamped                                            |
| 7   | Prompt resolution                 | A prompt in the stamp overrides a default; the default is used when absent                  |
| 8   | Menu derives from config          | `please` offers every registered Activity except `hidden`, Planners excluded                |
| 9   | Themes in config                  | A theme registered in `crust.themes.yaml` with local SCSS renders; a default can be removed |
| 10  | Core absorbs the runtime          | `modules/`, root scripts, `harness-engineering/`, deps and `crust.just` leave the stamp     |
| 11  | Justfile passthrough              | `just crust <anything>` works without a `mod`; unrelated recipes still work                 |
| 12  | Install, update, prune            | `update` deletes orphaned core files; the gitignore block is three lines                    |
| 13  | Docs                              | Every document describes this design rather than the one it replaced                        |

Stages 1 to 4 are where the DAG refactor and this one must agree on a schema. Do not design the Lifecycle schema twice.

## Install and update

`install` writes the stamp above and nothing else.

`update` replaces everything the core skill owns, never touches `config/`, `data/`, or `prompt-engineering/`, and **deletes orphaned core files** left in `.pi-crust/` by an earlier version. Deletion is scoped to a manifest of paths the core skill has ever owned, so a file a team created is never a candidate.

The verification that settles the refactor, written as a test before stage 12 is called done: stamp a tree, add an Activity, override a Lifecycle, add a prompt, register a theme, edit the roster, run `install --force`, and assert all five survive byte-identically while every core file is replaced.

## Follow-up

Applying the vocabulary to the surfaces a developer touches is a separate plan: flags, menus, trace rows, and the visualizer. `--steps` becomes `--activities`, and the same substitution runs through the interactive lists and the UI. It is deliberately not done here, because renaming a flag mid-refactor would make every behavioural comparison in these stages unreadable.

## Out of scope

`harness-engineering/` is not an extension point and does not appear in the stamp. An `harness_engineering` entry in configuration still accepts a path, so a team that writes its own pi extension may point at it from anywhere.

Changing what agents do, the Gate catalogue, the trace schema, or the visualizer beyond reading a theme. Orchestration semantics belong to [REFACTOR_DAG.md](REFACTOR_DAG.md).
