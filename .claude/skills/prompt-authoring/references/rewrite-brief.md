# The rewrite brief

This is the instruction the rewrite follows. It is written so it can be handed to a model verbatim — paste the sections below, then the prompt being rewritten, under a final heading naming it.

Nothing here overrides [harness-contract.md](harness-contract.md). Where this brief says to consolidate or remove, the contract says what may not be consolidated or removed.

---

Improve the following LLM agent instructions for clarity, precision, and reliable execution.

The audience is an LLM agent, not a person learning the methodology. Optimize for the agent's ability to interpret and follow the instructions consistently across models such as Claude, GPT and Kimi.

## Objectives

1. Preserve every requirement, constraint, permission, exception, decision boundary and operational instruction the agent needs to perform its role. Do not weaken a requirement to shorten the prompt.
2. Replace jargon, metaphor, rhetorical explanation and elaborate language with precise instructions. Prefer established scientific, engineering and software development terminology where it expresses the intended behaviour accurately.
3. Express each rule as a condition, an action and an observable outcome. State what the agent must do, when the rule applies, and how it determines that the requirement is satisfied.
4. Consolidate overlapping instructions and remove explanation that does not change behaviour. Keep distinctions that matter even when they cost text.
5. Remove decorative punctuation, emphasis, capitalization and formatting. Use headings, lists and examples only where they make the instruction easier to apply.
6. Preserve the agent's role, responsibilities, scope, inputs, outputs and interfaces. Do not introduce responsibilities belonging to another agent or another stage.
7. Preserve exact identifiers, commands, paths, schemas, field names and output formats where they are part of an interface or an execution contract.
8. Preserve operational requirements covering tools, repository conventions, authorization, verification and error handling.

## Scientific and engineering rigour

Use hypothesis testing, falsification and boundary analysis where they improve the agent's reasoning or verification.

- Distinguish observed facts, inferred conclusions, assumptions and hypotheses.
- Identify the evidence that would falsify a consequential assumption or conclusion.
- Seek counterexamples to important claims where feasible and within the agent's responsibilities.
- Test boundaries, failure conditions and alternative explanations rather than only the expected success case.
- Reject an interpretation contradicted by evidence, and record the evidence.
- Do not treat failure to falsify a hypothesis as proof that it is correct.
- Do not present a hypothetical failure as an observed fact.
- State uncertainty explicitly when the evidence cannot distinguish consequential alternatives.

Apply these in proportion to the role. An analyst tests assumptions and interpretations; a builder verifies implementation behaviour; a reviewer or tester attempts to falsify a claim of correctness. Do not impose the same procedure on every role, and do not manufacture hypotheses, failure scenarios, tests or analysis to satisfy a process.

## Instruction design

Favour instructions the agent can execute and verify.

- Use direct imperatives rather than descriptions of desirable behaviour.
- Define triggers and stopping conditions where they are not obvious.
- State an exception beside the requirement it qualifies.
- Make dependencies and required ordering explicit.
- Distinguish mandatory behaviour from preference.
- Remove ambiguous terminology, or define it.
- Prefer the concrete term over the abstract label when both describe the same thing.
- Avoid unsupported absolutes such as "always fails" or "guarantees correctness".
- Keep an example that marks a boundary, demonstrates a failure mode, or prevents a misreading.
- Prefer a positive instruction to a negative one where it expresses the required behaviour as clearly. Keep the negative where the prohibition is the requirement.

Write complete, self-contained statements. Do not compress an instruction so far that the agent must infer the missing context.

## Editing constraints

- Preserve the original intent and scope.
- Do not change the agent's authority or autonomy silently.
- Do not introduce a tool, dependency, workflow or approval requirement.
- Do not replace a concrete requirement with an abstract principle.
- Do not remove a qualification, exception or safeguard.
- Do not weaken a prohibition or a permission boundary.
- Do not change an established interface or output contract.
- Do not add generic best practice unrelated to the agent's responsibilities.
- Do not optimize for a word or token count.

Where an instruction is ambiguous, preserve the safest reasonable interpretation and report the ambiguity if it materially affects behaviour. Do not invent a policy to resolve it.

## Deliverable

Produce a complete replacement for the agent instructions.

Before finalizing:

1. Compare the replacement against the original.
2. Verify that every substantive requirement, constraint, exception and interface survives.
3. Check for contradictions, ambiguous triggers, duplicated rules and missing stopping conditions.
4. Confirm each instruction is actionable within the agent's responsibilities and available capabilities.
5. Remove wording that does not affect interpretation or execution.

Return the revised prompt first. Then report, omitting any section with nothing substantive in it:

- **Behavioural changes** — intentional changes to what the agent is instructed to do.
- **Ambiguities** — important questions the original does not resolve.
- **Preserved constraints** — requirements whose wording changed substantially and whose behaviour must not.

Do not enumerate cosmetic edits or explain obvious changes.

## Original agent instructions

<!-- Paste the prompt being rewritten below this line. -->
