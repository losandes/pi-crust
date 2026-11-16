import { expect, test } from 'bun:test'
import type { TRun, TTracer } from '../../../../lib/contracts'
import type { TRunChangePorts } from './run-change'
import {
  RUN_START,
  recordRunStart,
  runChange,
  runChangeBase,
  runStartIn,
} from './run-change'

type TEvent = Parameters<TTracer['event']>[0]
const fixture = (
  payloads: readonly Readonly<Record<string, unknown>>[] = [],
) => {
  let events: readonly TEvent[] = []
  const tracer: Pick<TTracer, 'event' | 'eventsNamed'> = {
    event: (event) => {
      events = [...events, event]
      return 'event'
    },
    eventsNamed: (_runId, name) =>
      name === RUN_START
        ? [...payloads, ...events.map((event) => event.payload ?? {})]
        : [],
  }
  const run = {
    runId: 'run',
    repoRoot: '/repo',
    vcsRoot: '/repo',
    sessionDir: '/repo/session',
    contextHandoffDir: '/handoff',
    tracer,
  }
  return { run, events: () => events }
}
const ports: TRunChangePorts = {
  rev: () => 'start',
  content: () => ({ status: 'ok', data: {} }),
}

test(
  [
    'given a run with no recorded start',
    'when recording its start',
    'it should file the revision and content under the request Activity Run',
  ].join(', '),
  () => {
    // given
    const { run, events } = fixture()
    let seen: readonly unknown[] = []
    const adapters: TRunChangePorts = {
      rev: (ref) => {
        seen = [...seen, ref]
        return 'sha'
      },
      content: (roots, head) => {
        seen = [...seen, roots, head]
        return { status: 'ok', data: { dirty: 'hash' } }
      },
    }
    // when
    recordRunStart(adapters)(run as TRun, 'request-id')
    // then
    expect(seen).toEqual([
      'HEAD',
      { workspaceRoot: '/repo', vcsRoot: '/repo' },
      'sha',
    ])
    expect(events()).toEqual([
      {
        run_id: 'run',
        activity_run_id: 'request-id',
        type: 'log',
        name: RUN_START,
        payload: { head: 'sha', tree: { dirty: 'hash' } },
      },
    ])
  },
)

test(
  [
    'given a recorded start',
    'when another request joins the run',
    'it should retain only the original start without reading ports',
  ].join(', '),
  () => {
    // given
    const { run, events } = fixture([{ head: 'first', tree: {} }])
    // when
    recordRunStart({
      rev: () => {
        throw new Error('must not read')
      },
      content: ports.content,
    })(run as TRun, 'later')
    // then
    expect(events()).toEqual([])
    expect(runStartIn(run as TRun)?.head).toBe('first')
  },
)

for (const entry of [
  { name: 'an empty revision', adapters: { ...ports, rev: () => '' } },
  {
    name: 'a revision read that throws',
    adapters: {
      ...ports,
      rev: () => {
        throw new Error('missing')
      },
    },
  },
  {
    name: 'a content error settlement',
    adapters: {
      ...ports,
      content: (): ReturnType<TRunChangePorts['content']> => ({
        status: 'error',
        error: new Error('missing'),
      }),
    },
  },
]) {
  test(
    [
      `given ${entry.name}`,
      'when recording the start',
      'it should file nothing and not throw',
    ].join(', '),
    () => {
      // given
      const { run, events } = fixture()
      // when
      recordRunStart(entry.adapters)(run as TRun, 'request')
      // then
      expect(events()).toEqual([])
    },
  )
}

