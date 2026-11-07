// A domain's typedefs re-export the server contract it owns, exactly as
// reference-web's books/src/typedefs/book.ts re-exports from the API package.
export type {
  ActivityRun,
  ActivityRunKind,
  ActivityRunStatus,
  AgentEndPayload,
  AgentPrompts,
  AgentSession,
  Envelope,
  GateCheck,
  GateResult,
  PromptsResponse,
} from '@shared/types'
