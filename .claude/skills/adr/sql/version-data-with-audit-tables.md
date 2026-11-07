---
Context: All apps with database access
---

# Preserve data history alongside current state

## Status

accepted

## Decision

Represent persisted entities in three distinct ways, each answering a different question:

```text
PRIMARY TABLES: What exists now?
shows
items
networks

STATE HISTORY: What states have existed?
shows_hist
items_hist
networks_hist

MUTATION AUDIT: What happened, who caused it, and when?
audit
```

The three representations are maintained atomically but serve different purposes.

This simple structure gives us many of the useful properties of event sourcing — immutable history, attribution, temporal reconstruction, and recovery — while keeping current state authoritative and directly queryable.

It is different than event sourcing in that we preserve states and mutations, rather than domain events, so read operations don't need to rely on reconstruction, projection, historical reasoning, etc.

## Primary tables represent current operational state

A primary table is the authoritative representation of what exists now.

```sql
SELECT * FROM shows;
```

should answer the ordinary operational question without requiring callers to understand version history, deletion state, audit records, or an event log.

A row's presence in the primary table means that entity currently exists.

A row's absence means that it does not.

### Do not soft-delete primary records

Primary tables must not retain deleted entities using flags or lifecycle metadata such as:

```text
is_active
is_deleted
deleted_at
```

Do not require ordinary queries to repeatedly express:

```sql
WHERE is_active = true
```

or:

```sql
WHERE deleted_at IS NULL
```

If an entity no longer exists operationally, delete it from the primary table. Its prior existence is preserved by its history.

This does not prohibit legitimate domain state. For example, a show may be:

```text
draft
published
suspended
```

if those are meaningful states of an existing show. A draft show still exists. A deleted show does not. However, you should not overload domain state to mean that a row remains physically present but should normally be treated as absent. **Presence in the primary table means the entity exists now.**

## History tables represent states that have existed

Where entity history is retained, use a corresponding table named:

```text
[domain]_hist
```

For example:

```text
shows
shows_hist

networks
networks_hist
```

The `_hist` suffix groups the primary and historical representations of a domain together in a table listing and distinguishes state history from the global audit ledger.

History tables are append-only.

Every successful `INSERT` or `UPDATE` that produces a new entity state writes that resulting state to history.

For example:

```text
shows

id=123 | "My Better Show" | network=5


shows_hist

v1 | 123 | "My Show"        | network=5
v2 | 123 | "My Better Show" | network=5
```

The primary table and history deliberately overlap: the current state also exists as the most recent historical version.

This duplication is intentional.

It makes the history table an independently complete record of the states that have existed without requiring a consumer to join current operational state back into history.

A deletion does not create a historical version. Nonexistence is not an entity state. After deleting show `123`:

```text
shows

<no show 123>


shows_hist

v1 | 123 | "My Show"        | network=5
v2 | 123 | "My Better Show" | network=5
```

History continues to describe every state the show occupied while it existed.

## Audit records represent mutations

Use one global append-only table:

```text
audit
```

The audit ledger records database mutations rather than entity state. Conceptually:

```text
audit
------------------------------------------------
id
entity_id
version_id
operation
tags
actor_id
on_behalf_of_id
time_ms
```

`operation` uses SQL mutation terminology:

```text
INSERT
UPDATE
DELETE
```

These are deliberately not domain events such as:

```text
ShowPublished
ShowTransferred
EpisodeReleased
```

`tags` can be used for a comma-separated list of domain events, if they are useful.

History and audit therefore answer different questions:

```text
shows_hist

What states has this show occupied?


audit

What mutations occurred?
Who caused them?
When?
```

Because audit metadata describes a mutation rather than the entity itself, do not add mutation metadata such as `actor_id`, `actor_type`, or `time_updated` to primary or history domain tables merely for auditing. **Keep domain tables focused on domain state.**

This prohibits persistence metadata, not domain time. When a row was written is a fact about the mutation and belongs to `audit`. When an entity entered a state, when it is scheduled to leave it, when it was released, published, suspended, or acquired are facts about the entity and belong to the domain table.

