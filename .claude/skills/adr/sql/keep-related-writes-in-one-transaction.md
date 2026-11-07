---
Context: All apps with database access
---

# Scope Database Transactions Narrowly

## Status

accepted

## Decision

Require atomicity when a set of database mutations must succeed or fail together to preserve a data invariant. Introduce an explicit ACID transaction only when the required atomic boundary exceeds the atomicity already provided by a single database statement.

Do not use an explicit transaction merely because an operation performs database I/O, performs multiple mutations within one atomic statement, or might benefit from rollback in the abstract.

| Situation | Explicit transaction? | Guidance |
|---|---|---|
| Single `INSERT`, `UPDATE`, or `DELETE` statement | No | A single database statement is already atomic. |
| One statement that performs multiple related mutations, such as a CTE | No | The statement already provides the required atomicity. Prefer a single atomic statement when it remains clear and maintainable. |
| Current-state, history, and audit mutations performed by one statement | No | The related mutations succeed or fail as one atomic statement. |
| Current-state, history, and audit mutations performed by multiple statements | Yes | The related statements must commit or roll back together. |
| Multiple writes that together establish one valid state | Yes | Commit all writes together or roll them all back. |
| Read followed by write where correctness depends on the value read remaining valid | Usually, with concurrency control | The transaction must use an isolation, locking, constraint, or conditional-write strategy sufficient to protect the invariant. A transaction alone does not necessarily prevent concurrent modification. |
| Multiple independent writes where partial completion is acceptable | No shared transaction | Preserve their independence rather than coupling their availability and failure modes. Each operation may rely on statement-level atomicity or own its own transaction as required. |
| Read-only operations that do not require a consistent multi-query snapshot | No | Avoid an explicit transaction. |
| Multiple reads that must observe one consistent database state | Sometimes | Use a transaction with the appropriate isolation semantics when the consistency requirement justifies it. |
| Database work combined with HTTP calls, message delivery, filesystem operations, or other external I/O | Do not hold the database transaction open across the external work | Database transactions cannot make external systems atomic. Use an appropriate coordination pattern instead. |
| Long-running computation or business logic between database operations | No long-lived transaction | Perform computation outside the transaction and keep the transactional persistence window as small as possible. |

Do not wrap a single database statement in an explicit transaction solely to obtain atomicity. This includes statements such as CTEs that perform multiple related mutations within one statement.

For example, an update that also produces its required history and audit records may be expressed as one atomic statement:

```sql
WITH updated_show AS (
  UPDATE shows
  SET
    title = $2,
    network_id = $3,
    version_id = $4
  WHERE id = $1
  RETURNING *
),
history_record AS (
  INSERT INTO shows_hist (
    version_id,
    show_id,
    title,
    network_id
  )
  SELECT
    version_id,
    id,
    title,
    network_id
  FROM updated_show
  RETURNING version_id
),
audit_record AS (
  INSERT INTO audit (
    id,
    entity_id,
    version_id,
    operation,
    tags,
    actor_id,
    on_behalf_of_id,
    time_ms
  )
  SELECT
    $5,
    updated_show.id,
    history_record.version_id,
    'UPDATE',
    $6,
    $7,
    $8,
    extract(epoch from transaction_timestamp()) * 1000
  FROM updated_show
  CROSS JOIN history_record
  RETURNING id AS audit_id
)
SELECT updated_show.*, audit_record.audit_id
FROM updated_show
CROSS JOIN audit_record;
```

The current-state mutation, history record, and audit record must be atomic, but they do not require an explicit transaction because the database already provides atomicity at the statement boundary.

The same principle applies when the required persistence operations differ by mutation type: the atomicity requirement follows the persistence outcome being produced, not a fixed number or kind of records.

Transaction management is a **data concern**. The code that begins, commits, rolls back, configures, or otherwise manages a database transaction belongs with the database operations in the domain's data layer.

A use case may decide *what business operation should occur*, but it must not manage *how that operation is transacted*. It must not receive a database connection or transaction object, begin or commit transactions, or pass transaction state between data operations.

When several database statements must be atomic, expose a single data operation representing that atomic persistence outcome:

```text
use-cases/[Use Case]
   |
   v
data/[Data Operation]
   |
   +-- BEGIN
   +-- database operation
   +-- database operation
   +-- database operation
   +-- COMMIT
```

Do not manage transactions directly in the use case, such as in this structure:

```text
use-cases/[Use Case]
   |
   +-- BEGIN
   +-- data/[Data Operation A]
   +-- data/[Data Operation B]
   +-- COMMIT
```

Similarly, do not make transaction-aware data operations whose transaction context is supplied or propagated by the use case:

```text
use-cases/[Use Case]
   |
   +-- transaction
       |
       +-- data/[Data Operation A](transaction)
       +-- data/[Data Operation B](transaction)
```

**Name data operations for the atomic outcome they produce.** When multiple database operations collectively represent one atomic persistence outcome, expose that outcome as one named data operation. The use case depends on that operation rather than sequencing lower-level mutations itself.

