# Contributing

Thank you for wanting to improve pi-crust.

## Licensing of contributions

pi-crust is released under the [MIT License](LICENSE).

By submitting a contribution — a pull request, a patch, a code suggestion in an issue or a review — you agree that:

- You have the right to submit it, and it is your own work or work you are authorised to contribute.
- Your contribution is licensed under the project licence in force at the time it is merged.
- The maintainer may relicense the project, including your contribution, under different terms in future, without asking you again.

pi-crust is MIT-licensed. The relicensing grant is retained so the licence can change again without tracing every contributor for permission.

This grant runs to the maintainer only. It does not give anyone else rights beyond the project licence, and it does not transfer your copyright: you keep it, and you may use your own contribution however you like elsewhere.

If you cannot agree to this, please open an issue describing the change rather than submitting the code. A described idea carries no licence, and is welcome.

## Running your clone as `crust`

`package.json` names `runtime/cli.ts` as the `crust` command. Link your clone from its root so that `crust` runs your working copy:

```sh
bun link
```

`bun link` puts a `crust` symlink in bun's global bin directory, `~/.bun/bin` unless `BUN_INSTALL` moves it. The symlink resolves to your clone's files, so an edit takes effect the next time `crust` starts, with no relinking. If that directory is not on your `PATH`, which is the case when bun was installed by a version manager such as mise, add it in your shell's startup file:

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

Then confirm it from a new shell:

```sh
which crust
crust help
```

To try a worktree's runtime without disturbing the one live runs use, set `CRUST_HOME` to that worktree. `crust` then hands every invocation to the worktree's `runtime/cli.ts`, and refuses rather than falling back when the directory holds no runtime. Do not run `bun link` in the worktree: that repoints the global `crust` for every repository on the machine.

```sh
CRUST_HOME=../pi-crust-wip crust run "..." --lifecycle sdlc
```

## Building the Node package

Run `mise run build:package` from the repository root to build the installable Node package in `dist/`, including the web UI. The build bundles JavaScript programs and the path-policy extension and copies runtime configuration, prompts, installer templates and shipped documentation. A linked clone does not use this build: `crust` still runs its TypeScript working copy under bun. Local `dist/` is not ignored and must not be committed; only the release workflow commits the distribution.

To build, pack and check an archive without creating a local `dist/`, use an installed Node with npm and the visualizer's Chromium:

```sh
( OUT="$(mktemp -d)"; bun scripts/build-package.ts --out "$OUT/pkg" && npm pack "$OUT/pkg" --pack-destination "$OUT" && bun scripts/check-package.ts --archive "$OUT"/polyn-pi-crust-*.tgz --node-bin "$(mise where node)/bin"; STATUS=$?; rm -rf "$OUT"; exit "$STATUS" )
```

The check installs only into a disposable prefix, runs every command without bun, opens the UI in Chromium and verifies shutdown, restart and network bindings. The release workflow repeats it under exactly Node 22.19.0.

## Releasing

Publish a GitHub release with a SemVer tag, optionally prefixed `v`, such as `v1.2.3` or `1.2.3-rc.1`. Build metadata (`+...`) is not accepted. Target a branch, not a commit. `main` publishes under the npm dist-tag `latest`; another branch publishes under its own name. Branch names must start with a letter and contain only letters, digits, dots, underscores and hyphens, cannot be `latest` and cannot begin with `v` or `V` followed by a digit. Cut prereleases from another branch if they should not become the default install.

Configure an `NPM_TOKEN` repository secret able to publish `@polyn/pi-crust` publicly. The workflow versions the root manifest, checks the code and the packed archive, commits `dist/` and the version to the release's target branch, publishes that same archive, and pushes the commit without changing tags. Nobody runs `npm publish` by hand.

## Branching and pull requests

`main` is always installable. Every change arrives through a short-lived branch and a pull request, including the maintainer's.

- Branch from `main`, named `<owner>/<topic>` — `losandes/archive-verb`.
- [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`. Present tense, imperative.
- Keep a pull request to one concern. One that fixes a bug and tidies the surrounding file is two reviews pretending to be one.
- Run the checks. A change is not ready while anything is red.
- Explain **why**, in the commit body and in the description. What the diff does is already visible; what it is for is not.
- Rebase rather than merge `main` into your branch; squash on merge, so `main` stays linear and each entry is one reviewable change.