The two differ whenever a state is backdated, scheduled ahead, imported, or corrected, which is often enough that conflating them produces wrong answers rather than merely redundant columns:

```text
audit.time_ms            the row was written at 14:02 today

episodes.time_released   the episode became available at 09:00 last Tuesday
```

The test is whether the value would still be true had the same state been persisted by a different mutation at a different moment. If it would, it is domain data.

### Version references

For `INSERT` and `UPDATE`, the audit record references the historical version produced by the mutation.

```text
INSERT
    -> creates v1
    -> audit references v1

UPDATE
    -> creates v2
    -> audit references v2
```

For `DELETE`, no new version exists.

The audit record references the version that was deleted:

```text
DELETE
    -> removes current v2
    -> audit references v2
```

Full example for a deleted record:

```text
shows

<no show 123>


shows_hist

v1 | show 123 | "My Show"
v2 | show 123 | "My Better Show"


audit

a1 | shows | 123 | v1 | INSERT | user 456 | T1
a2 | shows | 123 | v2 | UPDATE | user 789 | T2
a3 | shows | 123 | v2 | DELETE | user 456 | T3
```

This preserves an important distinction: **History records states. Audit records mutations.** Deletion is a mutation, but absence is not a historical state.

## Every mutation is atomic

The primary state, historical state, and audit record must never disagree.

Conceptually:

```text
                    MUTATION
                       |
          +------------+------------+
          |            |            |
          v            v            v
       current       history       audit
        state        version       record
```

The mutation must be atomic. Prefer a single statement using data-modifying CTEs when the operation can be expressed clearly that way; otherwise use an explicit transaction in the data layer.

For `INSERT`:

```sql
WITH show_record AS (
  INSERT INTO shows (
    id,
    version_id,
    title,
    network_id
  )
  VALUES ($1, $2, $3, $4)
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
  FROM show_record
  RETURNING version_id, show_id
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
    show_id,
    version_id,
    'INSERT',
    $6,
    $7,
    $8,
    extract(epoch from transaction_timestamp()) * 1000
  FROM history_record
  RETURNING id
)
SELECT show_record.*, audit_record.id AS audit_id
FROM show_record
CROSS JOIN audit_record;
```

or conceptually as a transaction:

```text
BEGIN

INSERT primary record
INSERT resulting historical version
INSERT audit record referencing that version

COMMIT
```

For `UPDATE`:

```sql
WITH show_record AS (
  UPDATE shows
  SET
    version_id = $2,
    title = $3,
    network_id = $4
  WHERE id = $1
    AND version_id = $9
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
  FROM show_record
  RETURNING version_id, show_id
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
    show_id,
    version_id,
    'UPDATE',
    $6,
    $7,
    $8,
    extract(epoch from transaction_timestamp()) * 1000
  FROM history_record
  RETURNING id
)
SELECT show_record.*, audit_record.id AS audit_id
FROM show_record
CROSS JOIN audit_record;
```

or conceptually as a transaction:

```text
BEGIN

UPDATE primary record
INSERT resulting historical version
INSERT audit record referencing that version

COMMIT
```

### Use the version as a concurrency token

`version_id` on the primary row identifies the version the caller read. Carrying it into the `WHERE` clause of the update, as `$9` does above, makes the mutation conditional on nothing having changed since.

The update then has two outcomes. One row means the caller's version was still current and the mutation applied. Zero rows means another writer committed first, and the whole statement — primary, history, and audit — produces nothing, because the history and audit inserts select from the empty update.

A zero-row result is a concurrency outcome, not an error and not a missing entity. Callers must distinguish it from both, and re-read before retrying; retrying with the same expected version cannot succeed.

This is the lost-update guard for the ordinary read-modify-write path. See [keep-related-writes-in-one-transaction.md](./keep-related-writes-in-one-transaction.md) for when an isolation level or an explicit lock is required instead.

For `DELETE`:

