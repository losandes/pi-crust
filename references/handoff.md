# Handoff Reference

The envelope schema, the two-channel output contract, and the session directory layout — how context transfers in code, not in conversation.

## Two output channels, exactly

An agent may produce output in two ways and no others:

1. **Reference files** written into `context_handoff/` — plans, notes, artifacts for the agents that follow.
2. **A final valid-JSON response** — the envelope, its direct response and nothing else.

Code does the rest: parse the response against the output type the call declared, persist it as `envelope.json`, and inject it into the next agent's user prompt.

## Envelope schema

Every output type extends `envelopeBaseSchema`:

```ts
export const envelopeBaseSchema = z.object({
  status: z.enum(['success', 'fail']),       // the only required field
  summary: z.string().default(''),           // one sentence: what happened
  artifacts: z.array(z.string()).default([]), // paths written, usually in context_handoff/
  notes_for_next_agent: z.string().default(''), // what the next agent must know
})
```

`status` is load-bearing: an envelope that parses but reports `status: 'fail'` throws, failing the phase. An agent declaring its own failure is not a successful phase.

The starter types in `modules/typedefs/envelope.ts`, each paired with a spec the call site passes as `outputType:`:

```ts
// genericOutput  — the base, unchanged: a fallback for an agent with no sharper
//                  contract yet.

planOutputSchema = envelopeBaseSchema.extend({
  commit_message: z.string().default(''),     // git subject for the PLAN FILE itself
})

buildOutputSchema = envelopeBaseSchema.extend({
  changed_files: z.array(z.string()).default([]),
  commit_message: z.string().default(''),     // consumed by the git commit phase
  disputes: z.array(disputeSchema).default([]),  // {finding, evidence, reason}
})                                            // a revise's answers that were not fixes

scoutOutputSchema = envelopeBaseSchema.extend({
  findings: z.array(scoutFindingSchema).default([]),  // {file, note}
})

reviewOutputSchema = envelopeBaseSchema.extend({
  approved: z.boolean().default(false),       // the verdict; status is only "did it run"
  findings: z.array(reviewFindingSchema).default([]), // {requirement, met, evidence}
  blocking: z.array(z.string()).default([]),  // what must change before approval
})

documentOutputSchema = envelopeBaseSchema.extend({
  document_path: z.string().default(''),      // the write-up's home in the repo
  documented_files: z.array(z.string()).default([]),
  commit_message: z.string().default(''),
})
```

`commit_message` defaults to empty, so a git phase consuming it always needs a fallback — see `cookbooks/create_lifecycle.md`.

**Each `commit_message` describes its own agent's work product, never the next one's**: `planOutput`'s covers the spec file, `buildOutput`'s the code, `documentOutput`'s the write-up. A chain that commits once can use whichever fits; a chain that commits more than once needs all three, and reusing one agent's sentence for another's diff is how a commit log starts lying.

There is no test output type: running the repository's checks is a `kind: 'code'` phase, and its `TQualityResult` reaches the next agent as a `VerifyOutput` built by `verificationEnvelope`.

Two of these are adapters rather than agent reports — code shaped as an envelope so an agent can be handed a deterministic result through the same door: `verifyOutput` (a lint/test block's result) and `changesOutput` (a captured `git diff`, from `changesAsEnvelope`). The consuming agent cannot tell the difference, which is the point.

The envelope is a **manifest of claims**. Gates verify those claims after the fact — declared artifacts exist and are non-empty, declared changes appear in the diff, declared tests actually pass. See `cookbooks/update_modules.md`.

## The typed-output rule

**Every agent call passes a concrete output type**, and the agent's final JSON is parsed against exactly that type. No untyped handoffs.

```ts
const plan = await phase(planParams, (ph) =>
  callAgent(run, ph, {
    outputType: planOutput,
    prompt,
    gates: [artifactsExist],
  }),
)
```

The user prompt asks for the shape; the schema enforces it. They always travel as a pair, which is what lets one agent serve many calls — same system prompt, different user prompt + output type per call site. Output types live in code, never in `crust.config.yaml`.

**Parse failure is not a restart.** If the response doesn't parse or doesn't validate, the harness re-prompts the **same session** with a correction naming the required fields — bounded by `JSON_FIX_ATTEMPTS` in `execute-agent.ts` (2). Gate violations use the identical mechanism, bounded instead by the phase's `retries`. A cold restart would throw away the context that produced the near-miss.

In v1 there is no separate continue call to make: `data/pi-agent.ts` passes `--session-id`, which pi treats as create-or-continue, so running an agent and continuing it are the same call with the same id. Before parsing, the harness also tolerates a fenced `json` code block or prose wrapped around the object — but the prompt still asks for bare JSON, and every failed attempt is persisted as an invalid envelope row.

## Injecting the previous envelope

`data/prompt-files.ts` renders the agent's `user.md`, substituting:

| Placeholder | Value |
|---|---|
| `{{prompt}}` | the engineer's ask (or the workflow's per-call prompt) |
| `{{previous_envelope}}` | the upstream envelope JSON, from `callAgent(..., { previous })` |
| `{{context_handoff_dir}}` | absolute path to this session's `context_handoff/` |
| `{{skills}}` | the skill paths `routing.skills` selected for this agent, phase and change; `(none)` when it selected none |
| `{{changed_files}}` | the paths this call is about, one per line, or `(none)` |
| `{{change_base}}` | the ref or range `--base` named, or `(the uncommitted working tree)` |

