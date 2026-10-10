# Update a Workflow

Modify an existing workflow chain — add phases, add gates, add a bounded fix loop.

## Add a phase

Insert an `await phase(...)` call where it belongs in the sequence. Pick the right `kind`: `agent` for a `callAgent(run, ph, {...})`, `code` for a deterministic step, `engineer` for a human touchpoint. If the new phase names an agent not already in `REQUIRED_AGENTS`, add it there too — otherwise validation passes and the run dies mid-flight instead of at startup.

```ts
const found = await phase(
  phaseParams({
    name: 'scout',
    kind: 'agent',
    owner: 'scout',
    description: 'Locate the code the request touches',
  }),
  (ph) => callAgent(run, ph, { outputType: scoutOutput, prompt }),
)
```

Phase `name` must be unique within the run — that is what the UI keys blocks on. In a loop, suffix it (`` `test_${round}` ``).

`description` is **required**, and `phaseParams()` rejects both a blank one and one that merely restates the name. It is the single line of intent the trace, the console, and the UI phase block show, so write what the phase does and why — `"Land the code only now: green suite, approved review"`, not `"Commit build"`.

A code phase does its work in the block body and logs what it did. The `commit` step is the pattern:

```ts
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
```

`commit_message` is a field on `planOutput`, `buildOutput`, and `documentOutput` that the agent fills in **for its own work product**, so always pair it with a fallback — it defaults to empty. `commitAll` throws if the cwd is not a git repo or nothing changed, which fails the phase rather than committing nothing. A chain that commits more than once commits each product with its own author's message.

## Remove a phase

Delete the block, drop any now-unused agent from `REQUIRED_AGENTS`, and re-thread the chain: whatever the removed phase produced was probably somebody's `previous:`. Point that call at the surviving upstream envelope.

## Add gates

A gate is a record — a `name` and a `check(envelope, run) -> TGateReport`, recording one `addCheck(report, item, ok, note)` per thing it looked at, with violations derived from the failed ones. Compose them per call:

```ts
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
      gates: [artifactsExist, diffMatchesClaims],
    }),
)
```

