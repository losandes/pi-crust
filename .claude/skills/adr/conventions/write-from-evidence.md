---
Context: All documentation
---

# Write from evidence

## Status

accepted

## Decision

Write so a competent reader can understand the finding or decision, the evidence and reasoning that produced it, the assumptions it depends on, and when it should be reconsidered.

Lead with the finding, decision, or disagreement. Support it with evidence. Distinguish observation from inference from recollection. Make material uncertainty inspectable. Stop once the reader can evaluate and act.

Include enough reasoning for a reader to evaluate whether the conclusion holds. Do not include reasoning merely to demonstrate expertise, reinforce a conclusion already established, or persuade the reader through rhetoric.

Prefer evidence and explicit assumptions over assertion. Prefer concise reasoning over repeated justification.

Repeat a statement only where the second instance carries information the first did not: a cost, a limit, a condition, or an exception. Repetition for emphasis is the defect.

Assume a competent technical reader. Explain specialized facts when they materially affect the reasoning, but do not teach surrounding concepts the reader does not need in order to evaluate or apply the conclusion.

Use tables, calculations, examples, diagrams, benchmarks, and other evidence when they materially support the conclusion. Summarize or omit them when they merely elaborate a conclusion already established.

Disagreement is useful; argumentativeness is not. Challenge a premise when evidence or reasoning warrants it. State the disagreement and its basis clearly. Do not continue building a case after the point is established unless additional reasoning materially affects the conclusion.

This record defines how evidence and reasoning are communicated across artifacts. It does not define the complete structure or conventions of each artifact type; those belong in artifact-specific conventions when needed.

### Applying the standard by artifact

| Artifact | Lead with | Evidence and reasoning should establish |
|---|---|---|
| Conversation | The answer, finding, or disagreement | The evidence necessary to understand or evaluate it; expand when asked, or when omitted reasoning materially affects the conclusion |
| Decision record | The decision | Why it was made and when it should be reconsidered |
| PR description | What changed and why | That the change addresses the problem, plus material risk or omissions |
| Issue description | The problem or desired outcome | Evidence of the problem, relevant constraints, and uncertainty |
| Review comment or reply | The finding | Evidence supporting it and, when uncertain, what would change the conclusion |
| Commit body | The reason for the change | Context or constraints the diff cannot preserve |
| Code comment | The non-obvious reason or constraint | Why the code must behave this way |
| Project-state artifact | Current state | Basis for material claims and unresolved uncertainty |

### Examples

Use these examples to calibrate the distinction between reasoning that makes a conclusion inspectable and rhetoric that merely reinforces it.

**State the decision instead of arguing for compliance**

Avoid:

> Inconsistency has its own cost: every reader of a schema has to learn which tables took which scheme, and every join across them is a place to get it wrong.

Prefer:

> Use the human-oriented identifier unless a documented exception applies.

The first continues arguing for a rule already established. The second makes the rule explicit.

**Preserve the conclusion of an analysis without teaching the analysis**

Avoid:

> Two mistakes are easy here, and both understate the risk. The first is to quote an instantaneous collision rate — the chance that the next insert conflicts with the current population. That figure is linear in n and looks reassuring, but the population keeps growing, so cumulative risk grows with the square of time rather than in proportion to it.

Prefer:

> Evaluate collision risk against the projected lifetime number of identifiers generated within the namespace, not the current row count.

The underlying analysis matters; include the probability model only when it is necessary to evaluate, reproduce, or challenge the conclusion.

**State the concrete consequence instead of making it memorable**

Avoid:

> An identifier outlives the schema that introduced it, the application that generates it, and probably the database engine beneath it.

Prefer:

> Existing identifiers are not changed for conformance alone because they may be persisted by external consumers.

The second exposes the fact that affects the decision without rhetorical framing.

These are examples, not prohibited sentence forms. Similar language may be appropriate when it contributes evidence or reasoning rather than emphasis.

### Make uncertainty inspectable

When a conclusion materially depends on something uncertain, make three things clear, in whatever form fits the artifact:

- **the assumption** — what is believed to be true;
- **the basis** — whether it is measured, estimated, observed, or inferred, and what evidence supports it;
- **the invalidating observation** — what new evidence or changed condition would cause the assumption, and therefore potentially the conclusion, to be reconsidered.

Distinguish measured values from estimates. An estimate does not need false precision; it needs enough provenance for a future reader to understand how it was obtained and whether it still applies.

For example:

> **Assumption:** This namespace will generate fewer than 100 million identifiers over its expected lifetime.
>
> **Basis:** Estimated from the current creation rate and a twenty-year planning horizon; this is a projection, not a measured lifetime count.
>
> **Reconsider if:** Projected lifetime generation materially exceeds this estimate or the generation rate changes enough to alter the collision budget.

The labels above illustrate the information to preserve; they are not required structure.

Do this when uncertainty materially affects the conclusion. Do not mechanically annotate facts or assumptions whose failure would not change it.

### Applying this to decision records

Use a scientific decision process:

1. Define the problem or question being decided.
2. Identify relevant constraints and observations.
3. Consider plausible alternatives.
4. Evaluate alternatives against the evidence and constraints.
5. State the decision.
6. Record meaningful consequences, uncertainties, and conditions that would invalidate or reopen it.

This is the thinking process, not the document structure. The template fixes the structure and puts the decision at the top: surface the takeaway first so a reader can decide whether, and where, to read further. Steps one to four appear in the record only where a reader needs them to evaluate the decision.

The sections of a decision record have different purposes:

| Section | Purpose |
|---|---|
| Decision | State what was decided and what to do |
| Context | Preserve the problem, evidence, constraints, assumptions, and reasoning necessary to understand why the decision was made |
| Consequences | Record meaningful costs, limitations, operational effects, uncertainties, exceptions, and conditions that may require reconsideration |

Some overlap is natural when it improves comprehension. Do not enforce section boundaries mechanically or repeat material solely to satisfy the structure.

Alternatives do not need exhaustive treatment. Record alternatives when understanding why they were rejected helps establish the boundary of the decision or makes future reconsideration easier.

Where decision-record conventions grow beyond the structural guidance above, extract them into a record of their own rather than expanding this one.

## Context

Prose that carries a finding is both an instruction for the present and evidence of how a conclusion was reached. Readers need enough information to distinguish a durable conclusion from one that depended on assumptions or conditions that are no longer true.

Good technical reasoning may therefore be detailed. Length is not itself a defect. Detail becomes noise when it does not contribute to understanding the conclusion, evaluating its validity, applying it correctly, or recognizing when it should change.

The goal is not to persuade the reader that the author was right. The goal is to make the reasoning inspectable.

Rhetorical argument weakens that goal when it substitutes emphasis for evidence, repeats a conclusion after the evidence already supports it, anticipates objections nobody raised, or explains familiar concepts that do not affect the conclusion.

The same reasoning failures appear across artifacts, so the standard is recorded once rather than repeated in artifact-specific conventions.

## Consequences

Documents may contain substantial technical reasoning when the conclusion genuinely depends on it. Concision is preferred only when it preserves the evidence and reasoning necessary to evaluate the conclusion.

A reader should be able to identify which statements are observations, assumptions, constraints, conclusions, and decisions. Important uncertainty should remain visible rather than being converted into confident prose.

Artifact-specific conventions — when a comment is warranted, how public API documentation is structured, what a commit subject contains — are out of scope here and belong in their own records. This record governs reasoning quality; those govern artifact structure.

Before publishing, review explanatory material by asking:

> Does this help the reader understand the evidence, evaluate the reasoning, apply the conclusion, or recognize when it should be reconsidered?

If not, remove it.
