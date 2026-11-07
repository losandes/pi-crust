# TypeScript Conventions

Entry point for all TypeScript work in this monorepo. Read this first, then the document matching your task.

## Read before you write

| When the task involves | Read |
|---|---|
| Any implementation | [functional-conventions.md](./functional-conventions.md) |
| Concurrency, batches, `Promise.*` | [settle-all-tasks-and-measure-failures.md](./settle-all-tasks-and-measure-failures.md) |
| Lint configuration, enforcing a convention | [enforce-conventions-with-lint.md](./enforce-conventions-with-lint.md), then `biome-plugins/README.md` at the repo root |
| Writing or changing tests | [test-conventions.md](./test-conventions.md) |
| Declaring types, generics, schemas | [use-type-not-interface.md](./use-type-not-interface.md) |
| Database queries, `data/` modules | [rdbms-conventions.md](../sql/rdbms-conventions.md), and [use-raw-sql-with-drizzle.md](./use-raw-sql-with-drizzle.md) when the project uses Drizzle |
| Backend layering and naming | [../project-organization/backend-domains-design-brief.md](../project-organization/backend-domains-design-brief.md) |
| Frontend components and layering | [../project-organization/frontend-domains-design-brief.md](../project-organization/frontend-domains-design-brief.md) |
| Frontend routing | [generate-routes-from-the-pages-directory.md](./generate-routes-from-the-pages-directory.md) |
| Audit trails, soft deletes, data history | [../sql/version-data-with-audit-tables.md](../sql/version-data-with-audit-tables.md) |
| Primary keys, identifiers, new tables | [../sql/choose-identifiers-by-purpose.md](../sql/choose-identifiers-by-purpose.md) |
| React state | [state-management/use-combo-useState-and-zustand-brief.md](./state-management/use-combo-useState-and-zustand-brief.md) |
| Where code belongs, naming a domain | [../project-organization/1-domains-and-atomic-design.md](../project-organization/1-domains-and-atomic-design.md) |

Architecture (DDD, Screaming Architecture, Atomic Design) is language-agnostic and lives in [../project-organization/1-domains-and-atomic-design.md](../project-organization/1-domains-and-atomic-design.md).

## Stance

Functional TypeScript: composability, immutability, pure functions. Avoid classes, inheritance hierarchies, service god-objects, and abstract classes used for polymorphism. Prefer small, testable functions with explicit data flow.

SOLID applies, reinterpreted functionally — especially Single Responsibility and Open/Closed, expressed through modular functions and type-safe extensibility.

- Pure functions: small, deterministic, one job each
- Compose simple functions rather than building complex ones
- Declarative over imperative
- No shared mutable state (Zustand stores in React apps are the sanctioned exception)
- Prefer `ramda` over hand-rolled utilities
- KISS: no speculative abstraction, no unnecessary type casting

## Type system

- `strict`, including `strictNullChecks` and `noUncheckedIndexedAccess`
- Prefer `Readonly` and `ReadonlyArray`
- No non-null assertions (`!`)
- Lean on inference; annotate at module boundaries
- Prefer `type` over `interface` — see [use-type-not-interface.md](./use-type-not-interface.md)

## Naming

| Case | Applies to |
|---|---|
| `camelCase` | variables, functions, properties |
| `PascalCase` | types, React components |
| `ALL_CAPS_SNAKE_CASE` | constants |
| `kebab-case` | file names, package names, CLI commands, CSS classes |

- Test files: `*.test.ts` / `*.test.tsx`

## Validation and errors

- `zod` for validation, parsing, and transformation
- Functional error handling with `Result` types over thrown exceptions
- Custom error classes extend `Error`

## Toolchain

`pnpm` for dependencies and workspaces. `bun` for execution, testing, and builds.

- `pnpm install` — never `npm`/`yarn`/`bun install`
- `bun <file>` — never `node` or `ts-node`
- `bun test` — never jest or vitest

| Task | Package | All TS packages |
|---|---|---|
| Dev server | `bun dev` | — |
| Build | `bun build` | `bun run build --recursive` |
| Test | `bun test` | `pnpm run test --recursive` |
| Lint | `bun lint` / `bun lint:fix` | `pnpm run lint --recursive` |
| Clean | `bun clean` / `bun clean:force` | `pnpm clean` / `pnpm clean:force` |

Each package declares its own runtime and framework choices in its `CLAUDE.md`. Stacks differ across apps; do not assume one app's stack applies to another.
