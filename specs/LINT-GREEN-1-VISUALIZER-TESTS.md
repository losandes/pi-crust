# Refactor: the Biome configuration is current and the visualizer's test files stay lint clean

## Objective

Two notices stand against `biome.json` itself — a schema version that does not match the pinned CLI, and a deprecated `recommended` field — and they print on every run of every later stage. They are migrated away without changing a single rule. The visualizer's test files reported diagnostics when this sequence was planned and report none now, resolved partly by suppressions that this document audits rather than re-litigates.

## 1. Requirements

### 1.1 The configuration

1.1.1 `biome.json`'s `$schema` MUST be updated to the Biome version pinned in `package.json`, which the linter reports as a mismatch on every run.

1.1.2 The deprecated `recommended` field MUST be replaced with `preset`, as the linter's own notice instructs.

1.1.3 These edits MUST change no rule's severity, add no override, narrow no `includes`, and change no entry in the `plugins` array. `biome migrate` performs them; its output MUST be inspected against this requirement rather than trusted.

1.1.4 The source-file diagnostic count MUST be identical before and after the migration. A migration that silences a source diagnostic has changed a rule and MUST be reverted.

1.1.5 No other document in this sequence MUST edit `biome.json`, and this one MUST edit it only for 1.1.1 and 1.1.2.

### 1.2 The test files

1.2.1 The current diagnostic count for `apps/visualizer`'s test files MUST be measured before any edit, because the developer resolved these by hand while this document was being written. At the time of writing the count is zero.

1.2.2 Any diagnostic the measurement finds in an `apps/visualizer` test file MUST be resolved under 1.3 and 1.4.

1.2.3 If the measurement finds none, this document's test-file work MUST be the audit in 1.5 and nothing else: no refactor, no opportunistic tidying of a file that already passes.

1.2.4 No non-test file in `apps/visualizer` MUST be modified. If a test's violation can only be fixed by changing the module it exercises, stop and report it — the next stage owns those files.

1.2.5 No file outside `apps/visualizer` test files and `biome.json` MUST be modified.

### 1.3 How a violation is resolved

1.3.1 A violation MUST be resolved by refactoring the code to satisfy the rule, unless a suppression has been approved under 1.4.

1.3.2 A refactor MUST NOT change what a test asserts, what it is named, or the conditions under which it fails.

1.3.3 No test MUST be deleted, skipped, merged, or renamed, and no assertion MUST be weakened.

1.3.4 An unsafe optional chain MUST be resolved so that an absent value fails as an assertion rather than as a thrown `TypeError` — by asserting existence first, or by binding to a checked local.

### 1.4 Suppressions need approval

1.4.1 A suppression comment MUST NOT be added without the developer's explicit approval of that specific comment, obtained before this work is reported finished.

1.4.2 A proposed suppression MUST be presented with the file, the line, the rule, and the reason it does not apply there, and the run MUST wait for a decision.

1.4.3 Every approved suppression MUST name the rule and MUST carry a reason.

1.4.4 A suppression MUST NOT use the bare `// biome-ignore lint:` form, which silences every rule on the line, nor the unqualified `// biome-ignore lint/plugin:` form, which silences every plugin on a line that often trips two.

### 1.5 Audit the suppressions already present

1.5.1 Every `biome-ignore` comment in `apps/visualizer`'s test files MUST be checked against 1.4.3 and 1.4.4: a named rule, a stated reason, and neither of the two unqualified forms.

1.5.2 Any suppression failing that check MUST be reported to the developer with a proposed replacement, and MUST NOT be silently rewritten.

1.5.3 No `suppressions/unused` diagnostic MUST remain in an `apps/visualizer` test file. A suppression that silences nothing is either misplaced — Biome spans the construct, not the comment above it — or left over from a fix, and the two need opposite treatments.

1.5.4 A suppression whose stated reason does not match what the code does MUST be reported. A reason is a claim, and an inaccurate one is worse than none because it survives review.

### 1.6 Behaviour and reporting

1.6.1 `bun run test:agent -- apps/visualizer` MUST exit 0, and the test count MUST NOT fall.

1.6.2 The run MUST report every suppression it proposed, whether approved or not.

1.6.3 The run MUST report every case where it followed an existing pattern in this repository in preference to the lint rule, a convention document, or an architecture record — naming the file, the rule, and the pattern it followed. Silently matching the surrounding code is the failure this exists to prevent.

1.6.4 The run MUST report any diagnostic it could not resolve, and why.

1.6.5 The run MUST report the measured before-and-after counts rather than asserting that a scope is clean.

## 2. Target state

A conforming suppression, in the form these test files already use — the rule named in full, and a reason that says what makes the rule inapplicable here rather than that it is inconvenient:

