/**
 * The handoff directory listing, refreshed when the run writes something.
 *
 * Not polled on a timer. The listing stats a directory and reads the first
 * kilobyte of each file, and nothing in it changes between the moments a
 * activityRun ends — so it is fetched on the signal that something may have been
 * written, which is an `artifacts` event arriving, rather than twice a second
 * forever.
 */
import { useEffect, useState } from 'react'
import type { EventRow } from '@/domains/events'
import { fetchHandoff } from '../io/fetch-handoff'
import type { HandoffFile } from '../typedefs/handoff'

export const useHandoff = (
  runId: string,
  workspace: string | undefined,
  events: readonly EventRow[],
): readonly HandoffFile[] | undefined => {
  /*
   * Undefined until the first answer, and that distinction matters: an empty
   * list means "nothing was written", while not knowing yet must not make a
   * reported document look missing.
   */
  const [files, setFiles] = useState<readonly HandoffFile[] | undefined>(
    undefined,
  )

  // The count of write observations, which is the only thing that can change
  // what the directory holds.
  const writes = events.filter((event) => event.type === 'artifacts').length

  /*
   * `writes` is a change SIGNAL, not a value the effect reads: it is the
   * count of observed writes, and the listing is refetched when it moves.
   * Biome sees an unused dependency; removing it would pin the listing to
   * the first render and a document written later would never appear.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change signal, deliberately not read inside
  useEffect(() => {
    let live = true
    fetchHandoff(runId, workspace)
      .then((listing) => {
        if (live && listing !== undefined) setFiles(listing)
      })
      .catch(() => {
        /*
         * Unknown, NOT empty. An empty listing means every reported document
         * is missing, so answering a failed request with one turns an old
         * API into a run that appears to have lost its documents.
         */
        if (live) setFiles(undefined)
      })
    return () => {
      live = false
    }
  }, [runId, workspace, writes])

  return files
}
