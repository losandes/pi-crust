# Refactor: the runtime's source lints clean

## Objective

Thirty-five lint diagnostics remain in `runtime`'s non-test files, and thirty of them are in one file: `harness-engineering/subagents.ts`, which `runtime/tsconfig.json` excludes and only `bun run typecheck:harness` checks. They are fixed without changing what any workflow does, and the runtime suite — read and reviewed in the previous stage, unchanged here — still passes.

## 1. Requirements

### 1.1 The scope

1.1.1 Every lint diagnostic in `runtime`'s non-test files MUST be resolved, after which `bun x biome check runtime` MUST exit 0 and report no diagnostic lines.

1.1.2 The counts below were measured against the Biome version pinned in `package.json`, and a Biome upgrade both adds rules and changes the output format. A run finding different counts MUST report the difference and MUST treat the linter's current output as governing. The files reported today, with their counts, are `harness-engineering/subagents.ts` 30, `consult.ts` 3, `modules/use-cases/merge-config.ts` 1, and `modules/typedefs/settlement.ts` 1. The counts MAY have shifted; the linter governs, not this list.

1.1.3 No test file MUST be modified. The previous stage made them clean and a reviewer has already read them; changing one here would destroy the evidence that this stage preserved behaviour.

1.1.4 No file outside `runtime` MUST be modified.

### 1.2 subagents.ts

1.2.1 The mutation sites MUST be rebuilt: `pop` replaced by `at(-1)` to read and `slice(0, -1)` to drop, `++` replaced by a computed next value, property assignment replaced by spread or a fresh literal.

1.2.2 This file is excluded from `runtime/tsconfig.json`, so `bun run typecheck:runtime` does not check it. `bun run typecheck:harness` MUST be run and MUST exit 0 after every change to it.

1.2.3 If `bun run typecheck:harness` reports that no pi is installed and exits 0 without checking, that MUST be reported as a skipped check rather than a passed one, and the run MUST say so explicitly.

1.2.4 The extension's observable behaviour MUST NOT change: the same hooks fire, the same payloads are produced, and the same subagents are selected.

### 1.3 The remaining files

1.3.1 The three diagnostics in `consult.ts` MUST be resolved by rebuilding the mutated values or, where the site is the process boundary, by a suppression approved under 1.4.

1.3.2 The `lint/performance/noAccumulatingSpread` diagnostic in `modules/use-cases/merge-config.ts` MUST be resolved without reintroducing a mutation: a `reduce` that spreads its accumulator each iteration and a loop that mutates one are both reported, and the fix is to build the result once.

1.3.3 The diagnostic in `modules/typedefs/settlement.ts` MUST be resolved with particular care, because this module is the settlement helper every other module's try-catch conversion is supposed to delegate to. If the only correct resolution is a suppression, say so plainly: a boundary that converts exceptions is what this module is for.

1.3.4 No change MUST alter the shape of a settlement, the `status` discriminant, or any exported type.

### 1.4 Suppressions need approval

1.4.1 A suppression comment MUST NOT be added without the developer's explicit approval of that specific comment, obtained before this work is reported finished.

1.4.2 A proposed suppression MUST be presented with the file, the line, the rule, and the reason the rule does not apply there, and the run MUST wait for a decision.

1.4.3 Every approved suppression MUST name the rule and carry a reason, and MUST NOT use the bare `// biome-ignore lint:` or unqualified `// biome-ignore lint/plugin:` forms.

1.4.4 `biome.json` MUST NOT be edited: no rule disabled, no override added, no `includes` narrowed, no plugin removed.

### 1.5 Behaviour and reporting

1.5.1 No workflow behaviour MUST change: not an activity's outcome, not a gate's verdict, not a traced event, not a printed line.

1.5.2 `bun run test:agent -- runtime` MUST exit 0, with no test modified.

1.5.3 `bun run typecheck` MUST exit 0.

1.5.4 The run MUST report every suppression it proposed, whether approved or not.

1.5.5 The run MUST report every case where it followed an existing pattern in this repository in preference to the lint rule, a convention document, or an architecture record — naming the file, the rule, and the pattern it followed.