for (const entry of [
  {
    name: 'invalid events followed by valid events',
    payloads: [
      { head: '', tree: {} },
      { head: 'bad', tree: { path: 1 } },
      { head: 'first', tree: {} },
      { head: 'later', tree: {} },
    ],
    expected: { head: 'first', tree: {} },
  },
  {
    name: 'only invalid events',
    payloads: [{ head: '', tree: {} }, { tree: {} }],
    expected: undefined,
  },
]) {
  test(
    [
      `given ${entry.name}`,
      'when reading the start state',
      'it should return the first payload that parses or undefined',
    ].join(', '),
    () => {
      // given
      const { run } = fixture(entry.payloads)
      // when
      const actual = runStartIn(run as TRun)
      // then
      expect(actual).toEqual(entry.expected)
    },
  )
}

test(
  [
    'given no run start',
    'when selecting the run change',
    'it should return undefined without reading content',
  ].join(', '),
  () => {
    // given
    const { run } = fixture()
    // when
    const actual = runChange({
      content: () => {
        throw new Error('must not read')
      },
    })(run as TRun)
    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given changed, removed, added and unchanged paths',
    'when selecting the run change',
    'it should compare content against the original head and sort the net difference',
  ].join(', '),
  () => {
    // given
    const { run } = fixture([
      { head: 'original', tree: { same: 'a', edited: 'old', removed: 'gone' } },
    ])
    let seen: readonly unknown[] = []
    // when
    const actual = runChange({
      content: (roots, head) => {
        seen = [...seen, roots, head]
        return {
          status: 'ok',
          data: { same: 'a', edited: 'new', added: 'new' },
        }
      },
    })(run as TRun)
    // then
    expect(seen).toEqual([
      { workspaceRoot: '/repo', vcsRoot: '/repo' },
      'original',
    ])
    expect(actual).toEqual({
      head: 'original',
      paths: ['added', 'edited', 'removed'],
    })
  },
)

test(
  [
    'given records in session and external handoff directories and similarly named siblings',
    'when selecting the run change',
    'it should exclude only whole directory segments including the directories themselves',
  ].join(', '),
  () => {
    // given
    const { run } = fixture([{ head: 'sha', tree: {} }])
    const data = Object.fromEntries(
      [
        'session',
        'session/record',
        '/handoff',
        '/handoff/plan',
        'session-other/file',
        '/handoff-other/file',
        'source',
      ].map((path) => [path, 'hash']),
    )
    // when
    const actual = runChange({ content: () => ({ status: 'ok', data }) })(
      run as TRun,
    )
    // then
    expect(actual?.paths).toEqual([
      '/handoff-other/file',
      'session-other/file',
      'source',
    ])
  },
)

for (const data of [
  { same: 'hash' },
  { same: 'hash', 'session/record': 'hash' },
]) {
  test(
    [
      `given no remaining product difference with ${Object.keys(data).length} snapshot entries`,
      'when selecting the run change',
      'it should return undefined',
    ].join(', '),
    () => {
      // given
      const { run } = fixture([{ head: 'sha', tree: { same: 'hash' } }])
      // when
      const actual = runChange({ content: () => ({ status: 'ok', data }) })(
        run as TRun,
      )
      // then
      expect(actual).toBeUndefined()
    },
  )
}

test(
  [
    'given a start commit that cannot be read',
    'when selecting the run change',
    'it should stop with the original head and scope escape hatch',
  ].join(', '),
  () => {
    // given
    const { run } = fixture([{ head: 'original-sha', tree: {} }])
    // when
    const act = () =>
      runChange({
        content: () => ({ status: 'error', error: new Error('lost') }),
      })(run as TRun)
    // then
    expect(act).toThrow(/original-sha.*--scope/)
  },
)

test(
  [
    'given a start head',
    'when describing the change base',
    'it should give the exact command and explanation',
  ].join(', '),
  () => {
    // given
    const head = 'abc'
    // when
    const actual = runChangeBase(head)
    // then
    expect(actual).toBe(
      'abc (HEAD when this run started). `changed_files` lists every file this run has changed since then, committed or not. Read each one with `git diff abc -- <path>`. A path that prints no diff is not tracked by git yet, or no longer exists: read the file itself.',
    )
  },
)
