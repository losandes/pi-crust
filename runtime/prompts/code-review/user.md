# Code Review Task

## Variables

### prompt

{{prompt}}

### changed_files

{{changed_files}}

### change_base

{{change_base}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Intake

`context_handoff_dir` and everything under it belong to this run: the handoff documents, envelopes and plans earlier Activities wrote for you. Read and write them as your own inputs and outputs. They are gitignored by design and may sit outside your working tree, in the clone the worktree was created from. Neither is a reason to ask permission, and neither makes them another repository.

Before anything else, read `previous_envelope` and decide whether you can do your job on it.

You are the gate for the stage before you. Its `facts` are what it established, its `assumptions` are what it did not, and its `unresolved` questions are what it could not answer. If proceeding would require you to invent a material fact, a requirement, or a decision that stage should have made, do not proceed: report `status: "fail"`, put what is missing in `unresolved`, and say in `notes_for_next_agent` which stage must supply it.

Accepting a context makes its assumptions yours. Carry forward the ones you still depend on, and say so rather than silently inheriting them.

Do not reject over style, completeness you do not need, or work you would have done differently. The test is narrow: can you proceed without inventing something that was somebody else's to decide?

## Task

Judge the change in `changed_files` against this repository's ratified conventions.

1. Read every file in `changed_files` and its diff. That list is the whole scope. `change_base` says where the change is: when it gives a `git diff` command, run that command for each path; when it names a ref or a range, read it with `git diff <change_base>`. In both cases the work may already be committed and absent from the working tree.
2. If `previous_envelope` carries `disputes`, answer each one before you rule. Check the evidence it cites. Then either withdraw the finding, or restate it with **new** evidence. Repeating a disputed finding with the same evidence ends the loop and sends it to the developer — the harness counts that, not you.
3. The blocking automated checks have already run — their output is in `previous_envelope`. Read it. Do not re-run them.
4. Rule on each applicable repository convention, with a `file:line` for every finding.
5. Write the review to `{{output_document}}`, then emit your `Report` JSON.

## Report

Respond with ONLY valid JSON matching `ReviewOutput` — no prose before or after:

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
  "approved": false,
  "summary": "<one sentence: N findings, M blocking, against which conventions>",
  "findings": [
    { "requirement": "<the convention, as the record states it>", "met": true, "evidence": "<path:line> — settles rather than throws" }
  ],
  "blocking": ["<what must change, naming the rule it breaks>"],
  "artifacts": ["{{output_document}}"],
  "notes_for_next_agent": "<what the builder must fix>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

`status` is `success` when the review itself completed — it is not the verdict. The verdict is `approved`, and it is true only when `blocking` is empty and no finding is unmet.

{{trust_stance}}
