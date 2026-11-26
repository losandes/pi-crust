---
Context: Runtime layout
---

# Define each command once and dispatch from CLI

## Status

accepted

Supersedes [Name runtime directories for what they hold](name-runtime-directories-for-what-they-hold.md).

## Decision

Keep the runtime's top level limited to these entries:

| Entry           | Holds                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.ts`        | The `crust` command: reads command definitions and starts each command's program in its own process, using the dispatcher's executable |
| `commands/`     | Command programs and their tests                                                                                                       |
| `config/`       | The package's default configuration: `crust.config.toml`, `crust.activities.toml`, `crust.lifecycles.toml`                             |
| `domains/`      | Capability-owned logic behind public domain indexes                                                                                    |
| `lib/`          | Packages used across domains                                                                                                           |
| `testing/`      | Shared test fixtures and terminal-capture helpers                                                                                      |
| `prompts/`      | Shipped Activity prompts and tests of their content                                                                                    |
| `extensions/`   | Adapters loaded into the pi host, currently the package path policy                                                                    |
| `README.md`     | Runtime usage and layout documentation                                                                                                 |
| `tsconfig.json` | The runtime compiler project, excluding host-loaded extensions                                                                         |

Each command is defined once in `RECIPE_DOCS` in the CLI domain. Its definition carries its help text and names its program, whether configuration is passed, fixed arguments, required positional arguments, whether those arguments are repeated before the typed arguments, whether further arguments are accepted, whether a Git repository is required and [the Lifecycle a command always runs](name-commands-after-four-shipped-lifecycles.md), when pinned. Dispatch, the bare command listing and help are derived from that table. Adding a command means writing its program and one definition.

A file belongs in `commands/` only when a definition names it or it tests one. Several commands may name the same program with different fixed arguments. A command exports only `main`. Nothing imports a command except its own colocated test, and `cli.ts` imports none: each command executes in its own process, started with the executable running the dispatcher and a program file of the dispatcher's own kind.

Commands run from the Git repository's root. `help`, the bare listing, `init`, `observe`, `config` and `list` also run outside a repository, where no repository configuration is read. Environment files are read from the nearest ancestor directory, including the starting directory, holding either `.env` or `.env.local`. Both files are read from that one directory; `.env.local` overrides `.env`, and the invoking environment overrides both.

A contributor's clone keeps `runtime/cli.ts` as its `bin` entry: bun executes the TypeScript source, and `bun link` puts that working copy on the contributor's PATH. An edit needs neither a build nor relinking.

An installed package is built by `scripts/build-package.ts`, with bun driving esbuild. Its `bin` names `runtime/cli.js`, and Node at the minimum version declared in `engines` executes JavaScript. Each command program is a self-contained file beside the copied configuration, prompts and templates; the package also includes a self-contained JavaScript path-policy extension. Its runtime dependencies are `zod` and `smol-toml`. The visualizer API server runs on Node. In a clone, `observe`'s development server still requires bun; an installed package [serves the prebuilt UI](publish-the-built-package-on-release.md).

The package finds its own files from the nearest ancestor of its executing module that holds `runtime/config/crust.config.toml`, not from a machine record. `CRUST_HOME` preserves arguments and the starting directory while handing the invocation to that home's `runtime/cli.ts` under bun or `runtime/cli.js` under Node. A home without the matching file is refused rather than falling back; an override naming this package's real path runs it without recursion.

Under Node, environment files are read only by the ancestor-directory rule above. In a clone, bun additionally performs its implicit loading of `.env`, `.env.<NODE_ENV>` and `.env.local` from each process's working directory.

`crust` is the command people type, and every command pi-crust prints or documents is written `crust <command>`. Setting a repository up, through `crust init` or `crust update`, writes `pi-crust.toml` when absent, the credentials example and the data ignore entry. It writes no `justfile` recipe and no machine record of where the package lives, and it leaves an existing `justfile` or record untouched. `CRUST_HOME` is how another checkout's runtime is run.

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

The previous entry point started `just`, and trace listings additionally required the `sqlite3` shell. Command names and help were maintained separately from execution wiring. Issue 204 requires a command that runs with bun and Git alone, including from an unstamped repository or outside Git for discovery and setup. [Issue 208](https://github.com/losandes/pi-crust/issues/208) extends installation to machines with Node, Git and pi but no bun, without changing the contributor's source workflow.

Shipping a bun binary was rejected because installation must not add a runtime beyond Node. A feasibility probe of `bun build --target node` produced broken entry-point guards for modules that also export `main`. Emitting with `tsc` would require rewriting extensionless imports throughout the source. Bundling with esbuild preserves the guards and resolves those imports without changing the source paths.

Both execution modes use a `node:sqlite` adapter, loaded with its SQLite experimental warning muted on Node 22 while other warnings still propagate. Writable connections checkpoint without waiting for locks and close before a temporary read-only keeper closes; that preserves WAL sidecars for Bun's read-only readers. A plain `DatabaseSync.close()` removes those files, making Node-written data unreadable by the unchanged Bun readers on macOS.

Passing a new root flag to every command was rejected: existing programs already resolve relative arguments and configuration from their working directory. Starting their own processes at the Git root preserves that contract without changing every parser. Importing commands into the dispatcher was rejected because their process inputs and exit handling are not a shared API. A second dispatch table would duplicate the command registry; execution metadata instead extends the existing help table.

The bare listing uses help's commands mode rather than a separate listing program or a special dispatch branch. The demo is a command program, rather than a step-list facility every definition would carry. Trace listings share a program and use read-only SQLite queries, with SQLite rendering numeric values as text to preserve shell output such as `0.0`.

Required arguments are deliberately repeated for definitions whose former recipes passed them twice. Correcting that behavior is separate from replacing dispatch: this change preserves what existing command programs receive.

## Consequences

Setup used to write a `crust` recipe into the repository's root `justfile`, so people typed `just crust <command>`, and a machine record that only that recipe read. Both are gone, together with this repository's own root `justfile` and its pin of the `just` tool. A repository set up earlier keeps the recipe and the record it already has: setup neither repairs nor removes them, and nothing migrates them. Publication and the prebuilt visualizer are decided in [Publish the built package on release](publish-the-built-package-on-release.md).

A recorded invocation resumes when the entry matching its recorded program exists in the running package; its original arguments are carried forward. A TypeScript entry recorded by a clone is refused by a JavaScript-only installed package, and the reverse is also refused. A pre-change `bun` invocation names TypeScript and is therefore not resumable under the installed Node package. History is not rewritten. The package path policy remains the only extension loaded by a run. Prompts are read from the package, or from beside the machine or repository file that first declares an entry; configuration provides no extension override. New host adapters require an explicit loading decision.

A configuration nested below the Git root is no longer selected implicitly by starting beneath it: commands now consistently start at the Git root. `CRUST_CONFIG` or a command's explicit configuration option selects another file.
