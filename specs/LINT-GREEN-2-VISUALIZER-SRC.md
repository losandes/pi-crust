# Refactor: the visualizer's source lints clean

## Objective

Fifty-six lint diagnostics remain in `apps/visualizer`'s non-test files, concentrated in `src/lib`: twenty-three intermediate try-catch sites, thirty-one mutations, one misplaced suppression and the `dangerouslySetInnerHTML` it was meant to cover. They are fixed without changing what the UI renders, and the visualizer suite — read and reviewed in the previous stage, unchanged here — still passes.

## 1. Requirements

### 1.1 The scope

1.1.1 Every lint diagnostic in `apps/visualizer`'s non-test files MUST be resolved, after which `bun x biome check apps/visualizer` MUST exit 0 and report no diagnostic lines. The first document in this sequence migrated `biome.json`, so no configuration notice should remain in that output; if one does, report it rather than editing the configuration here.

1.1.2 The counts below were measured against the Biome version pinned in `package.json`, and a Biome upgrade both adds rules and changes the output format. A run finding different counts MUST report the difference and MUST treat the linter's current output as governing. The files reported today, with their counts, are `src/lib/markdown.ts` 15, `src/lib/use-trace.ts` 6, `src/lib/artifacts.ts` 5, `src/lib/fences.ts` 5, `src/lib/activity-run-facts.ts` 4, `src/lib/format.ts` 3, `src/lib/narration.ts` 3, `src/components/NarrationPane.tsx` 2, `src/lib/events.ts` 2, `src/lib/token.ts` 2, `src/theme/theme.ts` 2, and one each in `src/components/SessionContext.tsx`, `src/lib/consult.ts`, `src/lib/highlight.ts`, `src/lib/ledger.ts`, `src/lib/router.ts`, `src/lib/use-poll.ts` and `src/lib/use-prompts.ts`. The counts MAY have shifted; the linter governs, not this list.

1.1.3 No test file MUST be modified. The previous stage made them clean and a reviewer has already read them; changing one here would destroy the evidence that this stage preserved behaviour.

1.1.4 No file outside `apps/visualizer` MUST be modified.

### 1.2 Intermediate try-catch

1.2.1 Each `no-intermediate-try-catch` site MUST be resolved by converting the throwing operation into a settlement through a helper, or by letting the exception propagate to the boundary that handles it.

1.2.2 A site that genuinely IS the boundary MUST be suppressed rather than restructured, subject to the approval in 1.4, using the form the diagnostic itself states.

1.2.3 A `catch` MUST NOT be deleted in a way that lets an exception escape to a place that does not handle it. Swallowing less is a behaviour change, and so is swallowing more.

### 1.3 Mutation

1.3.1 Each `no-array-mutation` site — `push`, `pop`, `shift`, `unshift`, `splice`, assignment to `length`, computed assignment — MUST be rebuilt with `map`, `filter`, `reduce`, `slice`, `at`, or spread.

1.3.2 Each `no-object-mutation` site — property assignment, `++`, compound assignment, `Object.assign` into an existing target — MUST be rebuilt with spread or a fresh literal.

1.3.3 A hot path where rebuilding would change the complexity class MUST be raised with the developer rather than silently rewritten or silently suppressed. `src/lib/markdown.ts`, which holds the largest group, is the likely candidate.

1.3.4 `lint/performance/noAccumulatingSpread` MUST NOT be introduced while fixing a mutation. A `reduce` that spreads the accumulator each iteration trades one diagnostic for another.

### 1.4 Suppressions need approval

1.4.1 A suppression comment MUST NOT be added without the developer's explicit approval of that specific comment, obtained before this work is reported finished.

1.4.2 A proposed suppression MUST be presented with the file, the line, the rule, and the reason the rule does not apply there, and the run MUST wait for a decision.

1.4.3 Every approved suppression MUST name the rule and carry a reason, and MUST NOT use the bare `// biome-ignore lint:` or unqualified `// biome-ignore lint/plugin:` forms.

1.4.4 The existing suppression in `src/components/NarrationPane.tsx` is reported as `suppressions/unused` because it sits on the comment line rather than on the attribute the rule spans, which is why `noDangerouslySetInnerHtml` is still reported two lines below it. It MUST be moved so that it covers the attribute, and MUST NOT be deleted — its reason, that the highlighter escapes its input, still stands.

1.4.5 `biome.json` MUST NOT be edited: no rule disabled, no override added, no `includes` narrowed, no plugin removed.

### 1.5 Behaviour and reporting

