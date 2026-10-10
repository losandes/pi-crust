# Install

`/skill:crust install` — stamp the entire factory out of the skill and into the current working directory.

## Run it

```bash
bun <pi-crust>/scripts/install.ts
```

Run from the **target repo root** — the cwd is where everything lands, whatever directory pi-crust itself is installed in. `<pi-crust>` is that directory: a package install, a git checkout, or a skill directory.

The installer records where it ran from in `.pi-crust/data/pi-crust-home`, which is how `just crust observe` later finds the web app without being told. Move or reinstall pi-crust and that file is stale — re-run the installer, or set `CRUST_HOME`.

## What gets stamped

`install.ts` copies `templates/pi-crust/` into `./.pi-crust/`, skipping the skill's own `*.test.ts` files:

| Stamped                                                                     | From                                          | Tracked?                                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `.pi-crust/config/crust.config.yaml`                                        | `templates/pi-crust/config/crust.config.yaml` | yes — the agent roster                                                        |
| `.pi-crust/crust.just`                                                      | `templates/pi-crust/crust.just`               | yes — starter recipes, reached as `just crust <recipe>`                       |
| `justfile`                                                                  | appended: `mod crust '.pi-crust/crust.just'`  | yes — created if the repo has none                                            |
| `.env.pi-crust.sample`                                                      | `templates/env.sample`                        | yes                                                                           |
| `.pi-crust/README.md`                                                       | `templates/pi-crust/README.md`                | no — regenerated                                                              |
| `.pi-crust/stages/*.ts`                                                     | `templates/pi-crust/stages/`                  | no — one runnable entrypoint per step                                         |
| `.pi-crust/lifecycles/*.ts`                                                 | `templates/pi-crust/lifecycles/`              | no — `sdlc`, `bugfix`, `compose`                                              |
| `.pi-crust/modules/`                                                        | `templates/pi-crust/modules/`                 | no — all low-level logic                                                      |
| `.pi-crust/package.json`, `.pi-crust/tsconfig.json`                         | `templates/pi-crust/`                         | no — one dependency, `zod`                                                    |
| `.pi-crust/prompt-engineering/{planner,builder,scout,reviewer,documenter}/` | `templates/pi-crust/prompt-engineering/`      | no — **the user-owned home for prompts**, un-ignore it once you edit it       |
| `.pi-crust/harness-engineering/`                                            | `templates/pi-crust/harness-engineering/`     | no — **the user-owned home for pi extensions**, un-ignore it once you edit it |
| `.pi-crust/data/`, `.pi-crust/node_modules/`                                | created at runtime                            | no — never commit                                                             |

Only four things are committed by default, because the rest is generated and `install.ts` can rewrite it at will. The roster is the agreement about which agents run; `crust.just` has to be committed or the `mod crust` line in the root justfile fails **every** `just` invocation for anyone who clones before installing.

`prompt-engineering/` and `harness-engineering/` are yours, but being yours is a decision you make rather than one the installer makes for you. Un-ignore them when you start editing them:

```gitignore
!.pi-crust/prompt-engineering/
!.pi-crust/harness-engineering/
```

The two `*-engineering` dirs mirror the two config keys of the same name: `prompt_engineering` is what an agent is told, `harness_engineering` is what its harness can do. Both are yours the moment they are stamped. Edit them in `.pi-crust/`, never back inside the skill. They sit beside `data/` rather than inside it because everything under `data/` is written by a run — authored files and runtime files do not mix.

`harness-engineering/` ships with `subagents.ts` — the pi extension backing `subagent_create` / `_continue` / `_list` / `_remove`, wired to the planner and scout in the starter roster.

## Idempotency

Re-running is safe. `install.ts` skips **every** file that already exists — your config, your prompts, and previously stamped code alike — and reports what it skipped, so a second run doubles as a drift check. To refresh stamped code (`modules/`, the starter `stages/*.ts` or `lifecycles/*.ts`) to the skill's current version, run with `--force` — but know that `--force` overwrites ALL existing stamped files, including `crust.config.yaml` and `prompt-engineering/`, so commit or back up user-owned edits first.

## Post-install checklist

1. **Env** — `cp .env.pi-crust.sample .env`, then set `OPENROUTER_API_KEY` in `.env`. The installer does not create `.env` for you, and does not ignore it either; confirm your repository already does. (v1 runs Pi; `ANTHROPIC_API_KEY` / `CLAUDE_CODE_PATH` are only needed once Claude Code lands in v2.)
2. **Dependencies** — `install.ts` runs `bun install` inside `.pi-crust/` for you (one package: `zod`). If that step reported a failure, run it yourself.
3. **Pi is installed and on PATH** — `pi --version`. Set `PI_PATH` in `.env` if it is not.
4. **The model resolves** — the config's default `gemini-3.6-flash` must be a registered id in `~/.pi/agent/models.json`. Check with `pi --list-models` or read the file directly; see `references/config.md` for model resolution.
5. **Gitignore** — `install.ts` appends four lines for you; confirm they landed:

   ```gitignore
   # crust runtime
   .pi-crust/*
   !.pi-crust/crust.just
   !.pi-crust/config/
   .pi-crust/config/*.local.yaml
   ```

   The negation depends on `.pi-crust/` itself not being excluded, so `.pi-crust/` and `.pi-crust/*` are not interchangeable on the first line — git cannot re-include a path whose parent directory is excluded.
6. **Git repo** — a chain that ends in a commit phase calls `commitAll`, which throws if the cwd is not a git repository. Run `git init` and make a first commit before using any chain that ends in `commit`. `document.ts` needs one too: it measures the change with `git diff` against a base ref (`main` by default, `--base` to override).
7. **Smoke test** — `just crust demo` runs two cheap read-only workflows back to back, or run the smallest workflow directly:

```bash
just crust demo                                                    # both, end to end
bun .pi-crust/stages/prompt.ts "reply with a one-line summary of this repo"   # the raw form
```

Green means the whole path works: config validated, session minted, Pi ran, envelope parsed, events landed in `.pi-crust/data/crust.db`. Verify the trace exists before trusting anything larger:

```bash
sqlite3 .pi-crust/data/crust.db "select run_id, status from sessions order by started_at desc limit 1;"
```

If the smoke test fails, fix it before composing chains — every multi-agent workflow rides on this exact path.
