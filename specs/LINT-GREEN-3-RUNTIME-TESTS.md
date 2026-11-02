# Refactor: the runtime's test files lint clean

## Objective

Twelve lint diagnostics remain in `runtime`'s test files: ten `useAwait` violations in the tests written for the agent ports, one `Object.assign` into an existing target, and one intermediate try-catch. They are fixed without weakening a single assertion, and the runtime suite still passes — so the next stage's source changes are reviewed against tests a reviewer has already read.

## 1. Requirements

### 1.1 The scope

1.1.1 Every lint diagnostic in `runtime`'s `*.test.ts` files MUST be resolved, after which no `*.test.ts` path under `runtime` MUST appear in `bun run lint` output.

1.1.2 The files reported today, with their counts, are `modules/use-cases/execute-agent.test.ts` 5, `modules/use-cases/activities/agent-activity.test.ts` 3, `modules/use-cases/activities/gh-pull-request.live.test.ts` 2, `modules/data/abandoned-activity-runs.test.ts` 1, and `modules/data/artifact-lock.test.ts` 1. The counts MAY have shifted; the linter governs, not this list.

1.1.3 No non-test file MUST be modified. If a test's violation cannot be resolved without changing the module it exercises, stop and report it — the next stage owns those files.

1.1.4 No file outside `runtime` MUST be modified.

### 1.2 useAwait

1.2.1 Each `lint/suspicious/useAwait` site MUST be resolved by removing `async` from a function that never awaits, or by awaiting what the function was always meant to await.

1.2.2 A fake port or stub declared `async` purely to satisfy a `Promise`-returning signature MUST return `Promise.resolve(…)` from a non-async function rather than carry an unused `async`.

1.2.3 Removing `async` MUST NOT change a function's return type from a caller's perspective. A stub whose signature promises a `Promise` MUST still return one.

1.2.4 A test MUST NOT stop awaiting something it awaited before. The diagnostic says the function never awaits; it does not say a caller should stop.

### 1.3 Mutation and try-catch

1.3.1 The `Object.assign` site in `modules/data/abandoned-activity-runs.test.ts` MUST be rebuilt as a fresh object with spread, or by passing a fresh literal as the target.

1.3.2 The intermediate try-catch in `modules/data/artifact-lock.test.ts` MUST be resolved through a settlement helper, or suppressed under 1.4 if the test is deliberately asserting that something throws.

1.3.3 A test that asserts a throw MUST keep asserting it. `expect(fn).toThrow()` is not an intermediate try-catch and MUST NOT be rewritten into one or out of one.

1.3.4 The two `lint/correctness/noUnsafeOptionalChaining` diagnostics in `modules/use-cases/execute-agent.test.ts` MUST be resolved so that an absent value fails as an assertion rather than as a thrown `TypeError` — by asserting existence first, or by binding to a checked local. An optional chain followed by an unguarded property access defeats the assertion it was written to make.

### 1.4 Suppressions need approval

1.4.1 A suppression comment MUST NOT be added without the developer's explicit approval of that specific comment, obtained before this work is reported finished.

1.4.2 A proposed suppression MUST be presented with the file, the line, the rule, and the reason the rule does not apply there, and the run MUST wait for a decision.

1.4.3 Every approved suppression MUST name the rule and carry a reason, and MUST NOT use the bare `// biome-ignore lint:` or unqualified `// biome-ignore lint/plugin:` forms.

1.4.4 `biome.json` MUST NOT be edited: no rule disabled, no override added, no `includes` narrowed, no plugin removed.

### 1.5 Behaviour and reporting

1.5.1 No test MUST be deleted, skipped, merged, or renamed.

1.5.2 No assertion MUST be weakened. A test that passes after a change it no longer exercises is worse than the lint violation it resolved.

1.5.3 `bun run test:agent -- runtime` MUST exit 0, and the test count MUST NOT fall.

1.5.4 The run MUST report every suppression it proposed, whether approved or not.

1.5.5 The run MUST report every case where it followed an existing pattern in this repository in preference to the lint rule, a convention document, or an architecture record — naming the file, the rule, and the pattern it followed.

