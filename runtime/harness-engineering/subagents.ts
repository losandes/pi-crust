/**
 * Subagent Widget — /sub, /subclear, /subrm, /subcont commands with stacking live widgets
 *
 * Each /sub spawns a background Pi subagent with its own persistent session,
 * enabling conversation continuations via /subcont.
 *
 * Usage: pi -e extensions/subagent-widget.ts
 * Then:
 *   /sub list files and summarize          — spawn using the parent model/thinking
 *   /sub --model openai/gpt-5 --thinking high review this code
 *   /subcont 1 --thinking xhigh now write tests for it
 *   /subrm 2                               — remove subagent #2 widget
 *   /subclear                              — clear all subagent widgets
 *
 * No Activity in the shipped configuration loads this file. It is an
 * interactive-pi extension, reached with `pi -e`. Loading it from a batch
 * Activity produces child agents whose work is untraced and whose results
 * never reach the parent: the only delivery path is
 * `pi.sendMessage(..., { deliverAs: 'followUp' })`, which pi queues until
 * after the current turn ends, so an agent polling mid-turn cannot see it.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { type ModelThinkingLevel, StringEnum } from '@earendil-works/pi-ai'
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from '@earendil-works/pi-coding-agent'
import { DynamicBorder } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { Container, Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { safeParseSettlement } from '../../lib/typedefs/src/settlement'
import { applyExtensionDefaults } from './theme-map'

/*
 * The host's own types, not local approximations of them.
 *
 * This file used to declare its own `TPiCtx`, `TTheme`, `TTui` and `TChild`,
 * with `require('node:child_process')` to sidestep the module system, on the
 * grounds that pi supplies these at run time and the repository cannot
 * resolve them. It supplies them at run time either way; what the local
 * shapes bought was that nothing ever compared them with the real thing, and
 * they had drifted — `theme.fg` was `unknown`, `ctx.model` did not exist on
 * the context at all, and `ThinkingLevel` was the one union that excludes
 * `off` while the host hands back the one that includes it.
 *
 * `scripts/typecheck-harness.ts` checks this file against the pi actually
 * installed on the machine, so these imports are typechecked without being
 * dependencies of this repository.
 */

const FALLBACK_MODEL = 'openrouter/google/gemini-3.5-flash'
const THINKING_OVERRIDES = ['low', 'medium', 'high', 'xhigh'] as const
type ThinkingOverride = (typeof THINKING_OVERRIDES)[number]

interface SpawnOptions {
  model?: string | undefined
  thinking?: ThinkingOverride | undefined
}

/**
 * A tool result carrying nothing but text.
 *
 * The host's `AgentToolResult` requires `details`, and none of these tools
 * has structured detail to report. Said once here rather than eight times
 * inline.
 */
const textResult = (text: string): AgentToolResult<undefined> => ({
  content: [{ type: 'text', text }],
  details: undefined,
})

/**
 * One subagent, as a value.
 *
 * Every field is readonly and a change produces a new record in the map,
 * so nothing holding a reference can observe a half-applied update. The
 * corollary is that a reference goes stale the moment anything changes it:
 * read through `agents.get(id)` at the point of use, never from a binding
 * captured earlier.
 */
interface SubState {
  readonly id: number
  readonly status: 'running' | 'done' | 'error'
  readonly task: string
  /**
   * Everything the agent has emitted, as text.
   *
   * It was an array of chunks that existed only to be joined; appending to
   * a string is the same answer without the mutation, and without copying
   * the whole array on every streamed delta.
   */
  readonly text: string
  readonly toolCount: number
  readonly elapsed: number
  readonly sessionFile: string // persistent JSONL session path — used by /subcont to resume
  readonly turnCount: number // increments each time /subcont continues this agent
  readonly model: string
  // The host's level, which includes `off`. `exactOptionalPropertyTypes`
  // wants the `undefined` spelled out on an optional it is assigned.
  readonly thinking: ModelThinkingLevel
  readonly proc?: ChildProcess | undefined // active child ref (for kill on /subrm)
}

interface ParsedCommand {
  options: SpawnOptions
  rest: string
  error?: string
}

function readCommandValue(input: string): { value?: string; rest: string } {
  const trimmed = input.trimStart()
  if (!trimmed) return { rest: '' }

  const quote = trimmed[0]
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1)
    if (end === -1) return { rest: trimmed }
    return { value: trimmed.slice(1, end), rest: trimmed.slice(end + 1) }
  }

  const end = trimmed.search(/\s/)
  return end === -1
    ? { value: trimmed, rest: '' }
    : { value: trimmed.slice(0, end), rest: trimmed.slice(end) }
}