```ts
// biome-ignore lint/plugin/no-object-mutation: globalThis.fetch is the external seam these tests stub; this is the adapter that owns the assignment
globalThis.fetch = stubbed
```

The two forms that MUST NOT appear, whatever the reason given:

```ts
// biome-ignore lint: silences every rule on the line, built-ins included
// biome-ignore lint/plugin: silences every plugin on a line that often trips two
```

Where this and the prose disagree about the form of a suppression, this governs.

## 3. Out of scope

- Every non-test file in `apps/visualizer`, which is [LINT-GREEN-2-VISUALIZER-SRC.md](./LINT-GREEN-2-VISUALIZER-SRC.md). The `suppressions/unused` diagnostic in `src/components/NarrationPane.tsx` belongs to that document, not to 1.5.3.
- `runtime`, `scripts`, `templates`.
- The plugins in `.biome/`, and `biome.json` beyond 1.1.1 and 1.1.2.
- Upgrading or downgrading Biome. The pinned version governs; this document aligns the configuration to it and nothing else.
- Re-opening a suppression the developer has already approved. 1.5 checks form and accuracy, not the decision.
- Test coverage. This stage adds no test and removes none.

## 4. Work stages

| #   | Change                                        | Proven by                                                                                   |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | 1.2.1 — measure before touching anything       | `bun run lint --max-diagnostics=500 2>&1 \| grep -c 'apps/visualizer/.*\.test\.ts[x]*:'` recorded |
| 2   | 1.1.1, 1.1.2, 1.1.3 — migrate the configuration | `bun run lint --max-diagnostics=500 2>&1 \| grep -c 'biome.json:'` prints `0`                |
| 3   | 1.1.4 — the migration changed no rule          | `git diff biome.json` shows only the schema line and the `recommended`-to-`preset` change, and the stage-1 measurement is unchanged |
| 4   | 1.2.2, 1.5.1, 1.5.3 — the test files are clean  | `bun run lint --max-diagnostics=500 2>&1 \| grep -c 'apps/visualizer/.*\.test\.ts[x]*:'` prints `0` |
| 5   | 1.6.1 — the suite is intact                    | `bun run test:agent -- apps/visualizer` exits 0                                             |
| 6   | 1.2.4, 1.2.5 — scope held                      | `git diff --name-only` lists only `biome.json` and paths matching `apps/visualizer/**/*.test.ts` |
| 7   | whole document — nothing else regressed        | `bun run typecheck` exits 0                                                                 |

The grep patterns match a path segment rather than a line start, because Biome prints absolute paths for some diagnostics and repository-relative ones for others. A pattern anchored on `^apps/` silently prints `0` against the wrong shape and reads as success.

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Exit 3 MUST NOT occur in this stage: no module's coverage changes, so anything other than 0 means something broke.

## 5. Rationale

This document changed shape between being written and being executed, and saying so is cheaper than pretending otherwise. It originally owned seven diagnostics in two test files: four unsafe optional chains in `server/writes.test.ts`, where `expect(spy.calls[0]?.options.env as …)` short-circuits to `undefined` and then throws a `TypeError` instead of failing as an assertion, and three `noComponentHookFactories` reports against `Probe` components defined inside tests. The developer resolved them by hand while this was being written. What survives is the configuration migration, which nothing else can do, and an audit of the suppressions that resolution produced.

The audit is worth a stage on its own because a suppression is the one kind of lint resolution that review cannot verify from the diff alone. A refactor either satisfies the rule or does not, and the linter settles it. A suppression is a claim — this rule does not apply here, for this reason — and the three ways it goes wrong are all invisible at a glance: the rule name is unqualified and silences more than intended, the comment sits where Biome does not span and silences nothing, or the reason describes a situation that is not the one in the code. `.biome/README.md` records the second of those as the known failure mode, which is why it tells plugin authors to bind the whole match and span that.

`noComponentHookFactories` is the case worth remembering from this stage, because it is the one the developer predicted would be a false positive and it was. The rule's reasoning — React treats a component defined inside a function as a different component on each call, destroying the subtree and losing state — describes a bug that cannot occur in a `Probe` rendered exactly once into a container the test just created. The alternative the rule suggests, hoisting to module level, would have required a module-level binding shared across tests: a real coupling traded for a theoretical re-render.

The configuration migration leads the sequence rather than trailing it because every later document measures itself by counting diagnostic lines, and two of those lines belong to `biome.json` on every run. It is carved out of the otherwise absolute prohibition on touching that file, and 1.1.3 and 1.1.4 exist because `biome migrate` is a tool that edits a policy file: one that quietly relaxed a rule while updating a schema URL would be indistinguishable from success.
