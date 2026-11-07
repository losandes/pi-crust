# Decision tree

Ask for this with **"decision tree"** — or **"decision matrix"**, which in this workspace means this form. See the note at the end.

Internal nodes are questions ending in `?`. Branches are the answers. A leaf is an outcome, introduced by `→`. An outcome may carry one child naming its specific subtype.

```text
One Ad Opportunity
└── Filled?
    ├── Yes
    │   └── Paid creative?
    │       ├── Yes
    │       │   └── Reached?
    │       │       ├── Yes
    │       │       │   └── Impression requirements satisfied?
    │       │       │       ├── Yes → Paid Impression
    │       │       │       └── No → Missed Opportunity
    │       │       │           └── Delivery Miss - IRS
    │       │       └── No → Missed Opportunity
    │       │           └── Delivery Miss — Unreached Fill
    │       └── No
    │           └── Reached?
    │               ├── Yes
    │               │   └── Impression requirements satisfied?
    │               │       ├── Yes → Non-Revenue Impression
    │               │       └── No → Non-Revenue Fill
    │               └── No → Unreached, Filled Opportunity
    └── No
        └── Reached?
            ├── Yes
            │   └── Eligible paid demand should have served?
            │       ├── Yes → Missed Opportunity
            │       │   └── Decisioning Miss - No Paid Demand
            │       └── No → Unsold Opportunity
            └── No → Unreached, Unfilled Opportunity
```

## Rules

- Every question has the **same answers in the same order** at every occurrence — `Yes` before `No`, throughout. A reader compares branches by position, so a flipped pair reads as a different question
- Every path terminates in an outcome. A branch with no `→` is unfinished work, not a shorthand
- The same outcome may appear on several paths; that is the point, and it is how the reader sees which distinct conditions collapse to one result

## "Decision matrix" means this

A decision matrix conventionally means a grid — options across, criteria down — which is [decision-matrix.md](decision-matrix.md). In this workspace "decision matrix" is taken to mean this decision tree, because that is what it has always meant here.

Ask which was meant **only** when the request also mentions options, criteria, scoring, or weighing alternatives. Otherwise draw the tree.
