import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SKIP_INTEGRATION } from '../runtime/testing/integration'

const PACKAGE = resolve(import.meta.dir, '..')
const LEGACY_CHAIN = [
  '    #!/usr/bin/env bash',
  '    set -euo pipefail',
  // A template literal with the dollar escaped, so what reaches the file is
  // the bash parameter expansion `${CRUST_HOME:-}` and nothing here reads as
  // a JavaScript placeholder written in the wrong quotes.
  `    home="\${CRUST_HOME:-}"`,
  '    if [[ -z "$home" && -f .pi-crust/data/pi-crust-home ]]; then',
  '      home="$(cat .pi-crust/data/pi-crust-home)"',
  '    fi',
  '    if [[ -z "$home" ]]; then',
  '      common="$(git rev-parse --git-common-dir 2>/dev/null || true)"',
  '      if [[ -n "$common" ]]; then',
  '        root="$(cd "$(dirname "$common")" && pwd)"',
  '        if [[ -f "$root/.pi-crust/data/pi-crust-home" ]]; then',
  '          home="$(cat "$root/.pi-crust/data/pi-crust-home")"',
  '        fi',
  '      fi',
  '    fi',
  '    if [[ -z "$home" ]]; then',
  '      echo "crust: cannot find the package home." >&2',
  '      echo "  checked CRUST_HOME, .pi-crust/data/pi-crust-home, and \\$(git rev-parse --git-common-dir)/../.pi-crust/data/pi-crust-home." >&2',
  '      echo "  set CRUST_HOME to repair it." >&2',
  '      exit 2',
  '    fi',
  '    exec bun "$home/runtime/cli.ts" "$@"',
].join('\n')
const SINGLE =
  '    @bun "$(cat .pi-crust/data/pi-crust-home)/runtime/cli.ts" "$@"'
const body = (recipe: string) =>
  `set positional-arguments\n\ncrust *ARGS:\n${recipe}\n`

