# Update Modules

Extend `<pi-crust>/runtime/modules/` with new low-level logic.

## The rule

**ALL low-level logic lives in `modules/`; the entry points stay thin.** A Lifecycle is YAML and runs no code of its own; the Composer resolves it into steps and the driver runs them. An entry point parses arguments and returns an exit code. Anything else — subprocess handling, parsing, retry mechanics, git plumbing, reusable predicates — goes in a module.

Modules are layered, and the layer decides the file. The rule that settles every placement: **if it reads the clock, the filesystem, the environment, a subprocess, a database, or a random number, it is `data/`.** Types and schemas are `typedefs/`. Everything else — policy, orchestration, decisions — is `use-cases/`.

## Where things go

| Module                                                                                                          | Owns                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typedefs/activity-run.ts`                                                                                      | `TActivityRunParams`, `TActivityRun`, and `activityRunParams()` with its description rule                                                                                                                                          |
| `typedefs/envelope.ts`                                                                                          | `envelopeBaseSchema` + one output type per agent call, and `TEnvelopeSpec`                                                                                                                                                         |
| `typedefs/config.ts`                                                                                            | `TAgentConfig`, `TPiCrustConfig`, and the zod schemas that parse the roster                                                                                                                                                        |
| `typedefs/gate.ts`                                                                                              | `TGateReport`, `addCheck`, `violationsOf`, and `TAgentCall`                                                                                                                                                                        |
| `typedefs/settlement.ts`                                                                                        | `TSettlement` and `safeParseSettlement` — a vendored copy, see the file header                                                                                                                                                     |
| `typedefs/pi.ts` · `quality.ts` · `changes.ts` · `trace.ts` · `run.ts`                                          | the remaining shapes                                                                                                                                                                                                               |
| `data/pi-agent.ts`                                                                                              | the Pi interface (v1) — non-interactive `pi -p --mode json`, JSONL stream tailed live, model resolved against `~/.pi/agent/models.json`; `--session-id` creates-or-continues, so running and continuing an agent are the same call |
| `data/claude-code-agent.ts`                                                                                     | the Claude Code interface — stubbed in v1, lands in v2                                                                                                                                                                             |
| `data/trace-db.ts`                                                                                              | append JSONL **and** insert every event into `crust.db` as it happens                                                                                                                                                              |
| `data/git.ts`                                                                                                   | branch, status, diff, commit — the raw plumbing `capture-changes.ts` composes                                                                                                                                                      |
| `data/working-tree.ts`                                                                                          | fingerprinting the tree, so permission breaches can be detected and undone                                                                                                                                                         |
| `data/files.ts` · `clock.ts` · `ids.ts` · `terminal.ts` · `prompt-files.ts` · `operator-env.ts` · `engineer.ts` | the rest of the outside world                                                                                                                                                                                                      |
| `use-cases/run-activity-run.ts`                                                                                 | the activity run primitive `runActivityRun(run)(params, body)` and `finish(run)`                                                                                                                                                   |
| `use-cases/create-run.ts`                                                                                       | the Run: config + run_id + tracer + console, and the only mutable state in the system                                                                                                                                              |
| `use-cases/start-session.ts`                                                                                    | mint or join `run_id`, maintain `agent_map.json`, create session dirs incl. `context_handoff/`                                                                                                                                     |
| `use-cases/execute-agent.ts`                                                                                    | one agent call: render prompts → pi → typed parse → gates → permissions → envelope                                                                                                                                                 |
| `use-cases/load-config.ts` · `validate-agents.ts`                                                               | parse the roster, merge defaults, fail fast on a half-valid config                                                                                                                                                                 |
| `use-cases/gates/`                                                                                              | validation gates over envelope claims                                                                                                                                                                                              |
| `use-cases/enforce-permissions.ts`                                                                              | what an agent may change, verified against the repo after the fact                                                                                                                                                                 |
| `use-cases/run-checks.ts`                                                                                       | the deterministic lint/typecheck/build/test blocks and their envelope adapter                                                                                                                                                      |
| `use-cases/capture-changes.ts`                                                                                  | resolve the base ref, `git diff` into `context_handoff/changes.diff`, adapt the `TChangeSet` into an envelope an agent can be handed                                                                                               |
| `use-cases/report-to-console.ts`                                                                                | the terminal narrative — every line printed is ALSO traced as a `log` event (`{message, level}`), from one `emit` helper, so the terminal and the swim-lane UI tell the same story                                                 |

## Never `console.log`

Modules report through `run.console` — never a bare write to stdout. Each console method prints a styled line **and** writes it to `crust.db` as a `log` event with payload `{message, level}`, both from one `emit` helper, so the terminal narrative and the swim-lane UI can't drift. New output means a new method on the console, not a print at the call site.

## The four-param rule

**Any function taking more than 4 parameters gets them converted into a concrete type in `typedefs/`.** `TAgentCall` and `TActivityRunParams` are the pattern — `activityRunParams()` and `callAgent()` each take exactly one object. This is skill-wide: every module the factory generates obeys it.

```ts
/** Everything reviewChanges() needs. Passed as one object, never loose params. */
export type TReviewParams = Readonly<{
  baseRef: string
  paths: ReadonlyArray<string>
  maxDiffLines: number
  ignoreGenerated: boolean
  reviewer: string
}>
```

## Adding an output type

Every agent call parses against a concrete type. Extend `envelopeBaseSchema` — `status`, `summary`, `artifacts`, `notes_for_next_agent` — with only the fields that call actually needs, then wrap it in a spec:

```ts
export const reviewOutputSchema = envelopeBaseSchema.extend({
  approved: z.boolean().default(false),
  blocking: z.array(z.string()).default([]),
})
export type TReviewOutput = Readonly<z.infer<typeof reviewOutputSchema>>
export const reviewOutput = envelopeSpec('ReviewOutput', reviewOutputSchema)
```

The spec carries three things the harness needs: the `name` that lands in the `envelopes.output_type` column, the schema the response is parsed against, and the field names the correction prompt lists when a response does not parse. `fieldNames` is derived from the schema, never written twice.

Field names are snake_case because they are the wire contract with the model — the prompt asks for exactly those keys.

**The output contract is a synced triad — one change means three edits, always together:**

1. The schema in `modules/typedefs/envelope.ts` (the enforcer).
2. The agent's `user.md` `## Report` section showing exactly that JSON (the ask).
3. Every call site passing `outputType:` (the binding) — `grep -rn "reviewOutput" .pi-crust/` to find them all.

