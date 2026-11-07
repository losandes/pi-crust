---
name: ascii-diagrams
description: Draws ASCII diagrams in this workspace's house style — trees, decision trees, workflows, walkthroughs, swimlanes, relationship diagrams and data models — and checks exported ones with a blocking script. Use when asked for a "tree", "decision tree", "decision matrix", "workflow", "workflow diagram", "walkthrough", "swimlane", "relationship diagram", "data model", or to "diagram", "visualize", "sketch" or "draw" a structure, a process, a taxonomy or a schema. Also use before pasting any box-drawing diagram into a README, an ADR, a PR description or a comment, and when editing a diagram that already exists. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Drawing ASCII Diagrams

## Use this skill when

- Asked for a **tree**, **decision tree**, **decision matrix**, **workflow**, **workflow diagram**, **walkthrough**, **swimlane**, **relationship diagram**, or **data model**
- Asked to *diagram*, *visualize*, *sketch*, *draw* or *show the shape of* a process, a taxonomy, a schema, or how components relate
- About to paste a box-drawing diagram into a README, an ADR, a PR description, `NOTES.md`, or a code comment
- Editing a diagram that already exists — hand-edits are where alignment decays, and the check exists for that moment more than for the first draft

## Do not use this skill for

- **Prose that a sentence answers.** Three items with no structure between them is a list. A diagram of a list wastes the reader's attention on decoding something they could have read
- **Comparisons destined for a README or an ADR** — a markdown table renders better, sorts, and reflows on a phone. See [references/decision-matrix.md](references/decision-matrix.md) for when the ASCII form is right anyway
- **Recording a decision.** The diagram may illustrate one, but the decision and its rationale belong in a record — use `adr-authoring`
- **Graphical output.** These are monospace diagrams for terminals, diffs and markdown. If a rendered image is wanted, say so rather than approximating one

## Step 1 — Pick the form, and say which

Name the form before drawing, so a wrong choice is caught while it is still cheap. Each form has an exemplar; **open it and copy its shape** rather than working from the description.

| Asked for | Form | Exemplar |
|---|---|---|
| "tree", a taxonomy, "what kinds of X are there" | Tree | [references/tree.md](references/tree.md) |
| "decision tree", "decision matrix" (bare), a classification path | Decision tree | [references/decision-tree.md](references/decision-tree.md) |
| "workflow", "workflow diagram", stages in order, a waterfall | Workflow | [references/workflow.md](references/workflow.md) |
| "walkthrough", a process whose *conditions* need explaining | Walkthrough | [references/walkthrough.md](references/walkthrough.md) |
| "swimlane", who does what and when, crossing a boundary | Swimlane | [references/swimlane.md](references/swimlane.md) |
| "relationship diagram", how entities relate | Relationship | [references/relationship.md](references/relationship.md) |
| "data model", tables, columns, keys | Data model | [references/data-model.md](references/data-model.md) |
| "comparison", or "decision matrix" **with** options/criteria/scoring | Decision matrix | [references/decision-matrix.md](references/decision-matrix.md) |

Two of these are routinely confused, and both produce a diagram that looks correct while answering a question nobody asked:

**Tree vs decision tree.** Identical glyphs, different semantics. In a tree a child is a *kind of* its parent. In a decision tree a node is a *question* and its children are the *answers*, ending in an outcome after `→`. Drawing a taxonomy when a classification path was wanted loses every branch condition.

**Decision matrix means a decision tree here.** Everywhere else it means a grid of options against criteria. In this workspace, bare "decision matrix" means the tree. Only ask which was meant when the request also mentions options, criteria, scoring, or weighing alternatives.

**Workflow vs walkthrough.** Both draw a process; they answer different questions, and the choice is made on what the reader must take away:

| The content is | Draw | Because |
|---|---|---|
| the *shape* — branches, merges, loops, fan-out | Workflow | a rail is linear and cannot show two paths diverging and rejoining without lying |
| the *conditions* — qualification rules, tie-breaks, caveats, what is not built | Walkthrough | boxes evict the sentences to prose beneath, where nobody reads them |

"Workflow" alone means the boxed form — that is what most people expect. Ask which was wanted **only** when the request carries signals both ways, such as *"a workflow, and explain the tie-break rules"*. Do not ask on every workflow request: the wrong pick is obvious on sight and cheap to redraw, while a question on every request is not.

