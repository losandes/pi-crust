# Create a Workflow

Compose a new workflow script — a thin, deterministic TypeScript workflow over agents already in the config. Design the chain first, then generate or hand-write it.

## Step 1 — Design the chain

Answer four questions, in order:

1. **What agents, in what order?** Pick from the roster (`.pi-crust/config/crust.config.yaml`). The starter six cover most chains:

| Agent | Use when | Output type | Typical gates |
|---|---|---|---|
| `scout` | you need to FIND something first — read-only recon | `scoutOutput` | `artifactsExist` |
| `planner` | the work needs a plan before code changes | `planOutput` | `artifactsExist`, `filesNonEmpty` |
| `builder` | code must change | `buildOutput` | `diffMatchesClaims`, `disputesSupported` |
| `builder`, revising | a review said no: fix each blocking finding, or dispute it with evidence | `buildOutput` | `diffMatchesClaims`, `disputesSupported` |
| `reviewer` | the change must be confirmed to BE what was asked for | `reviewOutput` | `artifactsExist`, `verdictConsistent` |
| `tester` | the change needs tests WRITTEN — judgement, so an agent; it may write test files only | `buildOutput` | `diffMatchesClaims` |
| *(no test-runner agent)* | RUNNING the suite is the `verify` step: a `kind: 'code'` phase over the commands `routing.checks` declares | `TQualityResult` → `asEnvelope` | the exit code is the check |
| `code-reviewer` | the change must be judged against this repository's conventions, which it loads from `routing.skills` | `reviewOutput` | `artifactsExist`, `verdictConsistent` |
| `documenter` | finished work needs a write-up (runs after a build, off the diff) | `documentOutput` | `artifactsExist`, `filesNonEmpty` |
| any agent, generic ask | one-off prompt, no special shape | `genericOutput` | as needed |

   A new kind of agent needs a config entry + prompt pair + output type first — see `update_config.md`.

   **The suite and the reviewer answer different questions.** "Does it run" is a test, and code can ask that. "Is this the thing that was asked for" is a review, and only an agent can. A green suite over a feature nobody requested is still a failed request, and neither one covers for the other.

2. **Where does code act?** Git branch/commit, migrations, deploys each get their own `kind: 'code'` phase — never buried inside an agent phase.

   **Running the suite is one of these — the `tester` agent WRITES tests, it does not run them.** The commands are declared in `routing.checks`, so a `kind: 'code'` phase runs them (`runVerification(run, paths)` → `verificationEnvelope(result, paths.length)` back into the builder) and the bounded repair loop is unchanged. An agent rediscovering `bun test` on every run buys nothing a subprocess does not already know. Capturing what changed is one of these: `captureChanges(run, changeCapture({ base: 'main' }))` diffs the working tree against a resolved base, writes `context_handoff/changes.diff`, and `changesAsEnvelope(...)` hands it to the next agent. A diff is two git commands, not a judgement call.

3. **Does anything loop?** Test-fix cycles are bounded fix loops (see `update_lifecycle.md`), not phase retries.

4. **What does each call need to prove?** Pick gates per call from `gates/`: `artifactsExist`, `filesNonEmpty`, `jsonParses`, `diffMatchesClaims`, `disputesSupported`, `testsPass(["bun","test"])` — or an inline one-off.

## Step 2 — Ownership rules (the swim lanes depend on these)

