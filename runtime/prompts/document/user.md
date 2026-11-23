# Document Task

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

Document the completed work described by `previous_envelope`, using `prompt` for what was originally asked.

1. Read the full diff at `previous_envelope.diff_path`, plus any changed file that needs context.
2. Write the write-up to `{{output_document}}`. Cover: what changed and why it matters, the files that carry it, and how to use or verify it.
3. Copy that file into the repo under `app_docs/`:
   - **List `app_docs/` before you pick the name.** A session that documents more than once reuses its `<run_id>`, so the obvious name may already be taken.
   - Base name: `app_docs/<run_id>_<slug>.md`, where `<run_id>` is the session directory name inside `context_handoff_dir` (`.../sessions/<run_id>/context_handoff`) and `<slug>` is two to four kebab-case words naming the work.
   - If a file with that name already exists, use `app_docs/<run_id>_<slug>_v2.md`, then `_v3`, and so on until the name is free. **Never overwrite an existing write-up** — it describes a change that already shipped.
   - **Copy it, do not retype it.** One bash call does the whole step: `mkdir -p app_docs && cp "{{output_document}}" "app_docs/<run_id>_<slug>.md"` Writing the document a second time through `write` re-emits every line you already wrote, which costs the whole write-up again in output tokens and lets the two copies drift.
4. Emit your `Report` JSON, declaring BOTH paths in `artifacts`.

## Report

Respond with ONLY valid JSON matching `DocumentOutput` — no prose before or after:

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
  "summary": "<one sentence describing what you documented>",
  "document_path": "app_docs/<run_id>_<slug>.md",
  "documented_files": ["<a path the diff touched>"],
  "artifacts": ["{{output_document}}", "app_docs/<run_id>_<slug>.md"],
  "commit_message": "<imperative one-line git subject for committing THIS WRITE-UP, not the change it describes — e.g. 'Document the /health endpoint'>",
  "notes_for_next_agent": "<anything the diff left unexplained>"
}
```

The six context fields are REQUIRED on every report, and `[]` is a legitimate answer to any of the five lists — but it is an answer, not a default. Say what you established and how you know; say what you chose and why; say what you believed without checking and what would disprove it. `consequential: true` on an unresolved question means a later stage would have to invent the answer rather than guess it — it marks what a person should read afterwards, and at most trust levels it does not by itself stop the run.

`beyond_this_run` is a separate judgement, and it is narrow: would acting on your answer reach outside what discarding this run's output would undo — a push, a deploy, a migration against real data, spend, an external side effect. Designing a schema is not beyond this run; applying it is. Importance is not the test, and neither is how costly the eventual artifact would be to change.

`provisional_answer` is what you would do if nobody answered. Give one even when the question is consequential: "I have no idea" and "I would do X, but confirm it" are different reports, and only the second lets a reader judge what the guess cost.

Do not pad them. One real assumption beats six restatements of the task.

`regress_to` is how you send the run BACKWARDS when evidence has invalidated earlier work. `{ "activity": "", "because": "" }` means no regression and is the ordinary answer. Name an activity only when continuing would mean compensating for something that is now wrong — and name the EARLIEST activity affected, not the one before you. `because` carries the evidence, not an opinion. An activity can be returned to once; the second request goes to the developer instead.

`document_path` and the `app_docs/` entry in `artifacts` are the path you ACTUALLY wrote, `_v2` suffix and all. Gates open these files — a name you meant to use fails them.

{{trust_stance}}