```sql
WITH show_record AS (
  DELETE FROM shows
  WHERE id = $1
  RETURNING *
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
    $2,
    id,
    version_id,
    'DELETE',
    $3,
    $4,
    $5,
    extract(epoch from transaction_timestamp()) * 1000
  FROM show_record
  RETURNING id
)
SELECT show_record.*, audit_record.id AS audit_id
FROM show_record
CROSS JOIN audit_record;
```

or conceptually as a transaction:

```text
BEGIN

identify current version
DELETE primary record
INSERT audit record referencing deleted version

COMMIT
```

**If any part fails, none of the mutation commits.**

A historical version without its corresponding mutation record is incomplete. An audit record referencing a mutation that did not occur is incorrect. Current state that changed without either record makes the historical model unreliable.

## Every committed mutation produces one audit record

The audit ledger has a simple invariant:

> **Every successful persisted mutation produces exactly one immutable audit record.**

An `INSERT` produces one audit record.

An `UPDATE` produces one audit record.

A `DELETE` produces one audit record.

Operations that affect multiple entities produce one audit record for each entity mutation.

The audit record identifies the actor responsible for the mutation.

Every change has an actor.

| Actor | Example identity |
|---|---|
| A person acting through the product | user id |
| A calling service in an integration | service or client identifier |
| A scheduled job, migration, or backfill | job name and run id |
| An operator acting directly | operator identity, not a shared account |

An application with no concept of a user still has actors.

Acting on behalf of someone may require more than one identity. A service applying a mutation requested by a user should preserve both where that distinction matters. `actor_id` identifies the actor that directly caused the persistence mutation. `on_behalf_of_id`, when present, identifies the actor on whose behalf the direct actor acted.

## Prefer complete historical versions

History should normally store complete versions rather than deltas.

A complete version:

```text
Show v17
```

can be understood independently.

A delta:

```json
{
  "title": {
    "from": "Old title",
    "to": "New title"
  }
}
```

cannot necessarily be understood without the surrounding state and mutation history.

Complete versions deliberately spend storage to gain:

- simple historical queries;
- simple recovery;
- bounded read complexity;
- independently understandable historical records;
- simpler debugging; and
- less coupling between a historical version and every version preceding it.

Entity count alone does not determine whether complete history is economical.

The relevant cost is approximately:

```text
mutation volume
    × version size
    × retention period
```

A table containing millions of mostly stable entities may produce relatively little history. A much smaller table whose records change continuously may produce substantially more. **Prefer complete versions until measured cost demonstrates that another representation is necessary.**

## Historical representation

History can use either typed rows or document snapshots depending on how that domain's history will be consumed.

### Typed history

Prefer typed history when historical state is itself a useful relational dataset.

For example:

```text
shows                    shows_hist
-----                    ----------
show_id                  version_id
title                    show_id
network_id               title
                         network_id
```

Typed history allows historical versions to participate naturally in relational queries and reporting. This is particularly useful for domains where deleted or superseded entities remain meaningful business data.

Typed history does not imply that every constraint from the current table applies to history. For example, a current-state uniqueness constraint may not make sense historically:

```text
shows.slug

UNIQUE among shows that exist now
```

does not imply:

```text
shows_hist.slug

UNIQUE across every version that has ever existed
```

Likewise, historical records may refer to entities that no longer exist in their current primary tables. History preserves historical truth; primary tables enforce current-world relational integrity.

Typed history therefore requires an explicit schema-evolution policy. Historical versions may predate fields or concepts that exist in the current schema.

### JSON history

Use JSON where history primarily supports investigation, recovery, compliance, or occasional temporal reconstruction and relational historical queries provide little value.

For example:

```sql
CREATE TABLE widgets_hist (
  version_id uuid PRIMARY KEY,
  widget_id  uuid NOT NULL,
  widget     json NOT NULL
);
```

A JSON historical document retains the shape it had when written. This makes history less coupled to future schema changes.

Use `json`, not `jsonb`, unless historical payloads actually require indexing, containment, or other `jsonb` behavior. Where PostgreSQL produces the snapshot, prefer `to_json()` when `jsonb` behavior is unnecessary.

## Delta history is an exceptional strategy

