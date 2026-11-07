# Relationship diagram

Ask for this with **"relationship diagram"**, or when the question is how entities relate rather than how work flows.

Entities are boxes. Edges carry a **label** and a **cardinality**. A caveat that belongs to an edge sits beside it, not in a footnote.

```text
                    ┌───────────────┐
                    │  core.shows   │
                    └───┬───────┬───┘
            owns 1..n   │       │   1..1 enrolled via
        ┌───────────────┘       └───────────────┐
        ▼                                       ▼
┌────────────────┐                     ┌────────────────────┐
│ publishing.    │  destination_id     │ destination_       │
│ destinations   ├────────────────────▶│ parameter_values   │
└────────────────┘        1..n         └────────────────────┘
                                          ⚠ two rows per
                                            video_enabled (#891)
```

## Rules

- Every edge is labelled. An unlabelled line says two things are connected, which the reader already assumed
- Cardinality is `1..1`, `1..n`, `0..n` — spelled out, never inferred from arrowheads
- Direction points the way the **dependency** runs, not the way a query happens to read
- `⚠` beside an edge marks where reality departs from the model: a duplicate, a nullable that should not be, a constraint the schema does not enforce. Cite the issue number — a warning with no reference gets deleted by the next person as stale
- Keep to **five or six entities**. Past that the crossings cost more than they explain; draw two diagrams at different altitudes instead

## Not this form

If you need columns, keys and types, it is a data model — see [data-model.md](data-model.md). This form deliberately omits them so the shape of the relationships stays visible.
