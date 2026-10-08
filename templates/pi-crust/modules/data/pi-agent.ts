/**
 * Pi coding agent interface — v1's only coding agent.
 *
 * Runs `pi -p --mode json` and tails its JSONL stdout line by line, forwarding
 * each event to a callback WHILE the agent works (the streaming crack, solved
 * by construction). `--session-id` creates-or-continues, so running and
 * continuing an agent are the same call: same session id = same context window.
 */

import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  TPiRequest,
  TPiResult,
  TToolCallRecord,
  TUsageBreakdown,
} from '../typedefs/pi'
import { emptyUsage, mergeUsage } from '../typedefs/pi'
import { safeParseSettlement, settledOr } from '../typedefs/settlement'
import { monotonicMs, nowIso } from './clock'
import { appendText, ensureDir, readText } from './files'
import { operatorEnv } from './operator-env'

const piPath = (): string => process.env.PI_PATH ?? 'pi'

const modelsJsonPath = (): string =>
  process.env.PI_MODELS_PATH ?? join(homedir(), '.pi', 'agent', 'models.json')

/** tool output rides along whole; clip only guards pathological cases */
export const RESULT_SNIPPET_CHARS = 20_000
/** args too — the UI scrolls, it must not be handed cut-off data */
export const ARG_VALUE_CHARS = 20_000
/** "bash: <command>" shown as the event name */
export const LABEL_CHARS = 80

/** The arg that identifies a call at a glance, in the order tools tend to use. */
export const PRIMARY_ARGS = [
  'command',
  'path',
  'file_path',
  'pattern',
  'query',
  'url',
] as const

type TCatalogRow = Readonly<{
  provider: string
  modelId: string
  window: number
}>

/** Parse pi's compact model-list counts (`272K`, `1.0M`). */
const parseCount = (value: string): number => {
  const suffixes: Readonly<Record<string, number>> = { K: 1_000, M: 1_000_000 }
  const suffix = value.slice(-1).toUpperCase()
  const multiplier = suffixes[suffix]
  if (multiplier !== undefined) {
    return Math.round(Number(value.slice(0, -1)) * multiplier)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`not a model count: ${value}`)
  }
  return parsed
}

// Memoised once per process, the way the Python's lru_cache was — `pi
// --list-models` spawns a process and the catalog does not change mid-run.
let catalogCache: readonly TCatalogRow[] | undefined

/** Read pi's merged catalog, including built-in providers and custom models. */
export const piCatalog = (): readonly TCatalogRow[] => {
  if (catalogCache !== undefined) {
    return catalogCache
  }
  const result = spawnSync(piPath(), ['--list-models'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...operatorEnv() },
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    catalogCache = []
    return catalogCache
  }
  catalogCache = result.stdout
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const columns = line.split(/\s+/).filter(Boolean)
      const [provider, modelId, count] = columns
      if (
        provider === undefined ||
        modelId === undefined ||
        count === undefined
      ) {
        return []
      }
      const window = Number.isNaN(Number(count.replace(/[KM]$/i, '')))
        ? undefined
        : parseCount(count)
      return window === undefined ? [] : [{ provider, modelId, window }]
    })
  return catalogCache
}

/**
 * Resolve a model pattern to an explicit `(provider, modelId)` pair.
 *
 * Pi's catalog merges built-in models with `~/.pi/agent/models.json`. Using
 * that same merged view lets pi-crust target direct providers such as
 * `openai/gpt-5.6-terra` without re-registering built-in models locally.
 */
