import styles from './App.module.css'
import { SessionsList } from './components/SessionsList'
import { SessionTrace } from './components/SessionTrace'
import { ThemeToggle } from './components/ThemeToggle'
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
                  route.phaseId === undefined ? styles.current : undefined
                }
              >
                {route.workspace === undefined
                  ? route.runId
                  : `${route.workspace} · ${route.runId}`}
              </a>
            </>
          )}
          {route.runId !== undefined && route.phaseId !== undefined && (
            <>
              <span className={styles.sep}>›</span>
              <span className={styles.current}>{route.phaseId}</span>
            </>
          )}
        </nav>
        <div className={styles.controls}>
          <span className={styles.liveHint}>
            <span className={styles.liveDot} /> live
          </span>
          <ThemeToggle />
        </div>
      </header>
      <main>
        {route.runId === undefined ? (
          <SessionsList />
        ) : (
          <SessionTrace
            key={`${route.workspace ?? ''}:${route.runId}`}
            runId={route.runId}
            phaseId={route.phaseId}
            workspace={route.workspace}
          />
        )}
      </main>
    </div>
  )
}