- `kind: 'agent'` → `owner` MUST be an agent name from the config — it selects the harness (model, thinking, tools, prompts) AND the lane. `callAgent()` runs whoever owns the phase.
- `kind: 'engineer'` → `owner: run.engineer`. Every workflow opens with the engineer request phase — it is the system input record.
- `kind: 'code'` → `owner` is a short actor label (`"git"`, `"db"`); all code phases share the code lane.
- Phase `name` must be unique within the run (`plan`, `build`, `test_1`, `fix_1`, …) — the UI keys blocks on it.
- **`description` is required and must earn its place.** The name identifies the phase; the description explains it — what this phase does and why, in one sentence. It rides the `phase_start` event and is the only line of intent the trace, the console, and the phase block ever show. `phaseParams()` throws at construction on a blank description *or* one that merely restates the name (`commit_plan: "Commit the plan"`), so the rule fails before the phase opens rather than leaving an unreadable run in the db. Write `"Put the spec on record before any code exists to blur it"` instead.
- ``retries: N`` on an **agent** phase = extra gate-correction rounds re-sent into the same session (pi's `--session-id` creates-or-continues, so context stays intact). Code-phase re-execution is not implemented in v1.

## Step 3 — Generate or write it

```bash
bun <pi-crust>/scripts/make-lifecycle.ts --name review-docs --agents scout,builder
```

Writes `.pi-crust/lifecycles/review-docs.ts`: one agent phase per name, chained by `previous:`, starter agents mapped to their output types, any other roster agent to `genericOutput`. It checks every name against the roster first and refuses to write a file naming an agent that does not exist — but it does NOT create config entries or prompt files, so do that first (`update_config.md`).

## The canonical skeleton

Every `stages/*.ts` or `lifecycles/*.ts`, generated or hand-written, has this shape:

```ts
#!/usr/bin/env bun
/**
 * pi-crust Plan Build — plan the request, then implement the plan.
 *
 * Usage:
 *     bun .pi-crust/lifecycles/ship.ts "<prompt or path/to/prompt.md>" [--config .pi-crust/config/crust.config.yaml] [--run-id a1b2c3d4]
 *
 * Phases: engineer(request) -> planner -> builder -> git(commit)
 */

import { commitAll } from '../modules/data/git'
import { buildOutput, planOutput } from '../modules/typedefs/envelope'
import { phaseParams } from '../modules/typedefs/phase'
import { callAgent } from '../modules/use-cases/execute-agent'
import {
  artifactsExist,
  diffMatchesClaims,
  filesNonEmpty,
} from '../modules/use-cases/gates'
import { loadConfig } from '../modules/use-cases/load-config'
import { runCli } from '../modules/use-cases/parse-cli'
import { resolvePrompt } from '../modules/use-cases/resolve-prompt'
import { finish, runPhase } from '../modules/use-cases/run-phase'
import { startSession } from '../modules/use-cases/start-session'
import { validateAgents } from '../modules/use-cases/validate-agents'

export const REQUIRED_AGENTS = ['planner', 'builder'] // names, never models

export const main = async (
  prompt: string,
  config?: string,
  runId?: string,
): Promise<number> => {
  const cfg = loadConfig(config)          // 1. point to config
  validateAgents(cfg, REQUIRED_AGENTS)    // 2. fail fast — nothing spawns on a half-valid config
  const run = startSession(cfg, runId)    // 3. pin-or-create the session → the Run
  const phase = runPhase(run)

  await phase(
    phaseParams({
      name: 'request',
      kind: 'engineer',
      owner: run.engineer,
      description: 'Capture the incoming ask',
    }),
    (ph) => ph.log({ input: prompt }),
  )

  const plan = await phase(
    phaseParams({
      name: 'plan',
      kind: 'agent',
      owner: 'planner',
      description: 'Turn the request into an implementable plan',
    }),
    (ph) =>
      callAgent(run, ph, {
        outputType: planOutput,
        prompt,
        gates: [artifactsExist, filesNonEmpty],
      }),
  )

  const build = await phase(
    phaseParams({
      name: 'build',
      kind: 'agent',
      owner: 'builder',
      retries: 1,
      description: 'Implement the plan exactly',
    }),
    (ph) =>
      callAgent(run, ph, {
        outputType: buildOutput,
        prompt,
        previous: plan,
        gates: [diffMatchesClaims],
      }),
  )

  await phase(
    phaseParams({
      name: 'commit',
      kind: 'code',
      owner: 'git',
      description: "Land the builder's changes, using the message it wrote",
    }),
    (ph) => {
      const message =
        build.commit_message || `crust(${run.runId}): ${build.summary}`
      ph.log({ sha: commitAll(message), message })
    },
  )

  return finish(run)
}

if (import.meta.main) {
  await runCli('.pi-crust/lifecycles/ship.ts', (args) =>
    main(resolvePrompt(args.prompt), args.config, args.runId),
  )
}
```

## Non-negotiables

- **`REQUIRED_AGENTS` + `validateAgents()`** — declare every agent name the script uses and validate before the first phase.
- **Every agent call declares a concrete output type** from `typedefs/`. No untyped handoffs.
- **`previous:` carries the chain** — the upstream envelope lands in the next agent's `user.md` as `{{previous_envelope}}`; bulky context moves through `context_handoff/` files the envelope references.
- **The engineer request phase comes first**, always.
- **Four-param rule** — `phaseParams()` and `callAgent()` each take exactly one object; new helpers with >4 params get a type in `modules/typedefs/`.
- **Stay thin** — sequencing and acceptance only; real logic goes in `modules/` (`update_modules.md`).
- **Every workflow ends in `finish(run)`.** Pass `accepted:` when the run has an acceptance criterion the phase statuses cannot express — a test phase that ran a red suite succeeded at its job.
- **Committing is a code phase, and it needs a fallback.** `planOutput`, `buildOutput`, and `documentOutput` each carry a `commit_message` the agent writes **for its own work product** — the spec, the code, the write-up. It defaults to empty, so always `envelope.commit_message || <fallback>`, and commit each product with the message of the agent that made it (a chain that commits three times must never cross them). `commitAll(message)` stages everything, commits, and returns the short sha; it throws a clear error when the cwd isn't a git repo or nothing changed, and that throw fails the phase.

## Before you ship it

1. `bun .pi-crust/lifecycles/<name>.ts "a tiny real request"` — watch it go green end to end.
2. Check the trace: `sqlite3 .pi-crust/data/crust.db "select seq,name,kind,owner,status from phases where run_id='<id>' order by seq;"`
3. Read the final `envelope.json` — is the output type earning its fields, or should it be sharper?