A `user.md` declares one h3 per incoming datum, then the task, then the output contract:

````markdown
# Scout Task

## Variables

### prompt

{{prompt}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Find what `prompt` asks about. Write findings into `context_handoff_dir`, then emit your `Report` JSON.

## Report

Respond with ONLY valid JSON matching `ScoutOutput` — no prose before or after:

```json
{
  "status": "success",
  "summary": "<one sentence on what you found>",
  "findings": [
    { "file": "src/server.ts", "note": "<why this file matters>" }
  ],
  "artifacts": ["<context_handoff_dir>/scout_findings.md"]
}
```
````

The `## Report` section shows the exact JSON shape of the declared output type — that is the agent's output contract, and it lives in `user.md` because the shape belongs to the *use*, not the identity. The matching `system.md` stays static: Purpose + Instructions only.

## Session directory layout

```text
.pi-crust/data/sessions/{run_id}/
├── agent_map.json          agent name → coding-agent session_id + model
├── context_handoff/        the ONE place agents write files for the agents that follow
└── {agent_name}/
    ├── prompts/            exact prompts sent (system.md + user.md), saved before execution
    ├── pi_sessions/        pi's own session state for this agent
    ├── raw_output.jsonl    full JSONL stream from the coding agent, appended live
    └── envelope.json       the final valid-JSON response — captured, validated, persisted by code
```

`startSession(cfg, runId)` mints or joins the id and creates these dirs. One `context_handoff/` per session, shared by every agent — the single location for cross-agent files.

## agent_map.json and resuming

```json
{
  "planner": {"session_id": "crust-a1b2c3d4-planner-9f2e",
              "model": "google/gemini-3.6-flash", "coding_agent": "pi"},
  "builder": {"session_id": "crust-a1b2c3d4-builder-71ac",
              "model": "google/gemini-3.6-flash", "coding_agent": "pi"}
}
```

This map is the key that lets a later workflow rejoin each agent's **existing context window**. Run `build.ts --run-id a1b2c3d4` after `plan.ts` and the builder resumes its own session rather than starting cold.

The map records the model each session was created with. If config drift changes an agent's model, that agent starts a **fresh** session and the map is updated — never a bad resume. `agent_sessions` in `crust.db` is the queryable mirror of this file.

**Files are the raw record; the db is the queryable mirror.** Losing `crust.db` loses nothing that can't be rebuilt from `raw_output.jsonl`, `envelope.json`, and `agent_map.json`.

## When an envelope is written

**The moment it parses.** `executeAgent` persists both the `envelopes` row and `{agent}/envelope.json` as soon as the response validates against the declared schema — before gates rule on it, and once more per gate-correction round.

`valid` keeps its meaning: *parsed against the declared schema*. Whether the gates liked it lives in `gate_results`, which is where that question belongs.

This matters because of what used to happen when it did not. A phase whose gates failed terminally threw before anything was written, so the agent's work sat in the repository while its report vanished — and a later phase in the same session read `previous_envelope: (none)` and carried on as though no one had done anything.

## How a phase is replayed

`--resume` skips a phase already recorded successful for the session and replays its result instead. Three sources, one per kind:

| Phase kind | Replayed from |
|---|---|
| agent | `{sessionDir}/{agent}/envelope.json`, parsed against the step's spec |
| code | the payload the phase filed under the `step_result` event |
| git (commit, change capture) | the recorded sha, or simply re-captured — a diff is deterministic and free |

Two rules hold this together:

- **A skipped phase opens no new phase row.** The trace already holds the successful one; a second would corrupt the completed set the next resume reads, and the reporter and resume would start to disagree.
- **A code phase's verdict is not its status.** A verify phase that ran a red suite succeeded at its job. Replay reads `{passed, failures}` from what the phase recorded, never from `status === 'success'`.

A missing `envelope.json` on a replayed agent phase is an error naming the exact path and both ways forward — drop `--resume`, or run that step alone. It is never a silent `previous: undefined`.
