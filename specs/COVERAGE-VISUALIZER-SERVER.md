# Feature: the visualizer server's database reads and spawns are tested

## Objective

`apps/visualizer/server/db.ts` and `apps/visualizer/server/writes.ts` are the two worst-covered files in the repository, and neither is hard to test — one needs a schema fixture nobody has built, the other needs its `spawn` passed in rather than imported. Both leave the `COVERAGE FAIL` list by the end of this work, and the argv a write action spawns becomes an assertion rather than a hope.

## 1. Requirements

### 1.1 A schema fixture

1.1.1 A test helper MUST exist that creates a temporary SQLite database carrying the real pi-crust schema and returns its path.

1.1.2 The helper MUST derive the schema from `runtime/modules/data/trace-db.ts`, which exports `SCHEMA` and `MIGRATIONS`, rather than restating the DDL.

1.1.3 The helper MUST apply `MIGRATIONS` as well as `SCHEMA`, so that a fixture database has the `sessions.archived` column that `setArchived` requires.

1.1.4 The helper MUST allow a test to insert `sessions`, `activity_runs` and `events` rows without writing raw SQL in each test.

1.1.5 Each test using the helper MUST create its database under a fresh temporary directory and MUST NOT write inside the repository.

### 1.2 db.ts

1.2.1 `PiCrustDb.usage` MUST be tested for: an `agent_end` payload counting input and cache-write tokens as read and output tokens as written; a payload whose JSON does not parse contributing nothing rather than throwing; and a payload carrying no `usage` key being skipped.

1.2.2 `PiCrustDb.setArchived` MUST be tested for: archiving a row, restoring it, returning false for a run id that does not exist, and throwing the stated error when the database predates the `archived` column.

1.2.3 The session, activity-run and event read methods of `PiCrustDb` MUST each be tested against a fixture database holding known rows.

1.2.4 `apps/visualizer/server/db.ts` MUST reach at least 90 percent functions and 90 percent lines, and MUST NOT appear in the `COVERAGE FAIL` list.

1.2.5 The existing tests of `resolveDbPath` MUST NOT be altered.

### 1.3 writes.ts

1.3.1 `startSteer`, `startConsult`, `resumeRun` and `startRun` MUST each accept the spawn function as a parameter with the real `spawn` as its default value, in the same shape as the `env` parameter those modules already use.

1.3.2 The injected parameter MUST be last in the signature, so that no existing call site changes.

1.3.3 Each of those four functions MUST be tested for the argv it builds, the `cwd` it runs in, the presence of `CRUST_DB` in the environment it passes, and `detached: true`.

1.3.4 `startSteer` MUST be tested for both branches it carries: the ordinary overwrite form and the `--branch` form with its seeding and branch-id arguments.

1.3.5 The existing refusal tests — the `NO_RUNTIME` path and the token check — MUST continue to pass unchanged.

1.3.6 `apps/visualizer/server/writes.ts` MUST reach at least 90 percent functions and 90 percent lines, and MUST NOT appear in the `COVERAGE FAIL` list.

1.3.7 No test in this work MUST spawn a real child process.

### 1.4 Test form

1.4.1 Every test added MUST name itself `given <module>::<subject>, when <condition>, it should <expectation>`, matching the tests already in these files.

1.4.2 Tests MUST NOT use `mock.module` to replace `node:child_process` or `bun:sqlite`; the fixture and the injected parameter exist so that they do not have to.

## 2. Target state

The injected spawn, following `crustRuntime`'s existing treatment of `env` in the same file:

```ts
export const startSteer = (
  dbPath: string,
  runId: string,
  activity: string,
  note: string,
  target: TSteerTarget,
  branchRunId?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  spawnChild: typeof spawn = spawn,
): TSteerResult => { /* unchanged body, calling spawnChild */ }
```

Where this signature and the prose disagree about parameter order, this governs; 1.3.2 governs the rule it illustrates.

## 3. Out of scope

- The behaviour of any of these functions. This work adds a seam and tests; it changes no argv, no refusal, no response shape.
- `apps/visualizer/server/handoff.ts`, `registry.ts`, `themes.ts`, `workspaces.ts` — all already above the threshold.
- The React components and the browser-driven layout tests.
- `runtime/modules/data/trace-db.ts`. It is read for its schema and not modified.
- The coverage threshold and the exclusion list. Exclusion is governed by [COVERAGE-GATE-POLICY.md](./COVERAGE-GATE-POLICY.md), and neither of these two modules qualifies: both are decision logic.

## 4. Work stages

| #   | Change                                                   | Proven by                                                                         |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | 1.1.1 through 1.1.5 — the schema fixture helper           | `bun run test:agent -- apps/visualizer/server` exits 0 or 3, never 1               |
| 2   | 1.2.1, 1.2.2, 1.2.3 — db.ts tests                         | `bun run test:agent -- apps/visualizer/server/db.test.ts` exits 0 or 3, never 1    |
| 3   | 1.3.1, 1.3.2 — inject spawn, call sites unchanged         | `bun run typecheck` exits 0                                                       |
| 4   | 1.3.3, 1.3.4, 1.3.5 — writes.ts tests                     | `bun run test:agent -- apps/visualizer/server/writes.test.ts` exits 0 or 3, never 1 |
| 5   | 1.2.4, 1.3.6 — both files leave the failing list          | `bun run test:agent -- apps/visualizer` prints neither file under `COVERAGE FAIL`  |
| 6   | whole document — nothing else regressed                   | `bun run test:agent` exits 0 or 3, never 1; `bun run typecheck` exits 0            |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Exit 3 is expected while other specs are outstanding; exit 1 is never acceptable.

## 5. Rationale

These two files are 62.96 and 38.46 percent of functions respectively, and they are the cheapest in the list to fix because nothing about them is structurally hard. `db.ts` is ordinary SQLite reads over a schema that already exists in `trace-db.ts`; the only reason it is untested is that nobody built a fixture, so `db.test.ts` tests the path resolver and stops.

`writes.ts` is the more valuable half. Its own comment records the defect that motivated the module: spawning a path that did not exist still returned a pid, the child died on a missing module, and the UI reported that the instruction went through. That is an argv bug, and an argv bug is exactly what an injected spawn makes assertable. Testing that the child *works* would require a real pi-crust runtime; testing that the right command is constructed requires only that `spawn` be a parameter.

Deriving the fixture from `SCHEMA` rather than writing the DDL in the test is the difference between a test that fails when the schema changes and one that passes against a schema the product no longer has. `apps/visualizer` is a separate package from `runtime`, so this is a cross-package import; that is accepted deliberately, because the alternative is a copy that drifts.

Rejected: `mock.module('bun:sqlite')`. The repository uses `mock.module` in four test files, all of them forcing `node:fs` to throw, and bun shares one module registry across the whole suite so each use has to be undone by hand. A real temporary database is simpler and proves more.
