# Fix: a retried Activity must not fail the run that retried it

## Objective

A run whose every Activity ultimately succeeded is reported `success`, whether or not one of them needed a second attempt to get there. A run reported `fail` always records which activity runs made it fail and why, so the reason is readable from the trace rather than inferred from it. The verdict is computed from the run's recorded activity runs rather than from the subset the finishing process happened to create, so a resumed run and an uninterrupted one judge the same facts.

This changes how the final verdict is computed and what a failure records. It does not change gate retries, steering, acceptance, resume, or what any Activity does.

## 1. Requirements

### 1.1 Superseded attempts do not count against the run

1.1.1 `finish` in `runtime/modules/use-cases/run-activity-run.ts` MUST compute its activity-run verdict over activity runs whose status is not `superseded`. A superseded row is an attempt that was explicitly replaced by a later attempt that did run; counting it is counting the same Activity twice and taking the worse answer.

1.1.2 Every remaining activity run MUST still be `success` for the verdict to be positive. A row with status `fail` MUST keep failing the run, exactly as today.

1.1.3 A run whose activity runs are all superseded MUST NOT be reported `success`. The present guard that an empty list is not a success MUST apply to the filtered list.

1.1.4 The predicate that decides whether an activity run counts MUST exist once and be imported by both callers. `runtime/modules/use-cases/run-workflow.ts` already filters `activityRun.status !== 'superseded'` when deciding what to replay; a second copy of that rule in `finish` is a rule that drifts.

### 1.2 The verdict judges the run, not the process

1.2.1 `finish` MUST judge the activity runs recorded for the run, read through the tracer, rather than only those held in the in-memory list that `createRun` accumulates.

1.2.2 The consequence MUST be accepted deliberately: a resumed process will see activity runs created by earlier processes, which it does not today. A run finished by a resume therefore reports on the whole run rather than on its last leg.

1.2.3 Where the recorded rows and the in-memory rows disagree, the recorded rows MUST govern. The trace is what the reporter, the visualizer and `--resume` all read.

### 1.3 A failed run says why

1.3.1 When the activity-run verdict is negative, `finish` MUST write an `error` event naming each activity run that was neither `success` nor `superseded`, with its status. Today that branch writes nothing at all: the `not_accepted` event and its console note sit inside the acceptance branch, so a run that fails on activity-run status alone ends with no recorded reason.

1.3.2 When acceptance is negative, the existing `not_accepted` event MUST continue to be written.

1.3.3 When both are negative, both reasons MUST be recorded. A reader MUST NOT have to discover the second one after fixing the first.

1.3.4 The console note printed on failure MUST name the same thing the event names.

### 1.4 The count agrees with the verdict

1.4.1 The session-finished line in `runtime/modules/use-cases/report-to-console.ts` MUST count the activity runs the verdict counted. It printed `session 867e452d fail · 9/9 activityRuns`, where nine of nine is a count of rows and the failure is a count of statuses, so the sentence contradicts itself.

1.4.2 A run containing a superseded attempt MUST report a total that excludes it, so `9/9 … fail` becomes `8/8 … success` for the run in 1.4.1.

### 1.5 Tests

1.5.1 A test MUST show a run of one superseded activity run followed by a successful retry of the same Activity reported `success`.

1.5.2 A test MUST show a run containing an activity run with status `fail` reported `fail`, with an event naming that activity run and its status.

1.5.3 A test MUST show a run whose activity runs are all superseded reported `fail`.

1.5.4 A test MUST show that a `finish` running in a process that recorded none of the run's activity runs still judges them, covering 1.2.1.

1.5.5 A test MUST show that a run which is both unaccepted and holds a failed activity run records both reasons, covering 1.3.3.

## 2. Target state

The verdict, stated once. Where this and the prose in section 1 disagree, section 1 governs.

```ts
/**
 * Does this activity run count towards the run's verdict?
 *
 * A superseded row is an attempt that a later attempt replaced — a gate
 * retry, or a steer. It stays in the trace because what it decided is worth
 * reading; it stops counting because the Activity it belongs to was run
 * again, and the later row is the answer.
 */
export const counts = (activityRun: TActivityRun): boolean =>
  activityRun.status !== 'superseded'

const judged = run.tracer.activityRunsFor(run.runId).filter(counts)
const activityRunsOk =
  judged.length > 0 && judged.every((activityRun) => activityRun.status === 'success')
```

## 3. Out of scope

