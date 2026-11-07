---
Context: All work with coding agents
---

# Work in explicit modes

## Status

accepted

## Decision

How much autonomy an agent has is stated, not inferred. Work runs in a named **mode**, the mode is declared when it changes, and it stays in force until changed again.

Two modes are defined here. The set is meant to grow — a mode is a named point on the autonomy axis, not a fixed taxonomy.

| Mode | Decisions the agent makes alone | Approval needed before |
|---|---|---|
| **Collaborative** *(default)* | Reading, searching, running checks, drafting, staging | Committing, pushing, opening a PR, or implementing an agreed plan's next stage |
| **Autonomous** | All of the above, plus committing and continuing through planned stages | Pushing to a shared branch, opening a PR, anything outside the agreed scope |

Collaborative is the default. An agent that has not been told otherwise is in it.

Autonomy is **granted, scoped, and temporary**. It is granted for a stated body of work — "do these four things, don't stop to ask" — and lapses when that work is done. It is not a setting that persists across topics.

## The working cycle

Both modes run the same cycle. The mode changes who confirms each transition, not what the steps are.

1. **Establish context.** Build a shared understanding of the problem, the constraints, and what success looks like. State what is known, what is assumed, and what is still unknown, so the assumptions can be corrected while they are cheap.
2. **Diverge.** Put up more than one hypothesis or approach. A single option presented confidently is not a decision, it is a recommendation wearing one.
3. **Converge.** Choose what to attempt, and say why the alternatives lost. The rejected reasoning is what stops the same option being re-proposed later.
4. **Research or implement.** Do the chosen thing.
5. **Verify.** Produce evidence that it worked. An unverified result does not end the cycle.
6. **Repeat, or move on.** If verification revealed something new, the context has changed and the cycle restarts with it.

Steps 1 through 3 are not a planning ritual to be performed before real work. They are how a wrong direction gets caught while it costs a paragraph instead of a branch.

Proportion the cycle to the work. A one-line fix does not need written hypotheses; a migration does. The test is whether anyone could be surprised by what happens next — if so, converge explicitly first.

## Why not a hard gate

A rule that demands approval before every implementation gets suspended the first time it is inconvenient, and once suspended there is nothing left. A named mode survives that, because changing mode is a visible act rather than an exception.

It also fails the case that actually happens: a person who has agreed a plan and now wants several stages executed without being asked again. Under a hard gate they must either re-approve repeatedly or abandon the rule. Under modes they say which mode applies.

## On divergence

Divergence means genuinely different approaches, not one approach with variations. Two options that differ only in naming are one option.

Divergence is also where disagreement belongs. An approach that the agent thinks is wrong should be said before the choice, not discovered afterwards. Converging on a worse option knowingly and silently is the failure this step exists to prevent.

## Context

- **Why modes rather than permissions**: the question is rarely "may you do X"; it is "how much should you do before checking in". That is a single axis, and a named point on it communicates faster than a list of allowed operations.
- **Why the default is the cautious one**: the cost of asking unnecessarily is a message; the cost of not asking is unreviewed work on a shared branch.
- **Why this record avoids the word "brainstorming"**: the term is used for many incompatible practices, and the unstructured-idea-generation sense it usually denotes is not what is wanted here. The cycle above says what to do instead.

## Consequences

**Easier**

- Autonomy is requested and granted in one sentence, rather than negotiated per action.
- The agent stops asking permission for reads and checks, which was never the risk.
- A plan agreed once can be executed through several stages without re-approval.

**Harder**

- The current mode has to be tracked, and re-stated after a long gap or a context reset, because an agent that has forgotten the mode will assume the default.
- Scope has to be stated when autonomy is granted, or "autonomous" quietly becomes permanent.

**Risk**

A mode is a claim about intent, not an enforcement mechanism. Nothing prevents an agent in collaborative mode from committing except the instruction not to, so the modes are a convention that still depends on being followed.
