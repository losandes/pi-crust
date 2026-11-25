import { expect, test } from 'bun:test'
import { RECIPE_DOCS } from '../runtime/domains/cli'
import {
  archiveFaults,
  externalIPv4,
  invocationFaults,
  invocations,
  MISSING_MARKERS,
  pageFaults,
  parseArgs,
  parseProcessRows,
  processFaults,
  runtimeFaults,
  setupFiles,
  type TArchive,
} from './package-faults'

for (const argv of [
  ['--archive', 'package.tgz', '--node-bin', '/node/bin'],
  ['--node-bin', '/node/bin', '--archive', 'package.tgz'],
]) {
  test(
    [
      'given archive-check flags in either order',
      `when parsing ${argv.join(' ')}`,
      'it should return the archive and Node directory',
    ].join(', '),
    () => {
      // given
      // when
      const actual = parseArgs(argv)
      // then
      expect(actual).toEqual({
        status: 'ok',
        data: { archive: 'package.tgz', nodeBin: '/node/bin' },
      })
    },
  )
}

for (const argv of [
  [],
  ['--archive', 'package.tgz'],
  ['--node-bin', '/node/bin'],
  ['--archive', 'package.tgz', '--node-bin'],
  ['--archive', '', '--node-bin', '/node/bin'],
  ['--archive', 'package.tgz', '--node-bin', ''],
  ['--archive', 'package.tgz', '--node-bin', '/node/bin', 'extra'],
  ['--archive', 'package.tgz', '--unknown', '/node/bin'],
  ['--unknown', 'package.tgz', '--node-bin', '/node/bin'],
  ['--archive', 'package.tgz', '--archive', 'other.tgz'],
]) {
  test(
    [
      'given incomplete or unsupported archive-check flags',
      `when parsing ${JSON.stringify(argv)}`,
      'it should return the usage error',
    ].join(', '),
    () => {
      // given
      // when
      const actual = parseArgs(argv)
      // then
      expect(actual.status).toBe('error')
      if (actual.status === 'error')
        expect(actual.error.message).toBe(
          'usage: bun scripts/check-package.ts --archive <path.tgz> --node-bin <directory holding node and npm>',
        )
    },
  )
}

for (const row of [
  { name: 'empty output', output: '', expected: [] },
  {
    name: 'malformed rows',
    output: ' PID PPID COMMAND\ninvalid\n10 nope node /prefix/a.js\n',
    expected: [],
  },
  {
    name: 'indented process rows with arguments',
    output:
      '  10     1 node /prefix/cli.js\n\t11 10 /bin/node /prefix/server.js --host 127.0.0.1\n',
    expected: [
      { pid: 10, ppid: 1, command: 'node /prefix/cli.js' },
      {
        pid: 11,
        ppid: 10,
        command: '/bin/node /prefix/server.js --host 127.0.0.1',
      },
    ],
  },
  {
    name: 'mixed valid and invalid rows',
    output: 'bad\n12 11 bun /prefix/unexpected.js\n',
    expected: [{ pid: 12, ppid: 11, command: 'bun /prefix/unexpected.js' }],
  },
]) {
  test(
    [
      'given ps output',
      `when parsing ${row.name}`,
      'it should preserve process identities and complete commands',
    ].join(', '),
    () => {
      // given
      // when
      const actual = parseProcessRows(row.output)
      // then
      expect(actual).toEqual(row.expected)
    },
  )
}

for (const row of [
  { name: 'no interfaces', interfaces: {}, expected: undefined },
  {
    name: 'unavailable interface',
    interfaces: { missing: undefined },
    expected: undefined,
  },
  {
    name: 'loopback and IPv6 only',
    interfaces: {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth: [{ address: '::1', family: 'IPv6', internal: false }],
    },
    expected: undefined,
  },
  {
    name: 'multiple external addresses',
    interfaces: {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth: [
        { address: '::2', family: 'IPv6', internal: false },
        { address: '192.0.2.1', family: 'IPv4', internal: false },
      ],
      wifi: [{ address: '192.0.2.2', family: 'IPv4', internal: false }],
    },
    expected: '192.0.2.1',
  },
]) {
  test(
    [
      'given network interfaces',
      `when selecting from ${row.name}`,
      'it should choose the first non-internal IPv4 address only',
    ].join(', '),
    () => {
      // given
      // when
      const actual = externalIPv4(row.interfaces)
      // then
      expect(actual).toBe(row.expected)
    },
  )
}

