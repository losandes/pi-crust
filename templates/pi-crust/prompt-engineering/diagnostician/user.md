# Diagnose Task

## Variables

### prompt

{{prompt}}

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

Reproduce the reported behaviour, find what causes it, and write what you found to `<context_handoff_dir>/diagnosis.md`. Then emit your `Report` JSON.

Work in this order, and stop at the first step you cannot complete honestly:

1. Reproduce it. Record exactly what you did, so someone else can do it too.
2. Narrow it. Halve the search space — a range of commits, a range of inputs, a branch of the code — until the smallest failing case is in front of you.
3. Name the mechanism, in terms of what the code does.
4. Collect the evidence that supports it, and say what would disprove it.
5. Write a test that FAILS because of this bug, if one can exist, and name its path in `reproducing_test`. Run it and confirm that it fails for the reason you diagnosed rather than for some other reason — a test that fails because it was written wrong proves nothing and will be "fixed" by making it pass.

Writing that test is the one change you may make. Nothing else.

A test is not always possible: the cause may live outside this codebase, be non-deterministic, or reproduce only sometimes. Then `reproducing_test` is `""`, and the reason goes in `assumptions` or `unresolved`. Never write a test that passes today and call it a reproduction.

If step 1 fails, that is your report: `reproduced: false`, `status: "success"`, `confidence: "unproven"`, everything you tried in `evidence`, and what you would need in `unresolved`. Do not proceed to step 3 on a guess.

## Report

Respond with ONLY valid JSON matching `DiagnosisOutput` — no prose before or after:

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
  "regress_to": { "stage": "", "because": "" },
  "objective_met": { "met": true, "evidence": "<how you know you did your job>" },
  "status": "success",
  "summary": "<one sentence: what is happening and why — or that it could not be reproduced>",
  "reproduced": true,
  "steps_to_reproduce": ["<the exact sequence — empty only if you could not reproduce it>"],
  "root_cause": "<the mechanism in the code, not the symptom>",
  "evidence": ["<a command and its exit status, a log line, a failing input, a path:line>"],
  "confidence": "confirmed",
  "suspect_files": ["<path where the cause lives>"],
  "reproducing_test": "<path to a test that fails because of this bug, or \"\" if one cannot exist>",
  "artifacts": ["<context_handoff_dir>/diagnosis.md"],
  "notes_for_next_agent": "<what whoever fixes this must know, including what must NOT change>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

A failing test is worth more than everything else you write, because it is the only part a machine can check later. `reproducing_test: ""` is honest when no test could exist; it is dishonest when you simply did not try.

`reproduced: false` with `status: "success"` is a complete, valuable report. `confidence` is not a formality: a cause you did not confirm must say `likely` or `unproven`, because the builder downstream cannot tell the difference from the prose and will treat whatever you wrote as an instruction.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "stage": "", "because": "" }` means no regression and is the ordinary answer. Name a stage only when continuing would mean compensating for something that is now wrong — and name the EARLIEST stage affected, not the one before you. `because` carries the evidence, not an opinion. A stage can be returned to once; the second request goes to the developer instead.

{{trust_stance}}
