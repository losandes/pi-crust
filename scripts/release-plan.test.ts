import { expect, mock, test } from 'bun:test'
import {
  restoreTerminal,
  silenceTerminal,
} from '../runtime/testing/terminal-capture'
import {
  main,
  planRelease,
  releaseEnvLines,
  releasePlanDeps,
} from './release-plan'

test(
  [
    'given live release adapters',
    'when reading the root minimum and emitting release lines',
    'it should use the declared Node minimum',
  ].join(', '),
  () => {
    // given
    silenceTerminal()
    try {
      // when
      const engines = releasePlanDeps.enginesNode()
      releasePlanDeps.out('release output')
      releasePlanDeps.err('release diagnostic')
      // then
      expect(engines).toBe('>=22.19.0')
    } finally {
      restoreTerminal()
    }
  },
)

for (const tag of ['v1.2.3', '1.2.3', '1.2.3-rc.1'])
  test(
    [
      'given a version release',
      `when planning ${tag}`,
      'it should derive the archive and branch dist-tag',
    ].join(', '),
    () => {
      // given
      const branch = tag.includes('-') ? 'next' : 'main'
      // when
      const actual = planRelease({
        tag,
        target: branch,
        enginesNode: '>=22.19.0',
      })
      // then
      expect(actual.status).toBe('ok')
      if (actual.status === 'ok')
        expect(releaseEnvLines(actual.data)).toEqual([
          `RELEASE_VERSION=${tag.replace(/^v/, '')}`,
          `RELEASE_BRANCH=${branch}`,
          `RELEASE_DIST_TAG=${branch === 'main' ? 'latest' : branch}`,
          `RELEASE_ARCHIVE=polyn-pi-crust-${tag.replace(/^v/, '')}.tgz`,
          'RELEASE_MIN_NODE=22.19.0',
        ])
    },
  )
for (const row of [
  ...['nightly', 'v1.2', '1.2.3+5', '', '01.2.3', '1.2.3-01', '1.2.3-'].map(
    (tag) => ({
      tag,
      target: 'main',
      enginesNode: '>=22.19.0',
      message: `release-plan: tag "${tag}" is not a version`,
    }),
  ),
  {
    tag: '1.2.3',
    target: 'a'.repeat(40),
    enginesNode: '>=22.19.0',
    message: `release-plan: release targets commit ${'a'.repeat(40)}, not a branch`,
  },
  ...['latest', 'v2', 'V2', 'release/2.0', ''].map((target) => ({
    tag: '1.2.3',
    target,
    enginesNode: '>=22.19.0',
    message: `release-plan: branch "${target}" cannot be an npm dist-tag`,
  })),
  {
    tag: '1.2.3',
    target: 'main',
    enginesNode: '^22',
    message: 'release-plan: engines.node "^22" is not a minimum version',
  },
])
  test(
    [
      'given invalid release input',
      `when planning ${JSON.stringify(row)}`,
      'it should report the first invalid rule',
    ].join(', '),
    () => {
      // given
      // when
      const actual = planRelease(row)
      // then
      expect(actual.status).toBe('error')
      if (actual.status === 'error')
        expect(actual.error.message).toBe(row.message)
    },
  )
for (const tag of ['1.2.3', 'nightly', undefined])
  test(
    [
      'given release environment',
      `when main receives ${tag}`,
      'it should write only the success lines or one diagnostic',
    ].join(', '),
    () => {
      // given
      const out = mock((_line: string) => undefined)
      const err = mock((_line: string) => undefined)
      // when
      const status = main({
        env: { RELEASE_TAG: tag, RELEASE_TARGET: 'main' },
        enginesNode: () => '>=22.19.0',
        out,
        err,
      })()
      // then
      expect(status).toBe(tag === '1.2.3' ? 0 : 1)
      expect(out.mock.calls.flat()).toEqual(
        tag === '1.2.3'
          ? [
              'RELEASE_VERSION=1.2.3',
              'RELEASE_BRANCH=main',
              'RELEASE_DIST_TAG=latest',
              'RELEASE_ARCHIVE=polyn-pi-crust-1.2.3.tgz',
              'RELEASE_MIN_NODE=22.19.0',
            ]
          : [],
      )
      expect(err.mock.calls.flat()).toEqual(
        tag === '1.2.3'
          ? []
          : [`release-plan: tag "${tag ?? ''}" is not a version`],
      )
    },
  )