1.5.6 The run MUST report any diagnostic it could not resolve, and why.

## 2. Target state

The accepted replacements for the two mutation shapes that dominate `subagents.ts`, as the diagnostics state them:

```ts
// reported: pop mutates in place, and conflates reading the last element with removing it
const last = stack.pop()

// accepted: reading and dropping are separate
const last = stack.at(-1)
const rest = stack.slice(0, -1)

// reported: ++ mutates the property in place
counts.seen++

// accepted: the next value is computed and returned
const next = { ...counts, seen: counts.seen + 1 }
```

Where this and the prose disagree about the shape of a fix, this governs.

## 3. Out of scope

- Every test file in `runtime`, finished by [LINT-GREEN-3-RUNTIME-TESTS.md](./LINT-GREEN-3-RUNTIME-TESTS.md).
- `apps/visualizer`, `scripts`, `templates`.
- `biome.json` and the plugins in `.biome/`.
- Enabling `.biome/no-throw.grit`, which is shipped but deliberately not enabled and would report every throwing site at once.
- `runtime/tsconfig.json`'s exclusion of `harness-engineering/`. It is deliberate and documented in that file; this work lives with it and runs the harness typecheck instead.
- The pi extension API. If a rule cannot be satisfied because the host API requires a mutable object, that is a suppression to propose under 1.4, not an API to work around.
- Test coverage. The coverage gate passes today and MUST still pass.

## 4. Work stages

| #   | Change                                        | Proven by                                                                 |
| --- | --------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | 1.2.1 — the subagents mutations                | `bun x biome check runtime/harness-engineering` exits 0                   |
| 2   | 1.2.2, 1.2.3 — the harness still type-checks   | `bun run typecheck:harness` exits 0, and the run states whether it checked or skipped |
| 3   | 1.3.1, 1.3.2, 1.3.3 — the remaining three files | `bun x biome check runtime/consult.ts runtime/modules` exits 0            |
| 4   | 1.1.1 — the package is clean                   | `bun x biome check runtime` exits 0                                       |
| 5   | 1.5.1, 1.5.2 — behaviour held                  | `bun run test:agent -- runtime` exits 0                                   |
| 6   | 1.1.3, 1.1.4 — scope held                      | `git diff --name-only` lists no path matching `*.test.ts` and none outside `runtime` |
| 7   | whole document — nothing else regressed        | `bun run typecheck` exits 0; `bun run build` exits 0                      |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Neither is acceptable here: the coverage gate passes before this stage starts.

## 5. Rationale

This stage is lopsided — thirty of thirty-five diagnostics are in one file — and that file is the least protected code in the repository. `runtime/tsconfig.json` excludes `harness-engineering/`, so `bun run typecheck:runtime` never reads it; the harness extensions import `@earendil-works` packages and `typebox` from the pi installed on the machine rather than from this repository, which is why `AGENTS.md` records that `typecheck:harness` with no pi installed "says so and exits 0, which is a skipped check, not a passed one." A thirty-site mutation refactor in a file that may be type-checked by nothing is the single riskiest edit in this whole lint sequence, which is why 1.2.3 demands the skipped-versus-passed distinction be stated rather than implied.

`settlement.ts` is the opposite kind of care. Every other `no-intermediate-try-catch` resolution in this repository is supposed to delegate to it, so a diagnostic inside it is either a genuine fix or the clearest legitimate boundary in the codebase. 1.3.3 asks for the claim to be made explicitly either way, because a suppression there sets the precedent that the other stages lean on.

`merge-config.ts` is the one case where two rules pull against each other. `noAccumulatingSpread` reports the functional form and the mutation plugins report the imperative one, so the fix is neither: build the result in a single pass. 1.3.2 says so because trading one diagnostic for the other and declaring victory is the obvious shortcut and it leaves the count unchanged.

The disclosure requirement in 1.5.5 is most likely to bite in `subagents.ts`, which is written in a consistently imperative style that the mutation plugins disagree with throughout. Thirty fixes in one file is exactly the situation where following the surrounding pattern is cheapest and least visible at review.
