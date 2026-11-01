/**
 * Which working trees this server is watching.
 *
 * One database per tree, never one shared database. A run's trace lives
 * beside the work it describes, so the session directories, the inboxes and
 * the handoff files a write has to reach are all found the same way they
 * always were — relative to that tree's own db. Pointing several trees at one
 * shared file would merge the rows and break every one of those paths, since
 * each is derived from where the database sits.
 *
 * It also means a run's workspace is not a column that can be wrong or
 * missing: it is which database the row came from.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DEFAULT_DB_RELATIVE, resolveDbPath } from "./db.ts";

/** One watched working tree: a label the UI shows, and the db to read. */
export type TWorkspace = Readonly<{
  /** URL-safe, unique within one server. Addresses the workspace in the API. */
  label: string;
  /** Absolute path to that tree's crust.db. */
  dbPath: string;
  /**
   * Absolute path to the working tree the database belongs to \u2014 the
   * directory holding `.pi-crust/config/`.
   *
   * Carried rather than derived, because `data_dir` is relocatable: a pooled
   * store puts the db at `<clone>/.pi-crust/data/issues/41/crust.db`, two
   * levels above which is `<clone>/.pi-crust/data`, a directory with no
   * stamp in it. The registry already records the true root; this is where
   * it survives to the reader.
   */
  root: string;
}>;

/**
 * A label that can survive a URL path segment.
 *
 * Workspaces are addressed in request paths, so a branch name with a slash in
 * it — which is most of them — would otherwise split into two segments and
 * route nowhere.
 */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";

/**
 * The working tree a database belongs to, when nothing recorded a better
 * answer.
 *
 * `<tree>/.pi-crust/data/crust.db` by default, so the tree is two levels up
 * from the file. This is the fallback for a workspace whose root nothing
 * recorded \u2014 a registry record that omits `root`, a `--workspace` spec that
 * names a file rather than a directory. It is wrong for a relocated or
 * pooled `data_dir`, which is why every other producer of a `TWorkspace`
 * carries its own root instead of calling this.
 */
export const workspaceRootOf = (dbPath: string): string =>
  resolve(dirname(dbPath), "..", "..");

/** A db file, whether given the file itself or the tree that contains it. */
const asDbPath = (raw: string): string => {
  const absolute = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  const isDirectory = existsSync(absolute) && statSync(absolute).isDirectory();
  return isDirectory ? join(absolute, DEFAULT_DB_RELATIVE) : absolute;
};

/** `label=path`, or just `path` with the tree's own directory name as label. */
const parseSpec = (spec: string): TWorkspace | undefined => {
  const trimmed = spec.trim();
  if (trimmed === "") return undefined;
  const split = trimmed.indexOf("=");
  const named = split > 0;
  const raw = named ? trimmed.slice(split + 1) : trimmed;
  const dbPath = asDbPath(raw);
  // The spec's own path IS the root when it names a directory \u2014 no need to
  // fall back to the database's two-levels-up arithmetic, which is wrong for
  // a relocated or pooled `data_dir`.
  const absoluteRaw = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  const root =
    existsSync(absoluteRaw) && statSync(absoluteRaw).isDirectory()
      ? absoluteRaw
      : workspaceRootOf(dbPath);
  const label = named ? slugify(trimmed.slice(0, split)) : slugify(root.split(sep).at(-1) ?? "");
  return { label, dbPath, root };
};

/**
 * A database's real path, resolving any symlink in the way — or its raw
 * path unchanged when it does not (yet) exist on disk, which is ordinary for
 * a vanished tree (1.7.3) and must not stop deduplication from working.
 */
const realOrRaw = (path: string): string => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: a path that cannot be resolved is reported as itself, not an error — a vanished tree's db has no real path to find
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * Collapse duplicates: same database twice is one workspace, same label twice
 * is two workspaces that both need addressing.
 *
 * Keyed by REAL path (1.7.5), not the string each tree happened to spell it
 * with: several worktrees can resolve `{primary_worktree}/.pi-crust/data` to
 * the identical pooled store through different `data_dir` values, or through
 * a symlink, and a pooled store is one workspace rather than one per tree
 * that points at it.
 *
 * Order is preserved because the first entry is the one the developer named
 * first, and a stable list means a stable UI.
 */
export const dedupe = (
  found: readonly TWorkspace[],
): readonly TWorkspace[] => {
  const byPath = new Map<string, TWorkspace>();
  const taken = new Set<string>();
  for (const workspace of found) {
    const real = realOrRaw(workspace.dbPath);
    if (byPath.has(real)) continue;
    const label = taken.has(workspace.label)
      ? uniqueLabel(workspace.label, taken)
      : workspace.label;
    taken.add(label);
    byPath.set(real, { label, dbPath: workspace.dbPath, root: workspace.root });
  }
  return [...byPath.values()];
};

const uniqueLabel = (base: string, taken: ReadonlySet<string>): string => {
  const next = (n: number): string => (taken.has(`${base}-${n}`) ? next(n + 1) : `${base}-${n}`);
  return next(2);
};

/** Every path `git worktree list` reports, including the main one. */
export const worktreePaths = (root: string): readonly string[] => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: not a repository, or git is not installed \u2014 discovery finding nothing is a legitimate answer and this IS the boundary that reports it that way
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim())
      .filter((line) => line !== "");
  } catch {
    // Not a repository, or git is not installed. Discovery finding nothing is
    // a legitimate answer; it must not take the server down with it.
    return [];
  }
};

/**
 * The other trees that hold a database in the same place this one does.
 *
 * "The same place" rather than `<tree>/.pi-crust/data/crust.db`, because a
 * workspace root is not always the repository root — a factory installed in a
 * subdirectory of a large repository sits below it. Taking the offset from
 * the database we already have finds its counterparts wherever they are,
 * instead of finding nothing and reporting that as "no other worktrees".
 */
