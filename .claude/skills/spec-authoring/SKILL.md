---
name: spec-authoring
description: Writes specifications in specs/ that an agent executes rather than a human admires, and runs a blocking checker over their structure, numbering, cross-references and verification commands. Use when writing or revising anything in specs/, when turning an agreed design into work an agent will carry out, when a spec is being handed to a run as its prompt, or when a previous spec was followed and came back incomplete. Also use when deciding whether a document is a specification at all rather than a record or a plan.
---

# Authoring a Spec

A spec in `specs/` is read by an agent, not by a reviewer. `resolvePrompt` hands the whole file to a Planner as the run's `prompt`, so every sentence is either an instruction, a constraint, or noise competing with one.

## Use this skill when

- Writing or revising any file in `specs/`
- Turning a design agreed in conversation into work an agent will execute
- A spec was executed and the result was incomplete, wrong in scope, or silently narrowed
- Deciding whether what you are about to write is a specification at all

## Do not use this skill for

- Recording a decision and its rationale for the long term — that is an architecture record. A spec is consumed and moves to `specs/completed/`; a record outlives the work
- Breaking agreed work into commits for a human to execute — that is a plan, and it needs none of the numbering this enforces

## Write for execution, not for agreement

The failure this skill exists to prevent is a spec that reads as a persuasive argument. An argument interleaves what must happen with why, so an agent extracting requirements from justification will miss some — and the ones it misses are invisible, because the document still reads as complete.

Two tests before you write a sentence:

- Could an agent do the wrong thing and still satisfy this sentence? Then it is not a requirement yet
- Is this sentence explaining *why*? Then it belongs in the rationale section, not beside the instruction

## Step 1 — Use the structure

```text
# Refactor|Feature|Fix: <what becomes true>
## Objective            — what is true when this is done, in three sentences
## 1. Requirements      — numbered, normative, individually citable
## 2. Target state      — the canonical example, appearing exactly once
## 3. Out of scope      — what must not change
## 4. Work stages       — ordered, each with the command that proves it
## 5. Rationale         — why, with evidence and rejected alternatives
```

Requirements are numbered `1.1.1`, `1.1.2` so a work stage can cite them, a reviewer can argue with one, and a failed execution can be traced to the clause it ignored. Prose cannot be cited.

Use `MUST`, `MUST NOT`, `SHOULD` and `MAY` deliberately. `MUST` is checkable; "we should probably" is a conversation.

## Step 2 — State the target once

Put the canonical configuration, schema or interface in section 2, **once**, and say which governs when it and the prose disagree. A spec that shows the same YAML in three places has three sources of truth that drift apart under editing, and an agent may implement any of them.

## Step 3 — Write Out of scope before Work stages

Name what must not change, and name it concretely — the schema, the neighbouring subsystem, the vocabulary settled by an earlier spec. An agent asked to rename something will improve it on the way past unless told not to.

Include the boundaries that previous executions crossed. "A rename is a rename" exists in this repo's specs because a rename was not.

## Step 4 — Make every stage provable

Stages order the work and make each part checkable. They do **not** divide it between runs: one document is one run, and that run is not finished until every stage in the table is. A stage names the requirements it satisfies and the one command that settles it:

| #   | Change                      | Proven by                          |
| --- | --------------------------- | ---------------------------------- |
| 1   | 1.1.6, 1.1.7 — remove `poc` | `bun test`; no Lifecycle offers it |

"Done when the registry is clean" is not evidence. A command with an exit code is. If no command can settle a stage, the stage is not yet specified — say what would have to exist for it to be checkable.

Order stages so removals come before the work that would otherwise have to carry them.

Never write that a stage is a run, that stages may be taken one per run, or that any part of the document may be left to a later run. An agent executing the spec reads that as permission to stop after one stage, approve what it did, and report success — and the developer reading that report believes the work is done when it is not. Splitting a document's work across runs also removes the one thing that makes an agent finish: a definition of done it cannot satisfy halfway.

## Step 4a — Too big for one run is a defect in the document

If the work will not fit in a single run, the document is wrong, not the run. Fix it by narrowing the requirements until one run can finish them, or by saying so and asking me.

Do not split work across runs on your own initiative. Split only when I explicitly ask for it, and split into **documents**, never into runs: the result is an epic — a parent spec that names its children and owns nothing executable itself — where each child is a complete spec in this structure, executed by its own run, and done when its own stage table is. Every one of those children is still one document, one run.

## Step 5 — Put the rationale last, and keep it

Rationale is not optional and it is not filler. A decision whose reasoning is lost gets relitigated by the next agent, or quietly reversed. Record the rejected alternatives and why they lost, and quote the evidence verbatim where a prior decision is being overturned.

It goes last because an agent reads it once for orientation and then works from section 1.

## Run the blocking check

```bash
scripts/check-spec.sh specs/<file>.md
```

Exit 0 is clean, 1 is violations, 2 is a usage error. Run it after every edit, and read the exit code rather than the output — a pipe through `tail` discards the status.

## What the check cannot see

It verifies structure, numbering, cross-references and the presence of commands. It cannot tell you:

- Whether a requirement is **right**, or whether the set is complete
- Whether a named command actually proves what the stage claims
- Whether the target state in section 2 agrees with the prose in section 1
- Whether Out of scope names the boundary this particular work will be tempted to cross
- Whether the document as a whole is small enough for one run to finish

A spec that passes this checker can still be unexecutable. The checker catches the shape; the content is yours.
