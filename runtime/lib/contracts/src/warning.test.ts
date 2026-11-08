import { expect, test } from 'bun:test'
import type { TTreeWarning } from './warning'
import { renderWarnings } from './warning'

const unexpected: TTreeWarning = {
  kind: 'unexpected',
  activities: ['build'],
  activityRunIds: ['run_01_build'],
  stage: 'implement',
  paths: ['src/add.ts'],
  note: '',
}

const uncommitted: TTreeWarning = {
  kind: 'uncommitted',
  activities: ['build'],
  activityRunIds: ['run_01_build'],
  stage: 'build',
  paths: ['src/add.ts'],
  note: 'commit failed: 1Password: failed to fill whole buffer',
}

test(
  [
    'given typedefs/warning::renderWarnings',
    'when a run raised one attribution warning and one failed commit',
    'it should keep the unexplained-change headline counting only the attribution kind',
  ].join(', '),
  () => {
    // given
    const given = [unexpected, uncommitted]

    // when
    const actual = renderWarnings(given)

    // then
    expect(actual).toContain('⚠ 1 unexplained change(s) during this run')
  },
)

test(
  [
    'given typedefs/warning::renderWarnings',
    'when a run raised a failed commit',
    'it should render it as its own block, naming what git could not land',
  ].join(', '),
  () => {
    // given
    const given = [unexpected, uncommitted]

    // when
    const actual = renderWarnings(given)

    // then
    expect(
      actual.some((line) => line.includes('commit(s) this run could not make')),
    ).toBe(true)
    expect(actual).toContain('  src/add.ts'.replace('  ', '    - '))
  },
)

test(
  [
    'given typedefs/warning::renderWarnings',
    'when a run raised only a failed commit',
    'it should print no unexplained-change headline at all',
  ].join(', '),
  () => {
    // given
    const given = [uncommitted]

    // when
    const actual = renderWarnings(given)

    // then
    expect(actual.some((line) => line.includes('unexplained change(s)'))).toBe(
      false,
    )
    expect(
      actual.some((line) => line.includes('commit(s) this run could not make')),
    ).toBe(true)
  },
)