For high-mutation or unusually large domains, complete snapshots may eventually become materially expensive. Such a domain may preserve deltas rather than complete versions.

This reduces storage and write amplification but gives up much of the simplicity of complete state history. Reconstructing state at time T may require locating a known complete state and applying subsequent mutations in order.

Deltas also couple interpretation to surrounding history and schema.

For those reasons: **Do not choose delta history based on anticipated scale. Choose it when measured mutation volume, version size, and retention requirements make complete snapshots materially expensive.**

If supporting deltas requires substantial replay, compaction, checkpointing, or reconstruction infrastructure in the operational database, reconsider whether that history belongs in the OLTP system at all.

## Why retain a primary table

Because history contains every version, current state could theoretically be derived by finding each entity's latest mutation and excluding entities whose latest operation was `DELETE`.

Do not do this.

Current state is intentionally materialized as an authoritative, immediately consistent primary table. Without it, an ordinary current-state query becomes a historical query:

```text
find latest mutation
determine whether entity was deleted
find corresponding version
return current state
```

That reintroduces exactly the state reasoning this design is intended to remove. It makes ordinary relational integrity temporal.

A constraint such as:

```sql
UNIQUE (slug)
```

should naturally mean: _No two shows that exist now have this slug._ A foreign key should naturally describe relationships among entities that exist now.

Primary tables allow the database to enforce these current-world invariants directly. The additional storage required for one current version of each existing entity is an intentional trade for simpler reads, simpler constraints, and a simpler operational model.

## Relationship to event sourcing

This design intentionally captures several useful properties associated with event sourcing:

- immutable history;
- mutation attribution;
- temporal reconstruction;
- recovery;
- visibility into how state evolved; and
- a durable stream of mutations that downstream systems may consume.

It does not make events authoritative.

Traditional event sourcing is approximately:

```text
events
   |
   v
replay / projections
   |
   v
current state
```

This model is:

```text
                    mutation
                       |
          +------------+------------+
          |            |            |
          v            v            v
       current       historical     audit
        state          state       mutation
```

Current state is written directly and remains authoritative.

Historical versions are records of states that existed.

Audit records describe persistence mutations, not domain events.

No replay, latest-version query, view, or projection is required to answer what exists now.

This is intentionally a simpler persistence model.

If a domain eventually requires events themselves to become first-class authoritative business facts, that domain may justify event sourcing separately.

## Why not just CDC

Change data capture can observe database mutations and emit before and after images without application involvement.

Where a CDC pipeline feeds an analytical platform, it can provide much of the mechanical history:

- what changed;
- from what;
- to what; and
- when.

It cannot reliably provide the application actor.

The identity visible to the replication log is generally the database connection. Whether a mutation originated from a person, an upstream service, a scheduled job, or another application concern exists in application context.

The responsibilities are therefore different:

| Question | Answered by |
|---|---|
| What states have existed | History |
| What database mutation occurred | Audit or CDC |
| Who caused the mutation | Audit |
| What exists now | Primary table |

Where CDC is configured, avoid unnecessarily capturing both primary mutations and derived historical representations into the same analytical destination.

## Retention and placement

Historical state and audit records do not necessarily remain indefinitely in the operational database. The operational database should retain the window useful for operational, support, recovery, and near-term historical workflows. Older history may move to a long-term analytical or historical platform.

```text
Operational database

current state
+
operational history
+
operational audit
        |
        v
Long-term historical / analytical storage
```

Retention windows and long-term placement are governed separately from this ADR.

Time-partition `*_hist` and `audit` tables where volume warrants it so retention can remove old partitions rather than performing large row-by-row deletes.

Because `audit` is global and append-only, expect its volume to be substantially higher than an individual domain's history and partition it when necessary.

## Cost model

This design intentionally introduces write and storage amplification.

A typical `UPDATE` produces:

```text
1 current-state update
1 historical-version insert
1 audit insert
```

An `INSERT` produces:

```text
1 current-state insert
1 historical-version insert
1 audit insert
```

A `DELETE` produces:

```text
1 current-state delete
1 audit insert
```

The infrastructure cost may additionally include:

