---
Context: All apps with database access
---

# Model state as independent axes

## Status

accepted

## Decision

Give each independent axis of an entity's lifecycle state its own column, and derive any combined status from them in the application.

Derive state that follows entirely from stored facts and the current time. Write a transition only where state records a decision.

Where state belongs in a table of its own rather than on the entity, see [split-tables-by-reason-to-change.md](./split-tables-by-reason-to-change.md). These rules hold whether or not that split is taken.

## Store independent axes; derive the composite

Give each independent state axis its own column and derive the combined status:

```text
billing_status    current | overdue | suspended
publish_status    draft | published
status            derived from both
```

A single enum for every combination grows multiplicatively, couples unrelated writes, and forces queries such as “which entities are suspended?” to match multiple composite values.

Compute the composite in the application, from the axes the query returned. The rule combining them is domain logic and belongs with the rest of the domain logic, not in a view or a generated column. See [rdbms-conventions.md](./rdbms-conventions.md).

Persist the composite only where the database itself must reference it, such as an index, a sort key, or a partial constraint. A stored composite is a denormalized cache of a computation, and carries the obligations of one: every mutation that writes an axis recomputes and writes the composite in the same statement, and changing the combining rule requires a backfill. Those obligations are the reason it is an exception rather than the default.

## Derive time-dependent state; write decision-based transitions

Compute state when it follows entirely from stored facts and the current time. An entity is scheduled before its release timestamp and released at or after it. This needs no job, row update, or audit event, and cannot lag behind the clock.

Applications may need to display a state derived from a timestamp or filter records by that state. These require different approaches:

- **Displaying state:** Calculate the state in application code using the record's timestamp.
- **Filtering by state:** Calculate the state in the database query so the database can return only matching records.

Do not store the calculated state. Store the timestamp and derive the state when needed. This keeps the timestamp as the single source of truth and avoids inconsistencies between stored values.

Each programming language can decide how to organize and reuse the filtering logic. Those implementation details belong in the app / service.

Do not materialize this state as a column. A stored value is correct only at the instant it is written and silently wrong from then until the next write, which is a worse failure than computing it twice. PostgreSQL rejects the attempt outright, because a generated expression must be `IMMUTABLE` and the current time is not.

**Rule:** Derive state determined by time and stored facts. Write a transition when state records a decision.

## State timestamps are domain data

The time an entity entered a state, and the time it is scheduled to leave one, are facts about the entity and belong beside the state they describe. The time the database row was written describes the mutation and belongs in the audit ledger, under the rule stated in [version-data-with-audit-tables.md](./version-data-with-audit-tables.md).

Where a transition history is retained, [choose-identifiers-by-purpose.md](./choose-identifiers-by-purpose.md) governs how its rows are ordered. Domain timestamps do not order transitions reliably.

## Context

Lifecycle state is where schemas accumulate decisions nobody records. A status column starts as two values, acquires a third for a billing concern and a fourth for a publishing one, and ends up encoding several unrelated questions in a single enum whose values cannot be set independently. Each new combination is a schema migration, every writer must read the column before setting it so as not to discard an unrelated axis, and a query for one axis has to enumerate the composite values that contain it.

Time-dependent state accumulates differently. Expressing it as a stored value requires something to perform the write when the moment arrives, which introduces a scheduled job, a mutation, an audit record, and a window in which the stored value disagrees with the clock. The facts needed to compute it are already stored, so none of that machinery buys information that was not already present.

Two alternatives were considered for the composite. A database view or generated column keeps the stored value consistent with its inputs by construction, and was rejected because it places a rule the business owns in the schema, where it cannot be tested beside the code that depends on it and cannot change without a migration. Persisting a value computed by the application at write time was rejected as the default for the same reason it remains available as an exception: it is a denormalized cache, and every input write becomes responsible for maintaining it.

## Consequences

**Easier**

- An axis can be set without reading or preserving the others.
- A query for one axis matches one column rather than a set of composite values.
- Adding a value to one axis does not multiply the values of any other.
- Time-dependent state needs no scheduler, no mutation, and no audit record, and cannot lag the clock.
- The rule that combines axes is a pure function, testable without a database.

**Harder**

- The composite does not exist in the database, so reporting and analytical consumers must either apply the same rule or read the axes.
- A consumer that bypasses the application reads axes rather than a status, and may combine them differently.
- Where the composite is persisted for an index or constraint, every write path that touches an axis must maintain it.
- Filtering by time-dependent state puts the comparison in the query, so the stored timestamp must remain the single fact both the query and the application derive from.

**When this does not apply**

An entity with genuinely one axis has one column, and nothing here applies to it. A value that looks like a second axis but can never vary independently of the first is one axis with a longer name.

**If we reverse this**

Collapsing axes into a single enum is a migration over existing rows and a rewrite of every writer that sets one axis without knowing the others. Materializing a derived composite is additive and reversible; materializing time-dependent state is not, because it reintroduces the writer and the window the derivation removed.
