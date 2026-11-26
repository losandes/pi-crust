import { z } from 'zod'
import type { TSettlement } from '../lib/typedefs'
import { RECIPE_DOCS } from '../runtime/domains/cli'

export const parseArgs = (
  argv: readonly string[],
): TSettlement<Readonly<{ archive: string; nodeBin: string }>> => {
  const args = z
    .object({ archive: z.string().min(1), nodeBin: z.string().min(1) })
    .safeParse({
      archive: argv[argv.indexOf('--archive') + 1],
      nodeBin: argv[argv.indexOf('--node-bin') + 1],
    })
  if (
    !args.success ||
    argv.length !== 4 ||
    !argv.includes('--archive') ||
    !argv.includes('--node-bin')
  ) {
    return {
      status: 'error',
      error: new Error(
        'usage: bun scripts/check-package.ts --archive <path.tgz> --node-bin <directory holding node and npm>',
      ),
    }
  }
  return { status: 'ok', data: args.data }
}

export const parseProcessRows = (psStdout: string): readonly TProcessRow[] =>
  psStdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return match
      ? [
          {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            command: match[3] ?? '',
          },
        ]
      : []
  })

export const externalIPv4 = (
  interfaces: Readonly<
    Record<
      string,
      | readonly Readonly<{
          address: string
          family: string
          internal: boolean
        }>[]
      | undefined
    >
  >,
): string | undefined =>
  Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address

export type TArchive = Readonly<{
  paths: readonly string[]
  manifest: Readonly<Record<string, unknown>>
  programs: readonly string[]
  expected: Readonly<Record<string, unknown>>
}>
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  )
    return false
  const left = Object.entries(a)
  const right = Object.entries(b)
  return (
    left.length === right.length &&
    left.every(([key, value]) =>
      equal(value, right.find(([name]) => name === key)?.[1]),
    )
  )
}
export const archiveFaults = (archive: TArchive): readonly string[] => {
  const required = [
    ...archive.programs,
    'apps/visualizer/dist/index.html',
    'README.md',
    'LICENSE',
    'references/config.md',
    'templates/env.example',
    'templates/pi-crust.toml',
    'runtime/config/crust.config.toml',
    'package.json',
  ]
  const allowed = (path: string): boolean =>
    !(
      path.endsWith('.ts') ||
      path.includes('.test.') ||
      path.split('/').includes('..')
    ) &&
    (required.includes(path) ||
      path.startsWith('apps/visualizer/dist/') ||
      /^runtime\/config\/.+\.toml$/.test(path) ||
      /^runtime\/prompts\/.+\.md$/.test(path))
  return [
    ...archive.paths
      .filter((path) => !allowed(path))
      .map((path) => `unexpected archive path: ${path}`),
    ...required
      .filter((path) => !archive.paths.includes(path))
      .map((path) => `missing archive path: ${path}`),
    ...Object.entries(archive.expected)
      .filter(
        ([field, value]) =>
          field !== 'version' && !equal(archive.manifest[field], value),
      )
      .map(([field]) => `manifest field differs: ${field}`),
  ]
}
export const runtimeFaults = (
  found: Readonly<{ node: string; engines: string; bun: string | undefined }>,
): readonly string[] => {
  const actual = found.node.trim().replace(/^v/, '').split('.').map(Number)
  const minimum = found.engines.replace(/^>=/, '').split('.').map(Number)
  const firstDifference = minimum.findIndex(
    (part, index) => actual[index] !== part,
  )
  return [
    ...(found.bun === undefined ? [] : [`bun is reachable: ${found.bun}`]),
    ...(firstDifference >= 0 &&
    (actual[firstDifference] ?? 0) < (minimum[firstDifference] ?? 0)
      ? [`node ${found.node.trim()} is below ${found.engines}`]
      : []),
  ]
}
export const setupFiles = (paths: readonly string[]): readonly string[] =>
  paths.filter((path) => path !== '.git' && !path.startsWith('.git/'))
