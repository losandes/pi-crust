# Refactor: one settlement module, shared by the runtime and the visualizer

## Objective

`runtime/modules/typedefs/settlement.ts` is the repository's settlement helper, and `apps/visualizer` cannot reach it — so the visualizer's twenty `no-intermediate-try-catch` sites have nothing to convert to. It moves to `lib/typedefs/src/settlement.ts`, both trees import it from there, and it gains the one asynchronous helper the visualizer's hooks need. One approved suppression covers the single `try` the helper owns, and no third copy of these types is created anywhere.

## 1. Requirements

### 1.1 The module

1.1.1 `lib/typedefs/src/settlement.ts` MUST hold what `runtime/modules/typedefs/settlement.ts` holds today, with every exported name — `TSuccessResult`, `TErrorResult`, `TSettlement`, `succeed`, `fail`, `isOk`, `safeParseSettlement`, `settledOr`, `errorMessage` — unchanged in name, signature and behaviour.

1.1.2 `runtime/modules/typedefs/settlement.ts` MUST NOT exist when this work is finished. A second copy is the condition this document exists to remove, so leaving a re-export shim in its place is a failure of 1.1.2, not a compatibility measure.

1.1.3 Every importer of the old path MUST import the new one, and MUST import the same names it imported before.

1.1.4 `runtime/modules/typedefs/settlement.test.ts` MUST move to `lib/typedefs/src/settlement.test.ts` unchanged except for the import path it resolves.

1.1.5 The module MUST additionally export `settleAsync`, in the shape section 2 gives, and `lib/typedefs/src/settlement.test.ts` MUST cover both its settled and its rejected branch.

1.1.6 No behaviour MUST change in `runtime` or `apps/visualizer`. This is a move and one addition.

### 1.2 Reachability

1.2.1 `apps/visualizer` MUST be able to import the module from both `src/` and `server/`, resolved through the alias section 2 declares in `apps/visualizer/tsconfig.json` and `apps/visualizer/vite.config.ts`.

1.2.2 `runtime` MUST import the module by relative path, as it imports everything else, and `runtime/tsconfig.json` MUST typecheck it.

1.2.3 `bun run lint` MUST check `lib`. The `lint` and `lint:fix` scripts in `package.json` name their roots explicitly and MUST be extended; `biome.json` MUST NOT be edited.

1.2.4 `bun run build` MUST exit 0, proving Vite resolves the module in a production bundle rather than only in the dev server.

1.2.5 A stamped repository MUST still run. The stamp points at the package root, so a sibling `lib/` is present wherever `runtime/` is, and `scripts/verify-install.sh` MUST still report `drift=0`.

### 1.3 Coverage

1.3.1 `lib/typedefs/src/settlement.ts` MUST meet the per-file coverage threshold `bunfig.toml` sets, from its own moved test.

1.3.2 No file MUST be added to `coveragePathIgnorePatterns`.

### 1.4 The one suppression

1.4.1 Exactly one `// biome-ignore` comment MUST be added by this work: the one on `safeParseSettlement`'s `try`, in the wording section 2 gives. It is approved; no other suppression is.

1.4.2 A suppression MUST NOT use the bare `// biome-ignore lint:` form, nor the unqualified `// biome-ignore lint/plugin:` form.

1.4.3 `settleAsync` MUST NOT contain a `try`, and so MUST NOT carry a suppression.

### 1.5 Reporting

1.5.1 The run MUST report any importer it could not move, and why.

1.5.2 The run MUST report every case where it followed an existing pattern in this repository in preference to the lint rule or a convention document — naming the file, the rule, and the pattern it followed.

1.5.3 The run MUST report the diagnostic count `bun run lint` reports before and after.

## 2. Target state

The helper's `try`, with the approved suppression, and the asynchronous helper beside it:

```ts
// biome-ignore lint/plugin/no-intermediate-try-catch: this IS the boundary the rule names — the single place in this repository where a throwing call becomes a settlement, which is what every caller reads instead of catching
export const safeParseSettlement = <TData>(
  compute: () => TData,
): TSettlement<TData> => {
  try {
    return succeed(compute())
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * The same conversion for work that settles later.
 *
 * `Promise.resolve().then(work)` rather than `work()`, so a function that
 * throws before it returns a promise settles here too. No `try`: a rejection
 * handler IS the conversion, and the rule has nothing to report.
 */
export const settleAsync = <TData>(
  work: () => Promise<TData>,
): Promise<TSettlement<TData>> =>
  Promise.resolve()
    .then(work)
    .then(succeed, (error) =>
      fail(error instanceof Error ? error : new Error(String(error))),
    )
```

How each tree reaches it:

