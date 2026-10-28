import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crustRuntime, NO_RUNTIME, startRun, startSteer } from "./writes.ts";

/**
 * A stamped tree, as an install leaves one: config, data, and NO runtime.
 *
 * The runtime ships with the package, so a server that resolves an entry
 * point relative to the repository resolves it to nothing — which is what
 * every write action in this UI was doing.
 */
const stampedTree = (home?: string): string => {
  const root = mkdtempSync(join(tmpdir(), "crust-writes-"));
  mkdirSync(join(root, ".pi-crust", "data"), { recursive: true });
  if (home !== undefined) {
    writeFileSync(join(root, ".pi-crust", "data", "pi-crust-home"), home);
  }
  return root;
};

/** A package, as an install reads one: `runtime/cli.ts` is what proves it. */
const packageTree = (): string => {
  const home = mkdtempSync(join(tmpdir(), "crust-home-"));
  mkdirSync(join(home, "runtime", "lifecycles"), { recursive: true });
  writeFileSync(join(home, "runtime", "cli.ts"), "");
  return home;
};

const dbOf = (root: string): string =>
  join(root, ".pi-crust", "data", "crust.db");

/**
 * Temporary trees, removed between tests.
 *
 * A Set rather than an array being pushed into: what this holds is a set of
 * paths to delete, and emptying it is one operation rather than a splice.
 */
const created = new Set<string>();
const track = (path: string): string => {
  created.add(path);
  return path;
};

/** The environment, passed rather than mutated — the whole point of the parameter. */
const withHome = (home?: string): Readonly<Record<string, string | undefined>> =>
  home === undefined ? {} : { CRUST_HOME: home };

afterEach(() => {
  for (const path of created) {
    rmSync(path, { recursive: true, force: true });
  }
  created.clear();
});

test(
  [
    "given server/writes::crustRuntime",
    "when the stamp recorded where pi-crust was installed from",
    "it should resolve the runtime there rather than inside the repository",
  ].join(", "),
  () => {
    // given
    const home = track(packageTree());
    const root = track(stampedTree(home));

    // when
    const actual = crustRuntime(dbOf(root), withHome());

    // then
    expect(actual).toBe(join(home, "runtime"));
  },
);

test(
  [
    "given server/writes::crustRuntime",
    "when CRUST_HOME is set",
    "it should win, because that is the repair when the package moves",
  ].join(", "),
  () => {
    // given
    const home = track(packageTree());
    const root = track(stampedTree("/gone/stale/path"));

    // when
    const actual = crustRuntime(dbOf(root), withHome(home));

    // then
    expect(actual).toBe(join(home, "runtime"));
  },
);

test(
  [
    "given server/writes::crustRuntime",
    "when nothing says where pi-crust is",
    "it should be undefined rather than a path that cannot exist",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());

    // when
    const actual = crustRuntime(dbOf(root), withHome());

    // then
    expect(actual).toBeUndefined();
  },
);

test(
  [
    "given server/writes::startSteer",
    "when the runtime cannot be found",
    "it should refuse and say so, rather than report a steer that never ran",
  ].join(", "),
  () => {
    // given — a pid proves a process started, not that it found its module
    const root = track(stampedTree());

    // when
    const actual = startSteer(dbOf(root), "a1b2c3d4", "plan", "overwrite", "x");

    // then
    expect(actual.started).toBe(false);
    expect(actual.pid).toBeUndefined();
    expect(actual.reason).toBe(NO_RUNTIME);
  },
);

test(
  [
    "given server/writes::startRun",
    "when the runtime cannot be found",
    "it should hand back no run id, so nothing is told to watch for one",
  ].join(", "),
  () => {
    // given
    const root = track(stampedTree());

    // when
    const actual = startRun(dbOf(root), "sdlc", "add a /health endpoint", []);

    // then
    expect(actual.run_id).toBe("");
    expect(actual.reason).toBe(NO_RUNTIME);
  },
);
