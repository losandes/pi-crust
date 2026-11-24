---
Context: Runtime layout
---

# Define each command once and dispatch from CLI

## Status

accepted

Supersedes [Name runtime directories for what they hold](name-runtime-directories-for-what-they-hold.md).

## Decision

Keep the runtime's top level limited to these entries:

| Entry           | Holds                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `cli.ts`        | The `crust` command: reads command definitions and starts each command's program as its own bun process    |
| `commands/`     | Command programs and their tests                                                                           |
| `config/`       | The package's default configuration: `crust.config.toml`, `crust.activities.toml`, `crust.lifecycles.toml` |
| `domains/`      | Capability-owned logic behind public domain indexes                                                        |
| `lib/`          | Packages used across domains                                                                               |
| `testing/`      | Shared test fixtures and terminal-capture helpers                                                          |
| `prompts/`      | Shipped Activity prompts and tests of their content                                                        |
| `extensions/`   | Adapters loaded into the pi host, currently the package path policy                                        |
| `README.md`     | Runtime usage and layout documentation                                                                     |
| `tsconfig.json` | The runtime compiler project, excluding host-loaded extensions                                             |

Each command is defined once in `RECIPE_DOCS` in the CLI domain. Its definition carries its help text and names its program, whether configuration is passed, fixed arguments, required positional arguments, whether those arguments are repeated before the typed arguments, whether further arguments are accepted and whether a Git repository is required. Dispatch, the bare command listing and help are derived from that table. Adding a command means writing its program and one definition.

A file belongs in `commands/` only when a definition names it or it tests one. Several commands may name the same program with different fixed arguments. A command exports only `main`. Nothing imports a command except its own colocated test, and `cli.ts` imports none: each command executes in its own bun process.

Commands run from the Git repository's root. `help`, the bare listing, `init`, `observe`, `config` and `list` also run outside a repository, where no repository configuration is read. Environment files are read from the nearest ancestor directory, including the starting directory, holding either `.env` or `.env.local`. Both files are read from that one directory; `.env.local` overrides `.env`, and the invoking environment overrides both.

`CRUST_HOME` hands the entire invocation to another checkout's `runtime/cli.ts`, preserving arguments and the starting directory. An invalid override refuses rather than falling back; an override naming this package's real path runs this package without recursion. The package locates its own files from its own location, not a machine record. Contributors put `crust` on their PATH with `bun link`, through the package's `bin` entry.

Logic a test or a second command needs to import belongs in the capability domain and is exposed through that domain's index. Shared argument parsing, help and menus belong in `domains/cli/`; composing capabilities into a process entry point does not. Commands read process inputs, compose domain calls, print and return an exit code.

`prompts/` holds Markdown input to agents rather than an imported runtime API. `extensions/` runs inside pi's process and is checked against its host separately from the runtime project. `testing/` holds test-only fixtures rather than production capabilities or production packages.

| New artifact                 | Destination                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Entry point of a new command | A file in `runtime/commands/` named by one definition                                       |
| Function two commands need   | The capability domain that owns it; reusable CLI behavior goes in `runtime/domains/cli/`    |
| Prompt                       | `runtime/prompts/<directory>/`, named by the entry's `prompts` setting                      |
| Pi extension                 | `runtime/extensions/`, with explicit host-loading integration; configuration cannot add one |
| Shared test helper           | `runtime/testing/`; a helper specific to one subject stays with that subject's tests        |

The general package and layer rules remain those in [domains and Atomic Design](../../.claude/skills/adr/project-organization/1-domains-and-atomic-design.md) and the [backend domain design brief](../../.claude/skills/adr/project-organization/backend-domains-design-brief.md).

## Context

The previous entry point started `just`, and trace listings additionally required the `sqlite3` shell. Command names and help were maintained separately from execution wiring. Issue 204 requires a command that runs with bun and Git alone, including from an unstamped repository or outside Git for discovery and setup.

Passing a new root flag to every command was rejected: existing programs already resolve relative arguments and configuration from their working directory. Starting their own processes at the Git root preserves that contract without changing every parser. Importing commands into the dispatcher was rejected because their process inputs and exit handling are not a shared API. A second dispatch table would duplicate the command registry; execution metadata instead extends the existing help table.

The bare listing uses help's commands mode rather than a separate listing program or a special dispatch branch. The demo is a command program, rather than a step-list facility every definition would carry. Trace listings share a program and use read-only SQLite queries, with SQLite rendering numeric values as text to preserve shell output such as `0.0`.

Required arguments are deliberately repeated for definitions whose former recipes passed them twice. Correcting that behavior is separate from replacing dispatch: this change preserves what existing command programs receive.

## Consequences

An installed repository's `just crust` still works through the root recipe the installer writes. The installer also still writes the machine record for that recipe; neither the dispatcher nor the visualizer reads it. Series 2/6 decides whether the recipe and machine record stay, and replaces printed `just crust` text. This change does not decide publication or a prebuilt visualizer.

Existing command paths remain runnable so recorded invocations can resume without rewriting history. The package path policy remains the only extension loaded by a run. Prompts are read from the package, or from beside the machine or repository file that first declares an entry; configuration provides no extension override. New host adapters require an explicit loading decision.

A configuration nested below the Git root is no longer selected implicitly by starting beneath it: commands now consistently start at the Git root. `CRUST_CONFIG` or a command's explicit configuration option selects another file.
