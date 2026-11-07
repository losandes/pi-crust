---
name: planning-work
description: Turns a request into an agreed plan before implementation, by establishing shared context, diverging on approaches, converging on one with reasons, and sizing the work into independently verifiable stages. Use when a request spans more than one file or commit, when requirements are ambiguous, when several approaches exist, before executing a multi-stage change, or when asked to plan, scope, or break down work. Also use when a task has grown beyond what was originally agreed. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Planning Work

## Use this skill when

- A request spans more than one commit, file, or package
- The requirements are ambiguous, or several approaches are plausible
- Asked to plan, scope, sequence, or break down work
- A task has grown past what was agreed, and the plan needs revisiting

## Do not use this skill for

- A change whose shape nobody could be surprised by. Proportion the ceremony to the work; a one-line fix planned in four stages is waste
- Debugging — use `systematic-debugging`. A plan built on a guessed cause plans the wrong work
- Recording the decision afterwards — use `adr-authoring`

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## The cycle

From [work-in-explicit-modes.md](../adr/conventions/work-in-explicit-modes.md). Steps 1 to 3 are this skill; 4 to 6 are the work.

### 1. Establish context

State what the work is for, not only what it is. A request names a solution; the purpose behind it is what lets a better solution be recognised.

Write back three things, separated:

- **Known** — what was said, and what the code shows
- **Assumed** — what you inferred and are proceeding on
- **Unknown** — what neither of you knows yet

Separating assumed from known is the point. An assumption stated is corrected in one line; an assumption buried in a plan is corrected after the branch is written.

Verify the context against the codebase before planning on it. A plan built on a misremembered file is wrong in a way that only appears at implementation.

Ask at most one or two focused questions, and only where the answer changes the plan. Asking to confirm what was already said is friction, not diligence.

### 2. Diverge

Put up more than one approach. Genuinely different ones — two options differing only in naming are one option with a coat of paint.

For each: what it costs, what it forecloses, and when it would be the right choice. An approach with no downside has not been examined.

Include the option of doing less. "Change nothing and document the constraint" and "handle the common case only" are real candidates, and they win more often than they are offered.

### 3. Converge

Choose, and say **why the alternatives lost**. The rejected reasoning is the part worth writing — it is what stops the same option being re-proposed in three months.

State any disagreement here, before the choice is made. Converging silently on something you think is wrong is the failure this step prevents.

Check the choice against the records that govern it. A plan that violates a ratified decision needs the decision changed first, not quietly worked around.

## Sizing the work

Once an approach is chosen, break it into stages.

**A stage is the smallest unit worth reviewing on its own.** The test is whether a reviewer could reasonably accept one stage and reject the next. If they could not, those are one stage.

- Each stage ends in something verifiable — a check that passes, a behaviour that can be exercised. "Refactor the types" is not a stage; "types changed, suite green" is
- Fold setup, configuration, and documentation into the stage that needs them. They are not stages of their own
- Split by responsibility, not by technical layer. A stage touching one file in each of five layers is usually one behaviour, and belongs together
- Sequence so each stage leaves the repository working. A plan with a broken middle cannot be paused, and plans get paused

Name what is explicitly **not** in scope. Unstated scope expands.

## Where the plan lives

Short plans belong in the conversation. Writing a file for work that fits in a message adds a document to maintain and a second place to be wrong.

Write it down when the work will outlive the session, when it spans several PRs, or when someone else will execute it. Put it with the change it describes — a PR description is usually the right home, since it is read at review time. A decision reached along the way goes in a record; a plan is not a record.

## After agreement

Confirm the mode before starting. Under collaborative mode, agreement on the plan is not agreement to execute every stage unattended — check in between stages. Under granted autonomy, execute the agreed stages and report at the end.

If the work diverges from the plan, say so when it happens. A plan quietly abandoned mid-execution leaves the developer reviewing something they did not agree to.
