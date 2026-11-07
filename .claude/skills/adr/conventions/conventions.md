# Project Context and Best Practices

## Status

accepted

Language-agnostic conventions for this monorepo. Language-specific conventions live in their own nests: [../typescript/README.md](../typescript/README.md), [../sql/README.md](../sql/README.md).

## Principles

**KISS.** Don't over-engineer. Avoid speculative abstraction. Write straightforward, readable code and let a second use case justify a generalization.

**Single Responsibility.** Every module, function, and component does one thing. Break large units into smaller focused ones. Prefer linear flow over nested conditions.

**Flat over nested.** Favor flat structures. Extract complex logic into separate, well-named units rather than deepening indentation.

**Name for behavior.** Files and folders are named for what the code does, not for the technical layer it occupies. See [../project-organization/1-domains-and-atomic-design.md](../project-organization/1-domains-and-atomic-design.md).

**Derive, don't store.** Prefer computing values from a single source of truth over persisting derived copies that can drift.

## Avoid redundancy

Two ways to do the same thing is a maintenance liability and an ambiguity for every future reader.

- Do not add an endpoint that an existing one already covers. If a search endpoint can filter by user, do not add a get-by-user endpoint beside it.
- Do not duplicate a code path for performance without a measurement that shows the duplication is warranted. Premature optimization buys a second thing to maintain and nothing else.
- Remove middleware, queries, and helpers that no longer have a caller.

## File and folder naming

- `kebab-case` for files and directories
- Name for the behavior produced, not the pattern used
- ADR filenames use a present-tense imperative verb phrase — see [../README.md](../README.md)

## Stack and layout

Repository layout, stacks, and toolchains are project facts, not conventions. They live in the root and package `CLAUDE.md` files. Each package declares its own runtime, frameworks, and deviations. Do not assume one package's stack applies to another.
