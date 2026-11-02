# Refactor: the repository lints green, in six reviewable stages

## Objective

`bun run lint` reports 103 errors and 3 warnings, plus two configuration notices against `biome.json` itself, across 108 diagnostic lines. `.biome/README.md` is explicit that the failure is the record of the debt rather than something to configure away. This epic owns no implementation: it names the six documents that repay it, the order they run in, and the condition that ends the work — `bun run lint` exits 0 with no diagnostic lines at all.

## 1. Requirements

### 1.1 Execution

1.1.1 Each child document named in section 2 MUST be executed as its own run, and that run MUST finish every stage in that document's own stage table.

1.1.2 The children MUST be executed in the order section 2 gives, so that a test file and the module it tests are never changed in the same review.

1.1.3 A child document MUST NOT be started before the preceding one has been reviewed and merged.

1.1.4 No run MUST edit `biome.json`: not to disable a rule, not to add an override, not to narrow `includes`, and not to remove a plugin from the `plugins` array. The one exception is the schema and deprecated-field migration owned by the first child document, which MUST change no rule's severity and no entry in `plugins`.

1.1.5 No run MUST add a suppression comment without the developer's explicit approval of that specific comment, obtained before the run reports itself finished.

1.1.6 Every run MUST leave the test suite passing for the scope it touched, and MUST NOT change observable behaviour anywhere.

1.1.7 Every count in these documents was measured against the Biome version pinned in `package.json`, and counts move when that version moves or when the developer fixes something by hand. A run MUST re-measure its own scope before editing, MUST report any difference from the count its document states, and MUST treat the linter's current output as governing.

### 1.2 Completion

1.2.1 When every child is finished, `bun run lint` MUST exit 0.

1.2.2 When every child is finished, the repository MUST report zero diagnostics of every shape Biome prints — errors, warnings, configuration notices, and formatting violations, which print as `path format` with no line or column and are invisible to a pattern anchored on `path:line:column`.

1.2.3 When every child is finished, `bun run test:agent` MUST exit 0 and `bun run typecheck` MUST exit 0.

1.2.4 When every child is finished, each executed document MUST be moved to `specs/completed/`.

1.2.5 This epic MUST NOT be executed as a run of its own. It is a sequencing document.

## 2. Target state

The six children, in execution order, with what each one owns:

| Order | Document                                                            | Scope                         | Diagnostics |
| ----- | ------------------------------------------------------------------- | ----------------------------- | ----------- |
| 0     | [LINT-GREEN-0-SHARED-SETTLEMENTS.md](./LINT-GREEN-0-SHARED-SETTLEMENTS.md) | `lib/typedefs`, and the imports of it | 1 |
| 1     | [LINT-GREEN-1-VISUALIZER-TESTS.md](./LINT-GREEN-1-VISUALIZER-TESTS.md) | `biome.json`, `apps/visualizer` test files | 2 + 0   |
| 2     | [LINT-GREEN-2-VISUALIZER-SRC.md](./LINT-GREEN-2-VISUALIZER-SRC.md)     | `apps/visualizer` source      | 56          |
| 3     | [LINT-GREEN-3-RUNTIME-TESTS.md](./LINT-GREEN-3-RUNTIME-TESTS.md)       | `runtime` test files          | 14          |
| 4     | [LINT-GREEN-4-RUNTIME-SRC.md](./LINT-GREEN-4-RUNTIME-SRC.md)           | `runtime` source              | 35          |
| 5     | [LINT-GREEN-5-SCRIPTS.md](./LINT-GREEN-5-SCRIPTS.md)                   | `scripts` and `templates`     | 1           |

Document 0 was added after the sequence began, when the visualizer's try-catch sites turned out to need a settlement helper only `runtime` could reach. It is ordered first because documents 2 and 4 both import what it moves.

Where this table and any prose disagree about which document owns a file, this table governs.

The exit code settles whether a scope is clean: `bun run lint` exits 0 only when nothing at all is reported, and it is the check a child document MUST finish against. A count is for watching progress between children, never for declaring one done.

The command that counts, because `biome check` exits 0 while warnings and configuration notices remain:

```sh
bun run lint --max-diagnostics=500 2>&1 | grep -cE '^[^ ]*[/.][^ ]+ .*━━'
```

