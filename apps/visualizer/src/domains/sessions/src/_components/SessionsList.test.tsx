import { expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import type { fetchSessions } from '../io/fetch-sessions'
import { FILTER_STORAGE_KEY } from '../state/filters-store'
import type { SessionSummary } from '../typedefs/session'
import type { createSessionCard } from './SessionCard'
import { createSessionsList } from './SessionsList'

const fixture = (
  run_id: string,
  repository_root: string,
  repository_location: string,
): SessionSummary => ({
  run_id,
  repository_root,
  repository_location,
  workspace_root: '',
  workspace: run_id,
  branch: run_id,
  lifecycle: 'build',
  name: '',
  request: '',
  status: 'success',
  engineer: '',
  archived: 0,
  started_at: '',
  ended_at: '',
  total_cost: 0,
  total_tokens: 0,
  activity_run_count: 0,
  activityRuns: [],
  agents: [],
})
const Card = ({
  session,
  onArchived,
  onRefused,
}: ComponentProps<ReturnType<typeof createSessionCard>>) => (
  <div data-card={session.run_id}>
    {session.run_id}
    <button type="button" onClick={() => onArchived(session.run_id)}>
      archive {session.run_id}
    </button>
    <button
      type="button"
      onClick={() => {
        onArchived('')
        onRefused('token refused')
      }}
    >
      restore {session.run_id}
    </button>
  </div>
)
const withList = async (
  check: (
    container: HTMLDivElement,
    mount: (fetcher: typeof fetchSessions) => Promise<void>,
  ) => Promise<void>,
) => {
  GlobalRegistrator.register()
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root = createRoot(container)
  let mounted = false
  const mount = async (fetcher: typeof fetchSessions) => {
    if (mounted) {
      await act(() => root.unmount())
      root = createRoot(container)
    }
    mounted = true
    const Component = createSessionsList({
      fetchSessions: fetcher,
      SessionCard: Card,
    })
    await act(() => {
      root.render(<Component />)

      return Promise.resolve()
    })
  }
  try {
    await check(container, mount)
  } finally {
    await act(() => root.unmount())
    container.remove()
    await GlobalRegistrator.unregister()
  }
}
const repositoryButton = (container: HTMLDivElement) =>
  [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.startsWith('repository'),
  )
const cards = (container: HTMLDivElement) =>
  [...container.querySelectorAll('[data-card]')].map((card) =>
    card.getAttribute('data-card'),
  )

test(
  [
    'given same-named repositories below home',
    'when opening the repository filter',
    'it should distinguish safe display titles',
  ].join(', '),
  async () => {
    // given
    const rows = [
      fixture('one', '/Users/ada/a/app', '~/a/app'),
      fixture('two', '/Users/ada/b/app', '~/b/app'),
    ]
    await withList(async (container, mount) => {
      // when
      await mount(async () => rows)
      await act(() => repositoryButton(container)?.click())
      // then
      expect(
        [...container.querySelectorAll('label span')].map((option) =>
          option.getAttribute('title'),
        ),
      ).toEqual(['~/a/app', '~/b/app'])
      expect(container.innerHTML).not.toContain('/Users/ada')
    })
  },
)

for (const initiallyRedacted of [true, false]) {
  test(
    [
      `given a repository selection saved with redaction ${initiallyRedacted}`,
      'when reloading under the opposite setting',
      'it should retain raw identities and the same selected run',
    ].join(', '),
    async () => {
      // given
      const rows = [
        fixture('one', '/srv/acme/app', '…/acme/app'),
        fixture('two', '/mnt/acme/app', '…/acme/app'),
      ]
      const underSetting = (enabled: boolean) =>
        rows.map((row) => ({
          ...row,
          repository_location: enabled
            ? row.repository_location
            : row.repository_root,
        }))
      await withList(async (container, mount) => {
        await mount(async () => underSetting(initiallyRedacted))
        await act(() => repositoryButton(container)?.click())
        const options = [...container.querySelectorAll('label')].filter(
          (label) => label.querySelector('span'),
        )
        // then
        expect(options).toHaveLength(2)
        // when
        // Options sort by raw identity: /mnt first, then /srv, under both settings.
        const target = options[1]
        await act(() => target?.querySelector('input')?.click())
        // then
        expect(cards(container)).toEqual(['one'])
        expect(
          JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) ?? '{}')
            .repository,
        ).toEqual(['/srv/acme/app'])
        // when
        await mount(async () => underSetting(!initiallyRedacted))
        // then
        expect(cards(container)).toEqual(['one'])
      })
    },
  )
}

test(
  [
    'given a loaded list',
    'when dismissing filters and archiving then restoring a card',
    'it should retain panel and optimistic-write behavior',
  ].join(', '),
  async () => {
    // given
    const rows = [
      fixture('one', '/srv/a/app', '…/a/app'),
      fixture('two', '/srv/b/app', '…/b/app'),
    ]
    await withList(async (container, mount) => {
      await mount(async () => rows)
      // when
      await act(() => repositoryButton(container)?.click())
      await act(() =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      )
      // then
      expect(repositoryButton(container)?.getAttribute('aria-expanded')).toBe(
        'false',
      )
      // when
      await act(() => repositoryButton(container)?.click())
      await act(() =>
        document.body.dispatchEvent(
          new Event('pointerdown', { bubbles: true }),
        ),
      )
      // then
      expect(repositoryButton(container)?.getAttribute('aria-expanded')).toBe(
        'false',
      )
      // when
      await act(() =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'archive one')
          ?.click(),
      )
      // then
      expect(cards(container)).toEqual(['two'])
      // when
      await act(() => {
        ;[...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'restore two')
          ?.click()

        return Promise.resolve()
      })
      // then
      expect(cards(container)).toEqual(['one', 'two'])
      expect(container.textContent).toContain('token refused')
    })
  },
)

test(
  [
    'given a filter that matches no loaded session',
    'when selecting all again',
    'it should restore all cards',
  ].join(', '),
  async () => {
    // given
    await withList(async (container, mount) => {
      sessionStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ repository: ['/missing'] }),
      )
      await mount(async () => [fixture('one', '/srv/a/app', '…/a/app')])
      // then
      expect(container.textContent).toContain('no runs match these filters')
      // when
      await act(() => repositoryButton(container)?.click())
      await act(() =>
        container
          .querySelector<HTMLInputElement>('input[type=checkbox]')
          ?.click(),
      )
      // then
      expect(cards(container)).toEqual(['one'])
    })
  },
)

for (const state of ['loading', 'empty', 'error'] as const) {
  test(
    [
      `given a ${state} session list`,
      'when rendering',
      'it should retain its existing status message',
    ].join(', '),
    async () => {
      // given
      await withList(async (container, mount) => {
        // when
        await mount(
          state === 'loading'
            ? () => new Promise(() => {})
            : state === 'error'
              ? () => {
                  return Promise.reject(new Error('offline'))
                }
              : async () => [],
        )
        // then
        expect(container.textContent).toContain(
          state === 'loading'
            ? 'loading sessions'
            : state === 'empty'
              ? 'no sessions yet'
              : 'api unreachable — retrying offline',
        )
      })
    },
  )
}
