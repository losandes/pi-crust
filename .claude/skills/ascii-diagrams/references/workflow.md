# Workflow

Ask for this with **"workflow"** or **"workflow diagram"**. This is what most people mean by the words, so it is the default when nothing else is specified.

Boxes and arrows, on a grid. The *shape* is the content: what follows what, where it branches, where branches rejoin, what falls through to the end. Labels are short. A step needing a sentence is a sign the wrong form was chosen — see [walkthrough.md](walkthrough.md).

```text
           ┌──────────────┐
           │ ad slot open │
           └───────┬──────┘
                   ▼
           ┌──────────────┐
           │ TIER 1       │   filled   ┌──────────────┐
           │ direct sold  ├───────────▶│ locked in    │
           │              │            └──────────────┘
           └───────┬──────┘
            empty  │
            slots  ▼
           ┌──────────────┐
           │ TIER 2       │   filled   ┌──────────────┐
           │ programmatic ├───────────▶│ locked in    │
           │              │            └──────────────┘
           └───────┬──────┘
            empty  │
            slots  ▼
           ┌──────────────┐
           │ TIER 3 house │ ⛔ not live
           └───────┬──────┘
                   ▼
           ┌──────────────┐
           │ MISSED       │
           │ OPPORTUNITY  │
           │              │
           └──────────────┘
```

## Rules

- **Box interior heights are odd** — 1, 3, 5. This is what lets a horizontal arrow leave from the exact vertical centre. Padding a box to an even height to fit a label silently breaks every arrow that meets it
- **Boxes joined by a horizontal arrow are vertically CENTRED on each other**, so a single row is the centre of both, and the arrow sits on it. Not top-aligned: in the example above a 1-row box is centred against a 3-row one, and aligning their top borders would put the arrow off-centre at one end. When the two boxes are the same height, centring and top-aligning look identical — do not learn the wrong rule from that case
- **The edge label sits in the gutter on the row above the arrow**, not on the arrow's own row, which belongs to the shaft
- **Boxes snap to a small number of columns.** The example uses two. A box that sits at its own unique indent reads as a level of hierarchy that does not exist
- **Edge labels sit 2 spaces from the rail** — the same gap swimlane lane titles use, so the eye lands in the same place across both forms
- **Annotations are centred on the box they describe and adjacent to it** (`⛔ not live`). An annotation drifting a column away attaches itself to whatever else is on that line
- Branch labels go **on the branch** (`filled`, `empty slots`), never in a key beneath the diagram. A key forces the reader to hold two things at once

## Not this form

| If | Draw |
|---|---|
| Steps need sentences, conditions, caveats | [walkthrough.md](walkthrough.md) |
| The work crosses actors or systems | [swimlane.md](swimlane.md) |
| Nodes are questions and edges are answers | [decision-tree.md](decision-tree.md) |

The swimlane boundary is the one that slips: a flow diagram has **one** actor. The moment a step belongs to somebody else, lanes carry that better than a differently-shaped box.