On violations the harness does **not** restart the agent — it sends the violation list back into the **same session** as a correction (pi's `--session-id` creates-or-continues, so the context window is intact), bounded by that phase's `retries`. Every gate result is traced to the `gate_results` table. Exhausting the retries throws `GateFailure` and fails the phase.

Gate claims, not guesses: declared artifacts exist and are non-empty, declared JSON parses, declared changes appear in the diff, declared test commands pass. Never hardcode counts — express quantity as a property of the declared list ("at least one artifact", "ALL declared paths valid"). Plan quality and code taste are not gateable; that is a reviewer agent or a human. New reusable gates go in `modules/use-cases/gates/` (`update_modules.md`).

## Add a bounded fix loop

`compose --steps build,verify,build,verify` is a fix loop written longhand, and it needs no new file. Write one in code only when the repetition has to be conditional — stop early when the checks pass, escalate when they do not — and bound it with a module-level constant so it cannot run forever.

```ts
export const MAX_FIX_LOOPS = 3

const attempt = async (round: number): Promise<TQualityResult> => {
  const checks = await phase(
    phaseParams({
      name: `verify_${round}`,
      kind: 'code',
      owner: 'checks',
      description: 'Run the checks the changed paths select — a known command, so code runs it',
    }),
    (ph) => {
      const result = runVerification(run, changedPaths) // TQualityResult, not an envelope
      ph.log({ passed: result.passed, artifacts: result.artifacts.join(', ') })
      return result
    },
  )
  if (checks.passed || round === MAX_FIX_LOOPS) {
    return checks
  }

  await phase(
    phaseParams({
      name: `fix_${round}`,
      kind: 'agent',
      owner: 'builder',
      retries: 1,
      description: 'Repair what the checks reported, from their verbatim output',
    }),
    (ph) =>
      callAgent(run, ph, {
        outputType: buildOutput,
        prompt,
        previous: verificationEnvelope(checks, changedPaths.length),
        gates: [diffMatchesClaims],
      }),
  )
  return attempt(round + 1)
}
const checks = await attempt(1)

return finish(run, {
  accepted: checks.passed,
  reason: `the checks still failed after ${MAX_FIX_LOOPS} fix attempt(s)`,
})
```

`finish(run)` ends every lifecycle, and it takes the acceptance criterion the phase statuses cannot express. A verify phase that ran failing checks **succeeded** — the runner did its job — so phases alone would report a green run that never passed, in the db and the UI as well as the terminal. Pass `accepted:` and the exit code, the session status, and the banner are decided together.

`verificationEnvelope` is the adapter: a deterministic result shaped as an envelope, so the builder cannot tell it came from code rather than from another agent. Every command it runs comes from `routing.checks` in the config — nothing is named in the module.

Three distinctions worth keeping straight:

- **Gate retries vs. JSON retries.** `retries` buys extra *gate*-correction rounds. Malformed final JSON is handled separately and always — `JSON_FIX_ATTEMPTS` in `modules/use-cases/execute-agent.ts` (2 by default) re-prompts the same session for a valid object even on a phase with `retries: 0`. Raising the phase's `retries` does not buy more JSON attempts, and vice versa.
- **Phase retries vs. fix loops.** ``retries: N`` on `phaseParams()` re-attempts one agent phase's gate corrections, re-sent into the same session with its context intact. (Code-phase re-execution is not implemented in v1.) A fix loop is a *chain* of phases repeated — different agents, new envelopes each pass.
- **The test phase succeeds when it runs and reports correctly.** A failing suite does not fail that phase; it fails the run, checked at the end. The runner did its job; the code didn't.

## Keep scripts thin

A stage or lifecycle script is sequencing and acceptance — nothing else. The moment you are writing parsing, subprocess handling, retry mechanics, or a reusable predicate inside `stages/*.ts` or `lifecycles/*.ts`, it belongs in `modules/`. See `update_modules.md`.

## Add a step to the registry

A new step is a new entry in `<pi-crust>/runtime/modules/use-cases/steps/` and one line in `STEP_REGISTRY` — after which `compose --steps` can run it, `sdlc` can include it, and `--resume` can skip it. Four things it must declare:

| Field                | What it is                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`               | the `TStepName`; add it to `STEP_NAMES` in `typedefs/step.ts` **and** to the hand-duplicated copy in the skill's `scripts/make-lifecycle.ts`, which cannot import from a repository it has not stamped yet |
| `params`             | `phaseParams({...})` — the same kind/owner/description rules as any phase                                                                                                                                  |
| `requires`           | the agent names it needs, so `validateAgents` catches a bad roster before anything spawns                                                                                                                  |
| `execute` / `replay` | how it runs, and how it is rehydrated when it already ran                                                                                                                                                  |

An agent step is a call to `agentStep({...})` and inherits both halves. A code step writes its own, and the replay is the part to get right:

```ts
execute: (ctx, handle) => {
  const result = doTheWork(ctx)
  handle.log({ … })                                     // for the human
  recordStepResult(ctx.run, handle, { passed: result.ok })  // for replay
  return Promise.resolve({ previous: envelopeOf(result), accepted: result.ok })
},
replay: (ctx) => {
  const payload = replayStepResult(ctx.run, phaseName)
  …
}
```

**Replay must read what the phase recorded, never what its status implies.** A verify phase that ran a red suite SUCCEEDED — the runner did its job — so `status === 'success'` says nothing about whether the code passed. That is the same distinction `finish(accepted:)` exists to keep, and inferring one from the other puts the bug straight back.

A missing replay record is an error that names the phase and the two ways forward. Do not fall back to `previous: undefined`; a later agent reading an empty `previous_envelope` is exactly the silent failure the envelope-persistence fix closed.

A step that ends a chain in a VERDICT inherits the bounded revise loop: `use-cases/revise-loop.ts` attaches to any chain whose last name is in `REVIEW_STEPS`, so adding a review-shaped step means adding it there too, or it ends the chain without ever being answered.

## Add resume to a hand-written workflow

The branching workflows do not go through the step driver, so they say how each phase replays at the call site:

```ts
const phase = resumablePhase(run)   // instead of runPhase(run)

await phase(
  phaseParams({ … }),
  (ph) => callAgent(run, ph, { outputType: buildOutput, prompt }),
  replayAgent(run, 'builder', buildOutput),
)
```

`replay.ts` has one helper per kind: `replayNothing` (the engineer request phase), `replayAgent` (the envelope on disk), `replayQuality` (the recorded verdict), `replayCommit` (already landed), `replayChanges` (just re-capture; a diff is free). The extra argument is the point — a phase whose replay nobody could name should not be skipped.
