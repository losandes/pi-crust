---
name: skill-authoring
description: Writes and repairs skills in a project's .claude/skills/ directory or the user's own skills directory, and runs a blocking checker over their frontmatter, boundaries, links, and referenced scripts. Use when asked to create a skill, when a convention needs enforcement a linter cannot provide, when a skill is not being triggered at the right moments, when porting a subagent or command into a skill, or when editing any SKILL.md. Also use when deciding whether something should be a skill at all rather than a record or a lint rule. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Authoring a Skill

## Use this skill when

- Asked to create a skill, or to port a subagent or command into one
- A convention needs enforcement that a linter cannot provide
- A skill is not being triggered when it should be, or fires when it should not
- Editing any `SKILL.md`, or the scripts a skill invokes

## Do not use this skill for

- Recording a decision — use `adr-authoring`. A skill carries workflow; a record carries the rule. A skill that states rules of its own will drift from the record and then contradict it
- A rule a linter can express — see [enforce-conventions-with-lint.md](../adr/typescript/enforce-conventions-with-lint.md). Reach for the cheapest mechanism that answers the question; a skill is the most expensive and the easiest to ignore

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## Step 1 — Decide it should be a skill

| The thing is                                                             | Build                                |
| ------------------------------------------------------------------------ | ------------------------------------ |
| A rule the linter already has                                            | Nothing. Enable it                   |
| A syntactic pattern, local to one file                                   | A lint plugin                        |
| A question needing resolved types, cross-file context, or the filesystem | A script, invoked by a skill         |
| A multi-step workflow with judgement in the middle                       | A skill                              |
| A decision about what is correct                                         | A record, which the skill then reads |

A skill with no script is a document with extra steps. That is sometimes right — routing and sequencing have value — but it should be a deliberate choice, not the default because writing a checker was harder.

Skills, not subagents. Subagents exist in only one of the harnesses this team uses, so a convention living there is invisible to half its audience.

## Step 2 — Write the description carefully

**The description is the only part loaded before the skill is selected.** Everything else is invisible at the moment the decision is made, so effort spent on the body cannot compensate for a vague description.

Name concrete triggers:

- The file patterns the work touches — `*.test.ts`, `.tsx`, `adr/`
- The phrases a person actually types — `"fp review"`, `"write that down"`, `"tts"`
- The words that appear in review comments — mutation, purity, immutability
- The moment it applies — *"before reporting work complete"*

And say what it is **not** for, pointing at the skill that owns the neighbouring case. Two skills whose descriptions both claim "review code" are selected by whichever matched first, which is selection by accident.

**Keep the description parseable as YAML.** It sits on one line as a plain scalar, so a colon-followed-by-space ends the value and a space-hash starts a comment. Either one makes the frontmatter invalid or truncated, and a harness that cannot parse frontmatter **drops the skill without saying so** — it does not appear in the skill list, `/skill:<name>` does not resolve, and nothing reports an error. Two skills here were invisible for exactly this reason, one whose description read `... every kind of review: "code review"` and one reading `Not an activity log: no chronology`.

Use a dash, a comma, or parentheses where a colon reads naturally, or quote the whole value. Quoting is awkward in practice — descriptions carry double quotes around trigger phrases and apostrophes in ordinary prose — so a dash is usually the cheaper fix.

After writing or editing a description, confirm the skill actually loaded rather than assuming a file on disk was read: start a session and check it is listed. Nothing fails loudly here, so an unverified description is an unverified skill.

Split skills by **activity**, not by subject area. Layer is mechanical and can be routed from the paths a change touches; whether someone is writing or reviewing cannot be inferred from a path, so that is the boundary worth spending a skill on.

## Step 3 — Structure it

```text
skill-name/
├── SKILL.md              # frontmatter, boundaries, numbered steps
├── scripts/              # the blocking check
└── references/           # layer- or case-specific detail, loaded on demand
```

Put detail that applies to a subset of invocations in `references/`, so it loads only when needed. `SKILL.md` stays a router.

Both boundary headings are required, and either wording is accepted: `## Do not use this skill for` when the exclusions are other skills that own the case, `## Do not use this skill when` when they are circumstances rather than alternatives. Pick the one that reads as a sentence with its own list.

