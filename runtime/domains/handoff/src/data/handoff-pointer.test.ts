import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultHandoffDir } from '../use-cases/handoff-location'
import {
  handoffDirFor,
  recordedHandoffDir,
  writeHandoffPointer,
} from './handoff-pointer'

const scratch = (): string =>
  mkdtempSync(join(tmpdir(), 'crust-handoff-pointer-'))

test(
  [
    'given data/handoff-pointer::writeHandoffPointer and recordedHandoffDir',
    'when a pointer was written',
    'it should read back exactly what was written',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const sessionDir = join(dataDir, 'sessions', 'a1b2c3d4')
    const relocated = join(dataDir, '..', 'specs', 'a1b2c3d4')

    // when
    writeHandoffPointer(sessionDir, relocated)

    // then
    expect(recordedHandoffDir(sessionDir)).toEqual(relocated)
  },
)

test(
  [
    'given data/handoff-pointer::recordedHandoffDir',
    'when no pointer was ever written',
    'it should say so rather than invent a path',
  ].join(', '),
  () => {
    const dataDir = scratch()
    const sessionDir = join(dataDir, 'sessions', 'never-started')

    expect(recordedHandoffDir(sessionDir)).toBeUndefined()
  },
)

test(
  [
    'given data/handoff-pointer::handoffDirFor',
    'when no pointer exists for the run',
    'it should fall back to the canonical default, the same path every reader used before this existed',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()

    // when
    const actual = handoffDirFor(dataDir, 'a1b2c3d4')

    // then
    expect(actual).toEqual(defaultHandoffDir(dataDir, 'a1b2c3d4'))
  },
)

test(
  [
    'given data/handoff-pointer::handoffDirFor',
    'when a pointer was recorded for the run',
    'it should resolve to the recorded directory instead of the default',
  ].join(', '),
  () => {
    // given
    const dataDir = scratch()
    const runId = 'a1b2c3d4'
    const relocated = join(dataDir, '..', 'specs', runId)
    writeHandoffPointer(join(dataDir, 'sessions', runId), relocated)

    // when
    const actual = handoffDirFor(dataDir, runId)

    // then
    expect(actual).toEqual(relocated)
  },
)
