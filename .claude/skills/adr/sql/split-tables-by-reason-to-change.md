---
Context: All apps with database access
---

# Split tables by reason to change

## Status

accepted

## Decision

Group columns according to what causes them to be rewritten. Columns belong in the same table when every event that writes one also writes the others. Give a group its own table within the domain when it changes for a different reason, such as a different writer, cadence, lifecycle, or retention obligation.

Multiple tables do not imply multiple domains. These tables remain within the same domain, share the entity's identifier, use domain-specific names, and are written in one transaction when an event affects more than one of them.

The Single Responsibility Principle and Interface Segregation Principle apply here as well as to classes. A table with unrelated reasons to change makes writers contend over the same row. When history is retained under [version-data-with-audit-tables.md](./version-data-with-audit-tables.md), each mutation also copies columns that did not change.

This decision is separate from normalization. Normalization addresses redundancy through functional dependencies. A fully normalized table can still have several unrelated reasons to change. This record addresses how to divide an entity into maintainable units where appropriate.

## Identify reasons to change

For each column, identify the events that rewrite it and the actors responsible. Columns rewritten by the same set of events share a reason to change. Look for these differences:

| Signal | Example |
|---|---|
| **Writer** (actor) | A person edits the body, a billing system changes account state, and moderation imposes restrictions |
| **Cadence** | One group changes on an edit, another on every request or playback |
| **Lifecycle** | One group is set at creation, another changes until the entity is retired |
| **Retention or erasure** | One group must be preserved for history, another must be erasable on request |
| **Read audience** | A consumer needs one group but never the other |
| **Presence** | A group applies only to certain subtypes, making other rows structurally nullable |

Writer, cadence, and lifecycle usually determine the split. Different retention or erasure obligations require separation when they apply, because retention, partitioning, and deletion operate at the table level.

Read audience rarely justifies a split on its own. A consumer that wants one group and not the other is already served by selecting fewer columns, and a boundary drawn on read shape alone adds a join without removing a write. Treat it as corroborating a split that a writer, cadence, or lifecycle difference already supports. Presence is the exception that stands alone: columns that exist only for some subtypes are structurally nullable in every other row, and no write-side difference is needed to justify separating them.

## When to keep columns together

A difference in how columns change is a reason to *consider* splitting them, not a premise that they should be split automatically. Keep groups in the same table when any of these conditions applies:

1. **A database constraint needs columns from both groups.** Uniqueness, check, and exclusion constraints cannot span tables. Columns that must satisfy a shared database invariant must remain together, regardless of their change drivers.
2. **The same events always write both groups.** Separate tables would add a join and another participant in the transaction without separating any writes.
3. **Every performance-critical read needs both groups, and no consumer reads either independently.** Separating them adds a join without providing a read-isolation benefit.

The first condition is especially important. For example, a partial uniqueness constraint requires `slug` and `publish_status` in the same table:

```sql
UNIQUE (slug) WHERE publish_status = 'published'
```

Moving `publish_status` to another table makes that constraint impossible to express directly. Either keep the constrained state column with `slug` and split only unconstrained state columns, or explicitly accept that the database cannot enforce this invariant and document where it will be enforced. Make this decision before consumers depend on the split.

**Also weigh the cost.** Splitting one or two narrow, rarely changed columns is probably not worthwhile. Every boundary adds joins for reads that need both groups, atomicity requirements for writes that touch both, and coordination for schema changes. Each split must justify that cost.

**Scope of these tests:** They apply only when dividing one entity's attributes into multiple tables with one row per entity in each. They do *not* apply to tables at a different grain:

- History: one row per version
- Audit: one row per mutation
- Transition log: one row per transition
- Child collection: one row per member

Those tables may be written by the same events as the entity. That does not make them inappropriate splits: they serve different purposes and have different row cardinalities.

## Procedure

