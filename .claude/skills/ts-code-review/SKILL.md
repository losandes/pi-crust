---
name: ts-code-review
description: Reviews TypeScript changes in this monorepo against the ratified conventions, routing by layer — backend data/use-case modules, frontend React components, or both. Runs the blocking automated checks (Biome lint and plugins, accessibility rules, and the typed parameter-immutability checker) before any human-judgement review, and loads only the records governing the layers actually touched. Use for every kind of review - "code review", "fp review", "functional review", "be review", "fe review", reviewing a PR, diff, or branch, checking work against conventions, and verifying a change before it is committed or reported complete. This is the only review skill — it covers functional, backend, and frontend conventions together. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins. TypeScript and TSX only.
---

# Code Review

## Use this skill when

- Asked to review code, a diff, a branch, or a pull request
- Asked for a "code review", "fp review", "functional review", "be review", or "fe review" — all of them, this is the only review skill
- Verifying your own work before committing or reporting it complete

There is no separate functional, backend, or frontend reviewer. Step 2 routes to the records for the layers a change actually touches, and the functional record applies to every one of them.

## Do not use this skill for

- Reviewing tests — use the `test-conventions` skill
- **Authoring** new code — use `functional-conventions`, which anchors on exemplar files to copy from. That skill writes; this one judges what was written. They run the same two checks, so nothing is lost by using either alone.

This skill contains **no rules of its own.** Rules live in the records, so the two can never disagree.

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## Step 1 — Establish what changed

```bash
git diff --name-only --diff-filter=ACMR HEAD
git diff --stat HEAD
```

Review the change, not the repository. Most packages have pre-existing violations recorded as debt; reporting them as if the author introduced them buries the findings that matter. If a file is untouched, it is not in scope.

## Step 2 — Route by layer

Read the records for the layers actually touched. Do not read all of them.

| Changed paths | Read |
|---|---|
| Anything `.ts`/`.tsx` | [functional-conventions.md](../adr/typescript/functional-conventions.md) — **always**, every layer |
| `**/data/**` | [rdbms-conventions.md](../adr/sql/rdbms-conventions.md), plus [use-raw-sql-with-drizzle.md](../adr/typescript/use-raw-sql-with-drizzle.md) when the project uses Drizzle, [backend brief](../adr/project-organization/backend-domains-design-brief.md) |
| `**/use-cases/**`, `**/routes/**`, `**/middleware/**` | [backend brief](../adr/project-organization/backend-domains-design-brief.md), [references/backend.md](references/backend.md) |
| `**/*.tsx`, `**/components/**`, `**/pages/**` | [frontend brief](../adr/project-organization/frontend-domains-design-brief.md), [references/frontend.md](references/frontend.md) |
| Zustand stores, `use*.ts` hooks | [state management](../adr/typescript/state-management/use-combo-useState-and-zustand-brief.md), [references/frontend.md](references/frontend.md) |
| `Promise.*`, batches, concurrency | [settle-all-tasks-and-measure-failures.md](../adr/typescript/settle-all-tasks-and-measure-failures.md) |
| New tables, keys, migrations | [adr/sql/README.md](../adr/sql/README.md) |
| `*.test.ts` | Stop and load the `test-conventions` skill instead |

Functional conventions apply to every layer. A React component is subject to the same rules about purity, immutability, and settlements as a data module — the frontend record adds rules, it does not replace them.

## Step 3 — Run the checks before reading for judgement (blocking)

Never hand-review something a tool can answer. Run these first, so the review spends its attention on what tools cannot see.

```bash
# from the repo root
node_modules/.bin/biome lint <changed paths>
bun the `ts-functional-conventions` skill
```

`biome lint` covers the syntactic conventions, the five plugins that enforce the functional record, and — for `.tsx` — the accessibility rules. The second command covers parameter immutability, which needs resolved types and so cannot be a plugin. It defaults to files changed against git.

Three rules for reading the output:

1. **A finding in a file the author did not touch is debt, not a review comment.** Say so separately, if at all.
2. **A new suppression is a finding.** `// biome-ignore lint/plugin: <reason>` is legitimate only when the reason names an exception the record allows. "Rule is annoying" is not one, and `lint/plugin` silences every plugin on the line.
3. **A green build is not conformance.** It means the checkable minority passed. Step 4 is where the review earns its keep.

For the full rule set, its limits, and how to add a rule, see the workspace's own Biome plugin directory.

## Step 4 — Review what no tool can check

| Question | Record |
|---|---|
| Does each `let` clear the three-part bar, or is it a fallback? | functional, "Immutability" |
| Is the use case pure, or does it fetch what it should have been given? | functional, "Pure core, effects at the edges" |
| Are dependencies first, data last, and is context a `Pick<>` rather than the whole thing? | functional, "Dependencies first, data last" |
| Is untrusted data parsed at the boundary, or cast into a type? | functional, "Parse at the boundary" |
| Is a settlement's `hasIssues` inspected, or silently dropped? | functional, "Return results" |
| Has a pipeline gone point-free to the point of obscuring intent? | functional, "Composition over loops" |
| Does this module's name describe the domain, or the technical layer? | project organization |
| Is the change in the right layer at all? | the brief for that side of the stack |

Layer-specific judgement questions are in [references/backend.md](references/backend.md) and [references/frontend.md](references/frontend.md). Load only the one that applies.

## Step 5 — Report

Lead with what blocks. Order by consequence, not by file.

- **Blocking** — a check fails on a touched file, or a convention is broken
- **Worth changing** — defensible but at odds with a record; name the record
- **Noted** — pre-existing debt the change sits near, stated once and not itemised

Cite `path:line`. Quote the record rather than paraphrasing it, so the author can disagree with the rule rather than with you. If a finding is a judgement call rather than a rule, say which it is.

Do not write a YAML plan file. Report in the conversation; the author decides what to apply.
