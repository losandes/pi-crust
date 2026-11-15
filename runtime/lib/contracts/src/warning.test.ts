import { expect, test } from 'bun:test'
import type { TTreeWarning } from './warning'
import {
  outstandingUncommitted,
  renderWarnings,
  standingWarnings,
  warningExplanation,
  warningFromPayload,
  warningPayload,
} from './warning'

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

const recovered: TTreeWarning = {
  ...uncommitted,
  kind: 'recovered',
  paths: [],
  note: 'committed abc123',
}
const later: TTreeWarning = { ...uncommitted, note: 'a later refusal' }

for (const given of [
  {
    name: 'a recovery answers a refusal',
    warnings: [uncommitted, recovered],
    expected: [],
  },
  {
    name: 'a later refusal replaces the earlier one',
    warnings: [uncommitted, later],
    expected: [later],
  },
  {
    name: 'a refusal after recovery still stands',
    warnings: [uncommitted, recovered, later],
    expected: [later],
  },
  {
    name: 'another kind is never answered',
    warnings: [unexpected, uncommitted, recovered],
    expected: [unexpected],
  },
  {
    name: 'recovery for another Activity leaves the refusal alone',
    warnings: [uncommitted, { ...recovered, activities: ['test'] }],
    expected: [uncommitted],
  },
  {
    name: 'overlap answers the whole warning',
    warnings: [{ ...uncommitted, activities: ['build', 'test'] }, recovered],
    expected: [],
  },
]) {
  test(
    [
      `given ${given.name}`,
      'when warnings are reported and outstanding commits selected',
      'it should retain only standing warnings in their original order',
    ].join(', '),
    () => {
      // given
      const warnings = structuredClone(given.warnings)

      // when
      const actual = standingWarnings(warnings)
      const outstanding = outstandingUncommitted(warnings)

      // then
      expect(actual).toEqual(given.expected)
      expect(outstanding).toEqual(
        given.expected.filter((warning) => warning.kind === 'uncommitted'),
      )
      expect(warnings).toEqual(given.warnings)
    },
  )
}

test(
  [
    'given a recovered warning on the trace channel',
    'when it is parsed and rendered alongside the refusal it answered',
    'it should recognise recovery but render neither record as a standing warning',
  ].join(', '),
  () => {
    // given
    const payload = warningPayload(recovered)

    // when
    const parsed = warningFromPayload(payload)
    const actual = renderWarnings([uncommitted, recovered])

    // then
    expect(parsed).toEqual(recovered)
    expect(actual).toEqual([])
    expect(warningExplanation('recovered')).not.toBe(
      warningExplanation('uncommitted'),
    )
    expect(warningExplanation('recovered')).not.toBe('')
  },
)

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
