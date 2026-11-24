import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKIP_INTEGRATION } from '../testing/integration'

for (const mode of [
  'record',
  'override',
  'missing',
  'stale local',
  'absent local',
] as const) {
  test.skipIf(SKIP_INTEGRATION || !Bun.which('just'))(
    [
      `given machine package discovery with ${mode}`,
      'when crust.just is evaluated',
      'it should use only CRUST_HOME or the machine record',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-home-lookup-'))
      const home = join(root, 'user')
      mkdirSync(join(home, '.pi-crust'), { recursive: true })
      mkdirSync(join(root, '.pi-crust/data'), { recursive: true })
      if (mode !== 'missing')
        writeFileSync(
          join(home, '.pi-crust/pi-crust-home'),
          '/machine/package\n',
        )
      if (mode !== 'absent local')
        writeFileSync(
          join(root, '.pi-crust/data/pi-crust-home'),
          '/stale/local/package\n',
        )
      const { CRUST_HOME: _override, ...baseEnv } = process.env
      try {
        // when
        const actual = spawnSync(
          'just',
          [
            '--working-directory',
            root,
            '--justfile',
            join(import.meta.dir, 'crust.just'),
            '--evaluate',
            'crust',
          ],
          {
            cwd: root,
            env: {
              ...baseEnv,
              HOME: home,
              ...(mode === 'override'
                ? { CRUST_HOME: '/override/package' }
                : {}),
            },
            encoding: 'utf8',
          },
        )
        // then
        expect(actual.status).toBe(mode === 'missing' ? 2 : 0)
        if (mode === 'missing') {
          expect(actual.stderr).toContain('CRUST_HOME')
          expect(actual.stderr).toContain('.pi-crust/pi-crust-home')
          expect(actual.stderr).toContain('scripts/install.ts')
        } else
          expect(actual.stdout.trim()).toBe(
            mode === 'override'
              ? '/override/package/runtime'
              : '/machine/package/runtime',
          )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}

test.skipIf(SKIP_INTEGRATION || !Bun.which('just'))(
  [
    'given an upgraded repository and a linked worktree without a stamp',
    'when the real root recipe runs in both trees',
    'it should locate the same package through only the scratch machine record',
  ].join(', '),
  () => {
    // given
    const scratch = mkdtempSync(join(tmpdir(), 'crust-linked-machine-'))
    const primary = join(scratch, 'primary')
    const linked = join(scratch, 'linked')
    const home = join(scratch, 'user')
    mkdirSync(primary)
    const { CRUST_HOME: _override, ...baseEnv } = process.env
    const env = { ...baseEnv, HOME: home }
    const packageRoot = join(import.meta.dir, '../..')
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: primary, env })
      expect(result.status).toBe(0)
    }
    try {
      // when
      expect(
        spawnSync(
          'bun',
          [join(packageRoot, 'scripts/install.ts'), '--refresh'],
          { cwd: primary, env },
        ).status,
      ).toBe(0)
      git('init', '-q', '-b', 'main')
      git('add', 'justfile')
      git(
        '-c',
        'user.name=tester',
        '-c',
        'user.email=tester@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'fixture',
      )
      git('worktree', 'add', '-qb', 'linked', linked)
      // then
      for (const cwd of [primary, linked]) {
        const result = spawnSync('just', ['crust', 'default'], {
          cwd,
          env,
          encoding: 'utf8',
        })
        if (result.status !== 0)
          throw new Error(
            `just exited ${result.status}: ${result.stderr} ${result.stdout}`,
          )
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('Available recipes:')
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
  20_000,
)
