import { expect, test } from 'bun:test'
import { legacyConfigNotices } from './legacy-config-notices'

for (const repositoryFiles of [
  [],
  ['crust.config.yaml'],
  ['crust.observe.yaml', 'crust.activities.local.yml'],
]) {
  test(
    [
      `given unread repository files ${repositoryFiles.join(', ')}`,
      'when notices are formatted',
      'it should name unread paths and preserve the theme exception',
    ].join(', '),
    () => {
      // given
      const found = {
        repositoryDirectory: '/repo/.pi-crust/config',
        repositoryFiles,
        machineFile: '/home/crust.config.yml',
        machineVariableFile: '/old/machine.yml',
      }
      // when
      const actual = legacyConfigNotices(found, {
        repositoryPath: '/repo/pi-crust.toml',
        machineDirectory: '/home',
      })
      // then
      expect(actual.length).toBe(repositoryFiles.length === 0 ? 2 : 3)
      expect(actual.every((notice) => notice.includes('not read'))).toBe(true)
      expect(actual.join('\n').includes('themes and default_theme')).toBe(
        repositoryFiles.includes('crust.observe.yaml'),
      )
      expect(actual.join('\n')).toContain(
        'CRUST_MACHINE_CONFIG=/old/machine.yml',
      )
    },
  )
}

test(
  [
    'given no legacy paths',
    'when notices are formatted',
    'it should return no notices',
  ].join(', '),
  () => {
    // given
    // when
    const actual = legacyConfigNotices(
      {
        repositoryDirectory: '/repo',
        repositoryFiles: [],
        machineFile: '',
        machineVariableFile: '',
      },
      { repositoryPath: '/repo/pi-crust.toml', machineDirectory: '/home' },
    )
    // then
    expect(actual).toEqual([])
  },
)
