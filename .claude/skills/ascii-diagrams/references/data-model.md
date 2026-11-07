# Data model

Ask for this with **"data model"**.

Tables with their columns, key markers and cardinality. This is the form to reach for when the *columns* are the point; when they are not, draw a [relationship diagram](relationship.md) instead.

```text
core.shows                        publishing.destinations
┌──────────────────────┐          ┌──────────────────────────┐
│ PK show_id      int  │──1────n─▶│ PK destination_id   int  │
│    show_slug    str  │          │ FK show_id          int  │
│    show_title   str  │          │ FK destination_type int  │
│    is_live      bool │          │    is_active        bool │
│    is_active    bool │          └────────────┬─────────────┘
└──────────────────────┘                       │ 1
                                               │
                                               n
                              publishing.destination_parameter_values
                              ┌──────────────────────────────────┐
                              │ PK value_id                 int  │
                              │ FK destination_id           int  │
                              │    parameter_value  '1' | '0'    │
                              │    is_active                bool │
                              └──────────────────────────────────┘
```

## Rules

- `PK` and `FK` in a fixed left column; plain columns indent to align with them. Types right-aligned in their own column
- Table name sits **above** its box, unboxed, so the box holds only columns
- Cardinality is written on the edge at both ends (`1` … `n`), because a crow's foot is ambiguous in a monospace font
- Show the **values** for a column whose meaning depends on them — `'1' | '0'` — where a bare `str` would hide the thing being explained
- Include only the columns the diagram is about. A faithful reproduction of the table is what the schema is for
- **Three or four tables per diagram.** With types included, five will pass 100 columns; the fix is fewer tables, not dropping the types
