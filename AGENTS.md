# Working on pi-crust

This file governs how work is done in this repository. Machine-specific facts — where this clone lives, how it is wired into an agent harness — belong in `AGENTS.local.md`, which is gitignored.

## One clone, one truth

There is exactly one working copy of pi-crust per machine, and the harness that loads it as a skill points at that same copy. Two checkouts of one branch merge against each other with no remote involved, and the loser is whichever one you forgot about.

Before the first edit of a task, confirm where you are with `git rev-parse --show-toplevel`. Two trees with identical filenames is the shape of an edit that looks successful and lands nowhere.

## Editing while runs are in flight

A run executes from the **stamp** — the `.pi-crust/` directory inside the target repository — not from this repository. Editing `templates/`, `prompt-engineering/`, `modules/`, `cookbooks/` or `SKILL.md` cannot disturb a run that is already going, because that code was copied at install time.

Two things do reach back here while a run is live:

- `apps/visualizer/` — the `observe` recipe runs the web app out of this repository, so an edit restarts the dev server and the API underneath a UI somebody is watching.
- Re-stamping — `install.ts --force`, and the `update` recipe that wraps it, replace the factory a run is executing from.

So the question is never "is this change big". It is "am I editing the visualizer while a run is being watched, or about to re-stamp a repository that has a run in it". Both are checkable; neither needs a forecast.

When the answer is yes and the work cannot wait, take a worktree rather than a second clone, and point `CRUST_HOME` at it so the live checkout stays frozen:

```sh
git worktree add ../pi-crust-wip -b <topic>
```

This should be rare. Most changes are invisible to a running run.

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

`runtime/tsconfig.json` excludes `harness-engineering/`, so the first line does not check it. The third does, against the pi installed on this machine — those extensions import `@earendil-works/*` and `typebox` from the host rather than from this repository, and pinning a copy would check them against a version no agent here runs. With no pi installed it says so and exits 0, which is a skipped check, not a passed one.

`apps/visualizer`'s suite also includes a browser-driven layout test (`SessionCard.layout.test.ts` and `SessionCard.layout.budget.test.ts`) that spins up real Chromium through Playwright to measure actual rendered geometry, because `happy-dom` has no layout engine and cannot see overflow clipping. Chromium is a ~99MB download and is not vendored, so on a machine without it those tests print a warning and skip rather than failing `bun test` — another skipped check, not a passed one. Run `bunx playwright install chromium` to make them run for real.

Then prove a stamp still matches its source, in a directory that is thrown away in the same breath:

```sh
probe="$(mktemp -d)" && (cd "$probe" && bun "$OLDPWD/scripts/install.ts" && "$OLDPWD/scripts/verify-install.sh"); rm -rf "$probe"
```

`verify-install` reports `drift=0` when the installed tree is the one this repository ships. Anything else means the template and the stamp disagree, which is the failure that check exists to catch.

Lint is wired up — `biome.json` at the root, with the convention plugins in `.biome/`:

```sh
bunx @biomejs/biome lint --max-diagnostics=500 .
```

It is not green yet. Biome had never run here before the configuration landed, so the backlog is a first enforcement rather than a regression, and it is being worked through in [specs/REFACTOR-LINT-GREEN-PLAN.md](specs/REFACTOR-LINT-GREEN-PLAN.md). Do not report lint as passing on a narrowed path: the claim is only ever settled by the whole-repository run above, and narrowing `includes` to make a job pass is ruled out by `.biome/README.md`.

## Contributing

Branching, commit messages, and pull requests are in [CONTRIBUTING.md](CONTRIBUTING.md). They apply to the maintainer too.
