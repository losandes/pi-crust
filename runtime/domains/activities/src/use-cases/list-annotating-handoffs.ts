import type { TActivityConfig } from '../../../../lib/contracts'
import { activitySuccession } from '../../../../lib/contracts'
import { handoffDocument } from '../../../policy'

export const listAnnotatingHandoffs = (
  given: Readonly<{
    activities: readonly TActivityConfig[]
    except: string
    repoRoot: string
    handoffDir: string
  }>,
): string => {
  const documents = given.activities.map((activity) => ({
    name: activity.name,
    succession: activitySuccession(given.activities, activity.name),
    document: handoffDocument(
      activity.writes ?? [],
      given.repoRoot,
      given.handoffDir,
    ),
  }))
  const supersedingDocuments = new Set(
    documents
      .filter((one) => one.succession === 'supersedes')
      .map((one) => one.document),
  )
  const lines = documents
    .filter(
      (one) =>
        one.succession === 'annotates' &&
        one.name !== given.except &&
        one.document !== undefined &&
        !supersedingDocuments.has(one.document),
    )
    .map((one) => `- ${one.name}: ${one.document}`)

  return lines.length > 0 ? lines.join('\n') : '(none)'
}
