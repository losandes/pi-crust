---
name: markdown-authoring
description: Applies this monorepo's markdown conventions when writing or repairing any .md file — records, CLAUDE.md, READMEs, skills, project-state artifacts, design notes — and runs a blocking checker over wrapping, headings, lists, fences, links, tables, and whitespace. Use when writing or editing markdown, when asked to reflow or tidy a document, when a diff shows several changed lines for a one-word edit, or when deciding how to format a document at all. Hard-wrapping prose at a column is the specific habit it exists to stop. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Authoring Markdown

## Use this skill when

- Writing or editing any `.md` file — records, `CLAUDE.md`, READMEs, skills, project-state artifacts, design notes
- Asked to reflow, tidy, or clean up a document
- A diff shows several changed lines because one word changed
- Deciding how a new document should be formatted

## Do not use this skill for

- Deciding what a document should *say*. Use `adr-authoring` for a record, `project-state` for durable working context, `planning-work` for a plan. This skill governs the shape of a file, never its content
- Drawing a diagram inside a fence — use `ascii-diagrams`, which owns everything between the fence markers
- Formatting code, including code inside fenced blocks. Biome owns that

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## Step 1 — Read the record

Every rule is in [format-markdown.md](../adr/conventions/format-markdown.md), with the reasoning behind it and the carve-outs. Read it before writing, and amend *it* — not this skill — if a rule is wrong. A rule restated here would drift from the record and then contradict it.

## Step 2 — Copy an exemplar

Match a file that is verified to conform rather than composing from the record:

| To write                 | Copy                                                                      |
| ------------------------ | ------------------------------------------------------------------------- |
| A record                 | [format-markdown.md](../adr/conventions/format-markdown.md)               |
| A skill                  | this file                                                                 |
| A project-state artifact | [example-artifact.md](../project-state/references/example-artifact.md) |

All three pass the checker as written. If an exemplar ever fails it, fix the exemplar before copying it, because a skill that points at a non-conforming file teaches the wrong shape.

## Step 3 — Run the checker (blocking)

```bash
scripts/check-markdown.sh
```

With no arguments it checks markdown changed against git. Pass paths to narrow, or `--all` to sweep. Exit 1 means violations. Each finding carries its markdownlint identifier, or `no-hard-wrap` for the one rule markdownlint has no equivalent of, so the output points back at the record.

The linting is markdownlint's, via `markdownlint-cli2`. The script owns only scope and exemptions; the rules live in `.markdownlint-cli2.jsonc` beside it, which is the record expressed as configuration. Two rules in `rules/` are this skill's own, because markdownlint has no equivalent: `no-hard-wrap`, and `table-alignment` for column padding. Both are TypeScript. They import with an explicit `.ts` extension where they import at all, because markdownlint loads them under node, whose ESM resolution does no extension guessing. That file sits inside the skill rather than at the workspace root on purpose: at the root an editor's markdownlint extension would discover it and lint every keystroke, and this is not turned on for developer edits.

Changed-files is the default because the record migrates documents as they are touched. `--all` does not pass today and must not be made to pass by a bulk reflow.

## Repairing a document

Most of it is automatic:

```bash
bunx markdownlint-cli2 --fix <file>...
```

That repairs blank lines, list markers, whitespace, and table padding. Every rule behind those carries `fixInfo`, including this skill's own `table-alignment`.

One repair is not automatic, deliberately:

```bash
bun scripts/reflow.ts <file>...
```

It joins the continuation lines of paragraphs and of single list items, leaving fences, tables, headings, block quotes and frontmatter untouched, and prints the line count before and after for each file it changed.

`no-hard-wrap` carries no `fixInfo` on purpose. Joining lines means deciding what is a paragraph and what is deliberately two blocks, and a wrong automatic join silently merges them, so that decision happens where a person can read the result rather than inside `--fix`.

Reflowing is a change to every line in a file, which buries whatever change prompted it. Reflow as its own commit, or not at all. Afterwards, confirm the non-whitespace characters are unchanged — that is the cheap proof that lines were joined and nothing was rewritten. If `--fix` ran in the same pass, normalise separator rows before comparing: padding a table changes their dash count, and the proof reports a false difference on every table otherwise.

## What the check cannot see

The checker reads shape, and shape is the easy half.

- **A paragraph that should have been three.** One long line can hold a wall of unrelated thoughts, and nothing here measures whether a block is a block
- **A table that should have been prose, or prose that should have been a table.** `ascii-diagrams` makes that call for diagrams; nothing makes it for tables
- **A heading that lies about what follows it.** Levels increment correctly in documents whose structure is nonsense
- **Reflow churn.** Nothing stops a well-meant pass that reflows a file the task never touched. Check `git status` afterwards and revert what the task did not require
- **Whether a rule still deserves to hold.** That argument belongs in the record