1.5.6 The run MUST report any diagnostic it could not resolve, and why.

## 2. Target state

The accepted shape for a fake port that must satisfy a `Promise`-returning signature without awaiting:

```ts
// reported: async with no await
const ports: TAgentPorts = {
  run: async () => preparedResult,
  changed: () => [],
}

// accepted: the signature still returns a Promise, the function is not async
const ports: TAgentPorts = {
  run: () => Promise.resolve(preparedResult),
  changed: () => [],
}
```

Where this and the prose disagree about the shape of a fix, this governs.

## 3. Out of scope

- Every non-test file in `runtime`, which is [LINT-GREEN-4-RUNTIME-SRC.md](./LINT-GREEN-4-RUNTIME-SRC.md).
- `apps/visualizer`, `scripts`, `templates`.
- `biome.json` and the plugins in `.biome/`.
- The `TAgentPorts` record itself. Its shape is settled; these tests implement it, and a signature that is awkward to fake is a finding to report, not to fix here.
- Test coverage. The coverage gate passes today and MUST still pass.
- `runtime/temp.test.ts`, which is gitignored and MUST be left alone.

## 4. Work stages

| #   | Change                                         | Proven by                                                                      |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 1.2.1, 1.2.2, 1.2.3 — the useAwait sites        | `bun x biome check runtime/modules/use-cases` reports no `useAwait` diagnostic  |
| 2   | 1.3.4 — the unsafe optional chains              | `bun x biome check runtime/modules/use-cases/execute-agent.test.ts` exits 0     |
| 3   | 1.3.1, 1.3.2 — mutation and try-catch           | `bun x biome check runtime/modules/data` reports no diagnostic in a test file   |
| 4   | 1.1.1 — no test file is reported                | `bun run lint --max-diagnostics=500 2>&1 \| grep -c 'runtime/.*\.test\.ts:'` prints `0`. The pattern matches a path segment rather than a line start, so it survives the pinned Biome printing absolute paths |
| 5   | 1.5.1, 1.5.2, 1.5.3 — the suite is intact       | `bun run test:agent -- runtime` exits 0                                        |
| 6   | 1.1.3, 1.1.4 — scope held                       | `git diff --name-only` lists only paths matching `runtime/**/*.test.ts`         |
| 7   | whole document — nothing else regressed         | `bun run typecheck` exits 0                                                    |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Neither is acceptable here: the coverage gate passes before this stage starts.

## 5. Rationale

Ten of these fourteen are `useAwait`, and all ten sit in tests written during the coverage work — fake ports and fake activities declared `async` to match a `Promise`-returning signature without ever awaiting anything. That is the honest shape of the mistake: `async` was used as a way to produce a `Promise`, where `Promise.resolve` is what the signature actually wanted. Fixing it changes no behaviour, because an `async` function with no `await` and a function returning `Promise.resolve` are the same thing to every caller.

The two `noUnsafeOptionalChaining` sites appeared with a Biome upgrade rather than with new code: the rule is newly enforced, and it is a true positive. `expect(x?.y.z)` reads as defensive and is not — when `x` is absent the chain yields `undefined` and the next property access throws, so the test reports a `TypeError` instead of the assertion that was meant to fail.

The two plugin diagnostics are the interesting ones. `artifact-lock.test.ts` catches an exception in a test, and whether that is a violation or a boundary depends on what the test is asserting — a test that deliberately proves a throw is not converting an exception to a settlement part-way through, it is the assertion itself. 1.3.3 exists so that neither direction of rewrite happens by reflex.

Requiring the test count not to fall is deliberate and it is the cheapest protection available. The fastest way to make a test file lint clean is to delete the test that violates the rule, and nothing in a diff summary distinguishes that from a refactor.

The disclosure requirement in 1.5.5 applies here mostly to `async` style: the repository has plenty of `async` functions that do await, and matching the local shape is the reflex that produced these ten. If the resolution ends up following an existing pattern rather than the rule, the developer wants that said rather than absorbed.
