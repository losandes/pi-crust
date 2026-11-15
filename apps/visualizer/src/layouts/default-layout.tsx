import type { ReactNode } from 'react'
import { ThemePicker } from '@/domains/themes'
import { cx } from '@/lib/cx'
import { hrefFor, useRoute } from '@/lib/router'

const Logo = () => (
  <img
    className="size-7 flex-none drop-shadow-[0_0_--spacing(2)_rgb(var(--purple-rgb)/0.35)]"
    src="/logo.png"
    alt="pi-crust logo"
  />
)

/** The chrome around every page: logo, breadcrumbs, theme picker, main. */
export default function DefaultLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const route = useRoute()

  return (
    <div>
      <header className="sticky top-0 z-10 flex items-center justify-between bg-panel/72 px-4 py-4 backdrop-blur-lg after:absolute after:inset-x-0 after:bottom-0 after:h-(--border-width) after:bg-[linear-gradient(90deg,rgb(var(--purple-rgb)/0.45),rgb(var(--cyan-rgb)/0.35)_40%,rgb(var(--cyan-rgb)/0.06))] sm:px-7">
        <nav className="flex min-w-0 items-center gap-2 text-[17px] sm:gap-2.5">
          <Logo />
          <span className="bg-[linear-gradient(90deg,var(--purple),var(--cyan))] bg-clip-text font-bold tracking-wider whitespace-nowrap text-transparent">
            pi-crust
          </span>
          <span className="text-faint">›</span>
          <a
            href={hrefFor()}
            aria-current={route.runId === undefined ? 'page' : undefined}
            className={cx(
              'min-w-0 truncate hover:text-text!',
              route.runId === undefined ? 'text-text!' : 'text-dim!',
            )}
          >
            sessions
          </a>
          {route.runId !== undefined && (
            <>
              <span className="text-faint">›</span>
              <a
                href={hrefFor(route.runId, undefined, route.workspace)}
                aria-current={
                  route.activityRunId === undefined ? 'page' : undefined
                }
                className={cx(
                  'min-w-0 truncate hover:text-text!',
                  route.activityRunId === undefined
                    ? 'text-text!'
                    : 'text-dim!',
                )}
              >
                {route.workspace === undefined
                  ? route.runId
                  : `${route.workspace} · ${route.runId}`}
              </a>
            </>
          )}
          {route.runId !== undefined && route.activityRunId !== undefined && (
            <>
              <span className="text-faint">›</span>
              <span aria-current="page" className="min-w-0 truncate text-text">
                {route.activityRunId}
              </span>
            </>
          )}
        </nav>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 text-base whitespace-nowrap text-dim">
            <span className="size-2 animate-[crust-pulse_1.6s_ease-in-out_infinite] rounded-full bg-ok shadow-[0_0_--spacing(2.5)_rgb(var(--ok-rgb)/0.7)]" />{' '}
            live
          </span>
          <ThemePicker workspace={route.workspace} />
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
