import { safeParseSettlement } from '@typedefs'
import { z } from 'zod'

export type TRedactionConfig = Readonly<{ enabled: boolean; home: string }>
/** Nullable roots arrive at the API boundary from older trace rows. */
export type TRunRoots = Readonly<{
  repository_root?: string | null
  workspace_root?: string | null
}>
export type TRedactor = Readonly<{
  text: (value: string) => string
  json: (raw: string) => string
  location: (path: string) => string
  forRun: (roots: TRunRoots) => TRedactor
}>
type TPrefix = Readonly<{ path: string; token: string; home: boolean }>

const usable = (path: string): boolean =>
  path.startsWith('/') && path.length >= 2
const normalise = (path?: string | null): string =>
  (path ?? '').replace(/\/+$/, '')
const under = (home: string, path: string): boolean =>
  usable(home) && (path === home || path.startsWith(`${home}/`))
const escapePattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const identity = (value: string): string => value
const healthSchema = z.object({
  redact_paths: z.unknown().optional(),
  home_dir: z.unknown().optional(),
})

export const redactionConfigOf = (
  health: unknown,
): TRedactionConfig | undefined => {
  const parsed = healthSchema.safeParse(health)
  if (!parsed.success) return undefined
  const { redact_paths, home_dir } = parsed.data
  if (redact_paths !== false && typeof home_dir !== 'string') return undefined
  return {
    enabled: redact_paths !== false,
    home: typeof home_dir === 'string' ? home_dir : '',
  }
}

const matcher = (
  entries: readonly (readonly [string, string])[],
  cut: string,
) => {
  const tokens = new Map(entries)
  const choices = [...tokens.keys()].toSorted((a, b) => b.length - a.length)
  const pattern = choices.length
    ? new RegExp(`(?:${choices.map(escapePattern).join('|')})${cut}`, 'gu')
    : undefined
  return (value: string): string =>
    pattern
      ? value.replace(pattern, (match) => tokens.get(match) ?? match)
      : value
}

const redactorFor = (config: TRedactionConfig, roots: TRunRoots): TRedactor => {
  const home = normalise(config.home)
  const repository = normalise(roots.repository_root)
  const workspace = normalise(roots.workspace_root)
  const prefixes: readonly TPrefix[] = [
    { path: repository, token: '<repo>', home: false },
    {
      path: workspace === repository ? '' : workspace,
      token: '<worktree>',
      home: false,
    },
    { path: home, token: '~', home: true },
  ].filter(({ path }) => usable(path))
  const pieces = (marked: boolean): readonly (readonly [string, string])[] =>
    prefixes.flatMap((prefix) =>
      Array.from({ length: prefix.path.length - 1 }, (_, i) => i + 1)
        .filter((k) =>
          prefix.home
            ? k > prefix.path.lastIndexOf('/') + 1
            : (!under(home, prefix.path) &&
                k > prefix.path.lastIndexOf('/') + 1) ||
              (marked && (under(home, prefix.path) ? k > home.length : k >= 2)),
        )
        .map(
          (k) =>
            [prefix.path.slice(0, k), prefix.home ? '~' : '<path>'] as const,
        ),
    )
  // Home comes last in the map so it wins a tie with a recorded root piece.
  const marked = matcher(pieces(true), '(?=…)')
  const ended = matcher(pieces(false), '(?![\\s\\S])')
  const whole = matcher(
    // Map keeps the last value: reverse priority so repository wins equal paths.
    prefixes.toReversed().map(({ path, token }) => [path, token] as const),
    '(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}_-])',
  )
  const text = (value: string): string => whole(ended(marked(value)))
  const stems = prefixes.map(({ path, home: isHome }) =>
    isHome
      ? path.slice(0, path.lastIndexOf('/') + 2)
      : under(home, path)
        ? home.slice(0, home.lastIndexOf('/') + 2)
        : path.slice(0, 2),
  )
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return text(value)
    if (Array.isArray(value)) return value.map(walk)
    if (typeof value === 'object' && value !== null)
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [text(key), walk(item)]),
      )
    return value
  }
  const json = (raw: string): string => {
    if (!stems.some((stem) => raw.includes(stem))) return raw
    const parsed = safeParseSettlement(() => JSON.parse(raw) as unknown)
    if (parsed.status === 'error') return text(raw)
    const value = parsed.data
    if (typeof value !== 'object' || value === null) return text(raw)
    const result = walk(value)
    return JSON.stringify(result) === JSON.stringify(value)
      ? raw
      : JSON.stringify(result)
  }
  const location = (path: string): string => {
    const clean = normalise(path)
    if (!usable(clean)) return path
    if (under(home, clean)) return `~${clean.slice(home.length)}`
    const segments = clean.slice(1).split('/')
    return segments.length > 1
      ? `…/${segments.slice(1).join('/')}`
      : `…${segments[0]}`
  }
  return {
    text: config.enabled ? text : identity,
    json: config.enabled ? json : identity,
    location: config.enabled ? location : identity,
    forRun: (next) => redactorFor(config, next),
  }
}

export const createRedactor = (config: TRedactionConfig): TRedactor =>
  redactorFor(config, {})

export const redactFields =
  <TRow extends object>(
    redactor: TRedactor,
    fields: Readonly<{
      text?: readonly (keyof TRow)[]
      json?: readonly (keyof TRow)[]
    }>,
  ) =>
  (row: TRow): TRow =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'string'
          ? fields.text?.includes(key as keyof TRow)
            ? redactor.text(value)
            : fields.json?.includes(key as keyof TRow)
              ? redactor.json(value)
              : value
          : value,
      ]),
    ) as TRow
