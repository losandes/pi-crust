/**
 * The packages a pi extension expects its host to provide.
 *
 * `harness-engineering/` is excluded from `runtime/tsconfig.json`, because
 * the modules it imports belong to the pi host rather than to this tree and
 * checking them here would report unresolvable imports forever. The price of
 * that exclusion is that nothing notices when the host RENAMES a package —
 * which is exactly what happened when pi moved off the `@mariozechner` scope
 * and `@sinclair/typebox` became bare `typebox`. Both extensions kept
 * compiling, because nothing compiled them, and would have failed the first
 * time an agent declared one.
 *
 * Pure: this reads source text and returns specifiers. Resolving them against
 * an actual installation is `data/pi-host.ts`, and judging the pair is the
 * test beside this file.
 */

/**
 * A line-anchored import or export statement. Deliberately not a general
 * expression match: these files carry long prose comments, and a pattern
 * loose enough to find `require(...)` mid-sentence also finds `from the
 * beginning` in English.
 */
const STATEMENT =
  /^\s*(?:import|export)\s(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/gm

/**
 * A specifier naming another package, not a file and not a runtime builtin.
 *
 * `node:` and `bun:` are the host's own, always present, and never anyone's
 * dependency; a relative or absolute path resolves within this tree.
 */
const isBare = (specifier: string): boolean =>
  !(
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.includes(':')
  )

/** `@scope/pkg/sub` -> `@scope/pkg`; `pkg/sub` -> `pkg`. */
export const packageOf = (specifier: string): string => {
  const segments = specifier.split('/')
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : (segments[0] ?? specifier)
}

/** Every package this source expects to import, once each, sorted. */
export const importedPackages = (source: string): readonly string[] =>
  [
    ...new Set(
      [...source.matchAll(STATEMENT)]
        .map((match) => match[1] ?? '')
        .filter(isBare)
        .map(packageOf),
    ),
  ].toSorted()