If a use case currently calls several data operations that must become atomic together, move the persistence composition into a data operation that owns the entire outcome. This gives the transaction one clear owner and keeps both the atomicity requirement and its implementation inside the data layer.

If preserving an invariant requires one transaction to reach deeply across otherwise independent domains, treat that as an architectural signal. The invariant and ownership boundary should be examined before introducing cross-domain transaction coupling.

Transactions must be kept as short as practical. Perform validation, transformation, computation, and external I/O outside the transaction unless their execution while the transaction is open is necessary to preserve the database invariant.

## Context

Database transactions provide ACID guarantees:

- **Atomicity** — all operations in the transaction commit or none do.
- **Consistency** — committed state respects the invariants enforced by the database and transaction.
- **Isolation** — concurrent transactions are prevented, to the degree guaranteed by the selected isolation strategy, from interfering in ways that violate the required invariant.
- **Durability** — once committed, the result survives subsequent failures according to the database's durability guarantees.

These properties make transactions essential when several database statements collectively represent one state transition. They do not make transactions free, nor does requiring atomicity necessarily imply that an explicit transaction is required.

Databases already provide atomicity at the statement boundary. A single statement either succeeds or fails as a unit, even when that statement performs multiple mutations. An explicit transaction adds value when the required atomic boundary spans multiple statements.

A transaction extends the lifetime over which the database must maintain transactional state. Depending on the database and operations involved, longer or unnecessary transactions can increase lock duration, contention, deadlock exposure, retained row versions, connection occupancy, retry cost, and latency for other work.

This creates two failure modes at opposite extremes.

**Too little atomicity** allows partially completed state transitions. When multiple writes collectively represent one valid domain state, partial completion can produce a database state that is individually valid at the row level but invalid as a domain outcome. For example, one part of a required persistence outcome may succeed while another fails, or one side of a multi-table invariant may be persisted without the other.

**Too much transactionality** couples operations that do not require atomicity and causes the database to preserve isolation and transactional state for longer than correctness requires. In the worst case, external calls or expensive computation occur while locks or database resources remain held.

The correct atomic boundary is therefore the **smallest set of database mutations that must succeed or fail together to preserve an invariant**. The correct explicit transaction boundary is the **smallest set of database statements that must commit together to preserve that invariant**.

A transaction also does not automatically solve every concurrency problem. For example:

```text
1. Read available quantity
2. Determine that quantity is sufficient
3. Subtract quantity
```

Wrapping these statements in a transaction provides atomic commit and rollback, but correctness under concurrent execution depends on the database's isolation behavior and the implementation of the read/write sequence. The invariant may require row locking, serializable isolation, an atomic conditional update, a database constraint, or another concurrency-control mechanism.

Transactions should therefore be selected because an invariant requires atomicity across statements, and configured according to the concurrency behavior that invariant requires.

The backend domain architecture assigns database operations and transaction management to the data layer. Use cases contain business logic and orchestrate capabilities, but do not directly manage database infrastructure. Keeping the transaction boundary inside the data layer preserves this separation: callers request an atomic persistence capability without becoming coupled to database connections, ORM transaction APIs, or transaction lifecycle management.

## Consequences

Database operations become explicit about their atomicity requirements. A developer deciding whether to introduce a transaction must identify the invariant being protected rather than applying transactions defensively to all database work.

Single atomic statements are preferred over explicit transactions when they can clearly express the required persistence operation. This reduces unnecessary transaction management while retaining the required correctness guarantees.

Simple mutations remain simple. Single statements rely on the database's statement-level atomicity rather than adding an explicit transaction with no additional atomicity benefit.

Composite mutations spanning multiple statements require a data operation representing the complete atomic outcome. This may produce data operations that perform several lower-level persistence steps, but it keeps the atomic persistence boundary visible and testable in the layer responsible for database behavior.

Use cases remain independent of database infrastructure. They do not know whether a data operation uses one statement, several statements in a transaction, optimistic concurrency, row locks, or another persistence strategy. Those choices may change without changing the use case.

Transactions remain short-lived because business computation and external I/O are kept outside them whenever possible. This reduces contention, lock duration, connection occupancy, deadlock exposure, and the blast radius of retries.

Operations that span the database and external systems cannot be made atomic merely by placing the database work in a transaction. Those workflows must tolerate partial failure or use another coordination mechanism, such as durable state transitions, an outbox, idempotent operations, or compensating actions.

A batch of independent items is not one atomic outcome merely because the items are processed together. When the domain permits each item to succeed or fail independently, wrapping the batch in one transaction unnecessarily couples its failure modes: one failed item can roll back otherwise valid work while also increasing transaction duration and contention.

Some concurrency-sensitive operations require more than `BEGIN` and `COMMIT`. Developers must identify the actual invariant and select an appropriate concurrency-control mechanism rather than assuming that the existence of a transaction guarantees serial execution.

Finally, an atomic operation that cannot be expressed without propagating a transaction through use cases or across multiple independent domain boundaries should trigger design review. Transaction propagation must not become an escape hatch that erodes domain and persistence boundaries.