```ts
// runtime, by relative path, as runtime imports everything
import { safeParseSettlement } from '../../../lib/typedefs/src/settlement.ts'

// apps/visualizer, through an alias declared in its tsconfig and vite config
import { settleAsync } from '@typedefs/settlement'
```

```jsonc
// apps/visualizer/tsconfig.json
"paths": {
  "@/*": ["./src/*"],
  "@shared/*": ["./shared/*"],
  "@typedefs/*": ["../../lib/typedefs/src/*"]
}
```

Where this and the prose disagree about a shape, this governs.

## 3. Out of scope

- Converting any `try`/`catch` outside `lib/typedefs`. Making the helper reachable is this document's whole job; the visualizer's twenty sites are [LINT-GREEN-2-VISUALIZER-SRC.md](./LINT-GREEN-2-VISUALIZER-SRC.md) and the runtime's are [LINT-GREEN-4-RUNTIME-SRC.md](./LINT-GREEN-4-RUNTIME-SRC.md).
- Bun workspaces. `lib/typedefs` is a directory of TypeScript, not a published package; adding a `workspaces` field changes how both trees install and is a separate decision.
- Any other module in `runtime/modules/typedefs/`. Only `settlement.ts` moves.
- Adding helpers nobody imports. `settleAsync` is specified because [LINT-GREEN-2-VISUALIZER-SRC.md](./LINT-GREEN-2-VISUALIZER-SRC.md) needs it; a batch or paginated variant is not.
- `biome.json`, and the plugins in `.biome/`.
- The mutation work already finished in `apps/visualizer`, which MUST NOT be re-litigated while moving imports past it.

## 4. Work stages

| #   | Change                                              | Proven by                                                                                             |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | 1.1.1, 1.1.4 — the module and its test move          | `test -f lib/typedefs/src/settlement.ts && test -f lib/typedefs/src/settlement.test.ts` exits 0        |
| 2   | 1.1.2, 1.1.3 — nothing imports the old path          | `test ! -e runtime/modules/typedefs/settlement.ts` exits 0; `rg -l "typedefs/settlement" runtime apps` lists no path containing `modules/typedefs/settlement` |
| 3   | 1.1.5, 1.4.3 — `settleAsync` exists and is covered   | `bun test lib/typedefs` exits 0                                                                        |
| 4   | 1.2.2, 1.2.1 — both trees typecheck against it       | `bun run typecheck` exits 0                                                                            |
| 5   | 1.2.3, 1.4.1 — `lib` is linted and one `try` remains | `bun run lint --max-diagnostics=500` reports no diagnostic whose path starts `lib/`                    |
| 6   | 1.2.4 — the browser bundle resolves it               | `bun run build` exits 0                                                                                |
| 7   | 1.1.6, 1.3.1 — nothing broke and coverage holds      | `bun run test:agent` exits 0                                                                           |
| 8   | 1.2.5 — a stamp still matches its source             | `probe="$(mktemp -d)" && (cd "$probe" && bun "$OLDPWD/scripts/install.ts" && "$OLDPWD/scripts/verify-install.sh"); rm -rf "$probe"` reports `drift=0` |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Both are failures of stage 7.

## 5. Rationale

The repository already carries two copies of this module: `runtime/modules/typedefs/settlement.ts` and the `lib/typedefs/src/settlements/` package it was copied from in another repository. Its own header says so — "A settlement is a returned outcome rather than a thrown one, and the shape is common enough that a repository adopting pi-crust may already define it in a shared package of its own" — and that argument is about not depending on a HOST repository's package. It is not an argument for a third copy inside this one, which is what a visualizer-local copy would have been.

Rejected: copying the module into `apps/visualizer/src/lib/`. It was the cheapest way to finish the visualizer stage, and it would have put three versions of eight lines in a repository whose own comment already apologises for having two. The developer rejected it in favour of the shared directory.

Rejected: importing `runtime/modules/typedefs/settlement.ts` from the visualizer where it stands. Nothing in `apps/visualizer/src/` imports from `runtime/` today, and the first such import would make the browser bundle depend on the stamped runtime tree — a coupling direction nobody chose, established by a lint fix.

Rejected, for now: making `lib/typedefs` a Bun workspace package. `apps/visualizer` runs its own `bun install` from the root `postinstall`, and the root declares no workspaces, so a package would change install topology in both trees to buy a nicer import specifier. An alias buys the same specifier and changes nothing about installation. If `lib/` grows a second module with dependencies of its own, revisit it.

`settleAsync` is specified here rather than in the stage that needs it because that stage may not create files outside `apps/visualizer`, and because a rejection handler is the asynchronous form of exactly the conversion `safeParseSettlement` performs. Writing it with `.then(onOk, onError)` rather than `await` inside a `try` is not a way around the rule: there is no exception handling in it to report.
