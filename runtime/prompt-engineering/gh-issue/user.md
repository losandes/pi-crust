# Gh-Issue Task

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

Turn the chain that ran before you into exactly one GitHub issue a maintainer can act on.

1. Read `previous_envelope` and `previous_envelopes`, then list `{{context_handoff_dir}}` and read every document in it — `identify.md`, `diagnosis.md`, `plan.md`, and anything else that is there. The envelopes carry only the Activity immediately before this one; the handoff documents carry the whole chain, and they are what the issue body is made of.
2. Confirm the tooling before writing anything: `gh auth status` and `gh repo view --json nameWithOwner -q .nameWithOwner`. If either exits non-zero, write what was found to `{{output_document}}`, report `status: "fail"` with the command's stderr in `summary`, and stop.
3. If `{{output_document}}` already exists and records a created issue (a `## Filed` section with a URL), do not create another one. Correct the report instead.
4. Write the issue body to `{{output_document}}`.
   - **When the chain produced handoff documents, they are the body.** Copy each one into `{{output_document}}` verbatim, in the order the chain produced them, each under a `---\n> _Handoff: <activity>_\n---` heading naming where it came from (`---\n> _Handoff: Identify_\n---`, `---\n> _Handoff: Plan_\n---`, `---\n> _Handoff: Diagnose_\n---`). Do the copying with a shell concatenation (`cat`/`printf` appends into `{{output_document}}`) rather than retyping the text: retyping costs the document a second time in output tokens and is where wording drifts. Do not summarise, reword, shorten, reorder or re-level what an upstream Activity wrote — leave its own headings as they are. Exclude only your own `{{output_document}}` and any file that is envelope JSON rather than prose.
   - **Only when nothing ran before you** — `{{context_handoff_dir}}` holds no document but your own — do you write the issue yourself, in your own words from `{{prompt}}`: `## Outcome`, then `## Success criteria`, then `## Plan` if you have one.
   - Either way, the file ends with a provenance line naming the pi-crust run — the session directory name in `{{context_handoff_dir}}`.
5. Create the issue: `gh issue create --title "<title>" --body-file "{{output_document}}"`. The title is at most 80 characters and names the outcome, not the Activity. The title is yours to write even when the body is copied. No `--label`, `--assignee` or `--repo` flag.
6. Append a `## Filed` section to `{{output_document}}` with the URL, the number and `owner/name`, using a shell append rather than rewriting the file — re-emitting the body costs it a second time in output tokens and lets the two copies drift.
7. Emit your `Report` JSON.

## Report

Respond with ONLY valid JSON matching `GhIssueOutput` — no prose before or after:

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
  "summary": "<one sentence: what issue was opened and what it covers>",
  "issue_url": "https://github.com/<owner>/<name>/issues/<n>",
  "issue_number": 42,
  "repo": "<owner>/<name>",
  "artifacts": ["{{output_document}}"],
  "notes_for_next_agent": "<anything a maintainer reading the issue should also know>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

`issue_url`, `issue_number` and `repo` are REQUIRED and MUST agree with each other: `issue_number` is the URL's trailing number as a bare number (not a quoted string), and `repo` is the URL's `owner/name`. A reference that does not resolve is refused by the gate that reads this envelope — report `status: "fail"` rather than one that does not check out.

{{trust_stance}}
