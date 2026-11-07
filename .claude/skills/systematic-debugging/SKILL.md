---
name: systematic-debugging
description: Finds the root cause of a bug, test failure, or unexpected behaviour before any fix is proposed. Use when a test fails, a check reports something surprising, behaviour differs from expectation, a previous fix did not work, or a number does not match what you predicted. Also use when tempted to try a change and see whether it helps — that impulse is the signal this skill exists for. Covers reading the error, reproducing reliably, narrowing by bisection, and proving the cause before changing anything. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Systematic Debugging

## Use this skill when

- A test fails, a build breaks, or a check reports something unexpected
- Behaviour differs from what you predicted, including a count you expected
- A previous fix did not work, or worked without explanation
- You are about to change something to see whether it helps

That last one is the real trigger. "Let me try X" before the cause is known is guessing, and guessing that succeeds is worse than guessing that fails, because it leaves a defect that now looks fixed.

## Do not use this skill for

- Behaviour that is not yet surprising — read the code first
- A failure whose cause the error message already states plainly. Read it, fix it, move on; this skill is for when that has not worked

## The rule

**No fix before the cause is known.** A change that makes a symptom disappear without an explanation of why is not a fix, and the explanation has to come first.

The rationalisations that defeat this, answered:

| Thought | Reality |
|---|---|
| "It's obviously the X" | Then proving it costs one command |
| "This is a quick one" | Quick bugs have causes too; the quick ones are quick to prove |
| "I'll investigate if the fix doesn't work" | You will not; a passing test ends the investigation |
| "It's urgent" | Guessing is slower than it looks, and it repeats |
| "It works now" | Working and fixed are different claims |

## Step 1 — Read the error completely

Read the whole message, the whole stack trace, and the exit code. Errors are routinely skimmed past, and the answer is routinely in the part that was skipped.

Read the **first** error, not the last. Later failures are usually consequences.

Check what the message actually says against what you assume it says. A path in an error is a fact; the reason you think that path is wrong is a hypothesis.

## Step 2 — Reproduce it reliably

An intermittent bug that has not been made reproducible has not been understood, and any fix for it is unverifiable by construction.

Find the smallest command that shows the failure, and run it twice. If it passes sometimes, that non-determinism is the finding — chase it before anything else.

If it reproduces in one place and not another, the difference between those two places is the lead. Enumerate the differences rather than guessing among them.

## Step 3 — State the hypothesis before testing it

Write down what you believe is happening and what you would expect to observe if that were true. Then look.

Stating it first is what keeps the result honest. Observation after the fact accommodates almost anything, so the prediction has to exist before the evidence does.

If the observation contradicts the hypothesis, say so and write a new one. Do not adjust the hypothesis to fit what you just saw and continue as though it had been right all along.

## Step 4 — Narrow it

Bisect rather than scan. Each check should roughly halve the remaining surface:

- **In history** — `git log`, `git bisect`, or `git show` on the suspect commit. "It used to work" is the most useful sentence in debugging; find where it stopped
- **In data** — does it fail for every input, or only some? What do the failing ones share?
- **In the stack** — is the value wrong when it arrives, or made wrong here? Check the boundary, not the middle
- **In configuration** — is the code running the configuration you think it is? Print it rather than assume it

When a tool reports something surprising, verify the tool is doing what you think before concluding the code is wrong. A disabled rule, a glob that does not match, and truncated output all read as clean results.

## Step 5 — Prove the cause

Before writing a fix, demonstrate the cause: make the failure appear and disappear on demand by changing only the suspected thing.

If you cannot make it come back, you have not found it. Something else changed.

## Step 6 — Fix the cause, then verify

Write the failing test first — see the test conventions record. Then fix.

Verify against the **original** symptom, not against the test you just wrote. They are the same thing only when the reproduction was faithful.

Then check for the same mistake elsewhere. A cause that occurred once usually occurred more than once, and the search is cheap while the pattern is fresh.

## Step 7 — Say what it was

Report the cause, not just the fix. "Fixed the null check" tells the next reader nothing; "the row parses before the transform runs, so the default was applied to an absent field" tells them where to look when it happens again.

If the cause was a misunderstanding rather than a defect, that belongs in the record or the package documentation — a repeated misunderstanding is a documentation bug.