If the schema and the Report example drift, the agent produces what the prompt asked for, the parser rejects what the schema expects, and every call burns correction round-trips before landing — a slow, silent tax. Renaming or removing a field is the same triad edit. Schema details: `references/handoff.md`.

## Adding a gate

A gate is a record: a `name` the db stores, and `check(envelope, run) -> TGateReport`. You record **one check per item you look at**, and the harness derives the verdict: any failed check is a violation, and no failed checks means pass.

```ts
import type { TGate } from '../../typedefs/gate'
import { addCheck, emptyReport } from '../../typedefs/gate'

/** Verify the envelope's own test claims, after the fact. */
export const testsDeclaredPassed: TGate = {
  name: 'tests_declared_passed',
  check: (envelope) => {
    const failures = (envelope as { failures?: ReadonlyArray<string> }).failures ?? []
    const passed = (envelope as { passed?: boolean }).passed === true
    return addCheck(
      failures.reduce(
        (report, failure) => addCheck(report, failure, false, 'declared failure'),
        emptyReport,
      ),
      'suite',
      passed,
      passed
        ? 'all declared tests passed'
        : `${failures.length} declared failure(s)`,
    )
  },
}
```

`addCheck(report, item, ok, note)` returns a NEW report rather than mutating the one it was given, so gates compose with `reduce` and a single-item gate is one expression: `addCheck(emptyReport, command, ok, \`exit ${code}\`)`.

**Write a note on passing checks too, not just failures.** The note is the evidence, and it is what makes a green gate worth reading — `artifacts_exist ✓ 1 checked · plan.md — exists, 454B` tells you what was verified, where a bare ✓ tells you nothing. Notes on failed checks double as the reason and are what the agent is told, so phrase them as the problem: `"claimed changed file does not exist"`.

Rules that keep gates honest:

- **Verify claims, never predict.** File names and counts are unknowable before the agent finishes; gates check what the envelope declared.
- **Quantity as properties, not counts.** "at least one artifact", "ALL declared paths exist" — never `artifacts.length === 3`.
- **Record checks, don't throw.** The harness feeds the derived violations back to the Activity as a new Activity Run — the same coding-agent session, so the context is intact, bounded by the Activity's `attempts` — and traces every check, passed or failed, to `gate_results.checks_json` and the `gate_pass`/`gate_fail` event payload.
- **Check every item, even after one fails.** Don't early-return on the first problem; the agent fixes more per correction round when it sees every failure at once, and the trace shows the full picture.
- **Don't gate the ungateable.** Plan quality and code taste are a reviewer agent's job or a human's.

Reusable gates live in `modules/use-cases/gates/` and are re-exported from its `index.ts`; genuine one-offs can be defined inline at the workflow call site and passed in `gates: [...]` where the step is constructed.

## Conventions these modules follow

- `type`, never `interface`. `Readonly` and `ReadonlyArray` on anything crossing a function boundary.
- No `null` — `undefined`, or a value with a sensible default.
- `data/` and `use-cases/` return settlements rather than throwing. The two sanctioned exceptions are `run-activity-run.ts`, which IS the error boundary, and `safeParseSettlement`, which wraps a throwing call once at the edge.
- Build new values; do not mutate the ones you were handed. The run's counters live in a closure in `create-run.ts` precisely so no other layer has to.

## Before you finish

Run the smoke chain — `just crust prompt "ping"` — since every module change rides the same path a real run does. `bun test` in `.pi-crust/` covers the modules the skill ships with tests for.