1.5.1 Rendered output MUST NOT change: not the markdown, not the fences, not the narration, not the highlighting, not the theme.

1.5.2 `bun run test:agent -- apps/visualizer` MUST exit 0, with no test modified.

1.5.3 `bun run build` MUST exit 0.

1.5.4 The run MUST report every suppression it proposed, whether approved or not.

1.5.5 The run MUST report every case where it followed an existing pattern in this repository in preference to the lint rule, a convention document, or an architecture record — naming the file, the rule, and the pattern it followed.

1.5.6 The run MUST report any diagnostic it could not resolve, and why.

## 2. Target state

The two accepted resolutions for an intermediate try-catch, as the diagnostic states them:

```ts
// reported: the exception is caught part-way through
const parsed = (() => { try { return JSON.parse(raw) } catch { return undefined } })()

// accepted (a): a settlement helper owns the conversion
const parsed = settledOr(safeParseSettlement(() => JSON.parse(raw)), undefined)

// accepted (b): this IS the boundary, and says so
// biome-ignore lint/plugin/no-intermediate-try-catch: the request handler is the boundary; nothing above it can answer the client
try { return handle(req) } catch (error) { return problem(error) }
```

Where this and the prose disagree about the shape of a fix, this governs. Form (b) requires approval under 1.4.

## 3. Out of scope

- Every test file in `apps/visualizer`, finished by [LINT-GREEN-1-VISUALIZER-TESTS.md](./LINT-GREEN-1-VISUALIZER-TESTS.md).
- `runtime`, `scripts`, `templates`.
- `biome.json` and the plugins in `.biome/`.
- The React components beyond the two reported. No prop changes, no hook reordering, no component extraction.
- Replacing the markdown, fence, or highlight implementations. This is a refactor of existing logic, not a rewrite, and "while I was in there" is how a lint fix becomes an outage.
- Test coverage. The coverage gate passes today and MUST still pass.

## 4. Work stages

| #   | Change                                            | Proven by                                                            |
| --- | ------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | 1.2.1, 1.2.2, 1.2.3 — intermediate try-catch       | `bun x biome check apps/visualizer/src/lib` reports no plugin diagnostic for that rule |
| 2   | 1.3.1, 1.3.2, 1.3.4 — mutation sites               | `bun x biome check apps/visualizer/src/lib` exits 0                   |
| 3   | 1.4.4 — the misplaced suppression and its rule     | `bun x biome check apps/visualizer/src/components` exits 0            |
| 4   | 1.1.1 — the package is clean                       | `bun x biome check apps/visualizer` exits 0                           |
| 5   | 1.5.1, 1.5.2, 1.5.3 — behaviour held               | `bun run test:agent -- apps/visualizer` exits 0; `bun run build` exits 0 |
| 6   | 1.1.3, 1.1.4 — scope held                          | `git diff --name-only` lists no path matching `*.test.ts` and none outside `apps/visualizer` |
| 7   | whole document — nothing else regressed            | `bun run typecheck` exits 0                                          |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Neither is acceptable here: the coverage gate passes before this stage starts, so anything other than 0 means this stage broke something.

## 5. Rationale

This is the largest stage and the one where a lint fix is most likely to become a behaviour change, because `src/lib` is where the visualizer parses things it does not control — markdown, fenced JSON, agent narration, trace payloads. Twenty-three of the diagnostics are intermediate try-catch, and every one of them is a decision about what happens to malformed input. Converting a `catch` to a settlement preserves that decision; deleting it does not, and the difference is invisible in a diff that only shows the `try` disappearing.

`markdown.ts` carries fifteen diagnostics on its own, which is why 1.3.3 names it. A parser that accumulates tokens by pushing is the one place where rebuilding arrays genuinely can change the complexity class, and the developer would rather be asked than find either a silent rewrite or a silent suppression.

The `NarrationPane.tsx` pair is the most instructive single case in the repository. Somebody wrote a correct suppression with a real reason — the highlighter escapes its input — and placed it where a reader would naturally put it, one line above the JSX element. Biome spans the attribute, not the element, so the suppression covered nothing: the rule still fires, and a second diagnostic appears saying the suppression is unused. `.biome/README.md` records this as the known failure mode, which is why it tells plugin authors to bind the whole match and span that, and why 1.4.4 says move it rather than delete it.

The disclosure requirement in 1.5.5 matters more here than anywhere else in this sequence, because `src/lib` has eighteen files written in a consistent local style that the rules disagree with. Copying the neighbour is the cheapest fix available and it is exactly what the developer wants reported rather than absorbed.
