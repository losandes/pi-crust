import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTracer } from './trace-db'
import { runHasLiveProcess } from './trace-reader'

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