export const resolveModel = (
  pattern: string,
): Readonly<{ provider: string; modelId: string }> => {
  const catalog = piCatalog()
  if (pattern.includes('/')) {
    const slash = pattern.indexOf('/')
    const provider = pattern.slice(0, slash)
    const modelId = pattern.slice(slash + 1)
    if (
      catalog.some(
        (row) => row.provider === provider && row.modelId === modelId,
      )
    ) {
      return { provider, modelId }
    }
  }
  const matches = catalog.filter(
    (row) => row.modelId === pattern || row.modelId.includes(pattern),
  )
  const exact = matches.filter(
    (row) => row.modelId === pattern || row.modelId.endsWith(`/${pattern}`),
  )
  const single = exact.length === 1 ? exact[0] : undefined
  if (single !== undefined) {
    return { provider: single.provider, modelId: single.modelId }
  }
  const only = matches.length === 1 ? matches[0] : undefined
  if (only !== undefined) {
    return { provider: only.provider, modelId: only.modelId }
  }
  if (matches.length === 0) {
    throw new Error(
      `model pattern '${pattern}' not found in pi --list-models — ` +
        'authenticate/register it or fix the config',
    )
  }
  throw new Error(
    `model pattern '${pattern}' is ambiguous: ` +
      matches.map((row) => `${row.provider}/${row.modelId}`).join(', '),
  )
}

type TUsagePayload = Readonly<Record<string, unknown>>

const numberAt = (source: TUsagePayload, key: string): number => {
  const value = source[key]
  return typeof value === 'number' ? value : 0
}

const objectAt = (source: TUsagePayload, key: string): TUsagePayload => {
  const value = source[key]
  return value !== null && typeof value === 'object'
    ? (value as TUsagePayload)
    : {}
}

/**
 * Tokens occupying the window after a turn.
 *
 * Mirrors pi's own `calculateContextTokens` (coding-agent
 * `core/compaction/compaction.ts`), which is what pi compacts against and shows
 * in its footer: prefer the provider's `totalTokens`, else sum the parts. Cache
 * reads count — cached prompt is still prompt.
 */
export const contextTokensOf = (usage: TUsagePayload): number => {
  const total = numberAt(usage, 'totalTokens')
  return total !== 0
    ? total
    : ['input', 'output', 'cacheRead', 'cacheWrite'].reduce(
        (sum, part) => sum + numberAt(usage, part),
        0,
      )
}

/** Fold one pi `message_end` usage object into a running breakdown. */
export const addTurn = (
  breakdown: TUsageBreakdown,
  usage: TUsagePayload,
  totalTokens: number,
): TUsageBreakdown => {
  const cost = objectAt(usage, 'cost')
  return mergeUsage(breakdown, {
    input_tokens: numberAt(usage, 'input'),
    output_tokens: numberAt(usage, 'output'),
    cache_read_tokens: numberAt(usage, 'cacheRead'),
    cache_write_tokens: numberAt(usage, 'cacheWrite'),
    reasoning_tokens: numberAt(usage, 'reasoning'),
    total_tokens: totalTokens,
    input_cost: numberAt(cost, 'input'),
    output_cost: numberAt(cost, 'output'),
    cache_read_cost: numberAt(cost, 'cacheRead'),
    cache_write_cost: numberAt(cost, 'cacheWrite'),
    total_cost: numberAt(cost, 'total'),
  })
}

/** The model's context ceiling from pi's merged model catalog. */
export const contextWindow = (provider: string, modelId: string): number => {
  const fromRegistry = ((): number => {
    // No registry on this machine is normal — the catalog still answers.
    const parsed = settledOr<unknown>(
      safeParseSettlement(() => JSON.parse(readText(modelsJsonPath()))),
      {},
    )
    const providers = objectAt(
      (parsed ?? {}) as TUsagePayload,
      'providers',
    ) as TUsagePayload
    const models = objectAt(providers, provider).models
    if (!Array.isArray(models)) {
      return 0
    }
    const match = models.find(
      (model: unknown) =>
        model !== null &&
        typeof model === 'object' &&
        (model as TUsagePayload).id === modelId,
    )
    return match === undefined
      ? 0
      : numberAt(match as TUsagePayload, 'contextWindow')
  })()
  if (fromRegistry !== 0) {
    return fromRegistry
  }
  const listed = piCatalog().find(
    (row) => row.provider === provider && row.modelId === modelId,
  )
  return listed?.window ?? 0
}

