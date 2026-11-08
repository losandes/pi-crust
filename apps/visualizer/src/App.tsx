import { useRoute } from '@/lib/router'
import SessionsPage from './pages'
import SessionPage from './pages/[run-id]'

export const App = () => {
  const route = useRoute()

  return route.runId === undefined ? (
    <SessionsPage />
  ) : (
    <SessionPage
      key={`${route.workspace ?? ''}:${route.runId}`}
      runId={route.runId}
      activityRunId={route.activityRunId}
      workspace={route.workspace}
    />
  )
}
