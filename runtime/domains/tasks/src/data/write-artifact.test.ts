import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { liveTaskPorts } from '../../index'
import { temporaryArtifactName, writeArtifact } from './write-artifact'

test(
  [
    'given a previously written task log',
    'when staging the replacement fails',
    'it should preserve the original log bytes',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-task-log-'))
    const artifact = join(dir, '01_task.log')
    try {
      liveTaskPorts.writeArtifact(artifact, 'previous\n')
      // when
      const replace = () => writeArtifact(() => dir)(artifact, 'replacement\n')
      // then
      expect(replace).toThrow()
      expect(readFileSync(artifact, 'utf8')).toBe('previous\n')
      expect(readdirSync(dir)).toEqual(['01_task.log'])
      expect(temporaryArtifactName(artifact)).not.toBe(
        temporaryArtifactName(artifact),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  [
    'given an artifact path occupied by a directory',
    'when the rename fails',
    'it should remove the temporary file',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-task-rename-'))
    const temporary = `${dir}.tmp`
    try {
      // when
      const replace = () => writeArtifact(() => temporary)(dir, 'new')
      // then
      expect(replace).toThrow()
      expect(() => readFileSync(temporary)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(temporary, { force: true })
    }
  },
)
