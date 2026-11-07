---
Context: All apps with database access
---

# Choose identifiers by purpose

## Status

accepted

## Decision

tl;dr: Human-oriented entities use a type-prefixed, 14-character [NanoID](https://github.com/ai/nanoid) generated with the [nolookalikes](https://github.com/CyberAP/nanoid-dictionary#nolookalikes) alphabet. Store the complete identifier directly as the primary key in a `text COLLATE "C"` column.

---

Other records may not need a surrogate identifier or may have workload characteristics that justify a different strategy. Choose according to the purpose the identifier serves:

| Purpose | Strategy |
|---|---|
| **Human-oriented entity** — individually referenced, and the identifier is handled by people in APIs, URLs, events, logs, administrative tools, or support workflows | Type-prefixed, 14-character NanoID stored directly as the primary key in `text COLLATE "C"` |
| **No surrogate at all** — a natural or composite key already expresses the row's identity, and nothing references a row individually | Primary key on the natural key, ordered to match the dominant access pattern |
| **Derived row** — identity is the parent's identifier plus what distinguishes the row within it | Composite primary key carrying the parent's identifier |
| **Machine-oriented record** *(exception)* — nothing a person handles, high volume or heavily referenced as a foreign key or read in the order the rows were written, and individual rows genuinely need identity, and the structure is not governed by a partitioning strategy | Database-generated `bigint` primary key |
| **Time-partitioned structure** *(exception)* — the table is partitioned or a hypertable | Decide the key with the partitioning strategy; this record does not prescribe it |
| **Secret value** — must resist guessing rather than merely avoid collision | Generate 256 cryptographically random bits using a CSPRNG and encode using Base64url; store only a cryptographic hash when the value acts as a bearer credential |

**Identity purpose determines the strategy. Workload can justify an exception to it, never the reverse.**

Table size alone does not determine identifier strategy. A human-oriented entity remains human-oriented at hundreds of millions of rows. Depart from the convention only when measurement demonstrates that storage, indexing, or write characteristics are materially problematic.

Use this decision order:

```text
One Value
└── Must it resist guessing?
    ├── Yes → Secret value
    │   └── 256 CSPRNG bits, Base64url, hashed when a credential
    └── No
        └── Is a row referenced on its own?
            ├── Yes
            │   └── Would anyone paste it and expect it to resolve?
            │       ├── Yes → Human-oriented identifier
            │       │   └── type-prefixed 14-character NanoID
            │       └── No
            │           └── Is the table partitioned by time?
            │               ├── Yes → Key follows the partitioning
            │               │   └── not settled by this record
            │               └── No
            │                   └── High volume, heavily referenced, or read in write order?
            │                       ├── Yes → Machine-oriented record
            │                       │   └── bigint identity
            │                       └── No → Human-oriented identifier
            └── No → No surrogate at all
                └── primary key on the natural key
```

A partitioned table is called out separately because its key may not be a free choice. Where the partitioning scheme requires the partitioning column to participate in the primary key, decide identity alongside the partitioning strategy.

Human-oriented entity IDs use the form `<type>_<nanoid>`, for example `ep_7Kp3mQ2Xa9Nr4T`. The complete prefixed value is canonical and is stored and communicated unchanged across the database, APIs, URLs, events, logs, administrative tools, and support workflows.

Prefixes use lowercase ASCII letters, are generally two to four characters, and are globally unique among human-oriented entity types. Once assigned, a prefix is permanently reserved. Prefix allocations are maintained under [Allocated prefixes](#allocated-prefixes).

When PostgreSQL generates a `bigint` surrogate key, use `GENERATED ALWAYS AS IDENTITY` rather than `serial`.

Do not vary identifier length by table size. Fourteen characters is the standard for human-oriented entities. Reconsider the length only when the projected lifetime number of identifiers generated within a namespace makes its collision probability unacceptable. State the assumed lifetime and projected generation rate when making that exception. Crossing that threshold should also prompt reconsideration of whether the records are genuinely human-oriented. Use the [NanoID collision calculator](https://zelark.github.io/nano-id-cc/) to evaluate the namespace.

Do not use identifiers as authorization mechanisms. Opacity and non-enumerability do not replace access control.

## Context

Identifiers serve different purposes, and optimizing all of them around a single representation creates unnecessary tradeoffs.

For human-oriented entities, the identifier is part of the operational interface of the system. It appears in places such as APIs, URLs, logs, events, administrative tools, support tickets, and database queries. Short, recognizable identifiers that retain one representation across those boundaries reduce operational friction.

Sequential `int` and `bigint` identifiers are efficient relational keys, but expose ordering and approximate entity volume when used externally. UUIDs provide decentralized generation and large identifier spaces, but their standard textual representation is substantially longer and less convenient for routine human handling.

NanoID provides decentralized generation with a deliberately short representation. A 14-character NanoID using the selected `nolookalikes` alphabet provides approximately 79 bits of randomness. Database primary-key or uniqueness constraints remain the authority on uniqueness.

Human-oriented identifiers are ASCII tokens rather than natural-language text. Their characters have exact, case-sensitive meaning, so PostgreSQL columns use `COLLATE "C"` to provide byte-oriented comparison semantics independent of the database's linguistic collation.

Machine-oriented records have different requirements. Where natural or composite identity is sufficient, adding a surrogate identifier provides no useful identity. Where individual records require a surrogate primarily for internal relationships or processing, compact sequential `bigint` keys may be preferable when volume or foreign-key propagation makes key width and insertion locality material.

Secret values have a different threat model. They must resist guessing rather than merely avoid collisions and therefore use cryptographically secure random values rather than an entity identifier scheme.

## Prefix conventions

A prefix:

- uses lowercase ASCII letters;
- is generally two to four characters;
- should be recognizable without requiring specialized domain knowledge;
- identifies an entity type, not a table, service, application, or implementation;
- must be globally unique among human-oriented entity types;
- becomes permanently reserved when allocated and must never be reused for another entity type, even if the original entity type is retired.

Prefer the shortest prefix that remains recognizable and unambiguous. Do not force all prefixes to the same length.

Register a prefix here before introducing it into a schema or application. When a reasonable abbreviation is already reserved, choose another recognizable prefix rather than changing or overloading the existing allocation.

### Allocated prefixes

| Prefix | Entity                       | Notes |
|--------|------------------------------|-------|
| `shw_` | Show                         |       |
| `wrk_` | Work (e.g. Episode)          |       |
| `exp_` | Expression (e.g. Episode)    |       |
| `mnf_` | Manifestation (e.g. Episode) |       |
| `usr_` | User                         |       |
| `svc_` | Another Service              |       |
| `job_` | A Job Queue Service          |       |

### Reserved or legacy prefixes

Prefixes for retired entity types remain here rather than being deleted so that they cannot be reassigned.

| Prefix | Former Entity                | Notes |
|--------|------------------------------|-------|
| `itm_` | Item                         |       |

## Ordering rows by the sequence they were written

Where rows must be totally ordered by the sequence in which they were written — a transition history, an append-only log, any table whose rows are read in the order they occurred — the engine-assigned `bigint` identity supplies that ordering, and the table takes one for that reason even where identity purpose alone would not require it.

Timestamps do not order such rows reliably. Rows written in one transaction can share a timestamp, and rows written in separate transactions can collide at the clock's resolution. A timestamp records when something happened; it does not establish what came first.

This is ordering, not identity. Domain timestamps remain the record of when an event occurred, and are not replaced by the sequence that orders the rows.

## Consequences

Human-oriented identifiers have one canonical representation everywhere. The complete prefixed value stored in PostgreSQL is also used in APIs, URLs, events, logs, administrative tools, and support workflows. An identifier copied from any of these locations can be used directly in a database query.

Human-oriented identifiers can be generated before persistence, allowing durable identity to exist in handlers, tests, events, traces, retries, and idempotent workflows before the database row exists.

Prefixes are part of the canonical identifier rather than presentation metadata. Changing an assigned prefix therefore changes existing identities; prefixes must be allocated under [Allocated prefixes](#allocated-prefixes) before use and are never reused.

NanoID primary and foreign keys consume more storage than `bigint` keys and are randomly distributed, so their B-tree insertion behavior and foreign-key storage cost are less favorable than sequential `bigint` keys. Measure these costs before departing from the human-oriented convention for an entity that otherwise requires it.

The 14-character NanoID length assumes the selected `nolookalikes` alphabet. Changing the alphabet changes the available entropy and requires reevaluating the identifier length. Applications must use a cryptographically secure NanoID implementation.

One of the benefits of using NanoID is the simplicity it provides for responding to change or unexpected outcomes. If the 14-character NanoID length results in collisions at an unexpected rate, we can change the length of the NanoID for that problem space which decreases the collision rate and also resets the collision rate when the change is made.

Every human-oriented identifier must be protected by a database primary-key or uniqueness constraint.

Human-oriented identifier columns must use PostgreSQL's `C` collation so comparison semantics do not depend on the database's linguistic collation.

Existing identifiers are not migrated for conformance alone. Apply this decision to new structures and reconsider it when an existing structure's identity model is otherwise being changed. Changing established primary keys and their references is expensive and may affect external consumers.

See the repository's `CLAUDE.md` for the technologies and shared implementations used to generate identifiers and secret values, and [Allocated prefixes](#allocated-prefixes) for the human-oriented entity prefixes in use.
