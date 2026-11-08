---
name: pr-check
description: Readies a branch for a pull request by running every check the branch's own changes make applicable — markdown, records, skills, project-state, test conventions, Biome lint, parameter immutability, and the touched packages' test suites — then cleaning up scratch files and incidental churn before the PR is opened. Use when asked to open a PR, raise a PR, "is this ready for review", "check my branch", or before pushing a branch for others to read. Owns no conventions of its own; it routes to the skill that owns each failure. A developer can force the PR past failures, which is a deliberate, recorded exception rather than the normal path. Defaults for any project — use this only when the project itself advertises no equivalent convention skill of its own, which always wins.
---

# Pre-PR Check

This skill owns no rules. It decides, from the paths a branch touched, which existing checks apply, runs them, and reports one verdict. Every failure belongs to another skill, and that is where it gets fixed.

## Use this skill when

- Asked to open, raise, or prepare a pull request
- Asked "is this ready for review", "check my branch", "anything left before I push"
- Finishing a body of work that others are about to read
- Before pushing a branch that someone will review

## Do not use this skill for

- Reviewing the substance of a change — use `ts-code-review`. This skill proves the mechanical things are clean so a review can spend its attention on what tools cannot see
- Fixing a failure it reports. Each one routes to the skill that owns the rule, listed in Step 2
- Deciding what the work should be — use `planning-work`
- Writing the commits. Conventional Commits and present-tense imperative phrasing are decided in the `adr/git/` records

## Write for inspection

Prose this skill produces follows [write-from-evidence.md](../adr/conventions/write-from-evidence.md): lead with the finding or decision, support it with evidence, distinguish observation from inference, make material uncertainty inspectable, and stop once the reader can evaluate and act on it. No checker enforces this.

## Step 1 — Run the gate (blocking)

```bash
scripts/check-pr.sh
```

It compares `HEAD` against the merge base with `main`, so work committed earlier on the branch is in scope, not just what changed since the last commit. Uncommitted edits are included too, because a check that ignores them passes on a tree nobody will push.

It runs in two passes. The **scoped** pass checks what the branch touched. The **repository-wide** pass then lints the whole repository and runs every package suite, because a scoped check cannot see a change that breaks something it never opened.

Useful variants: `--base <ref>` when the PR targets something other than `main`, `--no-tests` while iterating because the suites are the slow part, `--no-wide` to skip the repository pass, and `--list` to see what would run without running it.

Exit 1 means a blocking failure, or a dirty working tree. Both stop a pull request for the same reason: what a reviewer reads must be what the checks were run against.

## Step 1a — Read the repository-wide pass correctly

The repository always has failures that are nobody's fault today. Making the author fix them to ship their change is how a branch grows until nobody can review it. So the wide pass sorts what fails into three buckets, and only two of them block.

| Bucket     | Meaning                                        | Blocks |
| ---------- | ---------------------------------------------- | ------ |
| introduced | The failure is in a file this branch changed   | Yes    |
| downstream | The package depends on one this branch changed | Yes    |
| unrelated  | Nothing links the failure to this branch       | No     |

**Downstream is the bucket this pass exists for.** A package the branch never opened, failing because something it depends on changed, is exactly what an unintended consequence looks like. Treat it as caused by the branch until the base ref is shown to fail the same way.

**Unrelated is a claim about provenance, not history.** It means nothing here links the failure to this branch — not that the failure predates it. If the distinction matters, settle it on the base ref rather than assuming:

```bash
git worktree add ../pr-check-base <base-ref>
cd ../pr-check-base && <install> && cd <failing package> && <the project's test script>
cd - && git worktree remove ../pr-check-base
```

That is deliberately manual: it needs its own install, it is slow, and it is worth paying for only when a failure's provenance changes a decision.

Unrelated failures are not fixed in this branch. They are named in the pull request description so a reviewer does not read them as the author's, and filed as issues if nobody has.

## Step 2 — Route each failure to its owner

| Failing check              | Fix it with                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `markdown`                 | `markdown-authoring`                                                                     |
| `records`                  | `adr-authoring`                                                                          |
| `skills`                   | `skill-authoring`                                                                        |
| `project-state`            | `project-state`                                                                          |
| `test-conventions`         | `ts-test-conventions`                                                                    |
| `lint`, `immutable-params` | `ts-functional-conventions` for code being written, `ts-code-review` when reading a diff |
| `tests: <package>`         | `systematic-debugging` — a failing test is a bug until proven otherwise                  |

Do not suppress, exclude, or narrow a check to make it pass. A rule that reports nothing because it was disabled looks exactly like a clean branch, which is the failure these checks exist to prevent.

Pre-existing failures are a real case and a different one. If a check fails on code the branch never touched, say so with the evidence that it fails on the base ref too, and leave it alone — the repository has recorded debt, and fixing it here buries the change under unrelated edits.

## Step 3 — Clean up before anyone reads it

The gate cannot see any of this.

- Scratch files, fixtures, and probes created while working. Delete them, and say that you did
- Incidental churn from a formatter or autofixer pointed at a whole directory. `git status` and revert anything the task did not require
- Debug logging, commented-out code, and `TODO`s with no owner
- Commits that only fix an earlier commit on the same branch. Squash them so the history reads as the work, not as the process of getting there
- Commit messages: Conventional Commits, present-tense imperative, per the `adr/git/` records

## Step 4 — Open the pull request, with approval

Opening a PR needs approval in both working modes. Ask first, then open it.

The description states what changed and why, names the records the change follows, and carries the evidence — the commands run and their summary lines, not an assurance that they passed. Anything deliberately left undone is named in the description rather than discovered by the reviewer.

## Forcing past a failure

A developer can say to open the PR anyway, and that is a legitimate instruction. It is an exception, not the normal path, so it is recorded rather than quietly honoured.

When forced: run the gate anyway, because the output is the thing worth recording; open the PR; and put each failing check in the description with one line on why it is acceptable now and what will resolve it. Never present a forced PR as having passed, and never make the output green by narrowing a check.

If the only failure is a dirty working tree, forcing is almost always the wrong answer — commit or stash first, because a reviewer cannot see a file that was never pushed.

## What the check cannot see

- **Whether the change is right.** Every check here is mechanical. A branch can be perfectly clean and still solve the wrong problem
- **Whether the tests mean anything.** A suite can pass because it asserts nothing. `ts-test-conventions` governs their shape; only reading them tells you if they bite
- **Pre-existing versus introduced.** The wide pass sorts by provenance — which files changed, which packages depend on them — not by history. A failure can land in `unrelated` and still have been caused by this branch through a path the package graph does not express: a shared fixture, a generated artefact, an environment variable
- **A dependency edge that is not in `package.json`.** Blast radius is computed from declared dependencies. Code reaching across packages by relative path, or coupling through a database or a file on disk, is invisible to it
- **Scope creep.** Nothing measures whether the branch did more than it was asked to
- **An empty PR description.** The evidence has to be written by whoever ran the checks
