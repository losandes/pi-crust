import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HANDOFF_POINTER_FILENAME, handoffDirFor } from './handoff'

test(
  [
    'given server/handoff::handoffDirFor',
    'when no run has recorded a pointer file',
    'it should default to context_handoff under the run session directory',
  ].join(', '),
  () => {
    // given
    const sessionsDir = mkdtempSync(join(tmpdir(), 'crust-handoff-default-'))

    // when
    const actual = handoffDirFor(sessionsDir, 'aaaa1111')

    // then
    expect(actual).toEqual(join(sessionsDir, 'aaaa1111', 'context_handoff'))
  },
)

test(
  [
    'given server/handoff::handoffDirFor',
    "when --handoff relocated the run's documents and a pointer records it",
    'it should read the pointer rather than guess at the default',
  ].join(', '),
  () => {
    // given
    const sessionsDir = mkdtempSync(join(tmpdir(), 'crust-handoff-pointer-'))
    const runDir = join(sessionsDir, 'bbbb2222')
    mkdirSync(runDir, { recursive: true })
    const relocated = join(tmpdir(), 'crust-handoff-relocated')
    writeFileSync(join(runDir, HANDOFF_POINTER_FILENAME), `${relocated}\n`)

    // when
    const actual = handoffDirFor(sessionsDir, 'bbbb2222')

    // then
    expect(actual).toEqual(relocated)
  },
)

test(
  [
    'given server/handoff::handoffDirFor',
    'when the pointer file exists but is empty',
    'it should fall back to the default rather than hand back an empty path',
  ].join(', '),
  () => {
    // given
    const sessionsDir = mkdtempSync(join(tmpdir(), 'crust-handoff-empty-'))
    const runDir = join(sessionsDir, 'cccc3333')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, HANDOFF_POINTER_FILENAME), '   \n')

    // when
    const actual = handoffDirFor(sessionsDir, 'cccc3333')

    // then
    expect(actual).toEqual(join(sessionsDir, 'cccc3333', 'context_handoff'))
  },
)
