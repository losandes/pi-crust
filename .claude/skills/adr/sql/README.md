# SQL & Database Conventions

Language-agnostic decisions about SQL, schema, and database tooling. Conventions for calling a database *from* a given language live in that language's nest — for TypeScript, see [../typescript/use-raw-sql-with-drizzle.md](../typescript/use-raw-sql-with-drizzle.md).

## Decisions

| Topic | Document |
|---|---|
| Choosing a primary key; prefixed identifiers; NanoID, UUID, ULID | [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) |
| Surrogate keys on fact, event, and other high-volume tables; `bigint` identity over `serial` | [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) |
| Reset and verification tokens, bearer credentials, and other secret values | [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) |
| Collation on identifier columns | [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) |
| Ordering rows by the sequence they were written | [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) |
| Audit trails, data history, actors | [version-data-with-audit-tables.md](./version-data-with-audit-tables.md) |
| Optimistic concurrency; domain timestamps versus mutation timestamps | [version-data-with-audit-tables.md](./version-data-with-audit-tables.md) |
| What work the database performs; views, generated columns, triggers, and stored procedures | [rdbms-conventions.md](./rdbms-conventions.md) |
| Whether a computed value may be persisted | [rdbms-conventions.md](./rdbms-conventions.md) |
| Deciding which columns belong in which table within one domain | [split-tables-by-reason-to-change.md](./split-tables-by-reason-to-change.md) |
| Modelling lifecycle state, status columns, and state transitions | [model-state-as-independent-axes.md](./model-state-as-independent-axes.md) |
| Writing to more than one table or row as one outcome; where a transaction is opened | [keep-related-writes-in-one-transaction.md](./keep-related-writes-in-one-transaction.md) |
| Isolation levels, concurrent writes to the same row, lost updates | [keep-related-writes-in-one-transaction.md](./keep-related-writes-in-one-transaction.md) |

## Engines

Engines differ by application. Check the package's `CLAUDE.md` before assuming a dialect — do not infer one from a neighboring app.

## Tools

**dbcode** — `.dbcnb` files throughout this repo are Jupyter-style notebooks for data. The `dbcode.dbcode` VS Code extension renders them as interactive notebooks and provides database tooling in the editor. A separate client is only needed for DBA work such as performance profiling.

## Documenting queries

Every non-trivial query ships with a sibling `.dbcnb` notebook next to the code that runs it. The notebook explains the access path in markdown cells and holds runnable SQL cells for verification and `EXPLAIN`. This applies regardless of the calling language.

A notebook is not required for trivial single-table lookups by primary key.

See [../typescript/use-raw-sql-with-drizzle.md](../typescript/use-raw-sql-with-drizzle.md) for the full pattern and its TypeScript implementation.
