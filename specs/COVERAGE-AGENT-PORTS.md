# Refactor: the agent call is a port, so the activity around it can be tested

## Objective

`runtime/modules/use-cases/execute-agent.ts` is 0 percent of functions because calling it spawns a real coding agent: it reaches `piAgent.run`, real git, and the filesystem through module-scope imports. It gains a ports record with a live default, in the shape `gh-pull-request.ts` already uses, and the decision logic in it and in `agent-activity.ts` becomes testable without a spawn.

## 1. Requirements

### 1.1 The ports record

1.1.1 `execute-agent.ts` MUST declare an exported `TAgentPorts` type covering every side effect it performs: running the agent, reading changed and untracked paths, resolving the repository revision, writing prompt and envelope files, and snapshotting the working tree.

1.1.2 `execute-agent.ts` MUST export a `liveAgent` constant implementing `TAgentPorts` with the real adapters it imports today.

1.1.3 `executeAgent` and `callAgent` MUST each accept a `TAgentPorts` argument defaulting to `liveAgent`, placed last so that no existing call site changes.

1.1.4 The module MUST NOT call `piAgent.run`, `changedFiles`, `untrackedFiles`, `savePrompt`, `render`, `snapshotTree` or `rev` other than through the ports record.

1.1.5 `TRun` MUST NOT gain any field. The ports belong to the function that calls them.

1.1.6 Each port MUST be documented with a comment where the real implementation reads the process working directory rather than an argument, matching how `liveDelivery` documents the same hazard.

### 1.2 execute-agent tests

1.2.1 The JSON-repair loop MUST be tested: an agent reply that does not parse MUST be re-asked up to `JSON_FIX_ATTEMPTS` times, and the attempt count MUST be asserted.

1.2.2 The feedback block MUST be tested for the violations it renders and for its absence when there are none.

1.2.3 Path-policy arming MUST be tested: a refusal recorded by the policy MUST stop the call, and the refusal line MUST reach the caller.

1.2.4 The `changedPaths` decision MUST be tested for both branches — a caller that supplies them, and a caller that does not and gets the working tree's uncommitted and untracked paths instead.

1.2.5 `callAgent` MUST be tested for the throw it performs when the activity run is not of kind `agent`.

1.2.6 Permission enforcement and the observed-paths payload MUST each be covered by at least one test.

1.2.7 No test in this work MUST spawn a coding agent, a git subprocess, or any other child process.

### 1.3 agent-activity tests

1.3.1 A new `runtime/modules/use-cases/activities/agent-activity.test.ts` MUST exist.

1.3.2 The intake check MUST be tested: violations in the incoming context MUST throw before any agent call, and the thrown message MUST name the instance.

1.3.3 The `config.input === 'changes'` branch MUST be tested for both outcomes — changes captured, and no changes captured.

1.3.4 The `replay` path MUST be tested for a readable stored envelope and for the error message produced when the envelope cannot be read, neither of which needs a port at all.

1.3.5 The `execute` path MUST be tested through an injected `TAgentPorts` whose agent returns a prepared envelope.

### 1.4 Retiring the module mock

1.4.1 `runtime/modules/use-cases/activities/gh-pull-request.live.test.ts` MUST be rewritten to inject `TAgentPorts` rather than call `mock.module('../execute-agent', …)`.

1.4.2 After that rewrite, no test file under `runtime/modules/use-cases` MUST call `mock.module`.

1.4.3 The behaviours that file covers today — the live delivery path, the agent-call failure falling back to the trace-generated draft, and the attribution block — MUST still be covered.

### 1.5 Coverage and form

1.5.1 `execute-agent.ts` and `agent-activity.ts` MUST NOT appear in the `COVERAGE FAIL` list, whether by test coverage or, for any part that is pure process I/O, by the extraction and exclusion rules in [COVERAGE-GATE-POLICY.md](./COVERAGE-GATE-POLICY.md).

1.5.2 Every test added MUST name itself `given <module>::<subject>, when <condition>, it should <expectation>`.

1.5.3 Behaviour MUST NOT change. The prompts composed, the files written, the envelope returned, and the refusals raised MUST be identical with `liveAgent` in place.

## 2. Target state

The ports record, following `TDeliveryPorts` and `liveDelivery` in `runtime/modules/use-cases/activities/gh-pull-request.ts`:

```ts
export type TAgentPorts = Readonly<{
  run: (request: TPiRequest, hooks?: TPiHooks) => Promise<TPiResult>
  /** uncommitted paths; the real implementation reads the process cwd */
  changed: () => readonly string[]
  /** untracked paths; the real implementation reads the process cwd */
  untracked: () => readonly string[]
  rev: (ref: string) => string
  savePrompt: (dir: string, name: string, body: string) => string
  snapshot: (root: string) => TTreeSnapshot
}>

export const liveAgent: TAgentPorts = { /* the modules imported today */ }

export const executeAgent = async <TEnvelope extends TEnvelopeBase>(
  run: TRun,
  activityRun: TActivityRun,
  call: TAgentCall<TEnvelope>,
  ports: TAgentPorts = liveAgent,
): Promise<TEnvelope> => { /* unchanged body, calling ports */ }
```

Where this and the prose disagree about the shape of the seam, this governs; the member list is indicative and 1.1.1 governs its completeness.

## 3. Out of scope

- What any agent is asked. No prompt text, no system prompt, no skill routing changes.
- `runtime/modules/data/pi-agent.ts` and `pi-agent-run.ts`. This work calls `run` through a port; it does not touch the spawn.
- `runtime/modules/use-cases/run-activities.ts`, `revise-loop.ts` and `run-workflow.ts`. They are the next spec, and they will consume this seam.
- `enforce-permissions.ts`, `path-policy.ts` and `intake.ts`. They are already covered and are exercised here, not modified.
- The envelope schemas and the gate definitions.
- Widening `TRun`, which 1.1.5 forbids.

## 4. Work stages

| #   | Change                                           | Proven by                                                                                |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 1   | 1.1.1 through 1.1.6 — the ports record            | `bun run typecheck` exits 0                                                              |
| 2   | 1.5.3 — the live default changed nothing          | `bun run test:agent -- runtime` exits 0 or 3, never 1                                     |
| 3   | 1.3.1 through 1.3.5 — agent-activity tests        | `bun run test:agent -- runtime/modules/use-cases/activities` exits 0 or 3, never 1        |
| 4   | 1.2.1 through 1.2.7 — execute-agent tests         | `bun run test:agent -- runtime/modules/use-cases/execute-agent.test.ts` exits 0 or 3, never 1 |
| 5   | 1.4.1, 1.4.2, 1.4.3 — retire the module mock      | `grep -rl 'mock.module' runtime/modules/use-cases` prints nothing                          |
| 6   | 1.5.1 — both files leave the failing list         | `bun run test:agent -- runtime` prints neither file under `COVERAGE FAIL`                 |
| 7   | whole document — nothing else regressed           | `bun run test:agent` exits 0 or 3, never 1; `bun run typecheck` exits 0                   |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Exit 3 is expected while other specs are outstanding; exit 1 is never acceptable.

## 5. Rationale

`executeAgent(run, activityRun, call)` takes data and reaches for its dependencies through module-scope imports, so calling it once runs real git in the process working directory and spawns the `pi` binary. Nothing in the file can be reached by a test, which is why it reads 0 percent of functions and 4.93 percent of lines despite holding the JSON-repair loop, the path-policy arming, the permission enforcement and the inbox poll — four pieces of logic whose failure modes are the ones that matter.

The precedent is in the repository and is explicit about this exact gap. `gh-pull-request.live.test.ts` opens by recording that it reached for `mock.module` "because it is the only way to exercise … without changing `gh-pull-request.ts` to accept callAgent as an injected port — which is implementation work, not available to a test-only change." This document authorises that implementation work, which is why retiring the mock is part of it rather than a later tidy.

Ports on the function rather than fields on `TRun` is deliberate. `TRun` is passed through every layer and is faked with `as unknown as TRun` in several existing tests; adding adapters to it would make every one of those fakes larger and would give layers that never spawn an agent a handle on one.

The path policy is the strongest single argument for the seam. Its own comment says it is "the only check in this system that runs before the call instead of after it, which is the only way to answer for a secret — bytes that have been read cannot be unread." A protection that runs before every spawn and has never been executed by a test is a protection nobody has checked.

Rejected: widening the use of `mock.module`. bun shares one module registry across the suite, `mock.restore()` does not undo `mock.module`, and every existing use in this repository has to hand the real module back explicitly in an `afterAll`. That is a hazard to pay once for `node:fs`; paying it for the agent entry point, which half the use-case layer imports, would make test isolation a standing risk.
