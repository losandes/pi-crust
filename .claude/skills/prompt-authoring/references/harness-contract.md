# What a pi-crust prompt owes the harness

Everything here is observable in the runtime, with the file that settles it named. These are the parts of a prompt that an optimization pass must not change by accident; everything else in the file is prose, and prose is what the rewrite is for.

## Where prompts live and which copy runs

An Activity's prompts are `runtime/prompts/<activity>/system.md` and `.../user.md`, named by `prompts.system` and `prompts.user` in the Activity's configuration.

A writer Activity may also name a revise prompt with `prompts.revise`. When that key is absent, `revisePromptReference` checks for a `revise.md` beside the `user` reference using the same resolution as other prompts; if that reference resolves to a file it is used, otherwise `user` is used. An explicit `revise` reference takes precedence over the sibling file. A revise round (review findings present, gate violations absent) renders this prompt in place of `user.md`. A first attempt or a gate-failure retry still renders `user.md`.

`resolveReference` in `runtime/domains/agents/src/data/prompt-files.ts` resolves a relative reference against `<cwd>/.pi-crust/` first and the package second. A repository that writes `.pi-crust/prompts/plan/system.md` overrides that one file; every key it does not name keeps the shipped prompt. An absolute path is taken as given.

The consequence for editing: a shipped prompt is used by every stamped repository that has not overridden it, on its next run. There is no release step between the edit and that.

## Variable substitution is literal, and unknown names are silent

`render` in `runtime/domains/agents/src/data/prompt-files.ts` replaces `{{name}}` with a string for each key it is given, by `split`/`join`. It does no parsing, so:

- `{{ name }}` with spaces is not a key and is left in the text
- A name the harness does not supply is left in the text, and the agent reads the braces
- A variable a prompt never uses costs nothing

`runtime/domains/activities/src/use-cases/execute-agent.ts` builds the whole set:

| Variable              | Carries                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`              | The operator's request for this run                                                                                                                            |
| `previous_envelope`   | The immediately preceding Activity's report as JSON, or `(none)`                                                                                               |
| `previous_envelopes`  | Every upstream envelope, each labelled with its Activity — identical to the above when there is one upstream                                                   |
| `context_handoff_dir` | The absolute handoff directory for this run                                                                                                                    |
| `output_document`     | Where this Activity's own document goes, derived from its `writes`                                                                                             |
| `annotating_handoffs` | Each Activity whose succession resolves to `annotates`, as `- <activity>: <handoff document>`, or `(none)`                                                     |
| `changed_files`       | The paths the call is about, or `(none)`: for a judging Activity the run's change or the named scope, otherwise the working tree's changed and untracked paths |
| `change_base`         | Where that change is when it is not the uncommitted working tree: the named scope, or the commit the run started from with the command for reading it          |
| `step_catalogue`      | The Activity registry, rendered — only the operator prompt uses it                                                                                             |
| `trust_stance`        | The trust dial in words                                                                                                                                        |

Three absences are deliberate and worth knowing before inventing a placeholder:

- **Steering has no variable.** It is appended to the rendered user prompt in `execute-agent.ts`, so no prompt can forget it. `{{steering}}` would render as text
- **Gate violations and review findings have no variable.** The engine appends them after steering: gate violations use `feedbackBlock`, review findings use `findingsBlock`. If both are present, gate violations take precedence and no findings block is appended
- **`previous_envelope` carries one stage only.** Anything a later Activity needs travels in the handoff document, which is why prompts name `{handoff}` paths explicitly

## The Report example is the envelope's interface

`execute-agent.ts` parses the agent's output with the Activity's zod schema from `runtime/lib/contracts/src/envelope.ts`. The ```json block under `## Report` is how the agent learns the field names, so the example and the schema are one contract in two files:

- A field removed from the example is a field the agent stops emitting, and a required one failing to parse fails the call
- A field removed from the schema must be removed from the example too, or the agent emits something nothing reads
- Field names, not just their presence: `regress_to`, `objective_met`, `notes_for_next_agent`, `artifacts`, `commit_message`, `status`, `summary`, and the five context lists are read by name

## Sections tests assert

Four suites read prompt files and assert on their contents, so a heading or sentence they name is part of the contract:

- `runtime/prompts/request-capture.test.ts` — the `## Carry the request forward` section in `identify/user.md` and `diagnose/user.md`, required to be byte-identical in both, and the equivalent instruction in `gh-issue/user.md`
- `runtime/prompts/gh-pull-request/prompt-content.test.ts` — the prohibition on arguing the change should be merged, the statement that the harness owns the issue link and the `## Activities` and `## Checks` sections, and the no-attribution, no-envelope-JSON, no-git-or-`gh`, read-only instructions
- `runtime/prompts/handoff-authorization.test.ts` — the paragraph opening `## Intake` in every prompt that names `{{context_handoff_dir}}`, which authorizes reading and writing the run's handoff directory although it is gitignored and may sit outside the worktree. An agent whose own instructions forbid either stops and asks for permission without it
- `runtime/prompts/revise-round.test.ts` — the findings-only task, preservation and scope sentences in all three revise prompts, the tester-only restrictions and escalation sentences, and the copied Intake and Report spans from each Activity's `user.md`

Run `RUN_INTEGRATION_TESTS=false CLAUDECODE=1 bunx bunt runtime/prompts --parallel | bunx buntap --agent --no-color` after any edit. A new assertion belongs with any instruction a later rewrite must not quietly drop.

## The house structure

Every shipped `system.md` carries `## Purpose`; all but one also carry `## Instructions`. Every shipped `user.md` carries `## Variables`, `## Intake`, `## Task` and `## Report`, in that order. `check-prompt.sh` enforces those sections, because a missing one is usually a rewrite that merged two sections and lost the boundary between what the agent is given and what it must return.

Every shipped `revise.md` carries the same four sections as `user.md` — `## Variables`, `## Intake`, `## Task` and `## Report`, in that order — and no `{{prompt}}` placeholder. Its task answers review findings rather than repeating the original request.
