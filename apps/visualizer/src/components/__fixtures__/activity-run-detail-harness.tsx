/**
 * Mounts one real `ActivityRunDetail` so `ActivityRunDetail.layout.test.ts`
 * can measure actual rendered geometry in a real browser. Not shipped; loaded
 * only by that test's in-memory Vite server.
 */
import { createRoot } from 'react-dom/client'
import type { ActivityRun } from '../../../shared/types'
import '../../style.css'
import { ActivityRunDetail } from '../ActivityRunDetail'

const now = Date.now()

const activityRun: ActivityRun = {
  activity_run_id: 'ar-diag-1',
  run_id: 'run-diag-1',
  seq: 1,
  name: 'build',
  kind: 'agent',
  owner: 'builder',
  description: null,
  status: 'success',
  error: null,
  started_at: new Date(now - 60_000).toISOString(),
  ended_at: new Date(now).toISOString(),
}

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <ActivityRunDetail
      activityRun={activityRun}
      runId="run-diag-1"
      runStatus="success"
      events={[]}
      envelopes={[]}
      gates={[]}
      activityRuns={[activityRun]}
      onClose={() => {}}
    />,
  )
}
