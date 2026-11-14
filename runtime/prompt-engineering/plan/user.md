# Plan Task

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

Plan the work described in `prompt`.

`previous_envelopes` carries every Activity that has run before you, each labelled with its name — not only the stage immediately before. A run that identified, conceptualized and designed hands you all three, and all three are inputs to the plan. Read them before you write anything, and say in `facts` which of them you relied on.

1. Find the identify output before anything else. It is in `<context_handoff_dir>/identify.md` when `identify` ran in this run; when it ran in an earlier one, its content might be copied into `prompt` or in a ticket the prompt references — a `## Success criteria` list, a `## Scenarios` section of Gherkin, or both. Read whichever you find and treat it exactly as you would the document: the criteria are numbered `SC<n>` and the scenarios are the cases you owe. If both are present and they disagree, the handoff document governs, and say in `unresolved` that the copy in `prompt` differs. If neither carries success criteria, say so in `facts` rather than inferring them from the request.
2. Its `## Success criteria` are numbered `SC1`, `SC2`, …, and they are the standard the finished work is reviewed against — not your paraphrase of them. Every criterion must end up in one of two places: cited by the numbered requirement that satisfies it, or listed under Out of scope with the reason you are not covering it. Narrowing the scope is a decision you are allowed to make; narrowing it silently is the failure this step exists to stop. Copy its `## Scenarios` forward unchanged if it has any, or point at them by path — they are what the tester writes cases from.
3. Write the full plan to `{{output_document}}` — this is the plan, and the only copy of it. Use the structure in your system prompt: Objective, numbered Requirements, Target state once, Out of scope, Work with what proves each change, Rationale last. The builder executes it; a sentence it cannot act on is noise competing with one it can.
4. Write it ONCE, and leave the repository alone. Do not copy the plan into `specs/`, `docs/`, or anywhere else in the working tree: a second copy drifts from the first, costs the whole document again, and lands in somebody's diff as a change nobody asked for. The run keeps the plan in the handoff directory, where the trace and the interface already read it from.
5. Emit your `Report` JSON, declaring that path in `artifacts`.

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
