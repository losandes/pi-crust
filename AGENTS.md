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

Every check is a script in `package.json`, run from the repository root. Nothing here needs a `cd`: a `cd` into a package picks up that directory's `bunfig.toml` and `tsconfig.json` instead of the repository's, so a check run that way is not the check CI runs.

```sh
bun run check
```

That is the whole gate, in increasing order of cost, stopping at the first failure: `lint`, `typecheck`, `test:agent`, `build`, `check:install` and `check:stdout`. Run it before reporting work finished. While you are still working, run the scoped commands below instead — this one takes about a minute, and most of that is the suites.

It is one script rather than one for a developer and one for a pipeline, because two gates are how the thing CI runs and the thing you run stop being the same check. What differs between a laptop and a runner is handled inside the individual checks and made loud rather than silent: `CI` (which GitHub Actions sets) or `CRUST_STRICT` turns a check that could not run into a failure instead of a pass. `typecheck:harness` honours it today — with no pi installed it says so and exits 0 interactively, and exits 1 under either variable, because a skipped check is not a passed one and nobody reads a pipeline's log for the sentence that says which it was.

Two of those parts are checks this document used to describe as commands to type:

- `check:install` stamps `templates/stamp/` into a throwaway directory and runs `verify-install.sh` against it, expecting `drift=0`. It needs no git, no network and no cleanup of your own — an install into a bare `mktemp -d` is a legitimate install, which is what makes it runnable unchanged on a runner. Anything other than `drift=0` means the template and the stamp disagree, and that failure ships into other people's repositories.
- `check:stdout` proves the test output belongs to the runner. It deliberately bypasses `bunt | buntap` and `CLAUDECODE=1`, both of which change what lands on stdout. A gitignored scratch test of your own that prints will fail it — that is the check working, and the fix is to delete the scratch test rather than to skip the check.

A runner also needs `bunx playwright install --with-deps chromium`, or the browser-driven visualizer tests skip and the suite is green having not run them.

