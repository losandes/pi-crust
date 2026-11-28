import { createGetJson, scope } from '@/lib/api-client'
import { redactFields, redaction, type TRedactionStore } from '@/lib/redaction'
import type { SessionDetail } from '../typedefs/session'

export const createFetchSession = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchSession(
    runId: string,
    workspace?: string,
  ): Promise<SessionDetail> {
    const detail = (await createGetJson(request)(
      `/api/sessions/${encodeURIComponent(runId)}${scope(workspace)}`,
    )) as SessionDetail
    const { session } = detail
    const roots = {
      repository_root: session.repository_root,
      workspace_root: session.workspace_root,
    }
    const redactor = (await store.base()).forRun(roots)
    store.remember({ runId, workspace }, roots)
    store.remember({ runId, workspace: session.workspace }, roots)
    return {
      session: {
        ...redactFields<SessionDetail['session']>(redactor, {
          text: ['request', 'name'],
        })(session),
        ...(session.repository_root
          ? { repository_location: redactor.location(session.repository_root) }
          : {}),
        ...(session.workspace_root
          ? { workspace_location: redactor.location(session.workspace_root) }
          : {}),
      },
      handoff_dir: redactor.text(detail.handoff_dir ?? ''),
      usage: detail.usage ?? { read: 0, written: 0 },
      activityRuns: (detail.activityRuns ?? []).map(
        redactFields<SessionDetail['activityRuns'][number]>(redactor, {
          text: ['error', 'description'],
        }),
      ),
      agents: detail.agents ?? [],
    }
  }

export const fetchSession = createFetchSession(redaction)
