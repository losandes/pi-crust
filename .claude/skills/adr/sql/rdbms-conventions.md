# RDBMS Conventions

Decisions about what work a relational database performs, independent of the language calling it. Rules here hold whichever server-side technology issues the statements, and whichever engine executes them. Conventions for calling a database from a particular language live in that language's nest.

This document is sparse by design. It exists so that a decision about the engine's responsibilities has a home that is neither a schema-design record nor a language-specific one.

## Status

accepted

## Writing SQL

- Format for review: one column per line, joins and predicates on their own lines
- Qualify every column with its table alias
- Make join order explicit; record optimizer decisions in a comment where they are not obvious
- Use bound parameters. Never build SQL by string concatenation

### Author queries as SQL, not through a builder expression API

Every mainstream ORM and query builder offers a fluent API for composing queries — `select().from().where()`, operator helpers, relational finders. The API is pleasant for the simple cases that make up the first week of a project, and it is the reason the library was chosen.

Author queries as SQL. Use the client library for the things only it can do: opening and pooling connections, defining the schema a migration tool reads, generating and running migrations, and executing a parameterised statement.

Do not author queries through the builder's expression API, and do not treat the types it infers as a substitute for validating what came back.

A query you can read is a query you can take to a database console, explain, and profile. A builder expression has to be executed before anyone can see what it asked for, and the translation layer is where the surprising plan comes from.

SQL is the portable skill and the portable artifact. A team that writes it keeps the ability to change client library, and keeps every engineer able to read the data access layer without learning one library's dialect of it.

The cost is parameter handling and result typing, which the builder was doing for you. Both must be deliberate: parameterise through the library's tagged-template or prepared-statement interface rather than by interpolating strings, and parse every result through a schema rather than asserting the shape the builder would have inferred.

Injection risk moves from "the library handles it" to "the author handles it", which is only safe while parameterisation is a convention nobody is allowed to break. That is a rule worth a lint check rather than a review comment.

## The database engine enforces; the application computes

A relational database may reject states that must never exist. It must not produce domain values or hold the rules that determine them.

| The engine may | The engine must not |
|---|---|
| Reject a duplicate with a unique index | Compute a domain value in a view or a generated column |
| Reject an orphan with a foreign key | Decide an outcome in a trigger or a stored procedure |
| Reject an out-of-range value with a check constraint | Hold a rule the business can change without a schema migration |
| Reject overlapping values with an exclusion constraint | Apply a default that encodes a domain decision rather than a storage one |
| Order, group, aggregate, and filter the rows a query selects | Classify, score, price, or otherwise interpret those rows |

The distinction is between saying no and saying what something is. A constraint is a statement that a state is invalid, and it has to live in the engine because that is the only place with a consistent view of the data at commit time. A rule that composes a status, decides an eligibility, or applies a policy is domain logic, and the engine is the one place it cannot be unit-tested, cannot be read beside the code that depends on it, and cannot be changed without a migration.

Filtering is an exception in appearance only. A predicate that selects rows by a derived condition must execute where the rows are, so the condition appears in SQL whether or not the rule lives there. Keep the underlying facts stored and the predicate derived from them, so the query and the application compute the same thing from the same inputs rather than from two independent definitions.

### Persisting a computed value

A computed value may be stored when the engine itself must reference it — an index, a sort key, a partial constraint, or a partition key.

The stored column is then a denormalized cache of a computation, not a second source of truth. Every mutation that writes an input recomputes it and writes it in the same statement, and a change to the computation requires a backfill.

Store it as a plain column written by the application, not as a generated column, unless the engine is the only writer the schema permits. A generated column cannot disagree with its inputs, which is its appeal, but it does so by holding the rule in the schema, which is the thing being avoided.

### Values the engine should supply

The boundary applies to domain logic, not to facts about persistence itself.

- The time a row was written, taken from the database clock, so that mutations persisted by different application servers are timestamped by one clock. In PostgreSQL, take it from `transaction_timestamp()`. Every row written by one mutation then carries one time, which is what atomicity means; `clock_timestamp()` advances mid-transaction and would give rows that committed together times that differ by an interval nothing observed. A timestamp records when something happened and does not order anything, so the apparent precision buys nothing a sequence does not supply.
- Identity the engine owns, where [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) assigns identifier generation to the database.
- Sequence values used for ordering rows the engine wrote.

A value is in this category when it describes the act of persisting rather than the entity persisted.

## Behaviour the engine should not perform implicitly

[version-data-with-audit-tables.md](./version-data-with-audit-tables.md) requires cascading deletes to be performed explicitly by the data operation rather than by `ON DELETE CASCADE`, because each deleted entity must still produce its own audit record. The general form of that rule belongs here: a mutation the application is accountable for is issued by the application, even where the engine could perform it unprompted.

Declarative referential actions remain available for the case where nothing is accountable for the removal beyond the integrity rule itself: a junction row that exists only to express a relationship, or a dependent row that no history or audit consumer distinguishes from its parent.

## Related decisions recorded elsewhere

| Topic | Document |
|---|---|
| Which columns belong in which table | [split-tables-by-reason-to-change.md](./split-tables-by-reason-to-change.md) |
| Modelling lifecycle state; deriving a composite status | [model-state-as-independent-axes.md](./model-state-as-independent-axes.md) |
| Constraints as a mechanism for enforcing an invariant under concurrency | [keep-related-writes-in-one-transaction.md](./keep-related-writes-in-one-transaction.md) |
| Where identifiers are generated, and by what | [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) |
| History, audit, and the atomicity obligations of a mutation | [version-data-with-audit-tables.md](./version-data-with-audit-tables.md) |
| What authoring SQL rather than builder expressions means for a project using Drizzle | [../typescript/use-raw-sql-with-drizzle.md](../typescript/use-raw-sql-with-drizzle.md) |