export type TInvocation = Readonly<{
  argv: readonly string[]
  env: Readonly<Record<string, string>>
  status: number
  contains: readonly string[]
}>
export const invocations = (
  fixture: Readonly<{ runId: string; brokenConfig: string }>,
): readonly TInvocation[] => {
  const row = (
    argv: readonly string[],
    status = 0,
    contains: readonly string[] = [],
    env: Readonly<Record<string, string>> = {},
  ): TInvocation => ({ argv, status, contains, env })
  return [
    row(['help'], 0, ['crust observe']),
    ...RECIPE_DOCS.map((doc) => row(['help', doc.name])),
    ...['default', 'update', 'list', 'config'].map((name) => row([name])),
    row(['verify'], 0, ['no tasks are declared']),
    row(['run', 'x', '--lifecycle', 'no-such-lifecycle'], 2, [
      'unknown lifecycle: no-such-lifecycle',
    ]),
    row(['operator', 'x', '--activities', 'scout'], 2, [
      'competing instructions',
    ]),
    row(['triage', 'x', '--model', 'scout=anthropic/x'], 2, [
      '--model applies to',
    ]),
    row(['demo'], 2, ['1/2  scout', 'Invalid TOML document'], {
      CRUST_CONFIG: fixture.brokenConfig,
    }),
    row(['steer', 'no-such-run', 'scout'], 2, ['usage: crust steer']),
    row(['please'], 1, ['please needs a terminal']),
    ...['approve', 'reject', 'answer'].map((name) =>
      row([name, fixture.runId], 2, ['not waiting for anyone']),
    ),
    row(['resume', 'no-such-run'], 1, ['no run no-such-run']),
    ...['ask', 'amend'].map((name) =>
      row([name, 'no-such-run', 'scout'], 1, [
        'no activity "scout" in run no-such-run',
      ]),
    ),
    row(['join', 'no-such-run', 'scout'], 1, [
      'no run "no-such-run" was found',
    ]),
    ...['report', 'report-json'].map((name) =>
      row([name, fixture.runId], 0, [fixture.runId]),
    ),
    row(['sessions'], 0, [fixture.runId]),
    ...['activity-runs', 'tail', 'procs'].map((name) =>
      row([name, fixture.runId]),
    ),
    row(['prune', '3650d'], 0, ['nothing older than 3650d to prune']),
  ]
}
export type TInvocationResult = Readonly<{
  status: number | null
  timedOut: boolean
  output: string
}>
export const MISSING_MARKERS: readonly string[] = [
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'Cannot find module',
  'Cannot find package',
  'spawn bun',
  'spawn bunx',
  'bun: command not found',
  'bun: not found',
]
export const invocationFaults = (
  invocation: TInvocation,
  result: TInvocationResult,
  prefix: string,
): readonly string[] =>
  [
    ...(result.timedOut ? ['timed out after 60 seconds'] : []),
    ...(result.status === null
      ? ['ended by signal']
      : result.status === invocation.status
        ? []
        : [`exit ${result.status}, expected ${invocation.status}`]),
    ...invocation.contains
      .filter((text) => !result.output.includes(text))
      .map((text) => `missing output: ${text}`),
    ...MISSING_MARKERS.filter(
      (text) =>
        result.output.includes(text) &&
        !MISSING_MARKERS.some(
          (longer) =>
            longer !== text &&
            longer.includes(text) &&
            result.output.includes(longer),
        ),
    ).map((text) => `missing runtime dependency: ${text}`),
    ...(result.output
      .split('\n')
      .some((line) => line.includes('ENOENT') && line.includes(prefix))
      ? [`ENOENT under ${prefix}`]
      : []),
  ].map((fault) => `crust ${invocation.argv.join(' ')}: ${fault}`)
export type TPageObservation = Readonly<{
  runVisible: boolean
  responses: readonly Readonly<{
    url: string
    resourceType: string
    status: number
  }>[]
  pageErrors: readonly string[]
}>
export const pageFaults = (
  observation: TPageObservation,
): readonly string[] => [
  ...(observation.runVisible
    ? []
    : ['the UI did not show chkpkg01 within 10 seconds']),
  ...observation.responses
    .filter(
      (response) =>
        ['document', 'script', 'stylesheet'].includes(response.resourceType) &&
        response.status >= 400,
    )
    .map(
      (response) =>
        `UI ${response.resourceType} ${response.url}: HTTP ${response.status}`,
    ),
  ...observation.pageErrors.map((message) => `UI page error: ${message}`),
]
export type TProcessRow = Readonly<{
  pid: number
  ppid: number
  command: string
}>
export const processFaults = (
  seen: Readonly<{
    rows: readonly TProcessRow[]
    root: number
    prefix: string
  }>,
): readonly string[] => {
  const descendant = (
    pid: number,
    visited: readonly number[] = [],
  ): boolean => {
    if (pid === seen.root) return true
    if (visited.includes(pid)) return false
    const parent = seen.rows.find((row) => row.pid === pid)?.ppid
    return parent !== undefined && descendant(parent, [...visited, pid])
  }
  return seen.rows
    .filter((row) => row.pid !== seen.root && descendant(row.pid))
    .flatMap((row) => {
      const [command = '', program = ''] = row.command.trim().split(/\s+/)
      return (command === 'node' || command.endsWith('/node')) &&
        program.startsWith(`${seen.prefix}/`)
        ? []
        : [`unexpected observe child ${row.pid}: ${row.command}`]
    })
}