1. List the domain's columns, including the identity column.
2. For each column, identify the events that rewrite it and the actors responsible.
3. Group columns with identical sets of writing events.
4. Apply the **When to keep columns together** tests. Merge a rejected group into the group it is most often written with.
5. Set a history policy for each remaining group. Some may require no history; others may use different representations.
6. Name each table for what it contains. Names like `details`, `data`, or `meta` indicate that the reason to change has not been identified clearly.
7. Identify events that write multiple groups. Those writes must remain atomic.

Step five provides much of the benefit. Under [version-data-with-audit-tables.md](./version-data-with-audit-tables.md), history storage is approximately:

```text
mutation volume × version size × retention period
```

Separating frequently changed columns from a wide entity reduces the version size of frequent mutations and the mutation volume of the wide history. Neither saving is possible while both groups remain in one table.

## Naming and history

Each split table is an ordinary primary table holding current state. Where history is retained, its history table uses the `_hist` suffix:

```text
shows             identity and body; changes when someone edits the show
shows_hist        body versions

shows_state       current lifecycle state; changes when billing or publishing state changes
shows_state_hist  state transitions
```

Editing the body writes `shows`, `shows_hist`, and one audit record. Suspending billing writes `shows_state`, `shows_state_hist`, and one audit record. Neither operation copies the other group's columns.

Every split table follows the primary-table rule: a row's presence means the entity currently exists. State tables do not use soft deletes. Deriving current state from history instead of storing it in primary tables remains rejected for the reasons in [version-data-with-audit-tables.md](./version-data-with-audit-tables.md).

The state table references the entity's primary table through a foreign key. This enforces existence, while current-state constraints remain expressible within whichever table owns the constrained columns.

## State is the most common split

Lifecycle state commonly changes for a different reason and at a different cadence than the entity's other attributes. An author edits an episode title; a schedule or operator changes its publication state. Consider a separate state table when these events differ, subject to the constraints above.

How the state itself is modelled — independent axes, derived composites, and state that follows from the clock — is decided in [model-state-as-independent-axes.md](./model-state-as-independent-axes.md), and applies whether or not state is split into its own table.

## Context

Entities accumulate columns because their primary table is the obvious place to put them. Over time, unrelated writers contend for the same row, consumers load columns they do not need, and history captures unchanged fields with every mutation.

History amplifies the cost. Without it, a wide table with multiple change drivers is inefficient. With it, more reasons to change produce more versions, while more columns make every version larger. Separating those factors before data accumulates avoids that multiplication.

We considered storing state and body in separate immutable tables, deriving current state from append-only history through views. This would separate change drivers and reduce write amplification, but it was rejected because it:

- Makes current-world constraints, such as uniqueness among existing entities, inexpressible against a current row set
- Removes the current row used for optimistic concurrency and locking
- Reintroduces lifecycle flags instead of deletion
- Makes indexes on hot read paths grow with mutation volume instead of the number of current entities

The adopted approach separates change drivers without those drawbacks.

## Consequences

**Easier**

- Version, partition, or retain a frequently updated group independently.
- Reduce history size by avoiding copies of unchanged wide rows.
- Let consumers read only the groups they need.
- Prevent unrelated writers from contending on the same row.
- Apply retention and erasure rules at the table level.
- State can be versioned, retained, and written separately from the entity it describes.

**Harder**

- Reads spanning groups require joins. Writes spanning groups must be atomic under [keep-related-writes-in-one-transaction.md](./keep-related-writes-in-one-transaction.md).
- Constraints cannot span groups, so invariants must be identified before splitting.
- Deleting an entity affects multiple tables, and each deletion still needs an audit record.
- Additional tables bring history and audit obligations; a missed write creates a silent gap.
- Moving a poorly chosen boundary is harder than moving a column because consumers depend on the join.

**When this does not apply**

Keep a domain in one table when its columns genuinely share one reason to change. Most will. The goal is not more tables. Splitting groups that are always read and written together makes the schema worse.

**If we reverse this**

Groups can be merged into the entity table without changing the history or audit model, but write amplification returns. Consumers that previously joined the groups no longer need to; consumers that read one group alone must now carry the rest.
