import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from './trace-db'
import { readTrace, runHasLiveProcess } from './trace-reader'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-trace-reader-'))

test(
  [
    'given data/trace-reader::runHasLiveProcess',
    'when a process row is open and the pid is this test process\u2019s own',
    'it should answer true',
  ].join(', '),
  () => {
    // given
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('aaaa1111', 'tester', 'sdlc')
    tracer.processStart('aaaa1111', 'run', '', process.pid, 'crust run')
    tracer.close()

    // when
    const actual = runHasLiveProcess(dbPath, 'aaaa1111')

    // then
    expect(actual).toBe(true)
  },
)

test(
  [
    'given data/trace-reader::runHasLiveProcess',
    'when the only process row is already closed',
    'it should answer false',
  ].join(', '),
  () => {
    // given \u2014 the ordinary way a run ends: the process closes its own row
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('bbbb2222', 'tester', 'sdlc')
    tracer.processStart('bbbb2222', 'run', '', process.pid, 'crust run')
    tracer.processesEndAll('bbbb2222')
    tracer.close()

    // when
    const actual = runHasLiveProcess(dbPath, 'bbbb2222')

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given data/trace-reader::runHasLiveProcess',
    'when a process row is open but the pid no longer answers',
    'it should answer false \u2014 the SIGKILL case nothing closed on its way out',
  ].join(', '),
  () => {
    // given \u2014 a pid unlikely to be reused by anything else in the suite
    const dir = scratch()
    const dbPath = join(dir, 'crust.db')
    const tracer = createTracer(dbPath, join(dir, 'events.jsonl'))
    tracer.sessionStart('cccc3333', 'tester', 'sdlc')
    tracer.processStart('cccc3333', 'run', '', 999999, 'crust run')
    tracer.close()

    // when
    const actual = runHasLiveProcess(dbPath, 'cccc3333')

    // then
    expect(actual).toBe(false)
  },
)

test(
  [
    'given data/trace-reader::runHasLiveProcess',
    'when the database does not exist',
    'it should answer false rather than create one',
  ].join(', '),
  () => {
    // given
    const dbPath = join(scratch(), 'absent.db')

    // when
    const actual = runHasLiveProcess(dbPath, 'aaaa1111')

    // then
    expect(actual).toBe(false)
  },
)

for (const legacy of [false, true]) {
  test(
    [
      `given a ${legacy ? 'legacy' : 'current'} trace`,
      'when reading named, latest, missing and empty sessions',
      'it should return all related rows and tolerate a missing name column',
    ].join(', '),
    () => {
      // given
      const dir = scratch()
      const path = join(dir, 'crust.db')
      const tracer = createTracer(path, join(dir, 'events.jsonl'))
      tracer.sessionStart('run', 'engineer', 'run', 'label')
      tracer.event({ run_id: 'run', type: 'log', payload: { value: 1 } })
      tracer.close()
      const writer = new Database(path)
      try {
        if (legacy) writer.exec('ALTER TABLE sessions DROP COLUMN name')
        writer.run('INSERT INTO processes (run_id, pid) VALUES (?, ?)', [
          'run',
          null,
        ])
        // when
        const named = readTrace(path, 'run')
        const latest = readTrace(path)
        // then
        expect(named?.session.run_id).toBe('run')
        expect(named?.session.name).toBe(legacy ? null : 'label')
        expect(latest).toEqual(named)
        expect(named?.events[0]?.type).toBe('log')
        expect(named?.activityRuns).toEqual([])
        expect(named?.envelopes).toEqual([])
        expect(named?.gates).toEqual([])
        expect(readTrace(path, 'missing')).toBeUndefined()
        expect(readTrace(join(dir, 'missing.db'))).toBeUndefined()
        expect(runHasLiveProcess(path, 'run')).toBe(false)
        writer.exec('DELETE FROM sessions')
        expect(readTrace(path)).toBeUndefined()
      } finally {
        writer.close()
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}