- **Gate retries.** `run-activities.ts` marking a replaced attempt `superseded` is correct and is not changed. This spec changes who reads that status, not who writes it.
- **Steering.** `runtime/steer.ts` marks rows `superseded` directly in the database to make a replay happen. That mechanism is unchanged, and 1.2.1 is what makes its rows visible to the verdict.
- **Acceptance.** What makes a run accepted — the trailing reviews and `acceptedExcluding` — is untouched. Only the reporting of a negative result changes.
- **Commit failures.** A commit git cannot complete is reported as an `uncommitted` warning and does not end a run. That is settled by `deliver.ts` and by commit `5234dd4`, and it is not revisited here, even though it is what left run `867e452d`'s work in the working tree.
- **`--resume` and `readRunState`.** What a resumed run replays is decided elsewhere and does not change. 1.2.1 changes what the final verdict reads, not what resume skips.
- **The visualizer.** How a failed session is drawn is not part of this work, beyond its reading the events 1.3.1 adds.
- **The activity-run status vocabulary.** `success`, `fail`, `superseded` and the rest keep their present meanings; no status is added or renamed.

## 4. Work stages

| #   | Change                                                                  | Proven by                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 1.1.1–1.1.4, 2 — the shared predicate, and `finish` filtering by it     | `cd runtime && bun test modules/use-cases/run-activity-run.test.ts`                                                                                                                                                                                                                                                  |
| 2   | 1.2.1–1.2.3, 1.5.4 — the verdict reads the run's recorded activity runs | `cd runtime && bun test && bun x tsc --noEmit`                                                                                                                                                                                                                                                                       |
| 3   | 1.3.1–1.3.4, 1.5.5 — a failure records what failed                      | `cd runtime && bun test modules/use-cases/run-activity-run.test.ts`                                                                                                                                                                                                                                                  |
| 4   | 1.4.1, 1.4.2 — the count agrees with the verdict                        | `cd runtime && bun test modules/use-cases/report-to-console.test.ts`                                                                                                                                                                                                                                                 |
| 5   | 1.5.1–1.5.3 — the three verdict cases                                   | `cd runtime && bun test`                                                                                                                                                                                                                                                                                             |
| 6   | Whole-repository verification                                           | `(cd runtime && bun test && bun x tsc --noEmit)`; `(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)`                                                                                                                                                                                       |
| 7   | The historical runs are re-read and agree with the new rule             | `sqlite3 -readonly .pi-crust/data/crust.db "select s.run_id, s.status, group_concat(a.status) from sessions s join activity_runs a on a.run_id=s.run_id where a.status='superseded' group by s.run_id;"` shows no run whose non-superseded rows are all `success` still marked `fail` after a re-run of the reporter |

Stage 1 lands before stage 2 because the filter is what makes reading more rows safe: widening the source before narrowing the predicate would make a resumed run fail on attempts its predecessor already replaced.

## 5. Rationale

**The run that prompted this.** `867e452d` implemented [FIX-DISABLE-SUBAGENTS.md](../completed/FIX-DISABLE-SUBAGENTS.md) and was reported `fail`. Its nine activity runs are eight `success` and one `superseded`: `867e452d_03_build` failed its `checks` gate on Biome lint, was retried as `867e452d_04_build`, and the retry passed. Both final reviews approved — `867e452d_08_outcome-review` and `867e452d_09_code-review` both hold `approved = 1` — and the run recorded no `error` event of any kind. The sole cause of the failure was `every(status === 'success')` meeting a row that said `superseded`.

**Why it was unreadable.** `finish` records a reason only in the acceptance branch. A run that fails on activity-run status writes no event, prints no note, and ends. The console line it does print, `session 867e452d fail · 9/9 activityRuns`, counts rows one way and statuses another, so the only visible evidence contradicts itself.

**Why the verdict must read the trace.** Run `b6f8f617` has the identical shape — a superseded `03_build`, a successful `04_build`, the same gate-retry note — and is recorded `success`. Its final line reads `success · 2/2 activityRuns`: it was finished by a later process whose in-memory list held only the two activity runs it created, so the superseded row was never counted. The same facts therefore produce opposite verdicts depending on whether the run was resumed, which is not a rule anybody can reason about.

**Why superseded is the right thing to discard rather than to treat as success.** A superseded row is not a success and should not be recoloured as one; its gate violations are real and worth reading. It is simply not the Activity's answer. Discarding it from the verdict while leaving it in the trace keeps both facts true, and it is already the rule `run-workflow.ts` applies when deciding what to replay.

**Rejected: treating any run with a retry as failed, deliberately.** An argument exists that a run needing a second attempt is a run worth looking at. It is rejected because the retry budget is a declared feature of an Activity — `attempts` — and a mechanism that spends its budget successfully has done what it was configured to do. A run that exhausts the budget already fails, through the `fail` status that `run-activities.ts` writes when no attempts remain.

**Rejected: leaving the verdict on the in-memory list and only fixing the filter.** That would make `867e452d` report correctly and leave the resume inconsistency in place, so the next person comparing two runs with the same shape would find the same contradiction and no explanation for it.
