import styles from './App.module.css'
import { SessionsList } from './components/SessionsList'
import { SessionTrace } from './components/SessionTrace'
import { ThemePicker } from './components/ThemePicker'
import { hrefFor } from './lib/router'
import { useRoute } from './lib/use-route'

const Logo = () => (
  <img className={styles.logo} src="/logo.png" alt="pi-crust logo" />
)

export const App = () => {
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
      <main>
        {route.runId === undefined ? (
          <SessionsList />
        ) : (
          <SessionTrace
            key={`${route.workspace ?? ''}:${route.runId}`}
            runId={route.runId}
            activityRunId={route.activityRunId}
            workspace={route.workspace}
          />
        )}
      </main>
    </div>
  )
}
