---
name: adr-authoring
description: Writes, amends, and supersedes architecture decision records in this monorepo's adr/ directory, and runs a blocking checker that enforces their portability and structure. Use when recording a decision, adding or editing anything under adr/, changing a record's status, being told "write that down" or "that should be an ADR", or when a correction needs a home. Also use when deciding whether something belongs in a record at all rather than in a package CLAUDE.md. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Authoring a Record

## Use this skill when

- Recording a decision, or told "write that down" / "that should be an ADR"
- Adding or editing any file under `adr/`
- Changing a record's status, or superseding one
- Deciding whether a correction belongs in a record or a package `CLAUDE.md`

## Do not use this skill for

- Package-specific facts — stack, env vars, known deviations. Those go in that package's `CLAUDE.md`, and putting them in a record is the failure this skill exists to prevent
- Writing the code a record governs — use `functional-conventions`

## Step 1 — Decide whether it is a record at all

Most corrections are not new records. Route in this order:

| The correction is | Put it |
|---|---|
| A rule that should hold in any repo doing this kind of work | A record in `adr/` |
| True only of one package — its stack, its deviations, its migration state | That package's `CLAUDE.md` |
| A routing problem — the right document existed but was not read | The trigger table in the root `CLAUDE.md` |
| About how the agent should behave, not about this code | Personal agent config, outside the repo |

A record that names one project is not a record. It is package documentation in the wrong directory.

## Step 2 — Place it

Records live in a nest by language, and language-agnostic topics sit outside the nests. Read [adr/README.md](../adr/README.md) if unsure which nest applies. Adding a language later must mean adding a directory, not rewriting the root.

Start from [adr/template.md](../adr/template.md).

## Step 3 — Write it portable

Another repository should be able to copy `adr/` wholesale and delete the nests it does not use. That is the standard, and it has one practical consequence: a record may name a **technology**, because an unused technology is deleted like an unused nest, but never a **project, path, count, or line number**.

| Allowed | Not allowed |
|---|---|
| "a tagged template, executed by the driver" | "`apps/some-app/src/data/`" |
| an import statement naming the shared package | "twenty-two modules currently do this" |
| "the reference implementation names the columns" | "see `resolve-thing.ts:66`" |

Import statements are deliberately allowed. An adopting repository edits one line; omitting it leaves a symbol with no origin and nothing to edit.

Counts are the trap. They read as authority, go stale on the next commit, and a wrong count is worse than none. If the number matters, it belongs in a `CLAUDE.md`, where it is expected to move.

Cite a **quoted heading**, never a section number. Numbers shift silently when a section is inserted above them.

`adr/project-organization/` is exempt from the portability rule by decision — repo-specific detail aids comprehension there.

## Step 4 — Write from evidence

The reasoning standard lives in [write-from-evidence.md](../adr/conventions/write-from-evidence.md): it covers what reasoning to include, how to keep uncertainty inspectable, and calibrating examples of rhetoric to avoid.

The checker cannot see any of this. A record that passes `check-adr.sh` and argues with its reader instead of showing its evidence is still wrong.

## Step 5 — Run the checker (blocking)

```bash
scripts/check-adr.sh
```

With no arguments it checks records changed against git. Pass paths to narrow, or `--all` to sweep. Exit 1 means violations.

It enforces what is mechanical: paths and counts in prose, status present and valid, a decision record carrying a Decision section, relative links resolving, directory links, and section-number citations. It cannot tell you whether the decision is right, whether it contradicts another record, or whether the rationale survives a reader who disagrees.

The repository currently passes `--all`. Keep it that way — unlike the code checks, this one has no pre-existing debt to work around.

## Step 6 — Route to it

A record nobody finds is not written down. Add a row to the trigger table in the nest's `README.md`, naming the **task** rather than the document.

If the decision is now enforced by a tool, say so where the tool lives, so the rule and its enforcement point at each other.

## Superseding

Do not edit a decision into reversal. Set the old record's status to `superseded`, say what replaced it, and write the new one. The reasoning that was rejected is the most useful part of the history — deleting it invites the same proposal again next year.

Status is one of `proposed`, `accepted`, `superseded`, `deprecated`. Leave a record `proposed` while questions are genuinely open, and answer them before accepting it; a record that disagrees with the code implementing it is worse than no record.
