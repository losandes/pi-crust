import { afterAll, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeParseSettlement } from '../../../../../lib/typedefs/src/settlement'
import { isStepDocument, lockArtifacts, unlockArtifacts } from './artifact-lock'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'crust-lock-'))

/** Whether a write actually lands, which is the only thing a lock promises. */
const tryWrite = (path: string): string => {
  const settled = safeParseSettlement(() => writeFileSync(path, 'clobbered'))
  return settled.status === 'ok'
    ? 'written'
    : ((settled.error as NodeJS.ErrnoException).code ?? 'refused')
}

test(
  [
    'given data/artifact-lock::lockArtifacts',
    'when a later activity tries to overwrite a finished document',
    'it should be refused, and the original survive',
  ].join(', '),
  () => {
    // given — every agent is granted the whole session directory, so nothing
    // else stops this, and the directory being gitignored means git cannot
    // put it back afterwards
    const dir = scratch()
    writeFileSync(join(dir, 'design.md'), 'the approved design')

    // when
    lockArtifacts(dir, ['design.md'])
    const outcome = tryWrite(join(dir, 'design.md'))

    // then
    expect(outcome).toEqual('EACCES')
    expect(readFileSync(join(dir, 'design.md'), 'utf8')).toEqual(
      'the approved design',
    )
  },
)

test(
  [
    'given data/artifact-lock::unlockArtifacts',
    'when the activity that wrote a document runs again',
    'it should be able to replace its own output',
  ].join(', '),
  () => {
    // given — a retry, or a rejection sending the activity back, legitimately
    // produces a new design. That is the one overwrite that must be allowed.
    const dir = scratch()
    writeFileSync(join(dir, 'design.md'), 'first attempt')
    lockArtifacts(dir, ['design.md'])

    // when
    unlockArtifacts(dir, ['design.md'])
    const outcome = tryWrite(join(dir, 'design.md'))

    // then
    expect(outcome).toEqual('written')
  },
)

test(
  [
    'given data/artifact-lock::lockArtifacts',
    "when the file is the run's own machinery rather than a activity's output",
    'it should be left writable',
  ].join(', '),
  () => {
    // given — the gate rewrites its question every time a run stops, and the
    // answer arrives from a person. Locking either would not protect a
    // activity's work; it would break what was about to write them again.
    const dir = scratch()
    for (const name of [
      'decision-request.md',
      'decision-answer.md',
      'answers-identify.md',
      'disputes.json',
      'changes.diff',
    ]) {
      writeFileSync(join(dir, name), 'machinery')
    }

    // when
    const locked = lockArtifacts(dir, [
      'decision-request.md',
      'decision-answer.md',
      'answers-identify.md',
      'disputes.json',
      'changes.diff',
    ])

    // then
    expect(locked).toEqual([])
    expect(tryWrite(join(dir, 'decision-request.md'))).toEqual('written')
  },
)

test(
  [
    'given data/artifact-lock::lockArtifacts',
    'when a named document is not there',
    'it should report what it locked rather than fail',
  ].join(', '),
  () => {
    // given — `created` comes from an observation that may race a activity
    // cleaning up after itself, and locking must never be what fails a run
    const dir = scratch()
    writeFileSync(join(dir, 'real.md'), 'here')

    // when
    const locked = lockArtifacts(dir, ['real.md', 'vanished.md'])

    // then
    expect(locked).toEqual(['real.md'])
  },
)

test(
  [
    'given data/artifact-lock::isStepDocument',
    'when asked which files belong to a activity',
    'it should separate a activity\u2019s output from the run\u2019s plumbing',
  ].join(', '),
  () => {
    // given — the same distinction the UI draws, kept here because this side
    // decides what may be locked and the two must not disagree
    const paths = [
      'design.md',
      'research/sources.md',
      'decision-request.md',
      'answers-conceptualize.md',
    ]

    // when
    const actual = paths.filter(isStepDocument)

    // then
    expect(actual).toEqual(['design.md', 'research/sources.md'])
  },
)

afterAll(() => {
  // mock.module() leaks across files in bun's shared module registry
  // (https://bun.sh/docs/test/parallel); restore the real module explicitly
  // rather than rely on mock.restore(), which does not undo it.
  mock.module('node:fs', () => require('node:fs'))
})

test(
  [
    'given data/artifact-lock::lockArtifacts',
    'when the mode cannot actually be set on a document',
    'it should drop it from the result rather than fail the run',
  ].join(', '),
  () => {
    // given — mocked, because provoking a real chmod failure needs root or a
    // filesystem that refuses it, neither of which this test can assume
    const dir = scratch()
    writeFileSync(join(dir, 'design.md'), 'the approved design')
    mock.module('node:fs', () => ({
      ...require('node:fs'),
      chmodSync: () => {
        throw new Error('EPERM: operation not permitted')
      },
    }))

    // when
    const locked = lockArtifacts(dir, ['design.md'])

    // then
    expect(locked).toEqual([])
    mock.module('node:fs', () => require('node:fs'))
  },
)
