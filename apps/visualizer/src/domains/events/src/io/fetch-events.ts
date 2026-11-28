import { createGetJson, scope } from '@/lib/api-client'
import { redactFields, redaction, type TRedactionStore } from '@/lib/redaction'
import type { EventRow, EventsPage } from '../typedefs/event'

export const createFetchEvents = (
  store: TRedactionStore,
  request?: (...args: Parameters<typeof fetch>) => Promise<Response>,
) =>
  async function fetchEvents(
    runId: string,
    after: number,
    limit = 500,
    workspace?: string,
  ): Promise<EventsPage> {
    const page = (await createGetJson(request)(
      `/api/sessions/${encodeURIComponent(runId)}/events?after=${after}&limit=${limit}` +
        scope(workspace, '&'),
    )) as EventsPage | EventRow[]
    const events = Array.isArray(page) ? page : (page.events ?? [])
    const redactor = events.length
      ? await store.forRun({ runId, workspace })
      : undefined
    const redacted = redactor
      ? events.map(
          redactFields<EventRow>(redactor, {
            text: ['name'],
            json: ['payload_json'],
          }),
        )
      : events
    if (Array.isArray(page)) {
      const cursor = page.reduce((max, e) => Math.max(max, e.rowid), after)
      return { events: redacted, cursor, has_more: page.length === limit }
    }
    return {
      events: redacted,
      cursor: page.cursor ?? after,
      has_more: page.has_more ?? false,
    }
  }

export const fetchEvents = createFetchEvents(redaction)