/**
 * One flag at a time, each step returning the options it has so far.
 *
 * The loop this replaces assigned into one options object as it went; the
 * recursion carries the options forward instead, so a parse that fails
 * half-way reports exactly what it had read, as it always did.
 */
function parseCommandOptions(input: string): ParsedCommand {
  const step = (options: SpawnOptions, input: string): ParsedCommand => {
    if (!input.startsWith('--')) return { options, rest: input.trim() }

    const flagMatch = input.match(/^--(model|thinking)(?:=([^\s]+))?(?:\s+|$)/)
    if (!flagMatch) {
      const flag = input.match(/^\S+/)?.[0] || input
      return {
        options,
        rest: '',
        error: `Unknown or malformed option: ${flag}`,
      }
    }

    const flag = flagMatch[1]
    const afterFlag = input.slice(flagMatch[0].length)
    // `--model=x` carries its value; `--model x` is the next token.
    const read = flagMatch[2]
      ? { value: flagMatch[2], rest: afterFlag }
      : readCommandValue(afterFlag)
    const value = read.value
    if (!value)
      return { options, rest: '', error: `Missing value for --${flag}` }

    if (flag === 'model') {
      return step({ ...options, model: value }, read.rest.trimStart())
    }

    const thinking = value.toLowerCase()
    if (!THINKING_OVERRIDES.includes(thinking as ThinkingOverride)) {
      return {
        options,
        rest: '',
        error: 'Thinking must be one of: low, medium, high, xhigh',
      }
    }
    return step(
      { ...options, thinking: thinking as ThinkingOverride },
      read.rest.trimStart(),
    )
  }

  return step({}, input.trimStart())
}

