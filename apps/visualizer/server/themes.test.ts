import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_THEMES, workspaceThemes } from './themes.ts'

const workspace = (
  yaml?: string,
  stylesheets: Readonly<Record<string, string>> = {},
): string => {
  const root = mkdtempSync(join(tmpdir(), 'crust-themes-'))
  const config = join(root, '.pi-crust', 'config')
  mkdirSync(config, { recursive: true })
  if (yaml !== undefined) {
    writeFileSync(join(config, 'crust.observe.yaml'), yaml)
  }
  for (const [name, css] of Object.entries(stylesheets)) {
    writeFileSync(join(config, name), css)
  }
  return root
}

test(
  [
    'given server/themes::workspaceThemes',
    'when a repository registers only two of the shipped themes',
    'it should offer two, because registering is how a team removes one',
  ].join(', '),
  () => {
    // given
    const given = workspace(
      'themes:\n  - name: dark\n    builtin: true\n  - name: light\n    builtin: true\n',
    )

    // when
    const actual = workspaceThemes(given)

    // then
    expect(actual.themes.map((theme) => theme.name)).toEqual(['dark', 'light'])
  },
)

test(
  [
    'given server/themes::workspaceThemes',
    'when a repository defines its own theme',
    'it should return the stylesheet text, not the path',
  ].join(', '),
  () => {
    // given — the browser cannot read the observed repository's filesystem
    const given = workspace(
      'themes:\n  - name: midnight\n    stylesheet: config/midnight.css\n',
      { 'midnight.css': "[data-theme='midnight'] { --bg-rgb: 0 0 0; }" },
    )

    // when
    const actual = workspaceThemes(given)

    // then
    expect(actual.themes[0]?.css).toContain('--bg-rgb: 0 0 0')
  },
)

test(
  [
    'given server/themes::workspaceThemes',
    'when a stylesheet reference climbs out of the stamp',
    'it should be dropped rather than read',
  ].join(', '),
  () => {
    // given — the value comes from a file in the observed repository
    const given = workspace(
      'themes:\n  - name: escape\n    stylesheet: ../../../../etc/passwd\n',
    )

    // when
    const actual = workspaceThemes(given)

    // then
    expect(actual.themes[0]?.css).toBe('')
  },
)

test(
  [
    'given server/themes::workspaceThemes',
    'when a workspace has no themes file',
    'it should offer what shipped rather than an empty picker',
  ].join(', '),
  () => {
    // given — an older stamp, which is the normal case after an upgrade
    const given = workspace()

    // when
    const actual = workspaceThemes(given)

    // then
    expect(actual.themes).toEqual(BUILTIN_THEMES)
  },
)

test(
  [
    'given server/themes::workspaceThemes',
    'when the themes file cannot be parsed',
    'it should say why and still offer a usable picker',
  ].join(', '),
  () => {
    // given — a broken theme registration must not stop somebody reading a
    // trace
    const given = workspace('themes: [ this is not: valid: yaml\n')

    // when
    const actual = workspaceThemes(given)

    // then
    expect(actual.themes).toEqual(BUILTIN_THEMES)
    expect(actual.problem).not.toBe('')
  },
)

test(
  [
    'given server/themes::workspaceThemes',
    'when a registration omits its label',
    'it should show the name rather than an empty button',
  ].join(', '),
  () => {
    // given
    const given = workspace(
      'themes:\n  - name: midnight\n    stylesheet: config/midnight.css\n',
      { 'midnight.css': '' },
    )

    // when
    const actual = workspaceThemes(given)

    // then
    expect(actual.themes[0]?.label).toBe('midnight')
  },
)