const expected = {
  name: '@polyn/pi-crust',
  description: 'description',
  license: 'MIT',
  type: 'module',
  bin: { crust: 'runtime/cli.js' },
  engines: { node: '>=22.19.0' },
  dependencies: { zod: '4.6.7' },
  publishConfig: { access: 'public' },
}
const valid: TArchive = {
  expected,
  manifest: { ...expected, version: '1.2.3' },
  programs: ['runtime/cli.js'],
  paths: [
    'runtime/cli.js',
    'package.json',
    'apps/visualizer/dist/index.html',
    'apps/visualizer/dist/assets/main.js',
    'README.md',
    'LICENSE',
    'references/config.md',
    'templates/env.example',
    'templates/pi-crust.toml',
    'runtime/config/crust.config.toml',
    'runtime/prompts/build/system.md',
  ],
}
for (const row of [
  { name: 'valid', archive: valid, count: 0 },
  ...['extra', 'runtime/x.ts', 'runtime/x.test.js'].map((path) => ({
    name: path,
    archive: { ...valid, paths: [...valid.paths, path] },
    count: 1,
  })),
  ...['runtime/cli.js', 'apps/visualizer/dist/index.html'].map((path) => ({
    name: `missing ${path}`,
    archive: { ...valid, paths: valid.paths.filter((entry) => entry !== path) },
    count: 1,
  })),
  ...Object.keys(expected).map((field) => ({
    name: field,
    archive: {
      ...valid,
      manifest: { ...valid.manifest, [field]: 'different' },
    },
    count: 1,
  })),
  {
    name: 'version',
    archive: { ...valid, manifest: { ...valid.manifest, version: '9.9.9' } },
    count: 0,
  },
])
  test(
    [
      'given archive metadata',
      `when inspecting ${row.name}`,
      'it should report only the manifest or file-set fault',
    ].join(', '),
    () => {
      // given
      // when
      const faults = archiveFaults(row.archive)
      // then
      expect(faults).toHaveLength(row.count)
    },
  )
for (const row of [
  { node: 'v22.19.0', bun: undefined, count: 0 },
  { node: 'v26.13.0', bun: undefined, count: 0 },
  { node: 'v22.14.0', bun: undefined, count: 1 },
  { node: 'v21.30.0', bun: undefined, count: 1 },
  { node: 'v22.19.0', bun: '/bin/bun', count: 1 },
])
  test(
    [
      'given a runtime environment',
      `when inspecting ${row.node} with bun ${row.bun}`,
      'it should enforce the declared minimum without bun',
    ].join(', '),
    () => {
      // given
      // when
      const faults = runtimeFaults({ ...row, engines: '>=22.19.0' })
      // then
      expect(faults).toHaveLength(row.count)
    },
  )
