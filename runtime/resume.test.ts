import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from './testing/integration'
import { tokenRepo } from './testing/token-repo'

for (const one of [
  { name: 'token configuration', options: {}, note: false },
  { name: 'resume note', options: {}, note: true },
  { name: 'linked worktree', options: { linked: true }, note: false },
  {
    name: 'data directory override',
    options: { overrideData: true },
    note: true,
  },
  { name: 'store override', options: { overrideDb: true }, note: true },
  { name: 'relative configuration', options: { relative: true }, note: false },
]) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given resume with ${one.name}`,
      'when resuming a stopped run',
      'it should use the resolved store and the independent session directory',
    ].join(', '),
    () => {
      // given
      using fixture = tokenRepo(one.options)
      const note = 'continue with the corrected configuration'
      const args = [fixture.runId, ...(one.note ? ['--note', note] : [])]

      // when
      const child = fixture.invoke('resume.ts', args)
      const output = child.stdout.toString()

      // then
      expect(child.exitCode).toBe(0)
      expect(output).toContain('resumed:')
      expect(output).not.toContain('no run')
      expect(
        JSON.parse(readFileSync(join(fixture.root, 'resumed.json'), 'utf8')),
      ).toEqual(['--run-id', fixture.runId, '--resume'])
      expect(existsSync(join(fixture.root, '{primary_worktree}'))).toBe(false)
      if (one.note) {
        const steering = join(
          fixture.sessionDir,
          'context_handoff',
          'steering.md',
        )
        expect(output).toContain(`note recorded in ${steering}`)
        expect(readFileSync(steering, 'utf8')).toContain(note)
      }
    },
  )
}

test.skipIf(SKIP_INTEGRATION)(
  [
    'given resume with token configuration',
    'when the requested run is missing',
    'it should name the resolved absolute store and exit one',
  ].join(', '),
  () => {
    // given
    using fixture = tokenRepo()

    // when
    const child = fixture.invoke('resume.ts', ['bbbb2222'])
    const output = child.stdout.toString()

    // then
    expect(child.exitCode).toBe(1)
    expect(output).toContain(`no run bbbb2222 in ${fixture.dbPath}`)
    expect(output).not.toContain('{primary_worktree}')
  },
)