The test scripts run [`bunt`](https://github.com/losandes/buntap) — a bun-test runner that speaks a reporting protocol — and pipe it through `buntap`, which renders that protocol and applies the coverage gate. Both are devDependencies, and `bun run` puts `node_modules/.bin` on `PATH`, which is why they resolve without a global install. Outside `bun run` they do not: a shell that reaches `bunt` through an asdf shim is reaching a different installation, or none.

**Never run `bun test` without `CLAUDECODE=1`.** It is the difference between a readable result and a flood: `bun test runtime` prints 1344 lines, `CLAUDECODE=1 bun test runtime` prints 14, and the 1330 it dropped were per-test `(pass)` lines nobody reads. An agent that spends its context window on them has less left for the work.

Scope a run to what you are changing. That is the normal case while iterating, and the argument is a path from the root:

```sh
CLAUDECODE=1 bun test runtime
CLAUDECODE=1 bun test apps/visualizer/src/lib/markdown.test.ts
```

For two lines instead of fourteen, pipe the same scope through the reporter — identical meaning, less of it:

```sh
CLAUDECODE=1 bunt runtime | buntap --agent
```

**Coverage is only meaningful over the whole repository.** `--coverage` measures every file a run loads, including files imported from outside the scope whose own tests were not in it — so a scoped run reports those as uncovered and is lying. `bun test runtime --coverage` reports `lib/typedefs/src/settlement.ts` at 71.43% functions, which looks like a gap and is not: that module is imported by `runtime` and tested by `lib/typedefs/src/settlement.test.ts`, which a `runtime` scope never ran. Measured whole, the same file is at 100%.

So one command settles coverage, and it is the unscoped one:

```sh
bun run test:agent
```

It names every root — `apps/visualizer lib runtime scripts` — and that list is load-bearing in both directions. A new top-level directory that is not added to it gets its tests skipped while its source is still measured by whatever imports it, which is exactly how `settlement.ts` spent a day appearing to be 80% covered after it moved to `lib/`.

Nothing else settles it, because **`bun test --coverage` fails silently**. `bunfig.toml` sets `coverageThreshold`, bun applies it PER FILE, and a file below it makes bun exit non-zero having printed no message at all — verified again on the scoped run above, which exits 1 with no `error:` line, nothing but the ordinary coverage table and `0 fail`. Read straight, a run that failed its gate looks exactly like a run that passed. `buntap` reads the same threshold and says so:

```text
COVERAGE FAIL 2 files below the minimum (functions 90.00%, lines 90.00%)
  apps/visualizer/server/db.ts functions 62.96%, lines 66.03%
  apps/visualizer/server/writes.ts functions 38.46%, lines 40.91%
```

The exit code says which gate went red: `1` is a failing test, `3` is coverage. Both are failures. Because coverage is judged per file, a package whose total is 96% still fails on one 40% file.

A pipeline reports the last command's status, so what reaches you is `buntap`'s verdict rather than bun's own exit code. That is the trade the pipe makes for a legible failure.

Test output is the runner's and nothing else. bun writes its own lines to stderr and exactly one banner line to stdout, so anything else on stdout came from the code under test, and a suite that prints CLI banners hides the one failure a reader opened the log for. That is what `check:stdout` measures, and it is the one check that must not go through `bunt | buntap` — the pipe folds stderr into stdout, which is exactly the distinction being measured, and `CLAUDECODE=1` is left off for the same reason. Scope it to one package while hunting the source of a line:

```sh
bash scripts/check-stdout.sh apps/visualizer
```

A test that drives the CLI reporter — directly through `createConsole`, or through `createRun`/`startSession`, which wire it — keeps printing for real and captures the bytes with `runtime/modules/testing/terminal-capture.ts`. Stubbing the reporter instead would stop proving that a printed line and its traced twin cannot drift, which is the whole claim `report-to-console.ts` makes about itself.

`bun run typecheck` is three checks in sequence: `typecheck:runtime`, `typecheck:harness`, and `typecheck:visualizer`. `runtime/tsconfig.json` excludes `harness-engineering/`, so the first does not check it. The second does, against the pi installed on this machine — those extensions import `@earendil-works/*` and `typebox` from the host rather than from this repository, and pinning a copy would check them against a version no agent here runs. With no pi installed it says so and exits 0, which is a skipped check, not a passed one — and under `CI` or `CRUST_STRICT` it exits 1 instead, so a pipeline cannot be green on a check that never ran.

`apps/visualizer`'s suite also includes a browser-driven layout test (`SessionCard.layout.test.ts`) that spins up real Chromium through Playwright to measure actual rendered geometry, because `happy-dom` has no layout engine and cannot see overflow clipping. Chromium is a ~99MB download and is not vendored, so on a machine without it that test prints a warning and skips rather than failing the suite — a skipped check, not a passed one. Run `bunx playwright install chromium` to make it run for real.

To prove a stamp matches its source on its own, without the rest of the gate:

```sh
bun run check:install
```

It is also the thing to run against a repository you already stamped, which `bun run check` cannot do because it works in a throwaway directory:

```sh
scripts/verify-install.sh /path/to/a/stamped/repo
```

Lint is wired up — `biome.json` at the root, with the convention plugins in `.biome/`:

```sh
bun run lint
```

That is `biome check` over `apps`, `lib`, `runtime`, `scripts` and `templates` — every root that holds source. It is the same list the test scripts name, and for the same reason: a root nobody names is a root nobody checks. Add `--max-diagnostics=500` when the default cap truncates the report.

It is green, and it stays green: a change that reports a diagnostic is not finished. The backlog Biome found when the configuration first landed was repaid in five stages, so there is no longer a standing exception anyone can point at, and a new report is a regression rather than an inheritance.

Do not report lint as passing on a narrowed path: the claim is only ever settled by `bun run lint` with no path argument, and narrowing `includes` to make a job pass is ruled out by `.biome/README.md`. Read the exit code rather than counting lines — Biome prints a diagnostic header in several shapes, including `path format` with no line or column and `path:line:column <rule>  FIXABLE` with doubled spaces, and every pattern written to count them has missed one of those at least once.

A file in `bunfig.toml`'s `coveragePathIgnorePatterns` is not a gap in the test suite; it is a claim about what the module IS, not about the state of its tests. Each entry names a module that performs process-boundary I/O — a spawn, a raw-mode TTY, a real network call — and holds no decision logic of its own, with a comment on the line above stating what no `bun test` process can execute, and a matching comment at the top of the excluded file naming what was moved out of it so the remainder could be covered. A module is never excluded merely because covering it is difficult, slow, or unfinished — difficulty is a reason to write the test, not to exclude the file — and the threshold itself never moves to make a gate pass, because that would trade nine named problems for one invisible one.

## Contributing

Branching, commit messages, and pull requests are in [CONTRIBUTING.md](CONTRIBUTING.md). They apply to the maintainer too.