/**
 * Join the text blocks of anything pi shapes as {content: [...]} — a message or
 * a tool result.
 */
export const textOf = (container: TUsagePayload): string => {
  const content = container.content
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .filter(
      (part: unknown) =>
        part !== null &&
        typeof part === 'object' &&
        (part as TUsagePayload).type === 'text',
    )
    .map((part: unknown) => {
      const text = (part as TUsagePayload).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

const clipTo = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`

/** One-line human name for a tool call: `bash: ls -la src`. */
export const toolLabel = (tool: string, args: TUsagePayload): string => {
  const primary = PRIMARY_ARGS.map((key) => args[key]).find(
    (value): value is string =>
      typeof value === 'string' && value.trim() !== '',
  )
  const fallback = Object.values(args).find(
    (value): value is string =>
      typeof value === 'string' && value.trim() !== '',
  )
  const chosen = (primary ?? fallback ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
  return chosen ? `${tool}: ${clipTo(chosen, LABEL_CHARS)}` : tool
}

type TOpenCall = {
  tool: string
  args: TUsagePayload
  startedAt: string
  clock: number
}

/**
 * Folds pi's tool stream into ONE normalized record per completed call.
 *
 * pi announces a call as a `toolCall` content block, then emits
 * tool_execution_start / _update / _end for it. Only the end carries the
 * result, so that is where a record is emitted — one trace event per real tool
 * call, the moment it returns, instead of three shapeless ones.
 *
 * The record carries the call's real span (`started_at`/`ended_at`), which the
 * tracer writes to columns so the UI can lay tool calls on a time axis without
 * parsing every payload.
 */
export const createToolCallTracker = (): Readonly<{
  observe: (event: TUsagePayload) => TToolCallRecord | undefined
}> => {
  const open = new Map<string, TOpenCall>()

  /** First sighting starts the clock; a later sighting only fills gaps. */
  const announce = (callId: unknown, tool: unknown, args: unknown): void => {
    if (callId === undefined || callId === null || callId === '') {
      return
    }
    const key = String(callId)
    const known = open.get(key)
    open.set(key, {
      tool: (typeof tool === 'string' ? tool : '') || (known?.tool ?? ''),
      args:
        args !== null && typeof args === 'object'
          ? (args as TUsagePayload)
          : (known?.args ?? {}),
      // wall clock, for the row; monotonic, for the duration
      startedAt: known?.startedAt ?? nowIso(),
      clock: known?.clock ?? monotonicMs(),
    })
  }

  return {
    observe: (event) => {
      const eventType = event.type
      if (eventType === 'message_end') {
        const message = objectAt(event, 'message')
        const content = message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block !== null &&
              typeof block === 'object' &&
              (block as TUsagePayload).type === 'toolCall'
            ) {
              const typed = block as TUsagePayload
              announce(typed.id, typed.name, typed.arguments)
            }
          }
        }
        return undefined
      }
      if (eventType === 'tool_execution_start') {
        announce(event.toolCallId, event.toolName, event.args)
        return undefined
      }
      if (eventType !== 'tool_execution_end') {
        return undefined
      }

      const callId = String(event.toolCallId ?? '')
      const opened = open.get(callId)
      open.delete(callId)
      const tool = String(event.toolName ?? opened?.tool ?? 'tool')
      const args =
        event.args !== null && typeof event.args === 'object'
          ? (event.args as TUsagePayload)
          : (opened?.args ?? {})
      const resultText = textOf(objectAt(event, 'result'))
      return {
        tool,
        tool_call_id: callId,
        args: Object.fromEntries(
          Object.entries(args).map(([key, value]) => [
            key,
            typeof value === 'string' ? clipTo(value, ARG_VALUE_CHARS) : value,
          ]),
        ),
        ok: event.isError !== true,
        label: toolLabel(tool, args),
        ...(resultText
          ? { result_snippet: clipTo(resultText, RESULT_SNIPPET_CHARS) }
          : {}),
        started_at: opened?.startedAt,
        ended_at: nowIso(),
        duration_ms:
          opened === undefined
            ? undefined
            : Math.round(monotonicMs() - opened.clock),
      }
    },
  }
}

/* ───────────────────────────── narration ───────────────────────────── */

export type TNarrationRecord = Readonly<{
  /** Monotonic within a phase: the nth model turn. Joins narration to calls. */
  turn: number
  /** 'thinking' is reasoning; 'text' is what the agent chose to say. */
  channel: 'thinking' | 'text'
  text: string
  started_at: string
  ended_at: string
}>

/** A phase's narration is bounded: a long build must not blow up the trace. */
export const NARRATION_CHARS = 4000

/**
 * Folds pi's token stream into one record per turn, per channel.
 *
 * pi streams reasoning and prose a few characters at a time. Tracing each
 * delta would write thousands of rows per phase for text nobody reads
 * incrementally, so deltas accumulate and flush at the turn boundary — which
 * is exactly the unit the reader cares about: the agent thought, then it
 * acted.
 *
 * The turn number is the whole point. It is also stamped on tool calls, so a
 * UI can show which calls a given passage of thinking produced without
 * guessing from timestamps — two agents' events interleave, and adjacency in
 * time is not causation.
 *
 * The full text always lands in raw_output.jsonl regardless; what is clipped
 * here is only what the database keeps.
 */
/**
 * The text carried by a delta event.
 *
 * Harnesses spell a delta three ways — a bare string, `{ text }`, or a content
 * array — and which one arrives depends on the provider rather than on
 * anything this code controls. All three are read, because a narration pane
 * that works for one provider and silently shows nothing for another is worse
 * than one that does not exist.
 */
export const deltaText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(deltaText).join('')
  if (typeof value === 'object') {
    const text = (value as TUsagePayload).text
    if (typeof text === 'string') return text
    const content = (value as TUsagePayload).content
    if (content !== undefined) return deltaText(content)
  }
  return ''
}

export const createNarrationTracker = (): Readonly<{
  observe: (event: TUsagePayload) => TNarrationRecord | undefined
  /** The turn a tool call belongs to — the one that asked for it. */
  turn: () => number
  /** Anything still accumulating when the agent exits. */
  flush: () => TNarrationRecord | undefined
}> => {
  let turn = 1
  let channel: 'thinking' | 'text' = 'text'
  let buffer = ''
  let startedAt = ''
  /*
   * Whether this harness announces turns itself.
   *
   * It matters because `message_end` is NOT a turn boundary: pi closes the
   * assistant message, then executes the tools that message asked for. Ending
   * the turn there stamped the calls with the turn AFTER the reasoning that
   * caused them — the first live run produced narration on turns 3, 5, 7 and
   * tool calls on 4, 6, 8, so the two columns could never be joined and the
   * whole point of the turn id was lost.
   *
   * `turn_start` is the real boundary and is used when offered. `message_end`
   * stays as the fallback for a harness that emits no turn events at all.
   */
  let harnessMarksTurns = false

  const record = (text: string): TNarrationRecord | undefined => {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    return {
      turn,
      channel,
      text: clipTo(trimmed, NARRATION_CHARS),
      started_at: startedAt || nowIso(),
      ended_at: nowIso(),
    }
  }

  const take = (): TNarrationRecord | undefined => {
    const pending = buffer
    buffer = ''
    return record(pending)
  }

  const append = (
    next: 'thinking' | 'text',
    text: string,
  ): TNarrationRecord | undefined => {
    if (text === '') return undefined
    // A channel switch ends the passage: reasoning and prose are read apart.
    const flushed = next === channel ? undefined : take()
    channel = next
    if (startedAt === '' || flushed !== undefined) startedAt = nowIso()
    buffer += text
    return flushed
  }

  /**
   * A completed passage, as the harness itself reassembled it.
   *
   * `thinking_end` and `text_end` carry the whole content, which is
   * authoritative — so the accumulated deltas for that passage are DROPPED
   * rather than emitted as well. Keeping both would double every sentence.
   */
  const complete = (
    next: 'thinking' | 'text',
    text: string,
  ): TNarrationRecord | undefined => {
    channel = next
    buffer = ''
    const emitted = record(text)
    startedAt = ''
    return emitted
  }

  return {
    turn: () => turn,
    flush: take,
    observe: (event) => {
      /*
       * pi wraps the token stream: the envelope is `message_update` and the
       * interesting event is inside `assistantMessageEvent`. Reading only the
       * outer `type` finds no narration at all and says nothing about it,
       * which is how the first real run traced six tool calls and not one word
       * of the reasoning that produced them.
       */
      const inner = objectAt(event, 'assistantMessageEvent')
      const payload = inner.type === undefined ? event : inner
      const type = payload.type

      if (type === 'thinking_end') {
        return complete('thinking', deltaText(payload.content))
      }
      if (type === 'text_end') {
        return complete('text', deltaText(payload.content))
      }
      // Deltas are the fallback: a harness that streams without ever closing a
      // passage still gets its narration, flushed at the turn boundary.
      if (type === 'text_delta' || type === 'assistant_delta') {
        return append('text', deltaText(payload.delta ?? payload.text))
      }
      if (type === 'thinking_delta' || type === 'reasoning_delta') {
        return append('thinking', deltaText(payload.delta ?? payload.text))
      }
      if (event.type === 'turn_start') {
        // The first turn_start opens turn 1, which is already open.
        const closed = take()
        if (harnessMarksTurns) turn += 1
        harnessMarksTurns = true
        startedAt = ''
        return closed
      }
      if (event.type === 'message_end') {
        const closed = take()
        if (!harnessMarksTurns) {
          turn += 1
        }
        startedAt = ''
        return closed
      }
      return undefined
    },
  }
}

/**
 * What a caller may do to a run that is already in flight.
 *
 * `steer` lands after the current assistant turn finishes its tool calls and
 * before the next LLM call — the agent reads it in context, mid-task, which is
 * the difference between steering and starting over. `followUp` waits until
 * the agent has stopped. `abort` stops the active operation.
 *
 * All three are no-ops once the process has gone, rather than throwing: a
 * person clicking "steer" a moment after a phase finished has made a timing
 * mistake, not an error worth failing a run over.
 */
export type TPiControl = Readonly<{
  steer: (message: string) => void
  followUp: (message: string) => void
  abort: () => void
}>

export type TPiHooks = Readonly<{
  onEvent?: (event: TUsagePayload) => void
  onSpawn?: (pid: number) => void
  onExit?: (pid: number) => void
  /** Handed the control surface once the agent is live and can be reached. */
  onControl?: (control: TPiControl) => void
}>

export type TStreamState = Readonly<{
  text: string
  tokens: number
  cost: number
  usage: TUsageBreakdown
  contextTokens: number
}>

export const EMPTY_STREAM_STATE: TStreamState = {
  text: '',
  tokens: 0,
  cost: 0,
  usage: emptyUsage,
  contextTokens: 0,
}

/** Fold one `message_end` event into the running result for a pi turn. */
export const foldMessageEnd = (
  state: TStreamState,
  event: TUsagePayload,
): TStreamState => {
  const message = objectAt(event, 'message')
  if (message.role !== 'assistant') {
    return state
  }
  const text = textOf(message)
  const usage = objectAt(message, 'usage')
  const turn = contextTokensOf(usage)
  const stopReason = message.stopReason
  return {
    // last assistant message wins
    text: text || state.text,
    tokens: state.tokens + turn,
    cost: state.cost + numberAt(objectAt(usage, 'cost'), 'total'),
    usage: addTurn(state.usage, usage, turn),
    // Occupancy is read off the last VALID assistant turn, the way pi does it
    // — an aborted or errored turn reports usage you can't trust, so it must
    // not overwrite a good reading.
    contextTokens:
      turn !== 0 && stopReason !== 'aborted' && stopReason !== 'error'
        ? turn
        : state.contextTokens,
  }
}

const parseJsonLine = (line: string): TUsagePayload | undefined => {
  // An unparseable line is skipped, never fatal — pi may print diagnostics.
  const settled = safeParseSettlement<unknown>(() => JSON.parse(line))
  const parsed = settledOr<unknown>(settled, undefined)
  return parsed !== null && typeof parsed === 'object'
    ? (parsed as TUsagePayload)
    : undefined
}

/**
 * The exact argv one pi turn is spawned with.
 *
 * Extracted so it can be asserted without spawning anything: `--skill` is how a
 * repository's own conventions reach an agent, and whether one was actually
 * passed is otherwise invisible until the model's output disappoints.
 *
 * Three things are load-bearing by ABSENCE, which is why they are named here
 * and asserted in the tests rather than left to be rediscovered:
 *
 *   - `-nc` is never passed, so `AGENTS.md` and `CLAUDE.md` are discovered.
 *   - `-ns` is never passed, so every skill this repository configures stays
 *     reachable. `--skill` only PRE-LOADS; it cannot subtract.
 *   - `--append-system-prompt` rather than `--system-prompt`, so an agent keeps
 *     pi's own system prompt and adds its role to it. Replacing it removed the
 *     part that teaches an agent to reach for a skill at all, and no amount of
 *     role description puts that back.
 *
 * An agent therefore starts a phase on the same footing as a developer opening
 * a session in this repository, which is the only baseline worth having.
 */
export const buildArgv = (
  request: TPiRequest,
  resolved: Readonly<{ provider: string; modelId: string }>,
  piBinary: string,
): readonly string[] => [
  piBinary,
  /*
   * RPC, not print. The two differ in one way that matters: RPC keeps stdin
   * open as a command channel for the life of the process, which is the only
   * way to reach a model mid-run. `steer` is delivered after the current
   * assistant turn finishes its tool calls and before the next LLM call —
   * pi's own semantics, not something invented here.
   *
   * The event stream on stdout is the same one print mode emits, so every
   * tracker in this file reads it unchanged.
   */
  '--mode',
  'rpc',
  '--provider',
  resolved.provider,
  '--model',
  resolved.modelId,
  '--thinking',
  request.thinking,
  '--session-id',
  request.sessionId,
  '--session-dir',
  request.sessionDir,
  '--append-system-prompt',
  request.systemPrompt,
  ...(request.tools && request.tools.length > 0
    ? ['--tools', request.tools.join(',')]
    : []),
  ...request.extensions.flatMap((extension) => ['-e', extension]),
  // A repository's own conventions, routed by changed path from
  // `routing.skills`. Never a literal path in this module.
  ...request.skills.flatMap((skill) => ['--skill', skill]),
]

/**
 * Run one non-interactive pi turn.
 *
 * `onSpawn(pid)` and `onExit(pid)` bracket the child process so the caller can
 * record it as killable — a hung coding agent is otherwise a pid you have to
 * hunt for in `ps` while the run sits there.
 */
export const run = async (
  request: TPiRequest,
  hooks: TPiHooks = {},
): Promise<TPiResult> => {
  const resolved = resolveModel(request.model)
  const cmd = [...buildArgv(request, resolved, piPath())]

  ensureDir(dirname(request.rawOutputPath))
  const window = contextWindow(resolved.provider, resolved.modelId)

  // stdin is ignored, deliberately. The prompt travels in argv, so the child
  // never needs stdin — but inheriting the parent's means pi sees a non-TTY and
  // can sit forever waiting for piped input that will never arrive or EOF. That
  // failure is silent and total: no request goes out, no bytes come back, and
  // the workflow blocks on a read loop with nothing to read. Observed as a run
  // that sat idle at 0% CPU with an empty raw_output.jsonl.
  /*
   * stdin is a COMMAND CHANNEL now, not an input stream.
   *
   * It used to be `'ignore'`, because print mode reads the prompt from argv
   * and an inherited stdin made pi wait forever for piped input that never
   * came. RPC mode is the opposite: the prompt arrives as a command on stdin,
   * and the channel stays open so `steer`, `follow_up` and `abort` can reach a
   * run that is already working. Closing it is how a shutdown is requested.
   */
  const child = Bun.spawn({
    cmd,
    cwd: request.cwd,
    env: { ...operatorEnv() },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  hooks.onSpawn?.(child.pid)

  let open = true
  const send = (command: Readonly<Record<string, unknown>>): void => {
    if (!open) return
    /*
     * A write to a child that has already exited is the expected race, not an
     * error to propagate into a run that has otherwise finished its work.
     */
    // biome-ignore lint/plugin: this layer owns the boundary
    try {
      child.stdin.write(`${JSON.stringify(command)}\n`)
      child.stdin.flush()
    } catch (cause) {
      /*
       * The child went away between the check and the write. A steering
       * message with nobody left to read it is a timing accident, not a
       * failure of the run, so the channel is marked closed and the run's own
       * exit code remains the record of what happened.
       */
      void cause
      open = false
    }
  }

  send({ id: 'prompt-1', type: 'prompt', message: request.prompt })
  hooks.onControl?.({
    steer: (message) => send({ type: 'steer', message }),
    followUp: (message) => send({ type: 'follow_up', message }),
    abort: () => send({ type: 'abort' }),
  })

  const decoder = new TextDecoder()
  const consume = (state: TStreamState, rawLine: string): TStreamState => {
    // Events land on disk as they happen, before parsing — a hung agent's
    // partial stream is still readable from raw_output.jsonl.
    appendText(request.rawOutputPath, `${rawLine}\n`)
    const line = rawLine.trim()
    if (!line) {
      return state
    }
    const event = parseJsonLine(line)
    if (event === undefined) {
      return state
    }
    const next =
      event.type === 'message_end' ? foldMessageEnd(state, event) : state
    /*
     * `agent_settled` is the only honest finish line. `agent_end` closes one
     * low-level run, but retries, compaction, steering and follow-ups can all
     * produce more work after it — treating it as the end would cut a steered
     * turn off mid-thought.
     *
     * Closing stdin is how RPC mode is asked to shut down; pi disposes its
     * runtime and exits, which ends the read loop below.
     */
    if (event.type === 'agent_settled' && open) {
      open = false
      /* The child may already have gone; its exit code is the record. */
      // biome-ignore lint/plugin: this layer owns the boundary
      try {
        child.stdin.end()
      } catch (cause) {
        void cause
      }
    }
    hooks.onEvent?.(event)
    return next
  }

  const initial: TStreamState = EMPTY_STREAM_STATE

  const reader = child.stdout.getReader()
  const drain = async (
    state: TStreamState,
    buffered: string,
  ): Promise<TStreamState> => {
    const { done, value } = await reader.read()
    if (done) {
      return buffered ? consume(state, buffered) : state
    }
    const chunk = buffered + decoder.decode(value, { stream: true })
    const parts = chunk.split('\n')
    // The last piece is whatever follows the final newline — a partial line
    // that the next chunk completes, so it is carried rather than consumed.
    const complete = parts.slice(0, -1)
    const remainder = parts.at(-1) ?? ''
    return drain(complete.reduce(consume, state), remainder)
  }
  const drained = await drain(initial, '')

  const stderr = await new Response(child.stderr).text()
  const returncode = await child.exited
  hooks.onExit?.(child.pid)

  if (returncode !== 0 && !drained.text) {
    throw new Error(`pi exited ${returncode}: ${stderr.trim().slice(-800)}`)
  }

  return {
    text: drained.text,
    returncode,
    sessionId: request.sessionId,
    tokens: drained.tokens,
    cost: drained.cost,
    usage: drained.usage,
    contextTokens: drained.contextTokens,
    contextWindow: window,
  }
}
