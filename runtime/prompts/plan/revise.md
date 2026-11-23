# Plan Revise Task

## Variables

### previous_envelope

{{previous_envelope}}

### previous_envelopes

{{previous_envelopes}}

### context_handoff_dir

{{context_handoff_dir}}

## Intake

`context_handoff_dir` and everything under it belong to this run: the handoff documents, envelopes and plans earlier Activities wrote for you. Read and write them as your own inputs and outputs. They are gitignored by design and may sit outside your working tree, in the clone the worktree was created from. Neither is a reason to ask permission, and neither makes them another repository.

Before anything else, read `previous_envelope` and decide whether you can do your job on it.

You are the gate for the stage before you. Its `facts` are what it established, its `assumptions` are what it did not, and its `unresolved` questions are what it could not answer. If proceeding would require you to invent a material fact, a requirement, or a decision that stage should have made, do not proceed: report `status: "fail"`, put what is missing in `unresolved`, and say in `notes_for_next_agent` which stage must supply it.

Accepting a context makes its assumptions yours. Carry forward the ones you still depend on, and say so rather than silently inheriting them.

Do not reject over style, completeness you do not need, or work you would have done differently. The test is narrow: can you proceed without inventing something that was somebody else's to decide?

## Task

Your task in this round is to answer the blocking findings listed under `## Blocking findings from review` at the end of these instructions, and nothing else.

Leave every part of the existing work that no finding names exactly as it is.

Confine your changes, and the verification you run yourself, to what the findings name and what your changes to them affect.

You are revising a plan that has been reviewed, not writing a new one. Keep everything the reviewers did not object to: a rewrite that improves prose they approved costs a round and risks re-opening a finding they had settled.

More than one reviewer may have ruled, and `previous_envelopes` carries all of them. Answer every blocking item in all of them — the list appended to this prompt is the union of what they blocked on, and no item may be left without one of these two answers.

**Rewrite it** — change the part of `{{output_document}}` the finding names, then list that file in `changed_files`. A finding you agree with is answered by the document, not by a note saying you agree.

**Dispute it** — one `disputes` entry quoting the finding, carrying evidence a third party can re-check: a `path:line` a reader can open, or a command and the status it exited with. "The plan already says this" is a dispute only when you cite the line where it says it. A dispute without evidence of that shape is a refusal, and the gate rejects it.

Two things you do not get to decide:

- Whether a reviewer's reading of your plan is reasonable. If a fresh reader misread it, the plan is ambiguous — that is the finding, and the answer is to rewrite the sentence.
- Whether the argument has gone on long enough. Do not re-argue a finding you already disputed with the same evidence: the harness counts repeats and ends the loop, so saying it louder costs a round and changes nothing.

Reporting neither a rewritten file nor a dispute fails the gate, because it is the one answer that leaves the reviewers with nothing to re-examine.

## Report

Respond with ONLY valid JSON matching `PlanOutput` — no prose before or after:

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
  "summary": "<one sentence describing the plan>",
  "artifacts": ["{{output_document}}"],
  "changed_files": ["<the plan file, when you rewrote it to answer a review; [] on a first plan>"],
  "disputes": [
    { "finding": "<the blocking item you are answering, quoted>", "evidence": "<path:line, or a command and its exit status>", "reason": "<why the finding does not hold>" }
  ],
  "commit_message": "<imperative one-line git subject for committing THIS PLAN DOCUMENT, not the work it describes — e.g. 'Add spec for the /health endpoint'>",
  "notes_for_next_agent": "<what the builder must know>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

Every `artifacts` entry is a path you ACTUALLY wrote. Gates open these files — a name you meant to use fails them.

{{trust_stance}}
