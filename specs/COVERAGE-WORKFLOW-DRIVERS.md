# Feature: the workflow drivers are tested through fake activities

## Objective

`run-workflow.ts`, `revise-loop.ts` and `run-activities.ts` are the three drivers a run passes through, and their pure helpers are tested while the drivers themselves are not. With the agent behind a port, a driver can be run end to end against activities that settle without spawning anything, and the loop decisions that decide whether a run is accepted become assertions.

## 1. Requirements

### 1.1 run-workflow

1.1.1 `spentAlready`, `pinBaseline` and `runPlannedChain`, currently private to `runtime/modules/use-cases/run-workflow.ts`, MUST be exported so they can be tested individually.

1.1.2 `spentAlready` MUST be tested for a run id with prior spend and for one with none.

1.1.3 `pinBaseline` MUST be tested for a repository at a known revision and for a path that is not a repository.

1.1.4 Terminal-activity removal MUST be tested: a plan naming a terminal Activity MUST fold without it, and the terminal MUST still be built for the run.

1.1.5 Agent validation MUST be tested: a plan requiring an agent the configuration does not define MUST fail before anything runs, and the message MUST name the missing agent.

1.1.6 `runWorkflow` MUST be covered by at least one test that drives a complete plan of fake activities and asserts the exit code and the recorded run state.

1.1.7 `run-workflow.ts` MUST NOT appear in the `COVERAGE FAIL` list.

### 1.2 revise-loop

1.2.1 `runReviseLoop` MUST be tested for the `not-applicable` settlement when no trailing review group exists and when no reviser is configured.

1.2.2 `runReviseLoop` MUST be tested for a round that reaches acceptance and for one that exhausts the attempt ledger, asserting the `TLoopOutcome` in each case.

1.2.3 The dispute report MUST be tested: a loop that ends unaccepted MUST write `REPORT_FILENAME` and the written content MUST name the rounds.

1.2.4 `revise-loop.ts` MUST NOT appear in the `COVERAGE FAIL` list.

### 1.3 run-activities

1.3.1 `runUnits` MUST be tested for: an activity that settles accepted, one that fails a gate and retries within its attempt limit, one that exhausts its attempts, and one that raises a human gate and records the waiting reason.

1.3.2 The regression path MUST be tested: an activity whose envelope reports a regression MUST produce the recorded verdict and note.

1.3.3 The unexpected-paths warning MUST be tested for an activity touching a path no claim covers.

1.3.4 The existing `judgeGates` and `recordRequest` tests MUST continue to pass unchanged.

1.3.5 `run-activities.ts` MUST NOT appear in the `COVERAGE FAIL` list.

### 1.4 The fake activity helper

1.4.1 A shared test helper MUST exist that builds a `TActivity` settling with a prepared envelope, without reaching `callAgent`.

1.4.2 The helper MUST allow a test to control, per attempt, whether the activity succeeds, fails a gate, or throws.

1.4.3 The helper MUST build the accompanying `TRun` with a real tracer writing to a temporary database, so that what the driver records is assertable rather than mocked.

1.4.4 No test in this work MUST spawn a coding agent or any other child process.

### 1.5 Form

1.5.1 Every test added MUST name itself `given <module>::<subject>, when <condition>, it should <expectation>`.

1.5.2 Behaviour MUST NOT change in any of the three drivers. Exports are added; logic is not rewritten.

1.5.3 Tests MUST NOT use `mock.module`.

## 2. Target state

The fake activity, built once and reused by all three drivers' tests:

```ts
// runtime/modules/testing/fake-activity.ts
export type TAttemptOutcome =
  | Readonly<{ kind: 'accepted'; envelope: TEnvelopeBase }>
  | Readonly<{ kind: 'violates'; violations: readonly string[] }>
  | Readonly<{ kind: 'throws'; message: string }>

export const fakeActivity = (
  name: string,
  outcomes: readonly TAttemptOutcome[],
): TActivity => { /* settles from outcomes, one per attempt, no agent */ }

export const runWithTracer = (
  dir: string,
  cfg: TPiCrustConfig,
): TRun => { /* a real tracer over a temporary database */ }
```

Where this and the prose disagree about the helper's shape, this governs.

## 3. Out of scope

- `execute-agent.ts` and `agent-activity.ts`. Their ports and tests are [COVERAGE-AGENT-PORTS.md](./COVERAGE-AGENT-PORTS.md), which MUST be finished before this document is started.
- The semantics of any gate, lifecycle, or attempt limit. This work asserts what they already do.
- `runtime/modules/use-cases/attempts.ts`, `dispute-ledger.ts`, `deliver.ts` and `human-gate.ts`, all already covered.
- The trace schema.
- The coverage threshold and the exclusion list.

## 4. Work stages

| #   | Change                                      | Proven by                                                                            |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | 1.4.1, 1.4.2, 1.4.3 — the fake activity      | `bun run typecheck` exits 0                                                          |
| 2   | 1.3.1, 1.3.2, 1.3.3, 1.3.4 — run-activities  | `bun run test:agent -- runtime/modules/use-cases/run-activities.test.ts` exits 0 or 3, never 1 |
| 3   | 1.2.1, 1.2.2, 1.2.3 — revise-loop            | `bun run test:agent -- runtime/modules/use-cases/revise-loop.test.ts` exits 0 or 3, never 1 |
| 4   | 1.1.1 through 1.1.6 — run-workflow           | `bun run test:agent -- runtime/modules/use-cases/run-workflow.test.ts` exits 0 or 3, never 1 |
| 5   | 1.1.7, 1.2.4, 1.3.5 — all three leave the list | `bun run test:agent -- runtime` prints none of the three under `COVERAGE FAIL`        |
| 6   | whole document — nothing else regressed      | `bun run test:agent` exits 0; `bun run typecheck` exits 0                             |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. This is the last coverage document, so stage 6 requires exit 0: with every other spec finished, no file remains below the threshold and unexcluded.

## 5. Rationale

The shape of the gap is the same in all three files and is visible in the numbers: `revise-loop.ts` reads 77 percent of functions against 25 percent of lines, because its helpers — `trailingReviews`, `loopApplies`, `reviserFor`, `outcomeReason`, `groupApproved` — are small, pure and tested, while `runReviseLoop` is large and never entered. `run-activities.ts` is 90 percent of functions against 78 percent of lines for the same reason. `run-workflow.ts` is 0 percent of functions because it is a composition root with no test file at all.

Testing a driver is worth more than testing its helpers, and the repository already has the argument written down. `run-activities.judge-gates-wiring.test.ts` exists because "the gate's logic is correct in isolation, but its only production caller is `judgeGates`, which decides what `gate.check`'s third argument actually is" — a regression rewiring the caller would pass every unit test of the callee. Every decision in these three drivers has that property: the attempt ledger, the retry, the human gate, the loop's acceptance rule.

Exporting the three private helpers in `run-workflow.ts` is the smallest change that makes the composition root checkable without pretending the root itself can be unit tested. `runWorkflow` loads configuration, validates agents, folds stages, runs the loop and finishes the run; a test asserting all of that is a second implementation. One end-to-end test over fake activities, plus direct tests of the pieces, is the honest division.

A real tracer over a temporary database rather than a stubbed one is deliberate: what these drivers do that matters is *record* things — attempt counts, waiting reasons, regression verdicts, warnings — and a stub asserts that the driver called a function, while a real trace asserts what a resume would later read.

This document is ordered last because its fake activities settle where a real run would call the agent, and the seam that makes that possible is the ports record from the agent-ports spec. Attempting it first would reproduce that seam badly, in test code, and then have to unpick it.
