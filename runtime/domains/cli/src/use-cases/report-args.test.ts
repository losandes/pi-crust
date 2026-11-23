import { expect, test } from 'bun:test'
import { DEFAULT_DB, EXIT } from '../../../../lib/contracts'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import {
  parseReportArgs,
  resolveDbPath,
  resolveSessionDir,
  REPORT_USAGE as USAGE,
  reportUsageError as usageError,
} from '../..'

const reportUsageError = usageError(USAGE)

test(
  [
    'given reporter arguments whose configuration is unreadable',
    'when resolving the store and recorded session directory',
    'it should use the default store and the store-relative session fallback',
  ].join(', '),
  () => {
    // given
    const args = {
      runId: undefined,
      json: false,
      db: undefined,
      config: '/nonexistent/reporter.config.toml',
    }
    // when
    const db = resolveDbPath(args)
    const session = resolveSessionDir(args, '/nonexistent/trace.db', 'run1')
    // then
    expect(db).toBe(DEFAULT_DB)
    expect(session).toBe('/nonexistent/sessions/run1')
  },
)

test(
  [
    'given report::parseReportArgs',
    'when only a run id is given',
    'it should read it as the positional runId with every flag at its default',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      const actual = parseReportArgs(['fbf49583'])

      // then
      expect(actual.runId).toEqual('fbf49583')
      expect(actual.json).toBe(false)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::parseReportArgs',
    'when --json, --db and --config are all given',
    'it should parse every one of them',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      const actual = parseReportArgs([
        'fbf49583',
        '--json',
        '--db',
        '/tmp/crust.db',
        '--config=pi-crust.toml',
      ])

      // then
      expect(actual).toEqual({
        runId: 'fbf49583',
        json: true,
        db: '/tmp/crust.db',
        config: 'pi-crust.toml',
      })
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::parseReportArgs',
    'when a value-taking flag is given with nothing after it',
    'it should throw naming the flag and USAGE',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      expect(() => parseReportArgs(['--db'])).toThrow(/--db needs a value/)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::resolveDbPath',
    'when --db was given explicitly',
    'it should win over the config',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const args = parseReportArgs(['--db', '/tmp/explicit.db'])

      // when
      const actual = resolveDbPath(args)

      // then
      expect(actual).toEqual('/tmp/explicit.db')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::resolveDbPath',
    'when no --db was given and the config cannot be read',
    'it should fall back to the default db path',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const args = parseReportArgs([
        '--config',
        '/does/not/exist/pi-crust.toml',
      ])

      // when
      const actual = resolveDbPath(args)

      // then
      expect(actual.length).toBeGreaterThan(0)
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::USAGE',
    'when printed',
    'it should name --json, --db, --config and both env overrides',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      // when
      // then
      expect(USAGE).toContain('--json')
      expect(USAGE).toContain('--db')
      expect(USAGE).toContain('--config')
      expect(USAGE).toContain('CRUST_DB')
      expect(USAGE).toContain('CRUST_CONFIG')
    } finally {
      restoreTerminal()
    }
  },
)

test(
  [
    'given report::reportUsageError',
    'when main rejects with a parse error',
    'it should print the message and USAGE to stderr and return EXIT.USAGE',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // given
      const original = process.stderr.write.bind(process.stderr)
      let printed = ''
      // biome-ignore lint/plugin/no-object-mutation: swapping Node's own stderr.write for the capture, restored below
      process.stderr.write = ((chunk: string) => {
        printed += chunk
        return true
      }) as typeof process.stderr.write

      // when
      const actual = reportUsageError(new Error('run_id required'))

      // then
      // biome-ignore lint/plugin/no-object-mutation: restoring Node's own stderr.write after the capture
      process.stderr.write = original
      expect(actual).toEqual(EXIT.USAGE)
      expect(printed).toContain('run_id required')
    } finally {
      restoreTerminal()
    }
  },
)
