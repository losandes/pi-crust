import { expect, test } from 'bun:test'
import {
  EMPTY_REPOSITORY_PATH,
  withShippedPackage,
} from '../../../../testing/shipped-layer'
import {
  restoreTerminal,
  silenceTerminal,
} from '../../../../testing/terminal-capture'
import {
  askWhichRun,
  NEW_RUN,
  planNewRun,
  planResume,
  type TAskPorts,
} from './please-wizard'

const portsFor = (situation: string): TAskPorts => ({
  askOne: (title) =>
    Promise.resolve(
      title.includes('waiting.')
        ? situation === 'verb-cancel'
          ? undefined
          : situation
        : title.startsWith('how much')
          ? situation === 'trust-cancel'
            ? undefined
            : '50'
          : title.startsWith('may it')
            ? situation === 'commit-cancel'
              ? undefined
              : 'yes'
            : title.startsWith('stop and')
              ? situation === 'approval-cancel'
                ? undefined
                : ''
              : title.startsWith('show its')
                ? situation === 'stream-cancel'
                  ? undefined
                  : 'yes'
                : situation === 'choose-cancel'
                  ? undefined
                  : 'run1',
    ),
  askText: () =>
    Promise.resolve(
      situation === 'prompt-cancel' || situation === 'note-cancel'
        ? undefined
        : situation === 'prompt-empty' || situation === 'note-empty'
          ? ''
          : 'the request',
    ),
  askOrder: (_title, items) =>
    Promise.resolve(
      situation === 'order-cancel' ? undefined : items.toReversed(),
    ),
  askMenuChoice: (_title, _options, config) => {
    // Exercise the preview as a menu does, with and without a highlighted choice.
    expect(config.preview?.([], '')).toBe('nothing yet')
    expect(config.preview?.([], 'scout')).toContain('not selected')
    expect(config.preview?.(['scout'], 'scout')).toContain('scout')
    expect(config.preview?.([], '!operator')).toContain('chooses the chain')
    expect(config.preview?.(['!operator'], '!operator')).toContain(
      'chooses the chain',
    )
    return Promise.resolve({
      values:
        situation === 'menu-cancel'
          ? undefined
          : situation === 'menu-empty'
            ? []
            : situation === 'operator'
              ? ['!operator']
              : ['scout', 'build'],
      reorder: situation === 'reorder' || situation === 'order-cancel',
    })
  },
})

for (const situation of [
  'menu-cancel',
  'menu-empty',
  'prompt-cancel',
  'prompt-empty',
  'trust-cancel',
  'commit-cancel',
  'approval-cancel',
  'stream-cancel',
  'success',
  'operator',
  'reorder',
  'order-cancel',
]) {
  test(
    [
      `given a new-run wizard with ${situation}`,
      'when building the command through question ports',
      'it should preserve cancellation and the selected command order',
    ].join(', '),
    async () => {
      // given
      silenceTerminal()
      const config = EMPTY_REPOSITORY_PATH
      try {
        // when
        const actual = await withShippedPackage(() =>
          planNewRun(portsFor(situation))(config),
        )

        // then
        if (
          ['success', 'operator', 'reorder', 'order-cancel'].includes(situation)
        ) {
          expect(actual?.[0]).toBe('just')
          expect(actual).toContain('the request')
          if (situation === 'reorder') expect(actual).toContain('build,scout')
        } else expect(actual).toBeUndefined()
      } finally {
        restoreTerminal()
      }
    },
  )
}

for (const situation of [
  'approve',
  'answer',
  'reject',
  'verb-cancel',
  'note-empty',
  'note-cancel',
]) {
  test(
    [
      `given a waiting-run answer ${situation}`,
      'when planning its continuation',
      'it should require a nonempty correction unless approved',
    ].join(', '),
    async () => {
      // given
      silenceTerminal()
      try {
        // when
        const actual = await planResume(portsFor(situation))('run1')

        // then
        if (['approve', 'answer', 'reject'].includes(situation)) {
          expect(actual).toContain('run1')
          expect(actual).toContain(situation)
        } else expect(actual).toBeUndefined()
      } finally {
        restoreTerminal()
      }
    },
  )
}

for (const situation of ['empty', 'choose-cancel', 'chosen']) {
  test(
    [
      `given a waiting-run picker with ${situation}`,
      'when selecting what to run',
      'it should distinguish a new run, cancellation and an existing run',
    ].join(', '),
    async () => {
      // given
      const waiting =
        situation === 'empty'
          ? []
          : [
              {
                run_id: 'run1',
                lifecycle: 'sdlc',
                status: 'waiting',
                started_at: 'today',
                name: '',
              },
            ]

      // when
      const actual = await askWhichRun(portsFor(situation))(waiting)

      // then
      expect(actual).toBe(
        situation === 'empty'
          ? NEW_RUN
          : situation === 'choose-cancel'
            ? undefined
            : 'run1',
      )
    },
  )
}
