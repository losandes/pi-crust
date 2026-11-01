# Gh-Pull-Request Task

## Variables

### prompt

{{prompt}}

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

Read `{{context_handoff_dir}}/pull_request.md` — the harness has already written a draft from the trace, generated before you ran, so it is there whether or not this is your first attempt. Read `previous_envelope` and `previous_envelopes` too; they carry the Activity immediately before you, which the draft may not.

Write a better title and body than the draft, in your own words:

- `title`: at most 72 characters, naming the outcome this run produced rather than the Activity that produced it.
- `body`: markdown, describing what changed and why a reviewer should accept it. Do **not** include an attribution line — the harness adds one to every body it delivers, before and after yours, and a second one you wrote would contradict it.

You run no git or `gh` command, and you push nothing. Every git and `gh` operation is the harness's; your only output is the two strings above.

Emit your `Report` JSON.

## Report

Respond with ONLY valid JSON matching `PullRequestOutput` — no prose before or after:

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
  "summary": "<one sentence: what this pull request covers>",
  "title": "<at most 72 characters, naming the outcome>",
  "body": "<markdown, no attribution line>",
  "artifacts": [],
  "notes_for_next_agent": "<anything a reviewer of the pull request should also know>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

`title` and `body` are what the harness sends to `gh pr create` / `gh pr edit`, with an attribution line of its own added around your `body`. An empty `title` or `body` after trimming is treated as a failure to compose, and the harness falls back to its own trace-generated draft instead.

{{trust_stance}}
