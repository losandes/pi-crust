import type { ReactNode } from 'react'
import { ThemePicker } from '@/domains/themes'
import { hrefFor, useRoute } from '@/lib/router'
import styles from './default-layout.module.css'

const Logo = () => (
  <img className={styles.logo} src="/logo.png" alt="pi-crust logo" />
)

/** The chrome around every page: logo, breadcrumbs, theme picker, main. */
export default function DefaultLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const route = useRoute()

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <nav className={styles.crumbs}>
          <Logo />
          <span className={styles.brand}>pi-crust</span>
          <span className={styles.sep}>›</span>
          <a
            href={hrefFor()}
            className={route.runId === undefined ? styles.current : undefined}
          >
            sessions
          </a>
          {route.runId !== undefined && (
            <>
              <span className={styles.sep}>›</span>
              <a
                href={hrefFor(route.runId, undefined, route.workspace)}
                className={
                  route.activityRunId === undefined ? styles.current : undefined
                }
              >
                {route.workspace === undefined
                  ? route.runId
                  : `${route.workspace} · ${route.runId}`}
              </a>
            </>
          )}
          {route.runId !== undefined && route.activityRunId !== undefined && (
            <>
              <span className={styles.sep}>›</span>
              <span className={styles.current}>{route.activityRunId}</span>
            </>
          )}
        </nav>
        <div className={styles.controls}>
          <span className={styles.liveHint}>
            <span className={styles.liveDot} /> live
          </span>
          <ThemePicker workspace={route.workspace} />
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
