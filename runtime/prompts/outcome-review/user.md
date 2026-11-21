# Outcome Review Task

## Variables

### prompt

{{prompt}}

### change_base

{{change_base}}

### changed_files

{{changed_files}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Intake

Before anything else, read `previous_envelope` and decide whether you can do your job on it.

You are the gate for the stage before you. Its `facts` are what it established, its `assumptions` are what it did not, and its `unresolved` questions are what it could not answer. If proceeding would require you to invent a material fact, a requirement, or a decision that stage should have made, do not proceed: report `status: "fail"`, put what is missing in `unresolved`, and say in `notes_for_next_agent` which stage must supply it.

Accepting a context makes its assumptions yours. Carry forward the ones you still depend on, and say so rather than silently inheriting them.

Do not reject over style, completeness you do not need, or work you would have done differently. The test is narrow: can you proceed without inventing something that was somebody else's to decide?

## Task

Confirm that the change in `changed_files` is what was asked for.

1. Find the identify output before anything else. It is in `<context_handoff_dir>/identify.md` when `identify` ran in this run; when it ran in an earlier one, its content might be copied into `prompt` or in a ticket the prompt references — a `## Success criteria` list, a `## Scenarios` section of Gherkin, or both. Read whichever you find and treat it exactly as you would the document: the criteria are numbered `SC<n>` and the scenarios are the cases you owe. If both are present and they disagree, the handoff document governs, and say in `unresolved` that the copy in `prompt` differs. If neither carries success criteria, say so in `facts` rather than inferring them from the request.
2. Establish the rest of the spec: read `<context_handoff_dir>/plan.md` if it exists, else use `prompt`. The identify output's numbered success criteria and any scenarios are part of the spec too, and they are what the request was accepted on.
3. Establish the change. `changed_files` is its whole scope, and `change_base` says where it is: when it gives a `git diff` command, run that command for each path; when it names a ref or a range, read it with `git diff <change_base>`. In both cases the work may already be committed and absent from the working tree. When it says the uncommitted working tree, read the files on disk.
4. If `previous_envelope` carries `disputes`, answer each one before you rule. Check the evidence it cites. Then either withdraw the finding, or restate it with **new** evidence. Repeating a disputed finding with the same evidence ends the loop and sends it to the developer — the harness counts that, not you.
5. Rule on every requirement in the spec — one `findings` entry each, with evidence — and on every `SC<n>` from the identify output, citing the number.
6. Write the review to `{{output_document}}`, then emit your `Report` JSON.

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
  "summary": "<one sentence: N of M requirements met>",
  "findings": [
    { "requirement": "<the ask, in the requester's words>", "met": true, "evidence": "<path:line> — handler registered" }
  ],
  "blocking": ["<what must change before this can be approved>"],
  "artifacts": ["{{output_document}}"],
  "notes_for_next_agent": "<what the builder must fix, or how to verify if approved>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

`status` is `success` when the review itself completed — it is not the verdict. The verdict is `approved`, and it is true only when `findings` has no unmet entry and `blocking` is empty.

{{trust_stance}}
