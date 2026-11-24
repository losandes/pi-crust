import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_THEMES, machineThemes } from './themes'

for (const [name, document, expected, problem] of [
  ['no file', undefined, 5, false],
  ['no themes', 'poll_ms = 500', 5, false],
  [
    'custom stylesheet',
    '[themes.solarized]\nlabel = "Solarized"\nstylesheet = "themes/theme.css"',
    6,
    false,
  ],
  [
    'fallback label',
    '[themes.solarized]\nlabel = ""\nstylesheet = "themes/theme.css"',
    6,
    false,
  ],
  [
    'built-in override',
    '[themes.dark]\nlabel = "Different"\nstylesheet = "themes/theme.css"',
    5,
    true,
  ],
  [
    'missing stylesheet',
    '[themes.missing]\nstylesheet = "missing.css"',
    5,
    true,
  ],
  ['missing reference', '[themes.missing]\nlabel = "Missing"', 5, true],
  [
    'escaping stylesheet',
    '[themes.escape]\nstylesheet = "../outside.css"',
    5,
    true,
  ],
  ['directory stylesheet', '[themes.folder]\nstylesheet = "themes"', 5, true],
  ['malformed TOML', '[broken', 5, true],
  ['malformed entries', 'themes = 5', 5, false],
] as const) {
  test(
    [
      `given machine themes with ${name}`,
      'when loaded',
      'it should preserve all built-ins and report only unusable additions',
    ].join(', '),
    () => {
      // given
      const root = mkdtempSync(join(tmpdir(), 'crust-machine-themes-'))
      mkdirSync(join(root, 'themes'))
      writeFileSync(join(root, 'themes/theme.css'), '/* custom palette */')
      if (document !== undefined)
        writeFileSync(join(root, 'crust.config.toml'), document)
      try {
        // when
        const result = machineThemes({ CRUST_MACHINE_CONFIG: root })
        // then
        expect(result.themes.length).toBe(expected)
        expect(result.themes.slice(0, 5)).toEqual([...BUILTIN_THEMES])
        expect(BUILTIN_THEMES.map((theme) => theme.name)).toEqual([
          'auto',
          'light',
          'dark',
          'dracula',
          'high-contrast',
        ])
        expect(result.problem !== '').toBe(problem)
        expect(Object.keys(result).toSorted()).toEqual(['problem', 'themes'])
        if (expected === 6)
          expect(result.themes[5]?.css).toBe('/* custom palette */')
        // A reload reads edits rather than a cached snapshot.
        writeFileSync(join(root, 'crust.config.toml'), '')
        expect(machineThemes({ CRUST_MACHINE_CONFIG: root }).themes).toEqual(
          BUILTIN_THEMES,
        )
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
}
