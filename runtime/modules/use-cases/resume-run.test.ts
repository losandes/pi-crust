import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  INVOCATION_FILENAME,
  recordedInvocation,
  resumeArgv,
  resumeRecordedRun,
} from './resume-run'

const sessionWith = (record: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))
  writeFileSync(join(dir, INVOCATION_FILENAME), JSON.stringify(record))
  return dir
}

test(
  [
    'given use-cases/resume-run::resumeArgv',
    'when the run was launched with flags',
    'it should carry every one of them into the resumed command',
  ].join(', '),
  () => {
    // given — `--approve-after` exists only in argv, so a resumer that drops
    // it silently removes the gate the developer asked for
    const argv = [
      'bun',
      '/pkg/runtime/lifecycles/compose.ts',
      'specs/stats.md',
      '--approve-after',
      'plan',
    ]

    // when
    const actual = resumeArgv(argv, '9afffac5')

    // then
    expect(actual).toEqual([
      '/pkg/runtime/lifecycles/compose.ts',
      'specs/stats.md',
      '--approve-after',
      'plan',
      '--run-id',
      '9afffac5',
      '--resume',
    ])
  },
)

test(
  [
    'given use-cases/resume-run::resumeArgv',
    'when the run being resumed was itself a resumed run',
    'it should not stack a second --run-id or --resume',
  ].join(', '),
  () => {
    // given — the second gate of a chain picked up once already
    const argv = [
      'bun',
      '/pkg/runtime/lifecycles/compose.ts',
      'spec.md',
      '--run-id',
      '9afffac5',
      '--resume',
    ]

    // when
    const actual = resumeArgv(argv, '9afffac5')

    // then — two commands that do the same thing should look the same
    expect(actual).toEqual([
      '/pkg/runtime/lifecycles/compose.ts',
      'spec.md',
      '--run-id',
      '9afffac5',
      '--resume',
    ])
  },
)

test(
  [
    'given use-cases/resume-run::recordedInvocation',
    'when a prompt was given inline and contains spaces',
    'it should survive as ONE argument',
  ].join(', '),
  () => {
    // given — this is why argv is recorded as a list rather than reconstructed
    // from the space-joined command in the processes table
    const dir = sessionWith({
      argv: ['bun', '/pkg/runtime/stages/triage.ts', 'name the directories. change nothing.'],
      cwd: '/app',
    })

    // when
    const actual = recordedInvocation(dir)

    // then
    expect(actual?.argv[2]).toBe('name the directories. change nothing.')
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::recordedInvocation',
    'when the run never recorded one',
    'it should say so rather than guessing a command',
  ].join(', '),
  () => {
    // given — a session from before this existed
    const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))

    // when
    const actual = recordedInvocation(dir)

    // then — a guessed command drops flags, and a wrong resume costs money
    expect(actual).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::resumeRecordedRun',
    'when it attaches',
    'it hands back the exit code of the run it resumed',
  ].join(' '),
  async () => {
    // given
    const dir = sessionWith({
      argv: ['bun', '-e', 'process.exit(7)'],
      cwd: process.cwd(),
    })

    // when
    const resumed = resumeRecordedRun(dir, 'attached')

    // then
    expect(resumed.started).toBe(true)
    expect(await resumed.finished).toBe(7)
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::resumeRecordedRun',
    'when it detaches',
    'it reports started with nothing to wait on, so a caller cannot block',
  ].join(' '),
  () => {
    // given
    const dir = sessionWith({
      argv: ['bun', '-e', ''],
      cwd: process.cwd(),
    })

    // when
    const resumed = resumeRecordedRun(dir, 'detached')

    // then
    expect(resumed.started).toBe(true)
    expect(resumed.finished).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given use-cases/resume-run::resumeRecordedRun',
    'when the session never recorded how it was invoked',
    'it refuses rather than guessing a command',
  ].join(' '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-resume-'))

    // when
    const resumed = resumeRecordedRun(dir)

    // then
    expect(resumed.started).toBe(false)
    expect(resumed.finished).toBeUndefined()
    expect(resumed.reason).toContain(INVOCATION_FILENAME)
    rmSync(dir, { recursive: true, force: true })
  },
)