The body should carry, in order: when to use and when not, a read-the-record step, an exemplar to copy from, the blocking check, and what the check cannot see. The last is not filler — a skill that implies a green check means conformance is worse than no skill.

**Verify the exemplars.** A skill that points at a file which fails its own check teaches the wrong shape. Run the check against every file the table names.

### What language a script is written in

Two languages, chosen by what the script does rather than by preference:

| Write it in | When                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Shell       | Orchestration — resolving the workspace, selecting files from git, invoking a tool, mapping its output back, exit codes |
| TypeScript  | Everything else — parsing, analysis, transforming text, and any plugin a tool loads, including ones it runs under node  |

No third language. Do not reach for JavaScript or CommonJS because a tool *loads* the file rather than running it. Node strips types from a `.ts` file, so a linter plugin, a config module and a hook are TypeScript like everything else. Check what the host actually does before concluding it cannot.

Two details follow from node being the loader rather than `bun`. Imports need an explicit `.ts` extension, because ESM resolution does no extension guessing. And the syntax has to be erasable: an `enum` or a `namespace` fails where a type annotation does not.

Where a checker and its fixer share an algorithm, write it once and have both call it.

## Step 4 — Write the check so it can fail

A checker that silently matches nothing reports zero violations forever and reads as a clean codebase. Before trusting one:

1. Run it against a deliberate violation and confirm it fires
2. Run it against the compliant form and confirm it stays silent
3. Confirm the exit code is non-zero on violation — a check nothing can fail is decoration

**Invoke scripts by a path the reader can run**. In a project skill that is the workspace-relative path from `.claude/skills/...` onwards; in a skill installed outside any project it is the path relative to the skill directory, which the harness resolves. The checker finds a skill's scripts by matching that prefix in the body, so `./scripts/check.sh` reads as an unreferenced script and the real invocation goes unverified. It also means a reader can copy the line straight into a terminal at the workspace root.

Conventions for the script itself, so they behave alike:

- Default to files **changed against git**; accept explicit paths; support `--all`
- Derive the workspace root from the script's own location, never from `git rev-parse --show-toplevel`. This workspace is nested inside a much larger repository, so the git root is an **ancestor** of it. Anything driven from git — `git diff`, `git ls-files` — returns paths relative to that outer root and has to be resolved against it, then filtered back down to this workspace
- Exclude tooling directories as well as build output. A checker that scans `.claude/` reports its own scripts as findings, which is noise the first time and ignored thereafter
- Repeat exclusions in every collection mode. Pruning a directory during a walk does nothing for the changed-files and explicit-path modes, which never walk
- Print `path:line`, then the rule name in brackets and what to do about it
- End with a one-line summary carrying the counts
- Name the governing record on failure, so the reader can find the reasoning

## Step 5 — Check that the skill changes behaviour

The structural checker proves a skill is well-formed. It cannot prove the skill **works** — that following it produces different behaviour from not following it.

Before a skill is finished, establish the baseline:

1. Pick the situation the skill exists for, and state what a reader would do **without** it. Be concrete; guess at the specific wrong move, not a vague failure
2. Read the draft and ask whether it prevents *that* move. If the wrong move is still available after reading, the skill describes the right answer without closing the wrong one
3. Write down the rationalisation that would defeat it — "this case is different", "just this once", "the rule obviously means something else here" — and answer it in the text

A skill that only describes good practice is a reference. A skill that names the specific failure it prevents, and closes the reasoning that leads there, is a control. Prefer the second.

This is why every skill here ends with what its check *cannot* see. Naming the gap is what stops a passing check from being read as approval.

## Step 6 — Run the checker (blocking)

```bash
scripts/check-skill.sh
```

Checks every skill, or the ones named. It enforces frontmatter validity, that the name matches its directory, that a description is present and substantial enough to be selectable, that both boundary sections exist, that relative links resolve, that every script the body invokes exists and is executable, and that no script sits in `scripts/` unreferenced.

That last pair is the failure this checker exists for. A skill whose one blocking step invokes a path that no longer exists still loads, still reads plausibly, and does nothing — which is exactly what happened when a skill was moved between directories and its paths were left behind.

## Step 7 — Route to it

Add a row to the skills table in the root `CLAUDE.md`. A skill that only the description can surface will be found sometimes; one the project file names will be found reliably.
