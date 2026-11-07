# Decision matrix

Ask for this with **"comparison"**, or with **"decision matrix"** *plus* a mention of options, criteria, scoring, or weighing alternatives.

Bare "decision matrix" in this workspace means a [decision tree](decision-tree.md). Only ask which was meant when the request carries one of those additional words.

Options across, criteria down, a verdict row beneath a rule.

```text
                        │ Postgres   │ ClickHouse │ DuckDB
────────────────────────┼────────────┼────────────┼────────────
Daily stats volume      │ ⚠ 40M rows │ ✓ designed │ ✓ fine
Joins to publishing.*   │ ✓ native   │ ✗ federated│ ✗ federated
Ops burden (new engine) │ ✓ none     │ ✗ new tier │ ⚠ embedded
Backfill/replay         │ ⚠ slow     │ ✓ fast     │ ✓ fast
────────────────────────┼────────────┼────────────┼────────────
                        │ KEEP       │ later, if  │ analysis
                        │            │ volume 10x │ only
```

## Rules

- Criteria are phrased so that `✓` always means *better*. A column of mixed polarity cannot be skimmed
- `✓` `⚠` `✗` carry a **word** beside them. The glyph is for scanning; the word is the actual content, and a grid of bare ticks decides nothing
- The verdict row states what happens, not a score. Summed scores invent precision — they imply the criteria were weighted, and they never were
- Losing options keep their real strengths. A matrix where the winner wins every row is a matrix built to justify a decision already made

## Markdown tables beat this form

For anything destined for a README or an ADR, a markdown table renders better, sorts, and reflows on a phone. Reach for this form when the comparison sits **inside** another diagram, or in a terminal, or when a verdict row spanning several lines would break a table cell.