The two also **compose**. A workflow showing the shape, with a walkthrough beneath expanding one stage, is often better than either alone.

## Step 2 — Draw it in the house style

Rules that hold across every form. Per-form rules live in the exemplar.

| Rule | Value | Why |
|---|---|---|
| Target width | 80 columns | fits a PR split diff, which is about half a README's width |
| Hard cap | 100 columns | past this, GitHub scrolls it horizontally and it stops being readable on a phone |
| Trailing whitespace | none | invisible while writing, red in a GitHub diff, and stripped on save by editors — which silently re-raggeds the right edge |
| Tabs | never | column alignment would depend on the reader's tab width |
| Emoji | allowed | see below |

Widths are a target and a cap, not a single number. GitHub does not wrap fenced code blocks — it scrolls them — so an over-wide diagram survives intact but becomes unreadable in the narrow contexts. 80 is where it always reads; 100 is where it stops.

**Swimlanes are the exception worth knowing.** Every other form grows downward; a swimlane grows *right* with each step, having already spent a fixed field on lane titles, so it is the one form that routinely cannot be made to fit. Do not shrink the boxes or narrow the title field — both destroy what makes the form readable. Raise the altitude, or wrap into bands: [references/swimlane.md](references/swimlane.md).

**Emoji are welcome**, in two registers, and they must not be load-bearing on their own:

- *Playful* — a small number, for warmth, where nothing depends on them
- *Legend-bound* — meaningful, and then **the legend is part of the diagram**, not an afterthought in the prose below it

A glyph that carries meaning always has a word beside it. The glyph is for scanning; the word is the content. A diagram that decides something with bare ticks cannot be quoted in a sentence.

Prefer the established markers before inventing one: `✓` holds, `✗` does not, `⚠` counter-intuitive consequence, `⛔` planned but not live, `◀` margin aside, `▼` handoff, `→` outcome.

## Step 3 — Put the caveat inside the diagram

This is the habit that distinguishes a useful diagram here from a decorative one, and it is worth stating on its own.

Where reality departs from the model — a duplicate row, a constraint the schema does not enforce, a tier that is designed but not implemented — say so **at the place it bites**, not in a footnote. The workflow exemplar's `⚠ A higher partner tier beats a lower one even at a lower CPM` is the reason that diagram exists. Moved into the prose beneath, it would be read by nobody who needed it.

A diagram that draws planned behaviour as though it ships is worse than one that omits it. Mark it `⛔` and say it is not live.

## Step 4 — Check it, on export (blocking)

```bash
bun scripts/check-ascii-diagram.ts <path>...
```

Also accepts a directory, `--all` for every `.md` in the workspace, or `-` to read a diagram from stdin. In a `.md` file it finds fenced blocks that contain box-drawing characters and checks those.

Run it whenever a diagram is **exported** — written to a file, pasted into a PR, or committed. A diagram that only ever appears in conversation does not need it. That is a deliberate departure from the other checkers here, which default to files changed against git.

It enforces the universal rules above, and per form: tree connector correctness (`└──` last, ancestor rails aligned to a multiple of 4), swimlane axis alignment, lane-title justification, divider right edges, walkthrough rail continuity, and workflow box heights (odd, so horizontal arrows can leave from the centre row) and closure. Width past 80 warns; past 100 it blocks.

## What the check cannot see

A passing check means the diagram is well-formed. It says nothing about whether the diagram is **true** or **useful**, and reading a green result as approval is the failure this section exists to prevent.

It cannot tell you that:

- The diagram is **accurate**. Nothing verifies a box against the code it claims to describe. A diagram of a system that changed last month passes cleanly
- The **right form** was chosen. A taxonomy drawn where a decision tree was wanted is perfectly well-formed, as is a workflow drawn where the reader needed a walkthrough's conditions
- A glyph carries meaning **nowhere explained**. The legend rule is not machine-checkable
- The diagram **earns its space**. A well-formed diagram of three unrelated items is still a list with extra steps
- **Emoji are used well.** The register distinction is a judgement call

And the rationalisation to refuse when it arrives: *"the check passed, so the diagram is fine."* It passed the parts a script can see. Whether it says something true, at the altitude the reader needs, is the part that was never checked.
