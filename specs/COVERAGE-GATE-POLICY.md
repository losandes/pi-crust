# Refactor: the coverage gate names a deliberate exclusion rather than a backlog

## Objective

Every file the coverage gate reports is a file somebody intends to cover. A module that cannot be covered because it is a process boundary is extracted so that the boundary alone is excluded, by name, with the reason beside it. `runtime/modules/data/pi-agent.ts` is the first such module, and the policy this establishes is what the later coverage specs apply.

## 1. Requirements

### 1.1 The exclusion policy

1.1.1 `bunfig.toml`'s `coveragePathIgnorePatterns` MUST list only modules that perform process-boundary I/O and hold no decision logic of their own.

1.1.2 Every path added to `coveragePathIgnorePatterns` MUST carry a comment in `bunfig.toml`, on the line above it, naming what the module does that no `bun test` process can execute.

1.1.3 Every excluded module MUST carry a comment at the top of the file stating that it is excluded from coverage and what was moved out of it so the remainder could be covered.

1.1.4 A module MUST NOT be excluded merely because covering it is difficult, slow, or unfinished. Difficulty is a reason to write the test; a spawn, a raw-mode TTY, or a real network call is a reason to extract and exclude.

1.1.5 Code moved into an excluded module MUST be limited to the I/O call itself and the argument marshalling the call cannot be separated from. Branching that decides *what* to do MUST remain in a covered module.

### 1.2 pi-agent

1.2.1 The `run` function currently in `runtime/modules/data/pi-agent.ts` MUST move to a new module `runtime/modules/data/pi-agent-run.ts`, which spawns the `pi` child process and folds its stream.

1.2.2 `runtime/modules/data/pi-agent.ts` MUST re-export `run` so that every existing importer compiles unchanged.

1.2.3 `buildArgv`, `resolveModel`, `contextWindow`, `foldMessageEnd`, `piCatalog`, `textOf`, `toolLabel`, `createToolCallTracker`, `createNarrationTracker`, and every other function presently in `pi-agent.ts` MUST remain there.

1.2.4 `runtime/modules/data/pi-agent-run.ts` MUST be added to `coveragePathIgnorePatterns` under the rules in 1.1.1 through 1.1.5.

1.2.5 `runtime/modules/data/pi-agent.ts` MUST reach at least 90 percent functions and 90 percent lines once `run` has moved, and MUST NOT appear in the `COVERAGE FAIL` list.

1.2.6 Behaviour MUST NOT change: the argv built, the environment passed, the stdin command channel, and the `TPiResult` returned MUST be identical to what the current `run` produces.

### 1.3 Documentation

1.3.1 `AGENTS.md` MUST state the exclusion policy in the Verification section, in one paragraph, including that an exclusion is a claim about the module's nature rather than about the state of its tests.

1.3.2 `AGENTS.md` MUST NOT be reorganised, and its existing paragraphs about the silent coverage failure, the per-file threshold, and the stdout-noise check MUST survive unchanged.

## 2. Target state

`bunfig.toml`, in the form every later exclusion follows:

```toml
coveragePathIgnorePatterns = [
  # Browser-driven layout measurement; needs real Chromium, not happy-dom.
  "apps/visualizer/src/components/SessionCard.layout.test.ts",
  "apps/visualizer/src/components/ActivityRunDetail.layout.test.ts",
  "apps/visualizer/src/components/ThemePicker.interaction.test.ts",
  # Spawns the pi binary and folds its stream; no bun test process can run it.
  "runtime/modules/data/pi-agent-run.ts"
]
```

Where this table and the prose in section 1 disagree, this table governs the shape and section 1 governs the rules.

## 3. Out of scope

- The value of `coverageThreshold`. It stays where it is.
- Any other module in the `COVERAGE FAIL` list. Each has its own spec.
- The behaviour of `run` itself. This is a move, and a move is a move: no signature change, no refactor in passing, no tidying of the comments it carries.
- `runtime/modules/data/pi-host.ts` and the rest of `modules/data`.
- The `bin/` wrappers and the `package.json` scripts.

## 4. Work stages

| #   | Change                                                              | Proven by                                                                         |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | 1.2.1, 1.2.2, 1.2.3 — move `run` to `pi-agent-run.ts`, re-export it | `bun run typecheck` exits 0                                                       |
| 2   | 1.2.6 — prove the move changed nothing                              | `bun run test:agent -- runtime/modules/data` exits 0 or 3, never 1                 |
| 3   | 1.1.1, 1.1.2, 1.1.3, 1.2.4 — exclude the new module, with reasons   | `grep -A1 'pi-agent-run' bunfig.toml` shows the comment above the path             |
| 4   | 1.2.5 — pi-agent.ts leaves the failing list                         | `bun run test:agent -- runtime` prints no `pi-agent.ts` line under `COVERAGE FAIL` |
| 5   | 1.3.1, 1.3.2 — record the policy                                    | `grep -c 'coveragePathIgnorePatterns' AGENTS.md` is at least 1                     |
| 6   | whole document — nothing else regressed                             | `bun run test:agent` exits 0 or 3, never 1; `bun run typecheck` exits 0            |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Exit 3 is expected until every coverage spec is finished; exit 1 is never acceptable.

## 5. Rationale

`bun test --coverage` applies `coverageThreshold` per file and exits non-zero having printed nothing at all. The repository's `bin/` wrappers pipe bun through `buntap`, which prints a `COVERAGE FAIL` block naming each file below the line. That block is only useful while every name in it is a surprise. Nine files are in it today, several of which nobody intends to cover, and a list that is mostly expected teaches the reader to skip it.

Excluding a path by name with the reason beside it says the opposite of lowering a threshold. A threshold decides how much untested code is tolerable everywhere; an exclusion says this specific module is a process boundary and its logic lives somewhere a test can reach. The second is auditable and the first is not.

`pi-agent.ts` is the clearest case. It already reads 83 percent functions against 63 percent lines because its pure half — argv construction, model resolution, the usage and narration folds — was separated long ago and is tested. The only remaining gap is the single function that calls `Bun.spawn` and reads the child's stream, which no test process can exercise without a real `pi` on the machine and a real model behind it.

Rejected: mocking `Bun.spawn` to drive a fake child. It would raise the number without raising the confidence, because what the test then proves is that the fake behaves as the fake was written. The repository already has a precedent for the opposite instinct — `gh-pull-request.ts` separates `TDeliveryPorts` from `liveDelivery` so the decisions are tested and the `spawnSync` is not.

Rejected: leaving `run` where it is and excluding all of `pi-agent.ts`. That would exclude roughly 600 lines of covered, decision-carrying code to avoid 140 lines of I/O, and the next person adding a pure helper to the file would silently lose coverage of it.
