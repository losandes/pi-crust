---
Context: Runtime layout
---

# Name runtime directories for what they hold

## Status

accepted

## Decision

Keep the runtime's top level limited to these entries:

| Entry           | Holds                                                               |
| --------------- | ------------------------------------------------------------------- |
| `cli.ts`        | The single front door stamped repositories invoke                   |
| `commands/`     | Recipe-named composition roots, `crust.just`, and their tests       |
| `domains/`      | Capability-owned logic behind public domain indexes                 |
| `lib/`          | Packages used across domains                                        |
| `testing/`      | Shared test fixtures and terminal-capture helpers                   |
| `prompts/`      | Shipped Activity prompts and tests of their content                 |
| `extensions/`   | Adapters loaded into the pi host, currently the package path policy |
| `README.md`     | Runtime usage and layout documentation                              |
| `tsconfig.json` | The runtime compiler project, excluding host-loaded extensions      |

A file belongs in `commands/` only when a recipe runs it, it computes a value used by the recipes file, or it tests an entry point or the recipes file. Each recipe that starts an entry point names its own file; `demo` and `report-json` are shortcuts to existing commands. A command exports only `main`, if it exports anything. Nothing imports from a command except its own colocated test importing `main`.

Logic a test or a second command needs to import belongs in the appropriate domain and is exposed through that domain's index. Shared argument parsing, help and menus belong in `domains/cli/`; composing several capabilities into a process entry point does not. Commands read process inputs, compose domain calls, print and return an exit code.

`prompts/` is neither a domain nor a library package: its Markdown is input to an agent rather than an imported runtime API. `extensions/` runs inside pi's process and is checked against its host separately from the runtime project. `testing/` holds test-only fixtures rather than production capabilities or production packages.

| New artifact                | Destination                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| Entry point of a new recipe | A same-named file in `runtime/commands/`, wired through `crust.just`                                |
| Function two commands need  | The capability domain that owns it; reusable CLI behavior goes in `runtime/domains/cli/`            |
| Prompt                      | `runtime/prompts/<activity>/`, with the repository override mirroring it under `.pi-crust/prompts/` |
| Pi extension                | `runtime/extensions/`, with explicit host-loading integration; configuration cannot add one         |
| Shared test helper          | `runtime/testing/`; a helper specific to one subject stays with that subject's tests                |

The general package and layer rules remain those in [domains and Atomic Design](../../.claude/skills/adr/project-organization/1-domains-and-atomic-design.md) and the [backend domain design brief](../../.claude/skills/adr/project-organization/backend-domains-design-brief.md).

## Context

The former runtime root mixed unrelated command entry points with domain and library directories. The separate lifecycle and stage directories held executable entry points, while configuration held the actual Lifecycle and Stage definitions. A command's recipe name did not consistently identify the file it started, and importing helpers from commands made the process boundary a shared API.

Recipe-named files make the composition boundary explicit without making the CLI domain depend on every capability a command coordinates. The prompts, host adapters and shared test fixtures retain separate homes because they are consumed by different execution contexts.

## Consequences

Moving an entry point requires updating recipe wiring, recorded-invocation fixtures and process-spawn callers together. No compatibility shim preserves abolished entry-point paths. Existing recorded invocations naming those paths need to be restarted explicitly.

The package path policy is the only extension loaded by a run. Repository prompt overrides do not provide an extension override mechanism. New host adapters require an explicit loading decision rather than a configuration entry.
