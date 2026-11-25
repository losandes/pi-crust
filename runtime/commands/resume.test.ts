import { expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../testing/integration'
import {
  restoreTerminal,
  silenceTerminal,
  terminalOutput,
} from '../testing/terminal-capture'
import { tokenRepo } from '../testing/token-repo'
import { main } from './resume'

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

for (const argv of [[], ['--unknown'], ['run', '--note']]) {
  test(
    [
      'given invalid resume arguments',
      `when main receives ${JSON.stringify(argv)}`,
      'it should refuse with usage before reading configuration',
    ].join(', '),
    async () => {
      // given
      silenceTerminal()
      try {
        // when
        const actual = await main(argv)
        // then
        expect(actual).toBe(2)
        expect(terminalOutput()).toContain('usage: crust resume')
      } finally {
        restoreTerminal()
      }
    },
  )
}

for (const mode of ['attached', 'detached', 'missing', 'unrecorded'] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      'given an isolated recorded run',
      `when main resumes ${mode}`,
      'it should preserve its invocation or report the missing prerequisite',
    ].join(', '),
    async () => {
      // given
      using fixture = tokenRepo()
      const patch = {
        CRUST_CONFIG: fixture.configPath,
        CRUST_DB: fixture.dbPath,
        CRUST_DATA_DIR: fixture.dataDir,
        CRUST_MACHINE_CONFIG: join(fixture.root, 'machine'),
      }
      const previous = Object.fromEntries(
        Object.keys(patch).map((key) => [key, process.env[key]]),
      )
      const cwd = process.cwd()
      // biome-ignore lint/plugin/no-object-mutation: the test owns these environment inputs until finally restores them
      Object.assign(process.env, patch)
      process.chdir(fixture.root)
      silenceTerminal()
      try {
        if (mode === 'unrecorded')
          rmSync(join(fixture.sessionDir, 'invocation.json'))
        // when
        const actual = await main([
          mode === 'missing' ? 'missing' : fixture.runId,
          ...(mode === 'attached' ? ['--note', 'Proceed.'] : []),
          ...(mode === 'detached' ? ['--detach'] : []),
        ])
        // then
        expect(actual).toBe(mode === 'missing' || mode === 'unrecorded' ? 1 : 0)
        expect(terminalOutput()).toContain(
          mode === 'missing'
            ? 'no run missing'
            : mode === 'unrecorded'
              ? 'no invocation.json'
              : 'resumed:',
        )
        if (mode === 'attached')
          expect(
            readFileSync(
              join(fixture.sessionDir, 'context_handoff/steering.md'),
              'utf8',
            ),
          ).toContain('Proceed.')
        if (mode === 'detached') {
          for (
            let retry = 0;
            retry < 100 && !existsSync(join(fixture.root, 'resumed.json'));
            retry += 1
          )
            await Bun.sleep(10)
          expect(existsSync(join(fixture.root, 'resumed.json'))).toBe(true)
        }
      } finally {
        restoreTerminal()
        process.chdir(cwd)
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else {
            // biome-ignore lint/plugin: restore the external environment owned by this fixture
            process.env[key] = value
          }
        }
      }
    },
  )
}
