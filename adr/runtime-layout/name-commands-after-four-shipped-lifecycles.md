---
Context: Runtime layout
---

# Name commands after selected shipped Lifecycles

## Status

accepted

## Decision

The shipped Lifecycles `gh-issue`, `ship`, `ship-plan` and `ship-outcome` each have a command of the same name. Each is one definition in `RECIPE_DOCS` that names its Lifecycle and the `run` program. A definition carries a Lifecycle name, never a Stage list; `run` resolves the Stages from configuration.

The dispatcher places `--lifecycle <name>` before the typed arguments and refuses a missing prompt, a different `--lifecycle` and any `--activities` before starting a program. Repeating the command's own Lifecycle is accepted. Every option accepted by `crust run` alongside `--lifecycle` remains available.

No other command is named after a Lifecycle or an Activity. The naming guard in `runtime/domains/config/src/use-cases/recipes.test.ts` enforces both the exact set of pinned commands and the restriction on every other command, and verifies that each pinned Lifecycle is shipped and matches its command name and `run` program.

## Context

The command list once held a recipe per Activity and per Lifecycle. It drifted from configuration, so those recipes were removed and a test forbade their names. That rule was never a decision record. The request for `crust ship '<request>'` reverses it only for the names above, while keeping configuration as the source of their Stages.

A fixed `--lifecycle` argument alone was rejected because the run parser keeps the last repeated value: a typed `--lifecycle bugfix` would override a leading selection. It would also print usage asking for a Lifecycle when the command already selected one. Dispatcher validation reuses the run parser with command-specific usage rather than maintaining another flag scanner.

A new flag carrying the command name into `run` was rejected because it would persist into continuation commands as another public spelling. A separate command program was rejected because it would need another package entry, shared run orchestration extracted into a domain and a continuation mapping. Keeping `run` as the program needs none of those changes.

A command per configured Lifecycle was rejected because the command table is static, package programs and checks derive from it, and discovery also runs outside a repository where repository configuration is not read. The request names only the selected shipped Lifecycles.

## Consequences

A run started through these commands records the `run` program. Reports therefore print `crust run ... --lifecycle <name>` as its continuation, and resume and approve need no new program mapping. The short form and long form use the same downstream execution and resumption logic.

A repository that redefines a named Lifecycle gets its own Stages. A configuration that removes it gets `unknown lifecycle` from the command. Renaming or removing a selected shipped Lifecycle fails the guard test until the command definition and the expected pinned set are updated together.

`gh-issue` is both a command and an Activity name. The command runs the Lifecycle, including its preceding Activities, not just the Activity with that name. Other Lifecycles and individual Activities remain reachable through `crust run`.
