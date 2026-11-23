# Test Authoring Task

## Variables

### prompt

{{prompt}}

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

Write the tests that would prove the work described in `prompt` was done correctly, guided by `previous_envelope` if it carries a plan.

1. Find the identify output before anything else. It is in `<context_handoff_dir>/identify.md` when `identify` ran in this run; when it ran in an earlier one, its content might be copied into `prompt` or in a ticket the prompt references — a `## Success criteria` list, a `## Scenarios` section of Gherkin, or both. Read whichever you find and treat it exactly as you would the document: the criteria are numbered `SC<n>` and the scenarios are the cases you owe. If both are present and they disagree, the handoff document governs, and say in `unresolved` that the copy in `prompt` differs. If neither carries success criteria, say so in `facts` rather than inferring them from the request.
2. A `## Scenarios` section holds Gherkin written before anything was built, each `Scenario` tagged `@SC<n>` with the success criterion it refines. Those scenarios are the cases you owe: write one test per scenario, in this repository's own test style rather than in Gherkin, and name the criterion in the test name or a comment so a reviewer can trace it. They are stated in the vocabulary of whoever is affected, so translating a step into a call at the boundary is your job — changing what the step claims is not. Cover what the scenarios do not reach as well; they are a floor, not the whole suite.
3. Read enough of the code to know where the behaviour belongs and how its neighbours are tested.
4. Write the tests. Test files only — you may not modify implementation code.
5. Run them, and read which case you are in rather than assuming one. If the implementation is not there yet they will fail: that red is the work product, so report it and do not weaken them to make it go away. If the change has already been built they will pass, and a test that has passed from the moment it was written has not yet been shown to test anything — so for each test covering a reported defect, or guarding against its return, prove the red: revert or mutate the behaviour under test, confirm the test fails and that the failure names the cause rather than an import error, then restore it and re-run to confirm green before you report. Record what you reverted and what failed in `facts`. Leaving the implementation reverted fails the activity run, so restore it even if you abandon the attempt.
6. Emit your `Report` JSON.

### When a diagnosis came first

A bug-fix chain reaches you after a diagnosis, and its context may carry `reproducing_test` — the path to a test a diagnostician already wrote and already watched fail for the cause it found.

That test is evidence, not a draft. **Do not rewrite it, rename it, move it, or soften it.** It is the one artifact proving the bug exists, and a second test written from the same symptom either duplicates it or quietly contradicts it — and a contradiction here is a builder told two different things about what "fixed" means.

Read it, run it, and confirm it fails. Then write only what it does not already cover: the neighbouring cases that must keep working, and the behaviour the fix must not break. If it does NOT fail, say so plainly in `unresolved` with `consequential: true` — a reproduction that has stopped reproducing means the diagnosis, the test, or the working tree is not what somebody thought, and no amount of new tests settles which.

When `reproducing_test` is empty, the diagnosis said a test could not exist and gave its reason. Believe it, and do not invent one that passes today to fill the gap.

## Report

Respond with ONLY valid JSON matching `BuildOutput` — no prose before or after:

**`changed_files` takes literal paths only.** Every entry is checked against the filesystem exactly as written, so a glob fails the gate no matter how many files it would have matched. Enumerate every file you wrote.

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
  "summary": "<one sentence: what these tests prove, whether they currently pass, and what established they can fail>",
  "changed_files": ["<the test file you wrote>"],
  "artifacts": [],
  "disputes": [],
  "commit_message": "<imperative one-line git subject for the tests you wrote>",
  "notes_for_next_agent": "<what the builder must make true for these to pass>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

{{trust_stance}}