The pattern matches a first field that looks like a path — it contains a `/` or a `.` — on any header line carrying the box-drawing run, and it MUST stay that loose. Biome prints a diagnostic header in at least three shapes: `path:line:column <rule> ━━`, `path format ━━` for a formatting violation with no line or column, and `path:line:column <rule>  FIXABLE  ━━` with doubled spaces for anything it can fix itself. Each tightening of this pattern has hidden one of them: anchoring on `path:line:column ` hid every formatting violation, and requiring a single space before the box-drawing run hid every FIXABLE one. Both times the count read `0` while `biome check` on the same scope exited 1.

It MUST NOT anchor on a leading `apps/`, `lib/`, `runtime/`, `scripts/` or `templates/` either. The pinned Biome prints absolute paths for configuration diagnostics and repository-relative ones for source diagnostics, and an earlier version printed relative paths throughout. A pattern that assumes one shape prints a smaller number against the other and reads as progress. The trailing `check` summary line is excluded because `check` holds neither a `/` nor a `.`.

## 3. Out of scope

- `biome.json` beyond the schema and deprecated-field migration that 1.1.4 carves out for the first child.
- `.biome/no-throw.grit`, which is shipped but deliberately not enabled. Enabling it is a refactor of its own and is not part of this work.
- The coverage gate, the `bin/` wrappers, and the `package.json` scripts.
- Any behaviour change anywhere. Every stage is a refactor or an approved suppression.
- `runtime/temp.test.ts`, a gitignored local probe.

## 4. Work stages

| #   | Change                                      | Proven by                                                                      |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 1.1.2 — every child named here exists        | `ls specs/LINT-GREEN-0-SHARED-SETTLEMENTS.md specs/LINT-GREEN-1-VISUALIZER-TESTS.md specs/LINT-GREEN-2-VISUALIZER-SRC.md specs/LINT-GREEN-3-RUNTIME-TESTS.md specs/LINT-GREEN-4-RUNTIME-SRC.md specs/LINT-GREEN-5-SCRIPTS.md` exits 0 |
| 2   | 1.2.1 — the linter passes                    | `bun run lint` exits 0                                                         |
| 3   | 1.2.2 — nothing is left, warnings and formatting included | the counting command in section 2 prints `0`                     |
| 4   | 1.2.3 — nothing was broken to get there      | `bun run test:agent` exits 0; `bun run typecheck` exits 0                      |
| 5   | 1.2.4 — the executed documents are filed     | `ls specs/completed` lists all six child documents                             |

These stages are the epic's own completion criteria, checked after the last child run finishes. They are not a run.

## 5. Rationale

The split is by review surface, not by rule or by file count. Stages alternate between a package's tests and the modules those tests cover, so a reviewer reads the test changes first and watches them still pass, then reads the source changes and watches the same unchanged tests still pass. A single stage touching both would make a passing suite prove nothing: the tests could have been bent to fit the refactor in the same commit, and nobody could see it.

`scripts` is last because it is one warning and sequencing it earlier would waste a review round.

`.biome/README.md` settles the two shortcuts this work must not take. On exempting a path: "an exclusion is invisible from inside the excluded package — the editor stays quiet, the rule appears not to exist, and the debt stops being felt by the only people positioned to repay it." On suppressions: the reason is mandatory, the rule must be named rather than suppressing `lint/plugin` wholesale, and a bare `// biome-ignore lint:` disables every rule on the line including the built-in ones.

Requiring approval for each suppression is the developer's explicit instruction and it is the control that makes the rest safe. A refactor that satisfies a rule is reviewable from the diff; a suppression is a claim that the rule does not apply here, and that claim is the kind of thing a reviewer must agree with rather than discover.

Rejected: one run for all 109. The stages exist to separate test changes from source changes under review, and a single run would collapse exactly the distinction the developer asked for.

The counting command exists because three severities reach the terminal and only one reaches the exit code. `biome check` returns non-zero for errors, returns 0 with warnings outstanding, and prints configuration notices — a schema version that does not match the CLI, a deprecated `recommended` field — that are neither. Counting diagnostic lines is the only measure that covers all three, and the first child migrates the configuration so that the two notices stop appearing in every later stage's output.

Rejected: grouping by rule rather than by package — all the `no-intermediate-try-catch` sites in one run, all the mutations in another. It reads tidier and reviews worse, because a single run would then touch tests and the code under test together in several packages at once.