export default function (pi: ExtensionAPI) {
  const agents: Map<number, SubState> = new Map()
  let nextId = 1
  let widgetCtx: ExtensionContext | undefined

  // ── Session file helpers ──────────────────────────────────────────────────

  function makeSessionFile(id: number): string {
    const dir = path.join(os.homedir(), '.pi', 'agent', 'sessions', 'subagents')
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, `subagent-${id}-${Date.now()}.jsonl`)
  }

  /**
   * The next value of a subagent, in the map.
   *
   * Returns it, because the caller usually needs what it just wrote and the
   * binding it held is now the previous value. Unknown id writes nothing,
   * which is what every `agents.get(...)` guard already assumed.
   */
  function patch(id: number, change: Partial<SubState>): SubState | undefined {
    const previous = agents.get(id)
    if (previous === undefined) return undefined
    const next: SubState = { ...previous, ...change }
    agents.set(id, next)
    return next
  }

  // ── Widget rendering ──────────────────────────────────────────────────────

  function updateWidgets() {
    if (!widgetCtx) return

    for (const id of Array.from(agents.keys())) {
      const key = `sub-${id}`
      widgetCtx?.ui.setWidget(key, (_tui: TUI, theme: Theme) => {
        const container = new Container()
        const borderFn = (s: string) => theme.fg('dim', s)

        container.addChild(new Text('', 0, 0)) // top margin
        container.addChild(new DynamicBorder(borderFn))
        const content = new Text('', 1, 0)
        container.addChild(content)
        container.addChild(new DynamicBorder(borderFn))

        return {
          render(width: number): string[] {
            // Read at render time: the record is replaced on every change,
            // so a reference captured when the widget was registered would
            // paint the agent as it was then.
            const state = agents.get(id)
            if (state === undefined) return container.render(width)

            const statusColor =
              state.status === 'running'
                ? 'accent'
                : state.status === 'done'
                  ? 'success'
                  : 'error'
            const statusIcon =
              state.status === 'running'
                ? '●'
                : state.status === 'done'
                  ? '✓'
                  : '✗'

            const taskPreview =
              state.task.length > 40
                ? `${state.task.slice(0, 37)}...`
                : state.task

            const turnLabel =
              state.turnCount > 1
                ? theme.fg('dim', ` · Turn ${state.turnCount}`)
                : ''

            const header =
              theme.fg(statusColor, `${statusIcon} Subagent #${state.id}`) +
              turnLabel +
              theme.fg('dim', `  ${taskPreview}`) +
              theme.fg('dim', `  (${Math.round(state.elapsed / 1000)}s)`) +
              theme.fg('dim', ` | Tools: ${state.toolCount}`)

            const lastLine =
              state.text
                .split('\n')
                .filter((l: string) => l.trim())
                .at(-1) || ''
            const trimmed =
              lastLine.length > width - 10
                ? `${lastLine.slice(0, width - 13)}...`
                : lastLine
            const lines = lastLine
              ? [header, theme.fg('muted', `  ${trimmed}`)]
              : [header]

            content.setText(lines.join('\n'))
            return container.render(width)
          },
          invalidate() {
            container.invalidate()
          },
        }
      })
    }
  }

  // ── Streaming helpers ─────────────────────────────────────────────────────

  /** One line of the child's JSON stream, applied to the agent it belongs to. */
  function processLine(id: number, line: string) {
    if (!line.trim()) return
    // A torn or non-JSON line is skipped, which is what the empty catch did.
    const settled = safeParseSettlement(
      () =>
        JSON.parse(line) as {
          type?: string
          assistantMessageEvent?: { type?: string; delta?: string }
        },
    )
    if (settled.status === 'error') return
    const event = settled.data
    const current = agents.get(id)
    if (current === undefined) return

    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent
      if (delta?.type === 'text_delta') {
        patch(id, { text: current.text + (delta.delta || '') })
        updateWidgets()
      }
      return
    }

    if (event.type === 'tool_execution_start') {
      patch(id, { toolCount: current.toolCount + 1 })
      updateWidgets()
    }
  }

  function spawnAgent(
    id: number,
    prompt: string,
    ctx: ExtensionContext,
    options: SpawnOptions = {},
  ): Promise<void> {
    const parentProvider = ctx.model?.provider?.trim()
    const parentModelId = ctx.model?.id?.trim()
    const hasParentModel =
      parentProvider &&
      parentModelId &&
      parentProvider !== 'unknown' &&
      parentModelId !== 'unknown'
    const parentModel = hasParentModel
      ? `${parentProvider}/${parentModelId}`
      : FALLBACK_MODEL
    const model = options.model?.trim() || parentModel
    const thinking = options.thinking || pi.getThinkingLevel()
    const started = patch(id, { model, thinking })
    if (started === undefined) return Promise.resolve()

    return new Promise<void>((resolve) => {
      const proc = spawn(
        'pi',
        [
          '--mode',
          'json',
          '-p',
          '--session',
          started.sessionFile, // persistent session for /subcont resumption
          '--no-extensions',
          '--model',
          model,
          '--tools',
          'read,bash,grep,find,ls',
          '--thinking',
          thinking,
          prompt,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        },
      )

      patch(id, { proc })

      const startTime = Date.now()
      const timer = setInterval(() => {
        patch(id, { elapsed: Date.now() - startTime })
        updateWidgets()
      }, 1000)

      let buffer = ''

      // Guarded rather than asserted: a spawn that failed has no streams,
      // and asserting here turns that into a crash inside a callback.
      proc.stdout?.setEncoding('utf-8')
      proc.stdout?.on('data', (chunk: string) => {
        const pending = buffer + chunk
        const lines = pending.split('\n')
        // The last element is whatever follows the final newline, which is
        // the start of a line the next chunk finishes.
        buffer = lines.at(-1) ?? ''
        for (const line of lines.slice(0, -1)) processLine(id, line)
      })

      proc.stderr?.setEncoding('utf-8')
      proc.stderr?.on('data', (chunk: string) => {
        const current = agents.get(id)
        if (chunk.trim() && current !== undefined) {
          patch(id, { text: current.text + chunk })
          updateWidgets()
        }
      })

      proc.on('close', (code) => {
        if (buffer.trim()) processLine(id, buffer)
        clearInterval(timer)
        const finished = patch(id, {
          elapsed: Date.now() - startTime,
          status: code === 0 ? 'done' : 'error',
          proc: undefined,
        })
        updateWidgets()
        if (finished === undefined) {
          resolve()
          return
        }

        const result = finished.text
        // The host's notify takes info | warning | error; there is no
        // success tier to report a finished agent with.
        ctx.ui.notify(
          `Subagent #${finished.id} ${finished.status} in ${Math.round(finished.elapsed / 1000)}s`,
          finished.status === 'done' ? 'info' : 'error',
        )

        pi.sendMessage(
          {
            customType: 'subagent-result',
            content: `Subagent #${finished.id}${finished.turnCount > 1 ? ` (Turn ${finished.turnCount})` : ''} finished "${prompt}" in ${Math.round(finished.elapsed / 1000)}s.\n\nResult:\n${result.slice(0, 8000)}${result.length > 8000 ? '\n\n... [truncated]' : ''}`,
            display: true,
          },
          { deliverAs: 'followUp', triggerTurn: true },
        )

        resolve()
      })

      proc.on('error', (err) => {
        clearInterval(timer)
        const current = agents.get(id)
        patch(id, {
          status: 'error',
          proc: undefined,
          text: `${current?.text ?? ''}Error: ${err.message}`,
        })
        updateWidgets()
        resolve()
      })
    })
  }

  // ── Tools for the Main Agent ──────────────────────────────────────────────

  pi.registerTool({
    name: 'subagent_create',
    label: 'Subagent',
    description:
      'Spawn a background subagent. Thinking level is required and is the primary way to match the subagent to task complexity: low for lightweight/simple tasks, medium for routine tasks needing moderate reasoning, high for complex multi-step work, and xhigh for the hardest tasks or when accuracy and performance are critical. Unless the user explicitly requests a specific model, omit model and use the default inherited parent model. Returns immediately and delivers results as a follow-up message.',
    parameters: Type.Object({
      task: Type.String({
        description:
          'The complete task description for the subagent to perform',
      }),
      model: Type.Optional(
        Type.String({
          description:
            "Leave blank or omit unless the user explicitly requests a specific model. Do not choose a different model autonomously. When explicitly requested, provide the override in provider/model form. The default reuses the parent caller's current model and falls back to openrouter/google/gemini-3.5-flash only if the parent has no model.",
        }),
      ),
      thinking: StringEnum([...THINKING_OVERRIDES], {
        description:
          "Required thinking level. Use low for lightweight/simple tasks; medium for routine tasks needing moderate reasoning; high for complex, multi-step, or ambiguous work; and xhigh for the hardest tasks or when accuracy and performance are critical. Pi may clamp the value to the selected model's supported maximum.",
      }),
    }),
    // biome-ignore lint/suspicious/useAwait: pi's tool API requires an async execute
    execute: async (_callId, args, _signal, _onUpdate, ctx) => {
      widgetCtx = ctx
      const id = nextId++
      agents.set(id, {
        id,
        status: 'running',
        task: args.task,
        text: '',
        toolCount: 0,
        elapsed: 0,
        sessionFile: makeSessionFile(id),
        turnCount: 1,
        model: '',
        thinking: pi.getThinkingLevel(),
      })
      updateWidgets()

      // Fire-and-forget
      spawnAgent(id, args.task, ctx, {
        model: args.model,
        thinking: args.thinking,
      })

      // Read back: spawnAgent resolved the model and thinking level before
      // it returned, into a record this scope does not hold.
      const spawned = agents.get(id)
      return textResult(
        `Subagent #${id} spawned with ${spawned?.model ?? ''} (${spawned?.thinking ?? ''} thinking) and is running in background.`,
      )
    },
  })

  pi.registerTool({
    name: 'subagent_continue',
    label: 'Subagent continue',
    description:
      'Continue an existing subagent conversation. Thinking level is required and is the primary way to match this turn to task complexity: low for lightweight/simple tasks, medium for routine tasks needing moderate reasoning, high for complex multi-step work, and xhigh for the hardest tasks or when accuracy and performance are critical. Unless the user explicitly requests a specific model, omit model and use the default inherited parent model. Returns immediately while it runs in the background.',
    parameters: Type.Object({
      id: Type.Number({ description: 'The ID of the subagent to continue' }),
      prompt: Type.String({
        description: 'The follow-up prompt or new instructions',
      }),
      model: Type.Optional(
        Type.String({
          description:
            "Leave blank or omit unless the user explicitly requests a specific model. Do not choose a different model autonomously. When explicitly requested, provide the override in provider/model form for this turn. The default reuses the parent caller's current model.",
        }),
      ),
      thinking: StringEnum([...THINKING_OVERRIDES], {
        description:
          "Required thinking level for this turn. Use low for lightweight/simple tasks; medium for routine tasks needing moderate reasoning; high for complex, multi-step, or ambiguous work; and xhigh for the hardest tasks or when accuracy and performance are critical. Pi may clamp the value to the selected model's supported maximum.",
      }),
    }),
    // biome-ignore lint/suspicious/useAwait: pi's tool API requires an async execute
    execute: async (_callId, args, _signal, _onUpdate, ctx) => {
      widgetCtx = ctx
      const state = agents.get(args.id)
      if (!state) {
        return textResult(`Error: No subagent #${args.id} found.`)
      }
      if (state.status === 'running') {
        return textResult(`Error: Subagent #${args.id} is still running.`)
      }

      const resumed = patch(args.id, {
        status: 'running',
        task: args.prompt,
        text: '',
        elapsed: 0,
        turnCount: state.turnCount + 1,
      })
      updateWidgets()

      ctx.ui.notify(
        `Continuing Subagent #${args.id} (Turn ${resumed?.turnCount ?? state.turnCount})…`,
        'info',
      )
      spawnAgent(args.id, args.prompt, ctx, {
        model: args.model,
        thinking: args.thinking,
      })

      const running = agents.get(args.id)
      return textResult(
        `Subagent #${args.id} continuing with ${running?.model ?? ''} (${running?.thinking ?? ''} thinking) in background.`,
      )
    },
  })

  pi.registerTool({
    name: 'subagent_remove',
    label: 'Subagent remove',
    description:
      "Remove a specific subagent. Kills it if it's currently running.",
    parameters: Type.Object({
      id: Type.Number({ description: 'The ID of the subagent to remove' }),
    }),
    // biome-ignore lint/suspicious/useAwait: pi's tool API requires an async execute
    execute: async (_callId, args, _signal, _onUpdate, ctx) => {
      widgetCtx = ctx
      const state = agents.get(args.id)
      if (!state) {
        return textResult(`Error: No subagent #${args.id} found.`)
      }

      if (state.proc && state.status === 'running') {
        state.proc.kill('SIGTERM')
      }
      ctx.ui.setWidget(`sub-${args.id}`, undefined)
      agents.delete(args.id)

      return textResult(`Subagent #${args.id} removed successfully.`)
    },
  })

  pi.registerTool({
    name: 'subagent_list',
    label: 'Subagent list',
    description:
      'List all active and finished subagents, showing their IDs, tasks, and status.',
    parameters: Type.Object({}),
    // biome-ignore lint/suspicious/useAwait: pi's tool API requires an async execute
    execute: async () => {
      if (agents.size === 0) {
        return textResult('No active subagents.')
      }

      const list = Array.from(agents.values())
        .map(
          (s) =>
            `#${s.id} [${s.status.toUpperCase()}] (Turn ${s.turnCount}, ${s.model}, ${s.thinking}) - ${s.task}`,
        )
        .join('\n')

      return textResult(`Subagents:\n${list}`)
    },
  })
  // ── /sub [--model <model>] [--thinking <level>] <task> ────────────────────

  pi.registerCommand('sub', {
    description:
      'Spawn a subagent: /sub [--model provider/model] [--thinking low|medium|high|xhigh] <task>',
    // biome-ignore lint/suspicious/useAwait: pi's command API requires an async handler
    handler: async (args, ctx) => {
      widgetCtx = ctx

      const parsed = parseCommandOptions(args || '')
      if (parsed.error) {
        ctx.ui.notify(parsed.error, 'error')
        return
      }
      const task = parsed.rest
      if (!task) {
        ctx.ui.notify(
          'Usage: /sub [--model provider/model] [--thinking low|medium|high|xhigh] <task>',
          'error',
        )
        return
      }

      const id = nextId++
      agents.set(id, {
        id,
        status: 'running',
        task,
        text: '',
        toolCount: 0,
        elapsed: 0,
        sessionFile: makeSessionFile(id),
        turnCount: 1,
        model: '',
        thinking: pi.getThinkingLevel(),
      })
      updateWidgets()

      // Fire-and-forget
      spawnAgent(id, task, ctx, parsed.options)
      const spawned = agents.get(id)
      ctx.ui.notify(
        `Subagent #${id}: ${spawned?.model ?? ''} (${spawned?.thinking ?? ''} thinking)`,
        'info',
      )
    },
  })

  // ── /subcont <id> [--model <model>] [--thinking <level>] <prompt> ─────────

  pi.registerCommand('subcont', {
    description:
      'Continue a subagent: /subcont <id> [--model provider/model] [--thinking low|medium|high|xhigh] <prompt>',
    // biome-ignore lint/suspicious/useAwait: pi's command API requires an async handler
    handler: async (args, ctx) => {
      widgetCtx = ctx

      const trimmed = args?.trim() ?? ''
      const idMatch = trimmed.match(/^(\d+)(?:\s+|$)/)
      if (!idMatch) {
        ctx.ui.notify(
          'Usage: /subcont <id> [--model provider/model] [--thinking low|medium|high|xhigh] <prompt>',
          'error',
        )
        return
      }

      const num = Number.parseInt(idMatch[1] ?? '', 10)
      const parsed = parseCommandOptions(trimmed.slice(idMatch[0].length))
      if (parsed.error) {
        ctx.ui.notify(parsed.error, 'error')
        return
      }
      const prompt = parsed.rest

      if (!prompt) {
        ctx.ui.notify(
          'Usage: /subcont <id> [--model provider/model] [--thinking low|medium|high|xhigh] <prompt>',
          'error',
        )
        return
      }

      const state = agents.get(num)
      if (!state) {
        ctx.ui.notify(
          `No subagent #${num} found. Use /sub to create one.`,
          'error',
        )
        return
      }

      if (state.status === 'running') {
        ctx.ui.notify(
          `Subagent #${num} is still running — wait for it to finish first.`,
          'warning',
        )
        return
      }

      // Resume: the next value of this agent, for a new turn
      const resumed = patch(num, {
        status: 'running',
        task: prompt,
        text: '',
        elapsed: 0,
        turnCount: state.turnCount + 1,
      })
      updateWidgets()

      ctx.ui.notify(
        `Continuing Subagent #${num} (Turn ${resumed?.turnCount ?? state.turnCount})…`,
        'info',
      )

      // Fire-and-forget — reuses the same sessionFile for conversation history
      spawnAgent(num, prompt, ctx, parsed.options)
      const running = agents.get(num)
      ctx.ui.notify(
        `Subagent #${num}: ${running?.model ?? ''} (${running?.thinking ?? ''} thinking)`,
        'info',
      )
    },
  })

  // ── /subrm <number> ───────────────────────────────────────────────────────

  pi.registerCommand('subrm', {
    description: 'Remove a specific subagent widget: /subrm <number>',
    // biome-ignore lint/suspicious/useAwait: pi's command API requires an async handler
    handler: async (args, ctx) => {
      widgetCtx = ctx

      const num = Number.parseInt(args?.trim() ?? '', 10)
      if (Number.isNaN(num)) {
        ctx.ui.notify('Usage: /subrm <number>', 'error')
        return
      }

      const state = agents.get(num)
      if (!state) {
        ctx.ui.notify(`No subagent #${num} found.`, 'error')
        return
      }

      // Kill the process if still running
      if (state.proc && state.status === 'running') {
        state.proc.kill('SIGTERM')
        ctx.ui.notify(`Subagent #${num} killed and removed.`, 'warning')
      } else {
        ctx.ui.notify(`Subagent #${num} removed.`, 'info')
      }

      ctx.ui.setWidget(`sub-${num}`, undefined)
      agents.delete(num)
    },
  })

  // ── /subclear ─────────────────────────────────────────────────────────────

  pi.registerCommand('subclear', {
    description: 'Clear all subagent widgets',
    // biome-ignore lint/suspicious/useAwait: pi's command API requires an async handler
    handler: async (_args, ctx) => {
      widgetCtx = ctx

      let killed = 0
      for (const [id, state] of Array.from(agents.entries())) {
        if (state.proc && state.status === 'running') {
          state.proc.kill('SIGTERM')
          killed++
        }
        ctx.ui.setWidget(`sub-${id}`, undefined)
      }

      const total = agents.size
      agents.clear()
      nextId = 1

      const msg =
        total === 0
          ? 'No subagents to clear.'
          : `Cleared ${total} subagent${total === 1 ? '' : 's'}${killed > 0 ? ` (${killed} killed)` : ''}.`
      ctx.ui.notify(msg, 'info')
    },
  })

  // ── Session lifecycle ─────────────────────────────────────────────────────

  // biome-ignore lint/suspicious/useAwait: pi's event API requires an async listener
  pi.on('session_start', async (_event, ctx) => {
    applyExtensionDefaults(import.meta.url, ctx)
    for (const [id, state] of Array.from(agents.entries())) {
      if (state.proc && state.status === 'running') {
        state.proc.kill('SIGTERM')
      }
      ctx.ui.setWidget(`sub-${id}`, undefined)
    }
    agents.clear()
    nextId = 1
    widgetCtx = ctx
  })
}