- indexes;
- WAL;
- replication;
- backups;
- CDC;
- vacuum and maintenance;
- retention operations; and
- additional mutation-path I/O.

Do not optimize this representation merely because a table contains many entities. Measure mutation volume, version size, retention requirements, and actual operational cost. Storage is deliberately traded for conceptual and operational simplicity.

Where that cost does become material, the first thing to examine is whether the entity has more than one reason to change. A wide entity written by several unrelated processes copies every column on every mutation, so both factors in the cost model are inflated by the same structural problem. See [split-tables-by-reason-to-change.md](./split-tables-by-reason-to-change.md).

## Context

Mutations normally overwrite information.

Without retained history, questions such as these become difficult or impossible to answer:

> Who changed this?

> What did it look like before?

> What did it look like at a particular point in time?

> What existed before it was deleted?

At the same time, retaining old records in primary tables introduces complexity into the overwhelmingly common question:

> What exists now?

Soft deletion makes that complexity contagious. Every query, relationship, and consumer must remember which rows count as current.

This design separates those concerns:

```text
primary tables

What exists now?


*_hist tables

What has existed?


audit

What happened, who caused it, and when?
```

Each representation is deliberately optimized for one class of question.

## Consequences

**Easier**

- Current-state queries require no lifecycle filtering or historical reasoning.
- Primary tables do not accumulate soft-deleted records.
- Ordinary primary keys, foreign keys, and uniqueness constraints describe current reality.
- Historical versions remain available after update or deletion.
- Complete versions require no replay to understand historical state.
- Historical state can be queried independently of current state.
- Audit metadata does not pollute every domain schema.
- A global audit ledger allows mutations to be queried across domains and by actor.
- Current state, historical state, and mutation attribution have explicit and separate semantics.
- We obtain many useful properties of event sourcing without making events the persistence model.

**Harder**

- Most successful inserts and updates produce three writes.
- Storage grows with mutation volume rather than only entity count.
- Every mutation path must maintain the required representations atomically.
- A missing history or audit write creates a silent integrity gap.
- Historical state contains sensitive data that may no longer appear in current state; minimization and access requirements apply accordingly.
- Typed history introduces schema-evolution responsibilities.
- A global audit table cannot use ordinary foreign keys to every possible domain table and history table.
- Different domains may choose typed, JSON, or exceptionally delta-based history, so representation must be documented rather than assumed.
- A version-guarded update returns zero rows when another writer committed first, and every caller must handle that outcome distinctly from a missing entity.
- Database-level cascading deletes require special handling. When a cascade deletes versioned entities, each deleted entity must still produce its own audit record, so cascades generally need to be performed explicitly by the data operation rather than relying solely on ON DELETE CASCADE.

**If we reverse this**

Primary tables remain ordinary operational persistence and do not depend on history or audit for reads.

History and audit are additive. Removing them loses historical and attribution capabilities but does not require reconstructing the operational data model.

Applications that intentionally depend on historical queries would need another source for that history.

## Open questions

### Audit ordering

Nothing currently requires a strict global ordering of mutations.

Timestamps alone do not provide one. Multiple mutations may share a transaction timestamp, and millisecond resolution can collide.

If an ordered audit consumer appears, `audit` will need an explicit monotonic ordering mechanism. Do not add one until that requirement exists.

### Audit references across domains

`audit` references entities and historical versions across many domains. The identifier itself encodes which domain it belongs to, so no separate type discriminator is required.

However, an ordinary relational foreign key cannot reference different tables based on an identifier's prefix. `entity_id` and `version_id` are therefore polymorphic references that cannot be enforced using conventional foreign key constraints.

The application and atomic persistence operation are responsible for maintaining their integrity.

If stronger database-level enforcement becomes necessary, introduce it based on demonstrated need rather than duplicating audit tables per domain.

### Typed-history schema evolution

Domains using typed history need a policy for changes to the primary schema.

Not every current constraint applies historically, and historical versions may predate current fields or relationships.

Establish that policy when the first typed-history domain is implemented rather than imposing it on JSON history that does not need it.
