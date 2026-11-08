---
name: prompt-authoring
description: Writes and optimizes the Activity prompts an agent executes — runtime/prompt-engineering/<activity>/system.md and user.md, a repository's own .pi-crust/prompt-engineering overrides, and any other prompt whose reader is a model rather than a person. Rewrites for precision and consistent execution across Claude, GPT and Kimi while preserving the harness contract, then runs a blocking checker over template variables, required sections, envelope fields, and the paths and commands a rewrite tends to drop. Use when asked to improve, tighten, clarify, shorten or rewrite a prompt, when adding an Activity that needs prompts, when an agent misread its instructions, and before reporting any prompt edit complete.
---

# Authoring and Optimizing an Activity Prompt

A prompt in `runtime/prompt-engineering/` is executed by a model, not read by a person. It is also an interface: `render` substitutes a fixed set of `{{variables}}` into it, the harness parses the JSON the agent returns against a zod schema, and tests assert that particular sentences are still in the file. Rewriting the prose is cheap; rewriting the interface by accident is the failure this skill exists to prevent.

The prompts ship with the package, and every stamped repository that has not overridden one runs the copy in this clone. An edit here reaches every repository on its next run.

## Use this skill when

- Improving, tightening, clarifying, shortening or rewriting any file under `runtime/prompt-engineering/` or a repository's `.pi-crust/prompt-engineering/`
- Adding an Activity that needs a `system.md` and a `user.md`
- An agent misread, ignored, or inconsistently followed its instructions, and the prompt is the suspect
- Porting a prompt between models, or making one behave the same on Claude, GPT and Kimi
- About to report a prompt edit complete

## Do not use this skill for

- Writing a `specs/` document that a run executes as its `prompt` — that is `spec-authoring`, which owns requirement numbering and work stages. A spec is the input to a run; these prompts are what every run is built from
- Writing a `SKILL.md` — that is `skill-authoring`
- Deciding what an Activity is for, what it may produce, or where it sits in the Lifecycle. That is a decision, and it belongs in a record via `adr-authoring` before a prompt is written to match it
- Markdown shape — wrapping, headings, tables, fences. `markdown-authoring` owns that, and these files are checked by it like any other `.md`
- Changing the envelope schema, the gates, or any TypeScript. Those are `ts-functional-conventions` and `ts-code-review`

## Write for inspection

Prose this skill produces — the report at the end, not the prompt itself — follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding, support it with evidence, distinguish observation from inference, and stop once the reader can act. No checker enforces this.

## Step 1 — Establish what the prompt is contractually required to say

Read, before editing anything:

| Read                                                             | For                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Both files of the Activity — `system.md`, `user.md`              | What is stated once and what is split across the pair                    |
| [references/harness-contract.md](references/harness-contract.md) | The variables, sections, envelope fields and literals that are interface |
| The Activity's schema in `runtime/lib/contracts/src/envelope.ts` | The exact field names the Report example must show                       |
| Any `*.test.ts` that reads this prompt                           | Sentences another test asserts verbatim                                  |

Find the tests before you start, not after the rewrite fails them:

```bash
grep -rln "prompt-engineering" runtime --include='*.test.ts'
```

## Step 2 — Rewrite against the brief

[references/rewrite-brief.md](references/rewrite-brief.md) is the instruction the rewrite follows, and it is written to be usable verbatim as a prompt when the rewrite is delegated to another model. It covers what must be preserved, what jargon and rhetoric to remove, how to express a rule as a condition and an action, and what the deliverable is.

Two decisions it does not make for you:

- **Which file a rule belongs in.** `system.md` is the role and the standing constraints; `user.md` is this call's inputs, the task, and the Report. A constraint that moves between them is a behavioural change, because steering is appended to the user prompt and a model weighs the two differently
- **What to do with an instruction you believe is wrong.** Preserve it and say so in the report. A prompt is also a record of decisions made against observed agent behaviour, and the sentence that reads as superstition is usually the one that stopped a specific failure

## Step 3 — Keep the contract while shortening

The brief's instruction to remove explanation that does not change behaviour is the one that breaks prompts here, because in a pi-crust prompt several things that read like commentary are load-bearing:

- A `{{variable}}` the harness substitutes. Renaming or dropping one is silent: `render` leaves any brace sequence it was not given alone, so the agent is handed `{{output_document}}` as text
- A field in the ```json Report example. The agent emits what it was shown; the schema parses what it emits
- A path, a filename, or a command. `{handoff}/identify.md`, `specs/`, `bun test` — these are what the agent reads, writes and runs
- A sentence a test asserts, including ones required to be byte-identical across two prompts

Keep the prohibitions. "Never argue the change is safe", "change nothing", "do not re-run the checks" are each a narrowing of authority; losing one widens what the agent may do without anyone deciding to.

## Step 4 — Run the blocking checks

Both are blocking, and both run from the repository root.

```bash
.claude/skills/prompt-authoring/scripts/check-prompt.sh
```

With no arguments it checks prompts changed against `HEAD`; pass `--base <ref>` for a whole branch, paths to narrow, `--all` to sweep. Exit 0 is clean, 1 is violations, 2 is a usage or environment error. The analysis is in `.claude/skills/prompt-authoring/scripts/prompt-contract.ts`; the shell script owns scope and extracts each baseline from git, so a prompt with no committed version gets the structural rules only.

```bash
CLAUDECODE=1 bun test runtime/prompt-engineering
```

These suites read the prompt files and assert on their text. A test that now fails is a contract this rewrite changed: restore the sentence, or change the test deliberately and say which requirement made it stale.

Prompts are markdown, so `markdown-authoring`'s checker applies to them as it does to every `.md`:

```bash
.claude/skills/markdown-authoring/scripts/check-markdown.sh
```

## Step 5 — Report what changed

Return the revised prompt, then — omitting any section with nothing substantive in it:

- **Behavioural changes** — what the agent is now instructed to do differently, including anything deliberately dropped
- **Ambiguities** — questions the original does not resolve, which you preserved rather than decided
- **Preserved constraints** — requirements whose wording changed substantially and whose behaviour must not

Do not list cosmetic edits. A diff shows those.

## What the check cannot see

`check-prompt.sh` compares a prompt against its baseline and reads its shape. It cannot tell you:

- **Whether the rewrite is clearer.** No checker measures that. The evidence is a run, and the honest claim after a rewrite is "unverified against a run" unless one was executed
- **Whether a preserved sentence still means what it meant.** Every variable can survive a rewrite that inverts an instruction around it
- **Whether an added instruction contradicts one further down.** Two prompts in a pair can disagree and both pass
- **Whether a removed paragraph was load-bearing.** Only the literals, variables, envelope fields and asserted sections are tracked; ordinary prose is not, deliberately, because a rule that forbade removing prose could only be satisfied by reverting
- **Whether the Activity should say this at all.** That is a decision, and it belongs in a record
