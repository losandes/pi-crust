import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { offerableThemes, themeFaults, themesFileSchema } from './theme'

const shipped = () =>
  themesFileSchema.parse(
    Bun.YAML.parse(
      readFileSync(
        join(
          import.meta.dir,
          '..',
          '..',
          '..',
          'templates',
          'stamp',
          'config',
          'crust.observe.yaml',
        ),
        'utf8',
      ),
    ),
  )

test(
  [
    'given typedefs/theme::themeFaults',
    'when the shipped registrations are read',
    'it should find nothing wrong with them',
  ].join(', '),
  () => {
    // given
    const given = shipped()

    // when
    const actual = themeFaults(given)

    // then
    expect(actual).toEqual([])
  },
)

test(
  [
    'given typedefs/theme::offerableThemes',
    'when a team removes a default',
    'it should leave the picker, because the defaults are registrations',
  ].join(', '),
  () => {
    // given
    const given = themesFileSchema.parse(
      Bun.YAML.parse(`
default_theme: auto
themes:
  - name: auto
    builtin: true
  - name: dark
    builtin: true
`),
    )

    // when
    const actual = offerableThemes(given).map((one) => one.name)

    // then
    expect(actual).toEqual(['auto', 'dark'])
  },
)

test(
  [
    'given typedefs/theme::themeSchema',
    'when a theme has no label',
    'it should show its name rather than an empty row in the picker',
  ].join(', '),
  () => {
    // given
    const given = themesFileSchema.parse(
      Bun.YAML.parse('themes:\n  - name: midnight\n    stylesheet: x.css\n'),
    )

    // when
    const actual = given.themes[0]?.label

    // then
    expect(actual).toBe('midnight')
  },
)

test(
  [
    'given typedefs/theme::themeFaults',
    'when a theme names neither a builtin nor a stylesheet',
    'it should say so rather than registering a theme with no styles',
  ].join(', '),
  () => {
    // given
    const given = themesFileSchema.parse(
      Bun.YAML.parse('themes:\n  - name: empty\n'),
    )

    // when
    const actual = themeFaults(given)

    // then
    expect(actual[0]).toContain('no styles')
  },
)

test(
  [
    'given typedefs/theme::themeFaults',
    'when the default names a theme nobody registered',
    'it should say what this repository does offer',
  ].join(', '),
  () => {
    // given
    const given = themesFileSchema.parse(
      Bun.YAML.parse(
        'default_theme: nope\nthemes:\n  - name: dark\n    builtin: true\n',
      ),
    )

    // when
    const actual = themeFaults(given)

    // then
    expect(actual[0]).toContain('dark')
  },
)

test(
  [
    'given typedefs/theme::themeFaults',
    'when two registrations share a name',
    'it should report it rather than letting load order decide',
  ].join(', '),
  () => {
    // given
    const given = themesFileSchema.parse(
      Bun.YAML.parse(
        'themes:\n  - name: dark\n    builtin: true\n  - name: dark\n    builtin: true\n',
      ),
    )

    // when
    const actual = themeFaults(given)

    // then
    expect(actual[0]).toContain('twice')
  },
)
