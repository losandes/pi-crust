# The pi-crust visualizer

A web app for watching a run happen, and for reading one after it has. It ships with the pi-crust package rather than with the stamp, and `just crust observe` boots it against the trace database of whichever working tree you are standing in.

```sh
just crust observe              # the ports crust.observe.yaml names (4601, api on 4600)
just crust observe --host       # listen on every interface, so a phone can watch
```

## Styling

`src/style.css` loads Tailwind CSS v4 through the Vite plugin and holds theme plumbing and document-level rules only: the `@theme inline` bridge to the runtime theme variables, the app's keyframes, document-level rules for `*`, `html`, `body`, `#app` and `a`, and the `.j-*` classes the JSON highlighter emits. Theme palettes and derivation remain in `src/domains/themes/src/tokens.css`; registered themes still repaint the app through `data-theme`. Two provisions with no reader remain until issue #169 removes them: the `.empty-state` class and the `--radius-sm` override.

Preflight is the baseline. The stylesheet restores no browser default, so a native element renders reset until utilities on that element say otherwise; rendered markdown takes its utilities from the `Prose` root. An error message box is the `ErrorBar` atom from `@/lib/_components`.

Author components with Tailwind utilities, following the portable [CSS conventions](../../.claude/skills/adr/css/README.md). Existing components remain on their CSS Modules until migrated as a unit: do not mix a component's stylesheet with utility styling. Compose conditional classes with `@/lib/cx`.

Browser tests import `viewportWidths` from `@/lib/testing` and refer to widths by tier: `base`, `sm`, `md`, `lg`, `xl` and `2xl`. The helper reads Tailwind's default `--breakpoint-*` values and takes the base width from the `phoneViewport` constant, checked against Playwright's small-phone device descriptor by an integration test; do not repeat viewport dimensions in tests.

Integration tests run only under `RUN_INTEGRATION_TESTS=true`. The root `test:agent` and `test:raw` mise tasks set it; `test`, `test:be` and `test:fe` do not. These integrations are the browser-driven tests, the git-repository tests in `server/workspaces.test.ts`, and the Playwright viewport-descriptor check. From the repository root, run `CLAUDECODE=1 bun test apps/visualizer` for the fast suite or `RUN_INTEGRATION_TESTS=true CLAUDECODE=1 bun test <path>` for a scoped integration run. Browser tests also require Chromium: run `bunx playwright install chromium` from `apps/visualizer` if it is unavailable.

## What it reads, and what it can change

Reads come straight from the trace: sessions, Activity Runs, events, envelopes and gate results. They never block a run — the database is WAL, so poll as hard as you like.

Writes are different, and they live behind one unconditional token. `CRUST_TOKEN` must be set on the server and sent as `x-crust-token`; with no token set, every write is refused rather than allowed. Steering a live agent, answering a gate and starting a run all spend money or change a working tree, and "the request came from localhost" is not an identity.

Everything the server starts — `steer`, `ask`, `amend`, a new run — is resolved through `CRUST_HOME`, or through the `.pi-crust/data/pi-crust-home` the installer wrote. The runtime is not in the stamp, so a path relative to the repository would resolve to nothing.

## Activities, not Stages

The UI shows **Activity Runs**. It does not show which Stage one belonged to, what strategy that Stage declared, or where a Stage-level gate fell.

That is a decision, not an omission. The trace records Activity Runs; Stage membership is a property of the Lifecycle that produced them, so drawing it would mean either re-reading configuration that may have changed since the run, or growing a column to carry it. Neither is worth it for a grouping the waterfall already shows: two Activities that ran at the same time are drawn overlapping, on their own lanes, which is what concurrency looks like.

If you want the Stage names, they are in `crust.lifecycles.yaml`.

## What is true about time

Every block sits where its own clock puts it, and lists are ordered by when an Activity Run started.

Not by `seq`. `seq` is assigned `MAX(seq)+1` when the row is inserted, so two Activities of a concurrent Stage get values decided by which insert landed first. Sorting by it states "this ran after that" on the strength of a race, which is the one thing a trace must not do. `seq` survives only as a tiebreak between two rows that started in the same millisecond.

A block narrower than the readable floor is widened so it can be seen and clicked. It is **not** pushed sideways, and neither are its neighbours — nudging a block to avoid an overlap would invent a sequence.

## A run that never appears

A run can be refused before it opens a session: a concurrent Stage whose Activities declare overlapping `writes` is rejected at load, and so is an Activity name this repository does not register. There is no row to show, so `/api/sessions/:run_id` reports what the spawn log says rather than a bare "no session".
