# Install

`/skill:crust install` — stamp the entire factory out of the skill and into the current working directory.

## Run it

```bash
bun <pi-crust>/scripts/install.ts
```

Run from the **target repo root** — the cwd is where everything lands, whatever directory pi-crust itself is installed in. `<pi-crust>` is that directory: a package install, a git checkout, or a skill directory.

The installer records where it ran from in `.pi-crust/data/pi-crust-home`, which is how `just crust observe` later finds the web app without being told. Move or reinstall pi-crust and that file is stale — re-run the installer, or set `CRUST_HOME`.

## What gets stamped

`install.ts` copies `templates/stamp/` into `./.pi-crust/`. That is the whole stamp, and all of it is yours:

| Stamped                                  | What it is                                                   | Tracked?          |
| ---------------------------------------- | ------------------------------------------------------------ | ----------------- |
| `config/crust.config.yaml`               | defaults and routing                                         | yes               |
| `config/crust.activities.yaml`           | every Activity this repository offers                        | yes               |
| `config/crust.lifecycles.yaml`           | every Lifecycle, as Stages and dependencies                  | yes               |
| `config/crust.observe.yaml`              | the trace db, the UI's ports, every theme it offers          | yes               |
| `config/high-contrast.css`               | a worked theme, registered in `crust.observe.yaml`           | yes               |
| `config/crust.config.local.example.yaml` | what a personal override may say                             | yes               |
| `prompt-engineering/README.md`           | how to add or override a prompt                              | yes               |
| `prompt-engineering/example/`            | the shape of a prompt                                        | no — illustrative |
| `data/`                                  | this developer's runs, and where pi-crust is on this machine | no — never shared |
| `.env.pi-crust.example`                  | the variables a roster may need, at the repository root      | yes               |
| `justfile`                               | gains a `crust` recipe; created if the repository has none   | yes               |

**No code is stamped.** The runtime — modules, the Activity runner, the Planners, the shipped prompts, the pi extensions, the recipes — lives in the pi-crust package. That is what makes an update safe: it can replace every file it owns without touching a file you wrote, because none of them are the same file.

An install also **removes** paths an earlier version stamped into `.pi-crust/`: `modules/`, `stages/`, `lifecycles/`, `harness-engineering/`, `crust.just` and the root scripts. Those are dead copies no code reads. The list is explicit, so a file you created is never a deletion candidate.

## Extending it

Nothing here needs a `.gitignore` edit. Every directory that receives your work is already tracked.

| To                                | Do                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Add an Activity                   | Add an entry to `config/crust.activities.yaml`                                             |
| Remove one                        | Delete its entry — the file lists everything, so deleting removes the capability           |
| Reorder the menu                  | Reorder the file; nothing else records a sequence                                          |
| Hide one from `just crust please` | `hidden: true` on the Activity. It still runs by name, in a Lifecycle, and under a Planner |
| Add or change a Lifecycle         | Edit `config/crust.lifecycles.yaml`                                                        |
| Override a prompt                 | Write `.pi-crust/prompt-engineering/<activity>/system.md`. It wins; nothing else changes   |
| Add a theme                       | Register it in `config/crust.observe.yaml` and put the `.css` beside it, as `high-contrast.css` does |
| Move the trace UI's ports         | `ports:` in `config/crust.observe.yaml`; `CRUST_BE_PORT` / `CRUST_FE_PORT` win, for one shell |
| Deviate personally                | Any of the above in a `*.local.yaml` sibling, which is gitignored                          |

A local layer may set any key and may add an Activity or Lifecycle the team file does not have. It is not restricted, because whoever writes it can equally write the committed file.

Three capabilities are not configurable and cannot be removed: **Triage** recommends a Lifecycle, the **Operator** recommends and runs one, and the **Composer** runs the plan it is handed. They decide or initiate work rather than perform it.

## Post-install checklist

1. **Env** — `cp .env.pi-crust.example .env`, then set `OPENROUTER_API_KEY` in `.env`. The installer does not create `.env` for you, and does not ignore it either; confirm your repository already does. (v1 runs Pi; `ANTHROPIC_API_KEY` / `CLAUDE_CODE_PATH` are only needed once Claude Code lands in v2.)
2. **Dependencies** — nothing to install into `.pi-crust/`. The stamp is configuration and documents only; the runtime and its one dependency (`zod`) live in the pi-crust package, and an install removes any `package.json`, `bun.lock` or `node_modules` an older version left in the stamp.
3. **Pi is installed and on PATH** — `pi --version`. Set `PI_PATH` in `.env` if it is not.
4. **The model resolves** — the config's default `gemini-3.6-flash` must be a registered id in `~/.pi/agent/models.json`. Check with `pi --list-models` or read the file directly; see `references/config.md` for model resolution.
5. **Gitignore** — `install.ts` appends three lines for you; confirm they landed:

   ```gitignore
   # crust runtime
   .pi-crust/data/
   .pi-crust/config/*.local.yaml
   .pi-crust/prompt-engineering/example/
   ```

   Everything else in `.pi-crust/` is yours and belongs in the repository.

6. **Git repo** — an Activity that declares `commit: true` stages the paths it was observed to change and commits them, which throws if the cwd is not a git repository. Run `git init` and make a first commit before using any chain that ends in `commit`. `document.ts` needs one too: it measures the change with `git diff` against a base ref (`main` by default, `--base` to override).
7. **Smoke test** — `just crust demo` runs two cheap read-only workflows back to back, or run the smallest workflow directly:

```bash
just crust demo                                                    # both, end to end
bun <pi-crust>/runtime/lifecycles/compose.ts "reply with a one-line summary of this repo" --activities scout   # the raw form
```

Green means the whole path works: config validated, session minted, Pi ran, envelope parsed, events landed in `.pi-crust/data/crust.db`. Verify the trace exists before trusting anything larger:

```bash
sqlite3 .pi-crust/data/crust.db "select run_id, status from sessions order by started_at desc limit 1;"
```

If the smoke test fails, fix it before composing chains — every multi-agent workflow rides on this exact path.
