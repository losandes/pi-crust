---
name: ts-functional-conventions
description: Writes TypeScript that conforms to this monorepo's functional programming conventions — purity, immutability, composition, settlements instead of thrown errors, and dependency-first currying. Loads the ratified ADR, points at verified exemplar files to copy from, and runs two blocking checks (Biome plugins and a TypeScript-compiler parameter-immutability checker). Use when authoring or changing any .ts/.tsx source outside tests, when deciding how to shape a function, a settlement, or a dependency signature, and when fixing a violation one of these checks reported. For reviewing an existing change, diff, or pull request, use the code-review skill instead. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins. TypeScript only — the conventions suit JavaScript too, but the parameter-immutability check needs a tsconfig.json and the project's TypeScript compiler.
---

# Functional Conventions

## Use this skill when

- Authoring or changing any `.ts`/`.tsx` file that is not a test
- Deciding how to shape a function signature, a settlement, or a dependency parameter
- Fixing a violation that Biome or the parameter-immutability check reported

## Do not use this skill for

- **Reviewing** an existing change, diff, or pull request — use the `code-review` skill. It scopes to what changed, routes by layer, and runs these same checks. This skill is for authoring; that one is for judging what was authored.
- Test files — use the `test-conventions` skill, whose rules differ deliberately
- SQL, schema, or migration work — see `adr/sql/`
- Deciding where code belongs — see `adr/project-organization/`

This skill contains **no rules of its own.** All rules live in the ADR, so the two can never disagree. Follow the steps in order.

## Step 1 — Read the rules (mandatory, first)

Read [adr/typescript/functional-conventions.md](../adr/typescript/functional-conventions.md) before writing or reviewing. It is the single source of truth for purity, composition, immutability, error propagation, and the currying order.

Two records it depends on, read when the task touches them:

| Topic | Record |
|---|---|
| Concurrency, batches, `Promise.*` | [settle-all-tasks-and-measure-failures.md](../adr/typescript/settle-all-tasks-and-measure-failures.md) |
| Database access, `data/` modules | [rdbms-conventions.md](../adr/sql/rdbms-conventions.md), plus [use-raw-sql-with-drizzle.md](../adr/typescript/use-raw-sql-with-drizzle.md) when the project uses Drizzle |

Do not proceed from memory — read it. Several rules in this codebase are the opposite of the common default, and a reader working from general functional programming habits will get point-free style, `Either`, and deep immutability wrong.

## Step 2 — Anchor on a shape

Match a shape rather than composing from prose. These are the four that recur; copy the structure, not the names.

A data module returns a settlement and never throws:

```ts
export const resolveShowById = (deps: TDeps) => async (id: string): Promise<TSettlement<TShow>> => {
  const rows = await deps.query(showByIdSql, [id])
  const parsed = showSchema.safeParse(rows.at(0))
  return parsed.success
    ? { status: 'ok', data: parsed.data }
    : { status: 'error', error: parsed.error }
}
```

A use case composes data modules and decides nothing about transport:

```ts
export const loadFeed = (deps: TDeps) => async (id: string): Promise<TSettlement<TFeed>> => {
  const show = await resolveShowById(deps)(id)
  if (show.status === 'error') return show
  return buildFeed(show.data)
}
```

A transformer is pure, total, and takes readonly parameters:

```ts
export const withoutNulls = <T>(rows: readonly T[]): readonly NonNullable<T>[] =>
  rows.filter((row): row is NonNullable<T> => row !== null && row !== undefined)
```

Dependencies come first and are curried, so the inner function is callable in a test with nothing mocked but `deps`.

**Then find the nearest conforming file in the project you are in and match it.** The checks in Step 3 tell you whether a candidate conforms; a file that fails them is not an exemplar however widely it is copied. Do not assume the file you happen to be editing is one.

## Step 3 — Run both checks (blocking)

### Biome — the syntactic rules

```bash
node_modules/.bin/biome lint <path>...
```

Run from the repo root. Five plugins enforce this ADR; each names the record in its diagnostic. The rules and their limits are documented in the workspace's own Biome plugin directory.

Several packages have pre-existing failures. **Introduce none, and do not silence existing ones as a side effect.** `// biome-ignore lint/plugin: <reason>` requires a reason, and the reason must say which exception in the ADR applies — not that the rule is inconvenient.

### Parameter immutability — the typed rule

```bash
bun scripts/check-immutable-params.ts
```

With no arguments it checks source files changed against git. Pass paths to narrow, or `--all` to sweep the repo. Exit code 1 means violations.

This is a separate script because Biome cannot answer it. Deciding whether `TThing` is already readonly means resolving the type, following its alias, and inspecting property modifiers — GritQL sees syntax only, so a plugin would have to guess from the shape of the annotation and would be wrong on every alias.

What it enforces: an exported function must not take a parameter a caller can watch it mutate. Objects and arrays are readonly at the top level. Deep immutability is deliberately not required; we do not control the types arriving from other people's libraries, and demanding it there produces suppressions rather than safety. Parameters with no annotation are not judged, and parameters named for an error are exempt.

`--all` reports violations in the hundreds. The repo predates the rule, so a repo-wide sweep cannot pass and is not the gate — the changed-files default is.

**Both checks are blocking.** If either reports a violation in code you touched, fix it before reporting the task complete. If something looks like a false positive, say so explicitly and explain why, rather than ignoring it.

## Step 4 — Review what the tools cannot check

The checks cover mutation, composition helpers, error placement, and parameter types. They say nothing about the rules below, which is where review earns its keep:

| Question | Where it is decided |
|---|---|
| Does a `let` clear the three-part bar, or is it a fallback? | ADR, "Immutability" |
| Is this use case pure, or does it fetch what it should have been given? | ADR, "Pure core, effects at the edges" |
| Are dependencies first and data last, and is the context a `Pick<>`? | ADR, "Dependencies first, data last, curried" |
| Is untrusted data parsed at the boundary, or cast into a type? | ADR, "Parse at the boundary" |
| Does a settlement's `hasIssues` get inspected, or silently dropped? | ADR, "Return results" |
| Has a pipeline gone point-free to the point of obscuring intent? | ADR, "Composition over loops" |

A green build is not conformance. It means the checkable minority passed.

## Out of scope

This skill does not cover test structure, SQL authoring, React state management, or where a module belongs. If the task needs one of those, load the skill or record named for it rather than inventing a convention here.
