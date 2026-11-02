# Refactor: the menu's drawing is a pure module and only the terminal is excluded

## Objective

`runtime/modules/data/ask.ts` is 15.92 percent of lines because everything in it beyond key decoding writes to `process.stdout` or puts `process.stdin` into raw mode. The frame arithmetic — rows against lines, the scroll window, ANSI width — is pure and has broken before. It moves into a module with no terminal in it, and what remains is the raw-mode listener, excluded by name.

## 1. Requirements

### 1.1 The pure module

1.1.1 A new module `runtime/modules/data/menu-frame.ts` MUST hold the frame arithmetic currently private to `ask.ts`: `rowsFor`, `widthOf`, the ANSI pattern, `bullet`, and the body of `draw`.

1.1.2 `menu-frame.ts` MUST NOT import `process`, read `process.stdout`, or write to any stream.

1.1.3 The function replacing `draw` MUST take the viewport dimensions as arguments and MUST return the lines to print together with the number of terminal rows they occupy, rather than printing them.

1.1.4 `menu-frame.ts` MUST reach at least 90 percent functions and 90 percent lines.

1.1.5 The rows-against-lines distinction MUST be covered by a test proving that a line wider than the viewport costs more than one row, because an erase that counts lines instead of rows leaves a sliver of the previous frame on screen.

1.1.6 The scroll window MUST be covered by tests for: a list shorter than the budget, a cursor above the window, a cursor below it, and the more-above and more-below indicators.

1.1.7 `decodeKeys` MUST stay in `ask.ts` or move to `menu-frame.ts`, and either way MUST keep its existing tests passing.

### 1.2 The terminal module

1.2.1 `ask.ts` MUST retain `interactive`, `onKeys`, the stream writer, the viewport reader, and the public `askMenuChoice`, `askMenu`, `askOrder`, `askOne` and `askText` functions.

1.2.2 `ask.ts` MUST call `menu-frame.ts` for every line it prints and MUST NOT recompute widths, rows, or windows itself.

1.2.3 `ask.ts` MUST be added to `coveragePathIgnorePatterns` with the comment required by [COVERAGE-GATE-POLICY.md](./COVERAGE-GATE-POLICY.md), naming raw-mode stdin as what no `bun test` process can drive.

1.2.4 `ask.ts` MUST carry a top-of-file comment stating that it is excluded and that its arithmetic lives in `menu-frame.ts`.

1.2.5 Every public function's signature in `ask.ts` MUST be unchanged, and every existing caller MUST compile without edit.

### 1.3 Behaviour

1.3.1 The rendered output MUST be byte-identical to what `ask.ts` produces today for the same options, state and viewport.

1.3.2 `NOT_A_TERMINAL` and the refusal it belongs to MUST be unchanged.

1.3.3 Every test added MUST name itself `given <module>::<subject>, when <condition>, it should <expectation>`.

## 2. Target state

The seam between the two modules:

```ts
// runtime/modules/data/menu-frame.ts — no process, no streams
export type TViewport = Readonly<{ rows: number; cols: number }>
export type TFrame = Readonly<{ lines: readonly string[]; rows: number }>

export const menuFrame = (
  title: string,
  options: readonly TOption[],
  state: TMenuState,
  multiple: boolean,
  viewport: TViewport,
  preview?: (chosen: readonly string[], highlighted: string) => string,
): TFrame => { /* what draw() computed, without the write */ }
```

Where this and the prose disagree about the shape of the seam, this governs.

## 3. Out of scope

- `runtime/modules/use-cases/menu.ts`, which already holds `applySingleKey`, `initialMenu` and `visibleWindow` and is already covered. This work calls it; it does not change it.
- The appearance of any menu. Not the glyphs, not the help line, not the colours, not the wording.
- `runtime/modules/data/terminal.ts` and its `paint`.
- Any attempt to drive `process.stdin` in a test. It is not possible under the runner and it is not wanted.
- The coverage threshold.

## 4. Work stages

| #   | Change                                            | Proven by                                                                      |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 1.1.1, 1.1.2, 1.1.3 — extract `menu-frame.ts`      | `bun run typecheck` exits 0                                                    |
| 2   | 1.2.2, 1.2.5, 1.3.1 — `ask.ts` delegates, unchanged | `bun run test:agent -- runtime/modules/data` exits 0 or 3, never 1             |
| 3   | 1.1.4, 1.1.5, 1.1.6 — cover the arithmetic         | `bun run test:agent -- runtime/modules/data/menu-frame.test.ts` exits 0        |
| 4   | 1.2.3, 1.2.4 — exclude the terminal module         | `grep -A1 'ask.ts' bunfig.toml` shows the comment above the path               |
| 5   | whole document — neither file is in the list       | `bun run test:agent -- runtime` prints neither `ask.ts` nor `menu-frame.ts` under `COVERAGE FAIL` |
| 6   | whole document — nothing else regressed            | `bun run test:agent` exits 0 or 3, never 1; `bun run typecheck` exits 0         |

`bun run test:agent` exits 1 when a test fails and 3 when a file is below the coverage threshold. Exit 3 is expected while other specs are outstanding; exit 1 is never acceptable.

## 5. Rationale

What is covered in `ask.ts` today is `decodeKeys`, which is pure. Everything else is uncovered, and the reason is uniform: `write` goes straight to `process.stdout` through a module-private helper, `viewport` reads `process.stdout.rows`, and `onKeys` calls `process.stdin.setRawMode(true)`. There is no seam to inject and no runner that can supply a TTY.

The arithmetic is worth separating on its own merits, independent of coverage. The file carries two comments describing bugs that were arithmetic, not I/O: counting lines rather than rows made every redraw erase too little, so a sliver of the previous frame survived each keypress — invisible at 120 columns and obvious at 80 — and a frame that exactly fills the viewport scrolls it by one when the trailing newline lands. Both are properties of a pure function over a viewport size, and both are untested today because they are welded to a stream.

The alternative of stubbing `process.stdout.write` would make the numbers move without making those two bugs catchable, because a test that asserts against captured bytes is asserting about the renderer's output, not about the row budget it computed. The repository already owns `runtime/modules/testing/terminal-capture.ts` for the cases where captured bytes are the point; this is not one of them.

Excluding `ask.ts` afterwards is honest in a way that excluding it now would not be. After the split it genuinely contains only stream writes, a raw-mode listener, and thin wrappers that sequence them; before the split it contains the frame arithmetic, and excluding that would be a backlog wearing a policy's clothes.