test(
  [
    'given setup files and command definitions',
    'when preparing verification inputs',
    'it should exclude Git internals and exercise every installed command',
  ].join(', '),
  () => {
    // given
    const fixture = { runId: 'chkpkg01', brokenConfig: '/scratch/broken.toml' }
    // when
    const rows = invocations(fixture)
    // then
    expect(
      setupFiles([
        '.git',
        '.git/HEAD',
        '.git/objects/a/b',
        '.gitignore',
        'pi-crust.toml',
      ]),
    ).toEqual(['.gitignore', 'pi-crust.toml'])
    expect(rows).toHaveLength(26 + RECIPE_DOCS.length)
    for (const doc of RECIPE_DOCS) {
      expect(
        rows.some((row) => row.argv[0] === 'help' && row.argv[1] === doc.name),
      ).toBe(true)
      if (!['init', 'observe'].includes(doc.name))
        expect(rows.some((row) => row.argv[0] === doc.name)).toBe(true)
    }
    expect(rows.find((row) => row.argv[0] === 'demo')?.env).toEqual({
      CRUST_CONFIG: fixture.brokenConfig,
    })
    expect(rows.find((row) => row.argv[0] === 'report')?.argv).toEqual([
      'report',
      fixture.runId,
    ])
  },
)
const invocation = {
  argv: ['help'],
  env: {},
  status: 0,
  contains: ['commands'],
}
for (const row of [
  { name: 'success', status: 0, timedOut: false, output: 'commands', count: 0 },
  {
    name: 'wrong status',
    status: 2,
    timedOut: false,
    output: 'commands',
    count: 1,
  },
  {
    name: 'signal',
    status: null,
    timedOut: false,
    output: 'commands',
    count: 1,
  },
  { name: 'timeout', status: 0, timedOut: true, output: 'commands', count: 1 },
  { name: 'missing text', status: 0, timedOut: false, output: '', count: 1 },
  ...MISSING_MARKERS.map((marker) => ({
    name: marker,
    status: 0,
    timedOut: false,
    output: `commands ${marker}`,
    count: 1,
  })),
  {
    name: 'package ENOENT',
    status: 0,
    timedOut: false,
    output: 'commands ENOENT /prefix/file',
    count: 1,
  },
  {
    name: 'unrelated ENOENT',
    status: 0,
    timedOut: false,
    output: 'commands ENOENT /other/file',
    count: 0,
  },
])
  test(
    [
      'given command output',
      `when judging ${row.name}`,
      'it should identify failures with command context',
    ].join(', '),
    () => {
      // given
      // when
      const faults = invocationFaults(invocation, row, '/prefix')
      // then
      expect(faults).toHaveLength(row.count)
      expect(faults.every((fault) => fault.startsWith('crust help:'))).toBe(
        true,
      )
    },
  )
for (const row of [
  {
    name: 'rendered',
    runVisible: true,
    responses: [{ url: '/', resourceType: 'document', status: 200 }],
    pageErrors: [],
    count: 0,
  },
  {
    name: 'no run',
    runVisible: false,
    responses: [],
    pageErrors: [],
    count: 1,
  },
  ...['script', 'stylesheet', 'image'].map((resourceType) => ({
    name: resourceType,
    runVisible: true,
    responses: [
      {
        url: '/asset',
        resourceType,
        status: resourceType === 'stylesheet' ? 500 : 404,
      },
    ],
    pageErrors: [],
    count: resourceType === 'image' ? 0 : 1,
  })),
  {
    name: 'page error',
    runVisible: true,
    responses: [],
    pageErrors: ['failed'],
    count: 1,
  },
])
  test(
    [
      'given a browser observation',
      `when judging ${row.name}`,
      'it should require rendered runs and successful application assets',
    ].join(', '),
    () => {
      // given
      // when
      const faults = pageFaults(row)
      // then
      expect(faults).toHaveLength(row.count)
    },
  )
for (const row of [
  { command: 'node /prefix/a.js', count: 0 },
  { command: '/x/bin/node /prefix/a.js', count: 0 },
  { command: 'bun /prefix/a.js', count: 1 },
  { command: 'npm install', count: 1 },
  { command: 'node /other/a.js', count: 1 },
  { command: 'node /prefix-evil/a.js', count: 1 },
])
  test(
    [
      'given an observer process tree',
      `when judging ${row.command}`,
      'it should allow only package-owned Node descendants',
    ].join(', '),
    () => {
      // given
      const rows = [
        { pid: 1, ppid: 0, command: 'node /prefix/cli.js' },
        { pid: 2, ppid: 1, command: row.command },
        { pid: 3, ppid: 4, command: 'bun unrelated' },
        { pid: 4, ppid: 3, command: 'cycle' },
      ]
      // when
      const faults = processFaults({ root: 1, prefix: '/prefix', rows })
      // then
      expect(faults).toHaveLength(row.count)
    },
  )
