import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { repositoryPathFromRemote, repositoryPathOf } from './repository-path'

const cases: readonly Readonly<{
  url: string
  expected: readonly string[] | undefined
}>[] = [
  ...[
    'git@github.com:losandes/pi-crust.git',
    'ssh://git@github.com:22/losandes/pi-crust.git',
    'https://github.com/losandes/pi-crust.git',
    'https://github.com/losandes/pi-crust',
    'https://github.com/losandes/pi-crust/',
    'https://someone:secret@github.com/losandes/pi-crust.git',
    '  https://github.com///losandes/pi-crust.git///  ',
  ].map((url) => ({ url, expected: ['losandes', 'pi-crust'] })),
  ...[
    'https://gitlab.example.com:8443/group/subgroup/project.git',
    'git@gitlab.example.com:group/subgroup/project.git',
  ].map((url) => ({ url, expected: ['group', 'subgroup', 'project'] })),
  {
    url: 'https://github.com/LosAndes/Pi-Crust.git',
    expected: ['LosAndes', 'Pi-Crust'],
  },
  { url: 'git@github.com:local/tools.git', expected: ['local', 'tools'] },
  ...[
    'git@example.com:project.git',
    '/srv/git/project.git',
    'file:///srv/git/project.git',
    'FILE:///a/b',
    'https://example.com/../../outside/project.git',
    '',
    'https://example.com',
    'git@x:a//b',
    'git@x:a/./b',
    'git@x:a/../b',
    'git@x:a/\\b',
    'git@x:a/\0b',
    'git@x:a/.git',
  ].map((url) => ({ url, expected: undefined })),
]
for (const { url, expected } of cases) {
  test(
    [
      'given a remote URL',
      `when parsing ${JSON.stringify(url)}`,
      'it should preserve only safe owner and repository segments',
    ].join(', '),
    () => {
      // given
      // when
      const actual = repositoryPathFromRemote(url)
      // then
      expect(actual).toEqual(expected)
    },
  )
}
for (const originUrl of [
  undefined,
  'file:///a/b',
  'https://example.com/a/b.git',
]) {
  test(
    [
      'given a repository identity',
      `when placing origin ${originUrl}`,
      'it should use the origin or a stable local name',
    ].join(', '),
    () => {
      // given
      const primaryClone = '/work/notes'
      // when
      const actual = repositoryPathOf({ originUrl, primaryClone })
      // then
      expect(actual).toEqual(
        originUrl?.startsWith('https:')
          ? ['a', 'b']
          : [
              'local',
              `notes-${createHash('sha256').update(primaryClone).digest('hex').slice(0, 8)}`,
            ],
      )
    },
  )
}
