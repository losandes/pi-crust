# Install

Link a pi-crust clone from its root, with bun's global bin directory on your PATH (see [Running your clone as `crust`](../CONTRIBUTING.md#running-your-clone-as-crust)):

```bash
bun install
bun link
```

Set a repository up from its Git root:

```bash
crust init
```

`<pi-crust>` is the package directory, wherever installed. Runtime code and prompts stay there; nothing copies them into the target repository.

## What is installed

A fresh install creates exactly these files:

| File                    | Ownership                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `pi-crust.toml`         | Repository configuration, written only when absent; every example task is commented out. |
| `.env.pi-crust.example` | Template-owned credential example; the installer does not create `.env`.                 |
| `.gitignore`            | Gains `.pi-crust/data/`. Existing contents are retained.                                 |

The repository's only pi-crust configuration file is `pi-crust.toml`. Defaults, Activities and lifecycles are read live from `<pi-crust>/runtime/config/`, then `~/.pi-crust/config/`, then that repository file. A package update reaches the next command without re-stamping. See the [configuration reference](../references/config.md).

Setup writes nothing under the repository's `.pi-crust/`, no `justfile` and no machine record, and leaves an existing `justfile` untouched. It creates no configuration or prompt directory. Legacy `.pi-crust/config/` and `.pi-crust/prompts/` directories are left untouched and are no longer read for runtime configuration or prompt overrides; viewer settings and added themes live in the machine configuration. A leftover `.pi-crust/config/crust.observe.yaml` or `.pi-crust/data/pi-crust-home` is not read or deleted. The report points to the reference's hand-migration instructions. Never delete execution history under `.pi-crust/data/` as part of configuration migration.

## Reinstall or refresh

```bash
crust update
# Or: crust init --refresh
```

An existing `pi-crust.toml` is never overwritten, even with `--refresh` or `--force`. Refresh applies only to template-owned files such as the credential example. `--force` is a deprecated alias through 0.1.x, scheduled for removal in 0.2.0.

Old pointer files are left byte-identical. The explicit cleanup of obsolete stamped runtime paths is unchanged; legacy configuration and prompt directories are not cleanup candidates. The trace database and sessions are never migrated by installation.

To generate the repository file separately, use `make-config.ts`. Unlike the installer, that command's explicit `--force` replaces the one TOML file; review and preserve existing contents first.

## Configure once for the machine

```bash
mkdir -p ~/.pi-crust/config
cp <pi-crust>/cookbooks/examples/crust.activities.machine.example.toml \
   ~/.pi-crust/config/crust.activities.toml
```

If the destination already exists, merge the tables by hand rather than overwrite it. The same three file names are accepted at machine and package level: `crust.config.toml`, `crust.activities.toml`, `crust.lifecycles.toml`. The repository wins on fields it explicitly sets. Tasks may be declared only in the repository's `pi-crust.toml`.

## Post-install checks

1. Run `crust list`; an unedited installation needs no task commands and lists the shipped catalogue.
2. Copy `.env.pi-crust.example` to `.env` if needed, then set credentials for the providers named by the effective roster. Confirm the repository ignores credentials; the installer adds only the data ignore entry.
3. Confirm Pi is on `PATH`, or set `PI_PATH`. Check model patterns with `pi --list-models`.
4. Run `crust config` to inspect effective settings and their sources. Uncomment example task tables in `pi-crust.toml` only after replacing their commands with the repository's real verification commands.
5. If an end-to-end agent smoke test is wanted, run `crust demo`. It starts agents and uses provider credentials; listing and configuration inspection do not.

A fresh file declares no tasks, so a run reports that no commands ran rather than executing a placeholder command. `check:install` verifies a disposable fresh installation's exact file set, inactive task examples and successful catalogue loading; it does not compare or rewrite an existing repository's configuration.
