import { getJson, scope } from '@/lib/api-client'
import type { EventRow, EventsPage } from '../typedefs/event'

export async function fetchEvents(
  runId: string,
  after: number,
  limit = 500,
  workspace?: string,
): Promise<EventsPage> {
  const page = (await getJson(
    `/api/sessions/${encodeURIComponent(runId)}/events?after=${after}&limit=${limit}` +
      scope(workspace, '&'),
  )) as EventsPage | EventRow[]
  if (Array.isArray(page)) {
    const cursor = page.reduce((max, e) => Math.max(max, e.rowid), after)
    return { events: page, cursor, has_more: page.length === limit }
  }
  return {
    events: page.events ?? [],
    cursor: page.cursor ?? after,
    has_more: page.has_more ?? false,
  }
}
