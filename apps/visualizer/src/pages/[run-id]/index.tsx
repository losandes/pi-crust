import { SessionTrace } from '@/domains/sessions'
import DefaultLayout from '@/layouts/default-layout'

/** #/<run>[/<activity>] — one run. */
export default function SessionPage({
  runId,
  activityRunId,
  workspace,
}: Readonly<{
  runId: string
  activityRunId: string | undefined
  workspace: string | undefined
}>) {
  return (
    <DefaultLayout>
      <SessionTrace
        runId={runId}
        activityRunId={activityRunId}
        workspace={workspace}
      />
    </DefaultLayout>
  )
}
