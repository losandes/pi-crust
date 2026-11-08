// A domain's typedefs re-export the server contract it owns, exactly as
// reference-web's books/src/typedefs/book.ts re-exports from the API package.
//
// Envelope and Session are also owned by decisions/activity-runs and
// sessions respectively, but handoff does not depend on either domain
// (1.2.5), so it carries its own re-export of the same contract types.
export type { Envelope, HandoffFile, Session } from '@shared/types'
