// narration does not depend on the activity-runs domain (1.2.5's acyclic
// graph has no edge from narration to activity-runs — activity-runs depends
// on narration, not the reverse), so this is its own re-export of the same
// server contract, not an import of another domain's typedefs.
export type { ActivityRun } from '@shared/types'
