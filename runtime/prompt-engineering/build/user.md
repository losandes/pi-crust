# Build Task

## Variables

### prompt

{{prompt}}

### skills

{{skills}}

### previous_envelope

{{previous_envelope}}

### previous_envelopes

{{previous_envelopes}}

### context_handoff_dir

{{context_handoff_dir}}

## Intake

Before anything else, read `previous_envelope` and decide whether you can do your job on it.

You are the gate for the stage before you. Its `facts` are what it established, its `assumptions` are what it did not, and its `unresolved` questions are what it could not answer. If proceeding would require you to invent a material fact, a requirement, or a decision that stage should have made, do not proceed: report `status: "fail"`, put what is missing in `unresolved`, and say in `notes_for_next_agent` which stage must supply it.

Accepting a context makes its assumptions yours. Carry forward the ones you still depend on, and say so rather than silently inheriting them.

Do not reject over style, completeness you do not need, or work you would have done differently. The test is narrow: can you proceed without inventing something that was somebody else's to decide?

## Task

Implement the work described in `prompt`, guided by `previous_envelope` if present, then emit your `Report` JSON.

Load every skill path listed in `skills` and follow it. If the list is `(none)`, say so in your summary rather than inventing conventions of your own.

## When `previous_envelope` is a review verdict

You are revising. `previous_envelopes` carries every verdict on this work, and a concurrent review Stage produces more than one. Answer every blocking item in all of them — `previous_envelope` is one reviewer, not the review.

Every item gets exactly one of two answers, and no item may be left without one.

**Fix it** — but verify the claim against the code first. A reviewer asserts things that are not true, and implementing a wrong correction damages working code while the run reports success. Read the finding's own evidence in its review envelope, and read the file it names before you change it.

**Dispute it** — one `disputes` entry quoting the finding, carrying evidence a third party can re-check: a `path:line` a reader can open, or a command and the status it exited with. A dispute without one is a refusal, and the gate rejects it.

Two things you do not get to decide:

- A finding a declared check decides — anything the `checks` gate runs — may not be disputed. Fix it. Exit status is not a matter of opinion.
- Whether the argument has gone on long enough. Do not re-argue a finding you already disputed with the same evidence: the harness counts repeats and ends the loop, so saying it louder costs a round and changes nothing.

## When this activity run is a POC

A POC answers ONE question. Before touching anything, state the hypothesis and what evidence would support or disprove it — if you cannot, there is nothing to build yet and you should say so instead.

Build the smallest thing that could answer it, test the riskiest assumption first, and exercise the real boundary when the boundary is the uncertainty. A POC whose hypothesis turns out to be FALSE succeeded: it bought the answer before anyone built on it.

A disproved hypothesis usually means the chain should go back, not forward: set `regress_to` to the activity whose work it invalidated — `conceptualize` when the logical architecture will not hold, `design` when only the physical shape fails — and put the evidence in `because`. Carrying on to `build` after the POC said the concept does not work is the exact thing this stage exists to prevent.

Its code is not production code. List in `discard` what must not survive, and do not quietly improve it into something that looks shippable.

Report `PocOutput` instead of `BuildOutput` for this activity run: the same context fields, plus `hypothesis`, `evidence_sought`, `supported`, and `discard`.

## Report

Respond with ONLY valid JSON matching `BuildOutput` — no prose before or after:

**`changed_files` takes literal paths only.** Every entry is checked against the filesystem exactly as written, so a glob (`src/**`, `lib/*.ts`) fails the gate no matter how many files it would have matched — a path containing `*` cannot exist. Enumerate every file you touched, however long the list runs. Abbreviating a directory you rewrote is the one way to fail a activity run whose work is already on disk.

`disputes` is empty on a plain build. On a revise it holds one entry per finding you did not fix.

```json
{
  "facts": [
    { "fact": "<something you established>", "evidence": "<path:line, a command and its exit status, or what you read>" }
  ],
  "decisions": [
    { "decision": "<something you chose>", "rationale": "<why, so nobody re-decides it>" }
  ],
  "assumptions": [
    { "assumption": "<something you believe but did not establish>", "invalidated_by": "<what would disprove it>" }
  ],
  "unresolved": [
    {
      "question": "<what you could not answer>",
      "consequential": true,
      "beyond_this_run": false,
      "provisional_answer": "<what you would do unasked, or \"\" if you have no defensible guess>"
    }
  ],
  "risks": [
    { "risk": "<how this could fail>", "mitigation": "<what would blunt it>" }
  ],
  "regress_to": { "activity": "", "because": "" },
  "objective_met": { "met": true, "evidence": "<how you know you did your job>" },
  "status": "success",
  "summary": "<one sentence describing what you built>",
  "changed_files": ["src/server.ts", "src/server.test.ts"],
  "artifacts": [],
  "disputes": [
    {
      "finding": "<the blocking item, quoted from the review>",
      "evidence": "src/server.ts:42 — the guard the review says is missing",
      "reason": "<why that evidence settles it>"
    }
  ],
  "commit_message": "<imperative one-line git subject for the code you changed — this is what the commit of your work will say>",
  "notes_for_next_agent": "<how to verify this work>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

{{trust_stance}}
