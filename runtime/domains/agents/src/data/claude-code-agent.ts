/**
 * Claude Code interface — STUB in v1. The factory is Pi-only for now.
 *
 * The config schema accepts `coding_agent: claude_code` so nothing breaks at
 * the schema level, but selecting it throws until v2 implements this interface
 * (`claude -p --output-format stream-json --resume <session_id>`).
 */

export const run = (): never => {
  throw new Error(
    "coding_agent 'claude_code' is not implemented in v1 — pi-crust v1 runs the " +
      'Pi coding agent only. Set coding_agent: pi (or omit it) in crust.config.yaml.',
  )
}
