---
name: identification-prompt
description: Turns an idea, a gap, or a problem uncovered during a session into a prompt for pi-crust's Identify Activity, ready to paste into the gh-issue lifecycle so the problem is logged as an issue someone can act on later. Use when asked for an "identification prompt", "a prompt for gh-issue", "a prompt I can feed to identify", to "log this as an issue", "file that for later", or "restate that as a prompt", and when a session surfaces a problem the developer wants captured without fixing it now. Not for prompts that launch build work (see cookbooks/how_to_prompt_for_the_eng.md), not for Activity prompt files under runtime/prompts/ (use prompt-authoring), and not for specs (use spec-authoring).
---

# Writing an Identification Prompt

A developer and an agent often find a problem in passing, such as a gap noticed while answering a question about a pull request. The developer wants it logged, not fixed. This skill turns what the session established into a prompt for the `gh-issue` lifecycle (`identify`, then `gh-issue`), so that the issue that lands can be acted on by someone who never saw the session.

## Use this skill when

- Asked for an "identification prompt", "a prompt for the gh-issue lifecycle", or "a prompt I can feed to identify"
- Asked to "log this as an issue", "file that for later", or "restate that as a prompt"
- A session has surfaced a gap, bug, or idea that the developer wants captured and not fixed now

## Do not use this skill for

- A prompt that launches build work through `sdlc`, `ship`, or another chain that changes code. Follow `cookbooks/how_to_prompt_for_the_eng.md`
- An Activity's own `system.md` or `user.md`. Use `prompt-authoring`
- A specification in `specs/`. Use `spec-authoring`, and only when the developer asked for a spec
- Filing the issue yourself with `gh issue create`. The lifecycle files it, and only when the developer runs it

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it.

## Step 1 — Read what Identify does with the prompt

Read `runtime/prompts/identify/system.md` and `runtime/prompts/identify/user.md` before writing. In a stamped repository, check `.pi-crust/prompts/identify/` first, because an override there replaces the shipped prompts. These facts about the shipped prompts shape everything below:

- **The prompt is copied verbatim** into the `## Request` section of `identify.md`, and the `gh-issue` Activity copies that document into the issue body. Every word you write is published to the issue, so write it for a person reading GitHub months from now, not for the agent.
- **Identify turns a problem into an outcome, success criteria, scenarios, scope, and constraints.** It is told not to name a file, module, or algorithm in the outcome or criteria. A prompt that states a solution makes Identify reverse-engineer the problem from it, and that guess is recorded as an assumption.
- **Identify sorts statements** into facts (with evidence), assumptions (with what would disprove them), unresolved questions, constraints (with their source), and out of scope. A prompt that already separates these is classified correctly. A prompt that blurs them leads Identify to treat an inference as a fact.
- **Identify writes one document and changes no source.** The lifecycle does not build. Instructions such as "do not commit", "reproduce in `mktemp -d`", or "run the tests" address work that this lifecycle never performs.

## Step 2 — Establish what the session actually knows

Before writing, sort what the conversation produced:

| Kind               | Example from a session                                                | How the prompt carries it                                   |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Observed           | A command was run, a file was read, and its output or content says X  | State it as a fact and name the source                      |
| Inferred           | "Reading the code, a committed edit would appear in neither snapshot" | Say it was inferred and has not been reproduced             |
| Unknown            | "Whether the path policy already blocks this"                         | List it as an open question                                 |
| Requested solution | The developer said "it must use X"                                    | State it as a requirement and attribute it to the developer |
| Suggested solution | The agent proposed X while discussing it                              | Label it as a possible approach, not a requirement          |

Do not upgrade an inference to a fact to make the prompt sound decisive. The issue is the record that a later run will trust.

## Step 3 — Write the prompt

Include, in this order:

1. **The problem**: who or what is affected and what goes wrong, in the vocabulary of the people affected. Lead with this, not with the code.
2. **The evidence**: the paths and symbols involved, and how the problem was found (observed or inferred, and in which session or pull request).
3. **The outcome wanted**: what becomes true when this is resolved, without naming an implementation.
4. **What is not established**: open questions, phrased so a later run can settle them.
5. **Possible approaches**, only if the session produced them, each explicitly marked as not a requirement.
6. **Constraints** that already exist, each with its source, and **out of scope** items a reader could reasonably assume are included.

Rules:

- **Default to one paragraph.** It pastes cleanly into a shell or a chat box. Use more paragraphs, or a short list, only when one paragraph would lose a distinction the issue needs, such as several independent locations, each with its own behaviour.
- **Make it self-contained.** Do not refer to "the gap above", "as discussed", or "#3". The reader has only the issue.
- **Cite committed content only.** A gitignored or untracked file does not exist for the issue reader, and may not exist for the run. `specs/` is gitignored in pi-crust, so a prompt that says "Implement `specs/x.md`" publishes a path to nothing. Put the content in the prompt itself.
- **Prefer a path plus a symbol name over a line number.** Line numbers drift with the next commit. Add one only with the commit SHA it refers to, or when the pull request it comes from is named.
- **Name the default branch, branch, or pull request** when the evidence exists only there. Code on an unmerged branch is not on `main`.
- **Do not address the harness.** No "do not change files", "investigate and report", or "reproduce in a temporary directory". The lifecycle decides what runs. Describe the problem and what the investigation must answer.
- **Do not write the fix as the ask.** "Replace X with Y and add tests" is a build instruction. Unless the developer required it, state the outcome and offer the fix as a possible approach.

## Step 4 — Run the check (blocking)

Save the prompt to a scratch file (or pipe it from the clipboard) and run:

```bash
bun scripts/check-identification-prompt.ts <file>
```

It fails when a backticked path the prompt cites is missing, gitignored, untracked, or cited with a line number past the end of the file. It warns when a cited file has uncommitted changes, because its line numbers may not match what the issue reader sees, and when the prompt has more than one paragraph. Exit 0 is clean, 1 is violations, 2 is a usage error. Delete the scratch file afterwards.

## Step 5 — Deliver it

Return the prompt in a fenced block that the developer can copy, using four backticks when the prompt contains three. Do not launch the lifecycle or file an issue unless asked. When the developer asks for the command, give it with a quoted heredoc, because backticks inside a double-quoted shell argument run as commands:

```sh
just crust run "$(cat <<'PROMPT'
<the prompt>
PROMPT
)" --lifecycle gh-issue
```

Write the prompt to a file only when the developer asks, and say so if the location they named is gitignored.

## Exemplars

[references/examples.md](references/examples.md) holds two prompts from the session that produced this skill. Each is shown as first drafted and as rewritten, with what changed and why.

## What the check cannot see

- **Whether the prompt states the problem rather than a solution.** It reads paths, not intent. Re-read the prompt and ask whether Identify could write an outcome from it without guessing what the fix was meant to achieve.
- **Whether a claim is observed or inferred.** Only the session knows. Check each sentence against Step 2.
- **Whether a backticked symbol exists.** Only paths are verified. Search for each symbol name with `git grep` before citing it.
- **Whether the prompt is self-contained.** Read it as someone who has seen only the issue.
