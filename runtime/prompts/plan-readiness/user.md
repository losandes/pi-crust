# Plan Readiness Task

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

The plan is at `{{context_handoff_dir}}/plan.md`. If it does not exist or is empty, report `status: "fail"` and say in `notes_for_next_agent` that the planning stage must supply it. Do not review the request in its place.

## Task

Rule on whether `{{context_handoff_dir}}/plan.md` can be executed by a builder who decides nothing.

1. Read the plan in full, then read `prompt` — the request the plan answers — and `previous_envelopes`, which carries what the Activities before the planner established. A plan that is executable but answers a different request is blocking.
2. Audit every step for decisions left to the builder, for the repository-relative paths it will create, modify or delete, and for what proves each step is done. Cite the heading or line of each finding.
3. Verify what the plan claims about this repository, within the bounds your instructions set. Open the files it names, confirm the symbols, commands and configuration it depends on, and record what you checked and how in `facts`, with the `path:line` you read. A claim you could not verify is an assumption, not a finding.
4. Check that each phase of the plan leaves the repository in a state some command can pass, and that the commands the plan names exist in this repository. Confirm a command exists by listing the task or the script. Run one only when a step's proof depends on it passing on the unchanged tree, and then run its narrowest form — the named test file, or the named checker on the named paths. Do not run repository-wide gates.
5. If `previous_envelope` carries `disputes`, answer each one before you rule. Check the evidence it cites. Then either withdraw the finding, or restate it with **new** evidence. Repeating a disputed finding with the same evidence ends the loop and sends it to the developer — the harness counts that, not you.
6. Write the review to `{{output_document}}` as a short list: each blocking finding with its severity and citations, then the nits. Do not restate the facts, assumptions or risks your Report carries. Write it once and do not lint or reformat it. Then emit your `Report` JSON.

Do not rule on whether the plan reads well. Another reviewer has the same document open and owns that.

Give every finding a `severity` of `blocker`, `major` or `nit`. The blockers and the majors — and only those — go in `blocking`.

`findings` holds only those unmet blockers and majors, each with `met: false`. A requirement the plan satisfies is not a finding; record what you verified in `facts`. When nothing blocks, `findings` and `blocking` are both `[]`.

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
  "objective_met": { "met": true, "evidence": "how you know you did your job" },
  "status": "success",
  "approved": false,
  "summary": "<one sentence: N blocking findings, and what you verified against the repository>",
  "findings": [
    { "requirement": "<the bar, as your instructions state it>", "met": false, "severity": "major", "evidence": "plan.md:<line> names <path:line>, which does not exist" }
  ],
  "blocking": ["<what the plan must say, naming the step it is missing from>"],
  "artifacts": ["{{output_document}}"],
  "notes_for_next_agent": "<what the planner must change, and what you noticed that does not block>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

`status` is `success` when the review itself completed — it is not the verdict. The verdict is `approved`, and it is true only when `blocking` is empty and no finding is unmet. A plan you could not read is `status: "fail"`, not a rejection.

{{trust_stance}}
