# Working on pi-crust

This file governs how work is done in this repository. Machine-specific facts — where this clone lives, how it is wired into an agent harness — belong in `AGENTS.local.md`, which is gitignored.

## One clone, one truth

There is exactly one working copy of pi-crust per machine, and the harness that loads it as a skill points at that same copy. Two checkouts of one branch merge against each other with no remote involved, and the loser is whichever one you forgot about.

Before the first edit of a task, confirm where you are with `git rev-parse --show-toplevel`. Two trees with identical filenames is the shape of an edit that looks successful and lands nowhere.

## Editing while runs are in flight

A run executes from the **stamp** — the `.pi-crust/` directory inside the target repository — but the stamp holds no runtime code. `templates/stamp/` carries only `config/` and `prompt-engineering/{example,README.md}`; `runtime/`, `modules/`, `cookbooks/`, `harness-engineering/` and `SKILL.md` all live in this clone, and `.pi-crust/data/pi-crust-home` (or `CRUST_HOME`) is a pointer at it, not a copy. An edit to any of them is live for every process a stamped repository starts after the write — including the agent spawned for the next Activity of a run already going, and including the prompts under `runtime/prompt-engineering/`.

The corollary is the trap this file used to walk a reader into: a process already running keeps the modules it imported at startup. A fix a run writes to `runtime/` does not govern the run that wrote it — it has to be re-run before it is exercised. A run that dies against the bug it is fixing in the same breath is not a sign the fix is wrong.

Two more things reach back here while a run is live, beyond the runtime code every Activity already resolves out of this clone:

- `apps/visualizer/` — the `observe` recipe runs the web app out of this repository, so an edit restarts the dev server and the API underneath a UI somebody is watching.
- Re-stamping — `install.ts --force`, and the `update` recipe that wraps it, replace the factory a run is executing from.

So the question is never "is this change big". It is "am I editing the visualizer while a run is being watched, or about to re-stamp a repository that has a run in it". Both are checkable; neither needs a forecast.

When the answer is yes and the work cannot wait, take a worktree rather than a second clone, and point `CRUST_HOME` at it so the live checkout stays frozen:

```sh
git worktree add ../pi-crust-wip -b <topic>
```

This should be rare. Most changes are invisible to a running run.

This is about working on pi-crust's own source, in THIS clone — `CRUST_HOME` is set explicitly above so the worktree deliberately does not fall back to the live checkout it was branched from. It is not the general case: a worktree of a repository pi-crust has been STAMPED INTO (an ordinary target repository, not this package) no longer needs its own stamp at all to run `just crust ...` — `crust.just`'s passthrough recipe resolves the package home through `CRUST_HOME`, then its own stamp pointer, then the pointer beside the shared git directory `git rev-parse --git-common-dir` names, which finds the main clone a linked worktree was branched from with no re-install (issue #24, `references/config.md`). `git worktree add` followed directly by `just crust run ...`, with no `bun <pi-crust>/scripts/install.ts` in between, is the supported shape for that case.

## Never destroy a user's data

`.pi-crust/data/` holds the trace database and every session directory. It is worth more than any config file, because it cannot be regenerated.

`install.ts` contains no deletion of any kind — only copies and appends — and `data/` has no counterpart in the template, so there is nothing for an update to overwrite. Keep it that way:

- An update may replace anything the template owns. It may not remove anything.
- `config/` belongs to the repository being stamped, not to the template. `--force` skips it.
- Schema migration is a separate, explicitly invoked verb. It reads the old database and writes a new one, keeping the old. It is never a step inside something people run routinely.

## Verification

Run these from the repository root before claiming anything works:

```sh
(cd runtime && bun test && bun x tsc --noEmit)
(cd apps/visualizer && bun test && bun x tsc --noEmit && bun x vite build)
bun scripts/typecheck-harness.ts
```

Test output is the runner's and nothing else. bun writes its own lines to stderr and exactly one banner line to stdout, so anything else on stdout came from the code under test — and a suite that prints CLI banners hides the one failure a reader opened the log for:

```sh
test "$(cd runtime && bun test 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')" = 0
```

A test that drives the CLI reporter — directly through `createConsole`, or through `createRun`/`startSession`, which wire it — keeps printing for real and captures the bytes with `runtime/modules/testing/terminal-capture.ts`. Stubbing the reporter instead would stop proving that a printed line and its traced twin cannot drift, which is the whole claim `report-to-console.ts` makes about itself.

`runtime/tsconfig.json` excludes `harness-engineering/`, so the first line does not check it. The third does, against the pi installed on this machine — those extensions import `@earendil-works/*` and `typebox` from the host rather than from this repository, and pinning a copy would check them against a version no agent here runs. With no pi installed it says so and exits 0, which is a skipped check, not a passed one.

`apps/visualizer`'s suite also includes a browser-driven layout test (`SessionCard.layout.test.ts`) that spins up real Chromium through Playwright to measure actual rendered geometry, because `happy-dom` has no layout engine and cannot see overflow clipping. Chromium is a ~99MB download and is not vendored, so on a machine without it that test prints a warning and skips rather than failing `bun test` — a skipped check, not a passed one. Run `bunx playwright install chromium` to make it run for real.

Then prove a stamp still matches its source, in a directory that is thrown away in the same breath:

```sh
probe="$(mktemp -d)" && (cd "$probe" && bun "$OLDPWD/scripts/install.ts" && "$OLDPWD/scripts/verify-install.sh"); rm -rf "$probe"
```

`verify-install` reports `drift=0` when the installed tree is the one this repository ships. Anything else means the template and the stamp disagree, which is the failure that check exists to catch.

Lint is wired up — `biome.json` at the root, with the convention plugins in `.biome/`:

```sh
bunx @biomejs/biome lint --max-diagnostics=500 .
```

It is not green yet. Biome had never run here before the configuration landed, so the backlog is a first enforcement rather than a regression, and it is being worked through in [issue #5](https://github.com/losandes/pi-crust/issues/5). Do not report lint as passing on a narrowed path: the claim is only ever settled by the whole-repository run above, and narrowing `includes` to make a job pass is ruled out by `.biome/README.md`.

## Contributing

Branching, commit messages, and pull requests are in [CONTRIBUTING.md](CONTRIBUTING.md). They apply to the maintainer too.