for (const mode of [
  'fresh',
  'single absent',
  'single stale',
  'chain',
  'edited',
] as const) {
  test.skipIf(SKIP_INTEGRATION)(
    [
      `given the ${mode} recipe`,
      'when upgraded directly',
      'it should record the machine home, repair only legacy bodies and preserve all old data',
    ].join(', '),
    () => {
      // given
      const scratch = mkdtempSync(join(tmpdir(), 'crust-install-home-'))
      const root = join(scratch, 'repo')
      const home = join(scratch, 'user')
      mkdirSync(join(root, '.pi-crust/data/sessions/x'), { recursive: true })
      mkdirSync(join(home, '.pi-crust'), { recursive: true })
      writeFileSync(
        join(home, '.pi-crust/pi-crust-home'),
        '/previous/package\n',
      )
      const old =
        mode === 'chain'
          ? body(LEGACY_CHAIN)
          : mode.startsWith('single')
            ? body(SINGLE)
            : body('    @echo team-owned')
      if (mode !== 'fresh') writeFileSync(join(root, 'justfile'), old)
      writeFileSync(
        join(root, '.pi-crust/data/crust.db'),
        'valuable trace bytes',
      )
      writeFileSync(
        join(root, '.pi-crust/data/sessions/x/events.jsonl'),
        'valuable event bytes',
      )
      const pointer = join(root, '.pi-crust/data/pi-crust-home')
      if (mode !== 'single absent')
        writeFileSync(pointer, '/gone/stale/package\n')
      const before = readdirSync(join(root, '.pi-crust/data'), {
        recursive: true,
      })
        .map(String)
        .toSorted()
      const { CRUST_HOME: _override, ...baseEnv } = process.env
      const env = { ...baseEnv, HOME: home }
      try {
        if (mode.startsWith('single') && Bun.which('just')) {
          const refused = spawnSync('just', ['crust', 'update'], {
            cwd: root,
            env: { ...env, CRUST_HOME: PACKAGE },
          })
          expect(refused.status).not.toBe(0)
          expect(readFileSync(join(root, 'justfile'), 'utf8')).toBe(old)
        }
        // when
        const installed = spawnSync(
          'bun',
          [join(PACKAGE, 'scripts/install.ts'), '--refresh'],
          { cwd: root, env, encoding: 'utf8' },
        )
        // then
        expect(installed.status).toBe(0)
        expect(installed.stdout).toContain('was /previous/package')
        expect(
          readFileSync(join(home, '.pi-crust/pi-crust-home'), 'utf8'),
        ).toBe(`${PACKAGE}\n`)
        expect(
          readdirSync(join(root, '.pi-crust/data'), { recursive: true })
            .map(String)
            .toSorted(),
        ).toEqual(before)
        expect(
          readFileSync(join(root, '.pi-crust/data/crust.db'), 'utf8'),
        ).toBe('valuable trace bytes')
        expect(
          readFileSync(
            join(root, '.pi-crust/data/sessions/x/events.jsonl'),
            'utf8',
          ),
        ).toBe('valuable event bytes')
        if (existsSync(pointer)) {
          expect(readFileSync(pointer, 'utf8')).toBe('/gone/stale/package\n')
          expect(installed.stdout).toContain(
            `${pointer}: no longer read, left untouched.`,
          )
        }
        const rewritten = readFileSync(join(root, 'justfile'), 'utf8')
        if (mode === 'fresh')
          expect(rewritten).toBe(
            readFileSync(join(PACKAGE, 'justfile'), 'utf8'),
          )
        if (mode === 'edited') expect(rewritten).toBe(old)
        else {
          expect(rewritten).toContain(
            `pointer="\${HOME}/.pi-crust/pi-crust-home"`,
          )
          expect(rewritten).not.toContain('data/pi-crust-home')
          if (Bun.which('just')) {
            expect(
              spawnSync('just', ['crust', 'default'], { cwd: root, env })
                .status,
            ).toBe(0)
            rmSync(join(home, '.pi-crust/pi-crust-home'))
            const missing = spawnSync('just', ['crust', 'default'], {
              cwd: root,
              env,
              encoding: 'utf8',
            })
            expect(missing.status).toBe(2)
            expect(missing.stderr).toContain('scripts/install.ts')
            expect(
              spawnSync('just', ['crust', 'default'], {
                cwd: root,
                env: { ...env, CRUST_HOME: PACKAGE },
              }).status,
            ).toBe(0)
          }
        }
        // Reinstalling without --refresh is equally non-destructive.
        expect(
          spawnSync('bun', [join(PACKAGE, 'scripts/install.ts')], {
            cwd: root,
            env,
          }).status,
        ).toBe(0)
        expect(
          readdirSync(join(root, '.pi-crust/data'), { recursive: true })
            .map(String)
            .toSorted(),
        ).toEqual(before)
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    },
    20_000,
  )
}

test.skipIf(SKIP_INTEGRATION || !Bun.which('just'))(
  [
    'given a legacy chain with a stale pointer',
    'when updated with CRUST_HOME',
    'it should reach the installer and repair the recipe',
  ].join(', '),
  () => {
    // given
    const root = mkdtempSync(join(tmpdir(), 'crust-chain-update-'))
    expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0)
    writeFileSync(join(root, 'justfile'), body(LEGACY_CHAIN))
    mkdirSync(join(root, '.pi-crust/data'), { recursive: true })
    writeFileSync(join(root, '.pi-crust/data/pi-crust-home'), '/gone\n')
    try {
      // when
      const result = spawnSync('just', ['crust', 'update'], {
        cwd: root,
        env: { ...process.env, HOME: join(root, 'user'), CRUST_HOME: PACKAGE },
      })
      // then
      expect(result.status).toBe(0)
      expect(readFileSync(join(root, 'justfile'), 'utf8')).not.toContain(
        'git-common-dir',
      )
      expect(
        readFileSync(join(root, '.pi-crust/data/pi-crust-home'), 'utf8'),
      ).toBe('/gone\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)

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
    const packageRoot = PACKAGE
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
        expect(result.stdout).toContain('help')
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  },
  20_000,
)
