---
name: project-state
description: Creates, updates, distils, and discovers project-state artifacts under .context/project-state/<year>/<project>/<owner>/, turning Pi session exports, Markdown notes, pasted Slack threads, GitHub issues and PRs, commits, and another developer's artifact into durable working context — objective, current state, decisions and rationale, discoveries, constraints, known problems, open questions, rejected approaches, next steps. Not an activity log - no chronology, diff stats, commit hashes, test counts, or review history. Use when asked to save or update project context, to "write up what we learned", to hand work off or pick it up, to answer "does anyone have context on X" or "what did we learn last year", or to explain how project-state relates to context-mode. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Project State

Turn supplied source material into a small, structured artifact that carries a body of work across Pi sessions and between developers.

> **Sources → project-state artifact → context-mode index → relevant context in future sessions**

The artifact holds **durable working context, not an activity log** — not a history or summary of the sources.

> **Retention test:** before recording anything, ask what future question, decision, or action it would help with. If there is no plausible answer, omit it.

State over history, knowledge over activity, reasoning over implementation trivia. Git, GitHub, and the code are already authoritative for diffs, review threads, and current branch state; an artifact that restates them is redundant and stale on arrival. Keep the pointer and the reason it matters, not the metadata.

Each layer has one job: sources preserve primary evidence, artifacts preserve curated durable knowledge, Git distributes them, context-mode indexes them for selective retrieval, and a Pi session is temporary working context. The artifact is the durable thing; the index can be rebuilt from it. context-mode does not replace the artifact.

## Use this skill when

- Asked to save, write up, capture, or update context for a body of work
- Asked to add Pi session exports, notes, a pasted Slack conversation, a GitHub issue or PR, or commits to an existing project-state artifact
- Handing work to another developer, or picking up theirs
- Asked "does anyone have context on X", "where is my project state", "is there anything relevant from last year"
- Asked how project-state works, what belongs in it, how to name an artifact, or how it relates to context-mode
- Editing anything under `.context/project-state/`

## Do not use this skill for

- Recording a decision the whole team must follow — use `adr-authoring`. A record states the rule for everyone; an artifact states what one owner knows about one body of work. A decision that outlives the project belongs in `adr/`
- Planning or scoping work that has not happened yet — use `planning-work`. This skill writes down what is already known, not what is proposed
- Narrating a debugging session — use `systematic-debugging`. Its outcome may later become a discovery or a rejected approach here
- Indexing content for retrieval. Indexing is a separate operation; do not run it unless asked

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## Step 1 — Establish inputs

Two things are needed before writing anything:

1. **Sources** — the evidence to analyse. Paths, references reachable through tools, or material already pasted into the conversation.
2. **Artifact** — the Markdown file to create or update.

If either cannot be determined from the request, ask only for what is missing. If the developer names the body of work but not the path, derive it with them from [references/convention.md](references/convention.md), which also covers ownership, working across years, handoffs, and cheap discovery of existing artifacts.

Interpret natural language. "Add these sessions to my authorization context" is a complete request once year, project, owner, and artifact name are settled.

## Step 2 — Read the existing artifact first

If the target exists, read it before processing new sources. It is previously synthesised knowledge and is **not** automatically less authoritative than whatever was just supplied. Reconcile; do not append a new source summary to the bottom.

## Step 3 — Extract state, not history

Read [references/extraction.md](references/extraction.md) before synthesising. It carries the rules that decide what survives: current state over chronology, reconcile rather than append, preserve rationale, distinguish fact from uncertainty, weigh source authority and freshness, keep useful negative knowledge, and record only what the evidence supports.

## Step 4 — Apply the retention test to every line

Read [references/retention.md](references/retention.md). It holds the keep/omit lists, the six-month question, the ephemeral-versus-durable table, and the rule that each update should be able to make the artifact **smaller**.

The short form: what we are doing right now is usually ephemeral; what we learned while doing it is usually durable. Preserve the second aggressively. When new information supersedes old, rewrite the old rather than appending beside it; when finished work leaves durable knowledge, keep the knowledge and drop the activity record.

## Step 5 — Write it

Follow the shape in [references/artifact-template.md](references/artifact-template.md). A conforming example is [references/example-artifact.md](references/example-artifact.md) — copy its headings, metadata block, and entry density rather than inventing a layout.

Sections are a guide, not a schema; omit the ones with nothing in them. Never organise by source type — no `## Slack Notes`, `## Pi Session Notes`, `## PR 184`. Evidence from three sources lands in `## Decisions`, `## Active Work`, and `## Known Problems` together.

## Step 6 — Run the checker (blocking)

```bash
scripts/check-project-state.sh
```

Defaults to artifacts changed against git; takes explicit paths, or `--all`. It enforces the path convention, that the metadata block agrees with the path, that `## Objective` exists, that no section is named after a source or a chronology, that artifact names are semantic rather than sessions or PR numbers, that no commit hashes, diff stats, or test counts have crept in, that `Recently Completed` has not become a changelog, and that the file has not grown into a document the next session must read in full.

## Step 7 — Report, and stop

After writing, report briefly: artifact path, sources processed, created or updated, the major state changes made, and any contradiction or uncertainty that could not be resolved. Do not reproduce the artifact in the response unless asked.

Do not index it, and do not commit it, without being asked. Artifact creation and context-mode indexing are separate operations.

## Explaining the skill

When asked how any of this works rather than asked to run it, answer from [references/explaining.md](references/explaining.md) — invocation forms, the questions developers ask, and the division of responsibility between sources, artifacts, Git, context-mode, and sessions. Do not invent a parallel workflow, and do not make the developer classify their own decisions and discoveries first. That synthesis is what this skill is for.

## What the check cannot see

The checker reads shape. It cannot read truth.

- **Invented state.** Nothing detects a decision that was never made, a PR recorded as merged that is still open, or an inference presented as fact. Accuracy is yours; the evidence must support every line
- **Lost rationale.** A decision stripped of its reason passes every rule and is worth a fraction of what it was
- **Appended rather than reconciled.** Two entries describing the same decision from two sources look exactly like two decisions
- **Staleness.** `Last updated` being well-formed says nothing about whether Active Work is still active
- **Edits to someone else's artifact.** The path convention records an owner; it cannot stop you writing into another owner's directory. Do not
- **Over-collection.** A file under the size limit can still be padded with material no future session needs. The checker catches the metadata patterns it can name — hashes, diff stats, test counts — not a paragraph of narrated activity that happens to avoid them
- **Monotonic growth.** Nothing detects an update that only added. If the artifact did not get denser, the retention test was not applied
