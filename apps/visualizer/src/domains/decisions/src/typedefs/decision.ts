// A domain's typedefs re-export the server contract it owns, exactly as
// reference-web's books/src/typedefs/book.ts re-exports from the API package.
export type {
  DecisionRequest,
  Envelope,
  Event as EventRow,
  GateResult,
} from '@shared/types'
