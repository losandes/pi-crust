/**
 * Points `CRUST_DB` at a scratch path before any test runs.
 *
 * Several entry points resolve their database as
 * `--db` -> `CRUST_DB` -> the config -> `DEFAULT_DB`, and `DEFAULT_DB` is the
 * RELATIVE string `.pi-crust/data/crust.db`. A test that reaches the end of
 * that chain therefore resolves it against the process's working directory,
 * which during a test run is the repository root — so the test operates on
 * the developer's own trace database. That is how `prune.test.ts` came to
 * assert "nothing to prune" against a real store, passing on a machine whose
 * runs had all been pruned and failing on one that had seven.
 *
 * Reading someone's runs is the mild version. The same chain is what a
 * `--yes` away from deleting them, and nothing in a test file announces that
 * it is about to reach a real path.
 *
 * So the default is taken away from every test at once, here, rather than
 * left to each test to remember. A test that is ABOUT the resolution chain —
 * proving `CRUST_DB` is honoured, or that the built-in default is reached
 * when nothing else is set — deletes or overrides the variable itself, which
 * is the explicit act this file exists to require.
 *
 * The path is deliberately inside a directory that does not exist: nothing
 * reads a database from it, and anything that tries to CREATE one fails
 * loudly instead of quietly accumulating state between runs. Nothing is
 * written, so there is nothing to clean up.
 *
 * Loaded by `[test] preload` in `bunfig.toml`, which is why no test imports
 * it.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'

// biome-ignore lint/plugin/no-object-mutation: process.env is the external API every db-path resolver reads, and arming it before the first test is this file's whole purpose
process.env.CRUST_DB = join(
  tmpdir(),
  `crust-test-no-db-${process.pid}`,
  'crust.db',
)

// biome-ignore lint/plugin/no-object-mutation: React reads IS_REACT_ACT_ENVIRONMENT as a global, not an env var, and without it every act() call warns
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
