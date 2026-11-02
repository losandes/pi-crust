# Feature: the coverage gate passes, and every exclusion in it is deliberate

## Objective

Nine files sit below the per-file coverage threshold, so `bun run test:agent` exits 3 on every run and the `COVERAGE FAIL` block has stopped being news. This epic owns no implementation: it names the five documents that close the gap, the order they run in, and the single condition that ends the work — `bun run test:agent` exits 0.

## 1. Requirements

### 1.1 Execution

1.1.1 Each child document named in section 2 MUST be executed as its own run, and that run MUST finish every stage in that document's own stage table.

1.1.2 The children MUST be executed in the order section 2 gives, because each later document depends on a seam or a policy an earlier one establishes.

1.1.3 A child document MUST NOT be started before the preceding one has been finished and its work merged.

1.1.4 No run MUST lower `coverageThreshold` in `bunfig.toml` to make a gate pass.

1.1.5 No run MUST add a path to `coveragePathIgnorePatterns` except under the policy stated in the first child document.

1.1.6 Every run MUST leave `bun run test:agent` exiting 0 or 3 and never 1: a coverage gap is expected while the work is in progress, a failing test is not.

### 1.2 Completion

1.2.1 When every child is finished, `bun run test:agent` MUST exit 0 with no `COVERAGE FAIL` block.

1.2.2 When every child is finished, `bun run typecheck` MUST exit 0.

1.2.3 When every child is finished, each executed document MUST be moved to `specs/completed/`.

1.2.4 This epic MUST NOT be executed as a run of its own. It is a sequencing document.

## 2. Target state

The five children, in execution order, with the files each one closes:

| Order | Document                                                        | Closes                                            |
| ----- | --------------------------------------------------------------- | ------------------------------------------------- |
| 1     | [COVERAGE-GATE-POLICY.md](./COVERAGE-GATE-POLICY.md)             | `pi-agent.ts`                                     |
| 2     | [COVERAGE-VISUALIZER-SERVER.md](./COVERAGE-VISUALIZER-SERVER.md) | `db.ts`, `writes.ts`                              |
| 3     | [COVERAGE-ASK-MENU.md](./COVERAGE-ASK-MENU.md)                   | `ask.ts`                                          |
| 4     | [COVERAGE-AGENT-PORTS.md](./COVERAGE-AGENT-PORTS.md)             | `execute-agent.ts`, `agent-activity.ts`           |
| 5     | [COVERAGE-WORKFLOW-DRIVERS.md](./COVERAGE-WORKFLOW-DRIVERS.md)   | `run-workflow.ts`, `revise-loop.ts`, `run-activities.ts` |

Where this table and any prose disagree about which document owns a file, this table governs.

The baseline those five documents start from, as reported today:

```text
COVERAGE FAIL 9 files below the minimum (functions 90.00%, lines 90.00%)
  apps/visualizer/server/db.ts functions 62.96%, lines 66.03%
  apps/visualizer/server/writes.ts functions 38.46%, lines 40.91%
  runtime/modules/data/ask.ts functions 22.22%, lines 15.92%
  runtime/modules/data/pi-agent.ts functions 83.33%, lines 63.78%
  runtime/modules/use-cases/activities/agent-activity.ts functions 14.29%, lines 33.04%
  runtime/modules/use-cases/execute-agent.ts functions 0.00%, lines 4.93%
  runtime/modules/use-cases/revise-loop.ts functions 77.27%, lines 25.08%
  runtime/modules/use-cases/run-activities.ts functions 90.57%, lines 78.30%
  runtime/modules/use-cases/run-workflow.ts functions 0.00%, lines 8.01%
```

## 3. Out of scope

- The value of `coverageThreshold`, forbidden to change by 1.1.4.
- The Biome lint backlog, which is issue 5 and has nothing to do with coverage.
- The `bin/` wrappers, the `package.json` scripts and the `.envrc` PATH entry, all settled.
- `runtime/temp.test.ts`, a deliberately failing local probe that is gitignored and MUST be left alone.
- Any new feature. Every child is tests, a seam, or an exclusion, and none of them changes what the product does.

## 4. Work stages

| #   | Change                                 | Proven by                                                              |
| --- | -------------------------------------- | ---------------------------------------------------------------------- |
| 1   | 1.1.2 — every child named here exists   | `ls specs/COVERAGE-GATE-POLICY.md specs/COVERAGE-VISUALIZER-SERVER.md specs/COVERAGE-ASK-MENU.md specs/COVERAGE-AGENT-PORTS.md specs/COVERAGE-WORKFLOW-DRIVERS.md` exits 0 |
| 2   | 1.2.1 — every file is covered or excluded | `bun run test:agent` exits 0                                           |
| 3   | 1.2.2 — nothing was broken to get there | `bun run typecheck` exits 0                                            |
| 4   | 1.2.3 — the executed documents are filed | `ls specs/completed` lists all five child documents                    |

These stages are the epic's own completion criteria, checked after the last child run finishes. They are not a run.

## 5. Rationale

The work splits into five documents because the seams are independent of each other and because one run cannot finish all of it. The split is by seam, not by file count: the gate policy decides what may be excluded at all, the visualizer work needs only a fixture and an injected `spawn`, the menu work is an extraction, the agent ports are the one real design change, and the drivers can only be tested once that change exists.

The order is forced in two places and free elsewhere. The gate policy comes first because three later documents need to know what an exclusion is allowed to mean, and the drivers come last because their tests settle where a real run would call an agent, which needs the ports record. The visualizer and menu documents are independent of everything and sit between them only to keep the sequence linear.

Forbidding a threshold change matters more than it looks. The threshold is per file, which is what makes the gate specific — a package at 96 percent overall still fails on one file at 40 percent, and that is the signal. Lowering it to pass turns nine named problems into one invisible one.

Rejected: one document for all nine files. It would not fit in a run, and a document an agent cannot finish is one that gets abandoned halfway with its stage table partly ticked, which reads like progress and is not.

Rejected: a document per file. The fixture, the ports record and the fake activity are each shared by several files, and splitting them apart would have two runs inventing the same seam differently.
