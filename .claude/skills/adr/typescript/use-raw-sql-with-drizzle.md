---
Context: projects that use Drizzle. The tool-agnostic rule behind it — author SQL rather than builder expressions — is in [rdbms-conventions.md](../sql/rdbms-conventions.md); this record says what that means for Drizzle specifically, and does not apply to a project using something else.
---

# Write raw SQL; use Drizzle only to connect and migrate

## Status

accepted

## Decision

Drizzle is a **connection and migration tool**, not a query authoring tool.

| Use Drizzle for                                    | Do not use Drizzle for  |
|----------------------------------------------------|-------------------------|
| Connection/pool setup (`db`)                       | `db.select()`, `db.insert()`, `db.update()`, `db.delete()` |
| Schema definition for migrations (`schema.ts`)     | `eq()`, `and()`, `gte()`, `inArray()` and other operator helpers |
| Migration generation and execution (`drizzle-kit`) | Relational query API (`db.query.*.findMany()`) |
| `sql` tagged template + `db.execute()`             | Type inference as a substitute for a validated typedef |

Every query is authored as SQL in a `sql` tagged template, executed with `db.execute()`, and documented in a sibling `.dbcnb` notebook.

Each project names its reference implementation in its `CLAUDE.md`.

## The pattern

Each data-access module is a trio:

```text
resolve-thing-by-key.ts      # prep fns + execute + parse
resolve-thing-by-key.dbcnb   # the query, explained and runnable
resolve-thing-by-key.test.ts # tests
```

### 1. One `prep*Sql` function per query shape

Name the access path, not the entity. Document *when* to use each variant with KNOWN/UNKNOWN inputs, and record optimizer decisions in the doc comment.

```ts
/**
 * Prepares a SQL query to retrieve a thing by owner domain and slug.
 *
 * This query is optimized for starting the joins from the domains table.
 * If you start from things and then join to domains, it will take much
 * longer to execute.
 *
 * Use this when:
 * KNOWN: owner_domain, slug
 * UNKNOWN: thing_id
 */
const prepByDomainAndSlugSql = (domain: string, slug: string) => sql`
  SELECT
    things.thing_id,
    doms.owner_domain
  FROM owners.domains doms
    INNER JOIN core.things things
      ON doms.thing_id = things.thing_id AND doms.is_active = 1
  WHERE doms.owner_domain = ${domain}
    AND things.slug = ${slug}
    AND things.is_active = 1;
`
```

Interpolated values in a `sql` template are **bound parameters**, not string concatenation. Never build SQL with `+` or `${}` inside a plain string.

### 2. Parse results through a Zod schema into a settlement

Do not trust inferred row types. Validate the shape you actually selected.

`TSettlementWithRaw` is a settlement that also carries the untouched driver response on its `raw` field, so a caller can inspect row counts, field metadata, or the failing payload without the data layer deciding in advance what is worth keeping.

```ts
import { type TSettlementWithRaw } from '@workspace/typedefs'

const makeResult = ([rows, fields]: RawQueryResult): TSettlementWithRaw<TThing | null> => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 'ok', data: null, raw: [rows, fields] }
  }

  const data = thingSchema.safeParse({
    thingId: rows[0].thing_id,
    ownerDomain: rows[0].owner_domain,
  })

  return data.success
    ? { status: 'ok', data: data.data, raw: [rows, fields] }
    : {
        status: 'error',
        error: new Error(`Failed to parse thing data: ${data.error.message}`),
        raw: [rows, fields],
      }
}
```

### 3. Execute inside telemetry, export a curried resolver

```ts
export const resolveThingByDomainAndSlug =
  ({ db, logger }: Pick<TContext, 'db' | 'logger'>, domain: string) =>
  async (slug: string): Promise<TSettlementWithRaw<TThing | null>> => {
    const result = await telem.db.tryWithMetrics(
      { action: 'select', entity: 'things' },
      () => db.execute(prepByDomainAndSlugSql(domain, slug)),
    )

    return parseResult(result, { logger }, { domain, slug })
  }
```

### 4. Document the query in a `.dbcnb` notebook

Every non-trivial query gets a sibling `.dbcnb` (dbcode notebook — see [adr/sql/README.md](../sql/README.md)) containing markdown cells that explain the access path and SQL cells that run against a live connection. The notebook is where a reader confirms the query is correct and profiles it; the `.ts` file is where it ships.

A `.dbcnb` is required when adding or materially changing a query. It is not required for trivial single-table lookups by primary key.

## Context

- **What problem**: Query builders obscure the SQL that actually executes. Reviewers cannot see join order, index usage, or row multiplication, so astonishing queries reach production — a chain of `.leftJoin()` calls reads as harmless and emits a cartesian product. The builder also silently rewrites queries across ORM versions.
- **Constraint**: Production schemas that span multiple databases require cross-schema joins and hand-tuned join order. Some queries need optimizer hints — `STRAIGHT_JOIN` and its equivalents — that the builder cannot express at all.
- **What we keep from Drizzle**: connection pooling, typed schema for migrations, and a parameterized `sql` template that prevents injection. These are real and we are not giving them up.
- **What we reject**: the builder DSL as a query authoring layer.
- **Alternatives considered**: (a) full ORM usage — rejected, this ADR's motivation; (b) drop Drizzle for a raw driver — rejected, we lose migrations and pooling for no gain, since `sql` + `db.execute()` already gives us raw SQL; (c) stored procedures — rejected, moves logic out of version control.

## Consequences

**Easier**

- The SQL in review is the SQL that runs. Join order and hints are explicit and diffable.
- `EXPLAIN` is copy-paste from the source file to a notebook cell.
- DBAs can read and tune our queries without knowing TypeScript.
- Query changes show up as SQL diffs, so performance regressions are visible in review.

**Harder**

- Column renames are not caught by the compiler. Zod parsing at the boundary is what catches them — at runtime, in tests, not at build time. This is the cost we accept, and it is why step 2 is mandatory rather than optional.
- More boilerplate per query: prep, parse, execute.
- Result types must be declared in `typedefs/`, not inferred from the schema.

**If we reverse this**

Reversal is per-query and incremental — each `prep*Sql` is independently replaceable. The `.dbcnb` files remain valuable documentation regardless.

**Migration**

New queries follow this ADR. Existing builder-based queries migrate when touched for another reason; this is not a mandate for a bulk-rewrite pull request.

Each project records its own compliance state, reference implementation, and known deviations in its `CLAUDE.md`.
