# What to keep, and what to leave where it already lives

An artifact is **durable working context, not an activity log**. It exists so a future agent can understand the problem, resume useful work, keep the reasoning that was expensive to produce, and avoid repeating an investigation or reopening a settled decision.

## The retention test

Before recording anything, ask:

> **What future question, decision, or action would this information help with?**

If there is no plausible answer, omit it. The longer form, for anything you are tempted to keep because it feels significant:

> Imagine returning in six months and asking a question about this work. Would this fact improve the answer? Would it prevent repeating an investigation, violating a constraint, reopening a settled decision, or misunderstanding the problem? If not, do not store it.

Prefer **state over history, knowledge over activity, reasoning over implementation trivia**.

## Keep

- The objective, and the meaningful current state of the work
- Decisions, with the reasoning that would matter if they were reconsidered
- Discoveries that changed the understanding of the problem
- Constraints, invariants, assumptions, and observed external behaviour
- Unresolved problems and questions that still need a decision or an investigation
- Rejected approaches, where knowing why they failed prevents repeated work
- Immediate next steps, when they are needed to resume
- References to code, issues, PRs, documents, or evidence a future agent may need to find the authoritative material

## Omit

- A chronology of work performed
- File counts, lines changed, commit hashes, test counts, branch names, and similar implementation metadata — unless specifically needed to resume
- Review history and individual review comments, once they no longer affect the work
- Implementation details that can be rediscovered cheaply from the code
- Completed activities recorded merely because they happened
- Transient status that will be stale within weeks
- Anything whose main value is reconstructing what the agent did
- Conversational prose, tool calls, raw output, large code excerpts, per-source summaries, repetition

## Do not duplicate the repository or GitHub

Git, GitHub, and the code are already authoritative for history, diffs, review threads, and current branch state. An artifact that restates them is both redundant and wrong the moment either changes.

Too much:

> **PR #412 — `@workspace/rate-limiter`** (`you/rate-limiter-2`, 21 files, +4028). Rolling-window pacing, `rate()`/`setRate()`, `stall()`, `clear()`, `priority: 'interactive'`, `metrics()`, `retryAfter` parsing. Reviewed by the Claude action; findings were comment-level.

Nobody asks later how many files it touched, who reviewed it, or what the review said. Keep the pointer and the reason it matters:

> **PR #896** — the pacing primitive the client depends on. Must land before #898.

The same rule applies to a decision: keep the decision and its rationale, not the pull request that carried it.

## Ephemeral versus durable

What we are doing right now is usually ephemeral. What we learned while doing it is usually durable.

| Ephemeral — omit or let it age out | Durable — preserve and distil |
|---|---|
| "Extracted the decision table into a pure function" | Why the decision table must stay pure |
| "224 tests pass, tsc clean" | The invariant the tests defend |
| "Reviewed by X; three comment-level findings" | A finding that changed the design |
| "Pushed to `andy/foo`, awaiting review" | The constraint that makes this change necessary |
| "Opened issue #884" | What #884 establishes, and what it blocks |

Prefer the right column aggressively. A fact that only records activity will not answer a question six months from now.

## Distil as the work progresses

An artifact does not grow monotonically. Each update should be able to make it **smaller**.

- When new information supersedes old, rewrite or delete the old. Do not append next to it
- When completed work produces durable knowledge, keep the knowledge and discard the activity record — a finished migration becomes the constraint it established
- When an open question is answered, the answer replaces the question, in whichever section now owns it
- When a known problem is fixed, keep it only if the fix left a constraint or a trap behind; otherwise remove it
- `Recently Completed` is the section most likely to rot into a changelog. It holds only what a reader needs to know is *already true* so they do not redo it, and entries leave once that is obvious from the code. If it is growing every update, it is being used wrongly

Durable architectural decisions, constraints, and negative knowledge are the exception: do not drop them merely because the newest sources did not mention them.
