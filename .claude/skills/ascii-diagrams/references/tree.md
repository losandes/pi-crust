# Tree — taxonomy

Ask for this with **"tree"**.

Nesting is the only semantic: a child is a *kind of* its parent. No arrows, no status glyphs, no boxes. If a node needs a sentence to justify it, the sentence goes in prose beneath the diagram, not inside it.

Four glyphs only: `─ │ └ ├`. Indent is 4 columns per level, so an ancestor rail always lands on a multiple of 4.

```text
Commercial Outcome (derived)
├── Monetized
│   └── Paid Impression
└── Unmonetized
    ├── Non-Revenue Outcome (e.g. house ads, cross-promotions)
    │   ├── Non-Revenue Impression
    │   └── Non-Revenue Fill
    ├── Missed Opportunity
    │   ├── Decisioning Miss
    │   │   ├── No Paid Demand
    │   │   └── Error Occurred
    │   └── Delivery Miss
    │       ├── Unreached Opportunity
    │       └── Impression requirements satisfied (IRS)
    ├── Unsold Opportunity
    └── Unreached Opportunity
```

## Rules

- `└──` marks the **last** child at its level; every earlier sibling uses `├──`
- An open ancestor carries `│` down every line beneath it, in its own column
- Siblings are ordered by meaning, not alphabetically, and the order is stable between revisions so a diff shows the change and not a reshuffle

## Not this form

If the parent is a *question* and the children are its *answers*, it is a decision tree — see [decision-tree.md](decision-tree.md). The drawing is the same; the semantics are not, and confusing them produces a diagram that looks right and says nothing.