export const discover = (dbPath: string): readonly TWorkspace[] => {
  const root = gitRoot(workspaceRootOf(dbPath));
  if (root === undefined) return [];
  const offset = relative(root, dbPath);
  // A db outside its own repository has no offset to apply elsewhere.
  if (offset.startsWith("..")) return [];
  return worktreePaths(root)
    .map((tree) => ({ tree, dbPath: join(tree, offset) }))
    .filter(({ dbPath }) => existsSync(dbPath))
    .map(({ tree, dbPath }) => ({
      label: slugify(tree.split(sep).at(-1) ?? ""),
      dbPath,
      root: tree,
    }));
};

const gitRoot = (from: string): string | undefined => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: not a git repository, or git is not installed \u2014 this IS the boundary that converts that into "no root to discover from"
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: from,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

/**
 * Where the factory records the trees that have run on this machine.
 *
 * Read, never written, by this process. The factory owns the format; this is
 * a second reader of it, duplicated rather than imported because the server
 * and the factory are separate packages that ship independently — the same
 * reason the inbox is written here in the format the factory reads.
 */
export const registryPath = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const override = (env.CRUST_REGISTRY ?? "").trim();
  return override === ""
    ? join(env.HOME ?? homedir(), ".pi-crust", "workspaces.jsonl")
    : resolve(override);
};

/** The registered trees, newest record per database, tolerating a torn line. */
export const readRegistry = (path: string): readonly TWorkspace[] => {
  if (!existsSync(path)) return [];
  const byDb = new Map<string, TWorkspace>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    // biome-ignore lint/plugin/no-intermediate-try-catch: a half-written or newer-than-this-reader line is tolerated, not reported \u2014 this IS the boundary that decides a torn line does not refuse the rest
    try {
      const parsed = JSON.parse(line) as { db?: unknown; root?: unknown };
      if (typeof parsed.db !== "string" || parsed.db === "") continue;
      const root =
        typeof parsed.root === "string" && parsed.root !== ""
          ? parsed.root
          : workspaceRootOf(parsed.db);
      byDb.set(parsed.db, {
        label: slugify(root.split(sep).at(-1) ?? ""),
        dbPath: parsed.db,
        root,
      });
    } catch {
      // Half written, or written by a version that knows more than this one.
      // Neither is a reason to refuse to serve the trees that did parse.
    }
  }
  return [...byDb.values()];
};

/**
 * When the registry last changed, as a cheap gate on re-reading it.
 *
 * Zero when there is no file, which is also the value for "nothing has
 * registered yet" — the two are the same state and need no distinction.
 */
export const registryStamp = (path: string): number => {
  // biome-ignore lint/plugin/no-intermediate-try-catch: no file and "nothing has registered yet" are the same state \u2014 this IS the boundary that collapses a missing file into that zero
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

/**
 * What this server watches, in precedence order:
 *
 *   --workspace <spec>   repeatable; wins over everything
 *   CRUST_WORKSPACES     the same specs, separated by commas
 *   (otherwise)          every tree registered on this machine, plus the
 *                        --db / CRUST_DB / cwd one, which is always included
 *   --all-worktrees      additionally sweeps sibling worktrees holding a db
 *
 * Watching every registered tree by default is the point: a developer with
 * five agents running wants one page, not five flags. The registry only
 * contains trees where the factory has actually run, so this cannot sprawl
 * into unrelated checkouts.
 *
 * The local database is always in the list even when nothing has registered,
 * so a single-tree invocation behaves exactly as it always did.
 */
export const resolveWorkspaces = (
  argv: readonly string[] = Bun.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly TWorkspace[] => {
  const fallback = resolveDbPath([...argv], env);
  const explicit = [...flagValues(argv, "--workspace"), ...commaSpecs(env.CRUST_WORKSPACES)]
    .map(parseSpec)
    .filter((workspace): workspace is TWorkspace => workspace !== undefined);
  if (explicit.length > 0) return dedupe(explicit);

  const everywhere =
    argv.includes("--all-worktrees") || (env.CRUST_ALL_WORKTREES ?? "").trim() !== "";
  const swept = everywhere ? discover(fallback) : [];
  const registered = readRegistry(registryPath(env));
  const parsedHere = parseSpec(fallback);
  // CRUST_WORKSPACE_ROOT, when set, names the tree the caller was actually
  // run in more reliably than anything derivable from the database path \u2014
  // the whole reason this variable exists is a pooled `data_dir` that sits
  // nowhere near the tree it belongs to.
  const workspaceRootEnv = (env.CRUST_WORKSPACE_ROOT ?? "").trim();
  const here =
    parsedHere === undefined
      ? undefined
      : workspaceRootEnv === ""
        ? parsedHere
        : {
            ...parsedHere,
            root: resolve(workspaceRootEnv),
            label: slugify(resolve(workspaceRootEnv).split(sep).at(-1) ?? ""),
          };
  // The local database is listed FIRST and unconditionally, so an empty
  // registry never means an empty UI and the tree you are standing in is
  // never the one missing from the page.
  return dedupe([
    ...(here === undefined ? [] : [here]),
    ...registered,
    ...swept,
  ]);
};

const commaSpecs = (value: string | undefined): readonly string[] =>
  (value ?? "").split(",").filter((part) => part.trim() !== "");

/** Every `--flag value` and `--flag=value` occurrence, in order. */
const flagValues = (argv: readonly string[], flag: string): readonly string[] =>
  argv.flatMap((arg, index) =>
    arg === flag && argv[index + 1] !== undefined
      ? [argv[index + 1] as string]
      : arg.startsWith(`${flag}=`)
        ? [arg.slice(flag.length + 1)]
        : [],
  );
