---
name: ts-test-conventions
description: Writes, reviews, and runs bun tests in this monorepo (*.test.ts, *.test.tsx). Loads the ratified test conventions ADR, points at verified exemplar test files, gives the correct test command per situation, and runs a blocking convention checker. Use when creating or modifying any test file, when asked to add or fix tests or improve coverage, when a reviewer raises test structure, mocking, describe blocks, or given/when/then, when running the test suite, and before declaring test work complete.
---

# Test Conventions

## Use this skill when

- Creating or changing any `*.test.ts` / `*.test.tsx` file
- Asked to add tests, fix a failing test, or raise coverage
- A review comment mentions test structure, `describe`, mocking, lifecycle hooks, or given/when/then
- Running the suite, or finishing test work before reporting it complete

## Do not use this skill for

- Non-test source — use the `ts-functional-conventions` skill, whose rules differ
- End-to-end, browser, load, or contract tests — see "Out of scope" below

This skill contains **no rules of its own**. All rules live in the ADR, so the two can never disagree. Follow the steps in order.

## Step 1 — Read the rules (mandatory, first)

Read [test-conventions.md](../adr/typescript/test-conventions.md) before writing or reviewing any test. It is the single source of truth for file naming, given/when/then structure, forbidden constructs, coverage targets, mocking policy, integration-test guards, and escalation.

Do not proceed from memory — read it.

Note the first section: the record governs the **shape** of a test, not when it was written. Whether the test came before or after the code it covers is the developer's call, or the call of the workflow that invoked the work, and it is not a violation of anything here. Do not raise it as a finding.

## Step 2 — Anchor on a canonical exemplar

Match the shape of the existing file closest to your task rather than composing from prose.

The `// given`, `// when` and `// then` line comments are required, and must be line comments — a block comment does not satisfy the checker.

A table-driven test keeps one `test` per case rather than looping assertions inside one, so a failure names the case:

```ts
const cases = [
  { name: 'strips a trailing slash', input: 'a/', expected: 'a' },
  { name: 'leaves a bare name alone', input: 'a', expected: 'a' },
]

for (const { name, input, expected } of cases) {
  test(`given ${name}, when normalised, then it matches`, () => {
    // given, when
    const actual = normalise(input)

    // then
    expect(actual).toBe(expected)
  })
}
```

Then match the nearest conforming test in the project you are in — the Step 3 checker tells you whether it conforms.

## Step 3 — Run the tests

The command is the project's, not this skill's. Look first in the project's agent instructions — `AGENTS.md`, `CLAUDE.md` — for the command an agent should run, then in its task definitions — `package.json` scripts, or a task runner's file such as `mise.toml` — before inventing one, and choose a test run appropriate for LLMs.

Run only the tests your change needs. A task that runs every test is a full regression, and when the project's workflow already runs one as a gate, running it yourself duplicates the gate and spends wall-clock time to learn what the gate will report anyway. When neither defines one, use `CLAUDECODE=1 LOG_LEVEL_MIN=silent METRICS_LEVEL_MIN=silent bun test --verbose --bail` as your default.

| Situation                      | Command                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Validating what you just wrote | the project's test script, scoped to the package you changed                                  |
| Narrowing to one file          | `CLAUDECODE=1 LOG_LEVEL_MIN=silent METRICS_LEVEL_MIN=silent bun test <path> --verbose --bail` |
| Checking coverage              | the project's coverage script                                                                 |

Logging is the thing to watch: an unsilenced suite can produce thousands of lines of output, which costs context and hides the failure. If the project has a quiet variant, use it.

## Step 4 — Verify before declaring done (blocking)

Run the convention checker on the test files you touched:

```bash
scripts/check-test-conventions.sh <path>...
```

With no arguments it checks test files changed against git. Pass `--all` to sweep the repo.

**This check is blocking.** If it reports violations, fix them before reporting the task complete. If a violation looks like a false positive, say so explicitly and explain why rather than ignoring it.

The checker reports a `skipped` count covering two things: the legacy files listed in the script, which fail by design and are documented as debt in the ADR, and `*-fixture.test.ts` files, which carry the suffix only to stay out of build output and define no tests. Do not "fix" a legacy file as a side effect of an unrelated task, and do not copy its patterns.

`--all` currently reports violations in the hundreds. The repo predates the ADR, so a repo-wide sweep cannot pass and is not the gate — the default changed-files scope is.

## Out of scope

This skill and the ADR do not cover end-to-end/browser tests, load or performance tests, snapshot testing, contract tests, or database seeding. If your task needs one of those, ask the developer for direction instead of inventing a convention.
