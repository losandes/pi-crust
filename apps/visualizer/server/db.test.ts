import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDbPath } from "./db.ts";

/**
 * Issue #24, 1.1.1: `apps/visualizer/server/db.ts:89` is named explicitly as
 * one of the consumers that MUST resolve its configured path the same way
 * every other consumer does (1.1.2) — expand a leading `~`, expand
 * `{primary_worktree}`, use an absolute value unchanged, otherwise resolve
 * against the repository root.
 *
 * `resolveDbPath` now expands `~` the same way (`db.ts`'s own `expandHome`,
 * duplicated from the shared resolver rather than imported — the server and
 * the factory are separate packages). `{primary_worktree}` is deliberately
 * NOT expanded here: that token exists for a value stated in a repository's
 * own `crust.config.yaml`, not for a flag or environment variable a single
 * developer types at a shell, which is all this function ever sees.
 */

const sealed = (
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> => ({
  CRUST_DB: undefined,
  ...overrides,
});

test(
  [
    "given server/db::resolveDbPath",
    "when CRUST_DB starts with ~",
    "it should expand to the user's home directory, same as every other data-path consumer (1.1.1, 1.1.2)",
  ].join(", "),
  () => {
    // given
    const env = sealed({ CRUST_DB: "~/pi-crust-data/crust.db" });

    // when
    const actual = resolveDbPath(["bun", "server"], env);

    // then
    expect(actual).toEqual(join(homedir(), "pi-crust-data", "crust.db"));
  },
);

test(
  [
    "given server/db::resolveDbPath",
    "when --db is given a ~-prefixed value",
    "it should expand it the same way CRUST_DB does, rather than treating ~ as a literal path segment",
  ].join(", "),
  () => {
    // given
    const env = sealed();

    // when
    const actual = resolveDbPath(
      ["bun", "server", "--db", "~/pi-crust-data/crust.db"],
      env,
    );

    // then
    expect(actual).toEqual(join(homedir(), "pi-crust-data", "crust.db"));
  },
);

test(
  [
    "given server/db::resolveDbPath",
    "when the value is a bare ~ with nothing after it",
    "it should resolve to exactly the home directory, not a literal '~' entry inside cwd",
  ].join(", "),
  () => {
    // given
    const env = sealed({ CRUST_DB: "~" });

    // when
    const actual = resolveDbPath(["bun", "server"], env);

    // then
    expect(actual).toEqual(homedir());
  },
);
