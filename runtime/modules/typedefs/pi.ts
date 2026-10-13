/** The pi coding-agent interface's request and result shapes. */

/** Everything one non-interactive pi run needs. */
export type TPiRequest = Readonly<{
  prompt: string
  systemPrompt: string
  /** registry pattern, resolved to provider + id */
  model: string
  thinking: string
  /** pi --session-id: creates or continues */
  sessionId: string
  sessionDir: string
  /** JSONL stream lands here */
  rawOutputPath: string
  tools: readonly string[] | undefined
  extensions: readonly string[]
  /**
   * Skill files or directories the agent must load (pi `--skill`).
   *
   * Resolved per call from `routing.skills` in the config, by the paths the
   * change actually touched. Nothing in this tree names a skill; a stamped
   * repository declares its own, or none.
   */
  skills: readonly string[]
  /** set from run.repoRoot — the codebase root agents work in */
  cwd: string
  /**
   * Variables added to the operator’s own environment for this call.
   *
   * The only channel an extension has: pi loads one by PATH and takes no
   * arguments, so a policy computed per run reaches it as a file named by a
   * variable. ADDED rather than replacing, because an agent is meant to see
   * exactly what the operator sees — their PATH, their toolchains, their
   * globally installed packages.
   */
  env?: Readonly<Record<string, string>>
}>

/**
 * Tokens and the dollars they cost, per component, summed over a call.
 *
 * Mirrors pi's `usage` shape one-for-one so the numbers reconcile with what pi
 * itself reports: `input` EXCLUDES cache reads, which bill at their own
 * (cheaper) rate — add them to learn the size of the prompt that was sent.
 */
export type TUsageBreakdown = Readonly<{
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  // Thinking tokens. NOT a fifth component: measured across every session on
  // disk, reasoning is always <= output and the four components above always
  // sum to totalTokens, so reasoning is the thinking SHARE of output, billed
  // at the output rate. Report it nested under output, never added to it.
  reasoning_tokens: number
  total_tokens: number
  input_cost: number
  output_cost: number
  cache_read_cost: number
  cache_write_cost: number
  total_cost: number
}>

export const emptyUsage: TUsageBreakdown = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  input_cost: 0,
  output_cost: 0,
  cache_read_cost: 0,
  cache_write_cost: 0,
  total_cost: 0,
}

/** Add another call's usage — an activity run that retries spends more than once. */
export const mergeUsage = (
  left: TUsageBreakdown,
  right: TUsageBreakdown,
): TUsageBreakdown => ({
  input_tokens: left.input_tokens + right.input_tokens,
  output_tokens: left.output_tokens + right.output_tokens,
  cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
  cache_write_tokens: left.cache_write_tokens + right.cache_write_tokens,
  reasoning_tokens: left.reasoning_tokens + right.reasoning_tokens,
  total_tokens: left.total_tokens + right.total_tokens,
  input_cost: left.input_cost + right.input_cost,
  output_cost: left.output_cost + right.output_cost,
  cache_read_cost: left.cache_read_cost + right.cache_read_cost,
  cache_write_cost: left.cache_write_cost + right.cache_write_cost,
  total_cost: left.total_cost + right.total_cost,
})

export type TPiResult = Readonly<{
  text: string
  returncode: number
  sessionId: string
  tokens: number
  cost: number
  usage: TUsageBreakdown
  // Context occupancy after the LAST turn — not a sum. `tokens` bills every
  // turn; this is how full the window is right now, which is what the
  // visualizer's context bar measures against `contextWindow`.
  contextTokens: number
  /** 0 when the registry declares no ceiling */
  contextWindow: number
}>

/** One normalized record per completed tool call. */
export type TToolCallRecord = Readonly<{
  tool: string
  tool_call_id: string
  args: Readonly<Record<string, unknown>>
  ok: boolean
  label: string
  result_snippet?: string
  started_at: string | undefined
  ended_at: string
  duration_ms: number | undefined
}>
