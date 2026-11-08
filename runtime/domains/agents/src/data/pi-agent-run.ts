/**
 * Excluded from coverage: spawns the `pi` binary and folds its live stdout
 * stream. No `bun test` process can exercise a real child process reading a
 * real model's output, so this module holds only that boundary — `run` moved
 * here from `pi-agent.ts`, unchanged, so the decision logic it calls
 * (argv construction, model resolution, usage folding) stays covered there.
 */

import { dirname } from 'node:path'
import { appendText, ensureDir, operatorEnv } from '../../../../lib/system'
import type { TPiRequest, TPiResult } from '../typedefs/pi'
import type { TStreamState } from './pi-agent'
import {
  buildArgv,
  contextWindow,
  EMPTY_STREAM_STATE,
  foldMessageEnd,
  parseJsonLine,
  piPath,
  resolveModel,
} from './pi-agent'

/**
 * What a caller may do to a run that is already in flight.
 *
 * `steer` lands after the current assistant turn finishes its tool calls and
 * before the next LLM call — the agent reads it in context, mid-task, which is
 * the difference between steering and starting over. `followUp` waits until
 * the agent has stopped. `abort` stops the active operation.
 *
 * All three are no-ops once the process has gone, rather than throwing: a
 * person clicking "steer" a moment after an activity run finished has made a timing
 * mistake, not an error worth failing a run over.
 */
export type TPiControl = Readonly<{
  steer: (message: string) => void
  followUp: (message: string) => void
  abort: () => void
}>

export type TPiHooks = Readonly<{
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
  onSpawn?: (pid: number) => void
  onExit?: (pid: number) => void
  /** Handed the control surface once the agent is live and can be reached. */
  onControl?: (control: TPiControl) => void
}>

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
    // The operator's own environment, plus whatever this call adds to it:
    // an extension is loaded by path and takes no arguments, so a per-run
    // policy reaches it as a variable naming a file.
    env: { ...operatorEnv(), ...(request.env ?? {}) },
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
