import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TPiRequest } from '../typedefs/pi'
import { emptyUsage } from '../typedefs/pi'
import {
  addTurn,
  buildArgv,
  contextTokensOf,
  contextWindow,
  createNarrationTracker,
  createToolCallTracker,
  deltaText,
  EMPTY_STREAM_STATE,
  foldMessageEnd,
  parseJsonLine,
  textOf,
  toolLabel,
} from './pi-agent'

const originalPiModelsPath = process.env.PI_MODELS_PATH

/**
 * `process.env` is the external API `contextWindow` reads, and pointing it at
 * a fixture is the only way to exercise the registry path without a real
 * `~/.pi/agent/models.json`. Assigning to it is the adapter, said once here
 * rather than at every call site.
 */
const setPiModelsPath = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env.PI_MODELS_PATH
    return
  }
  // biome-ignore lint/plugin/no-object-mutation: process.env is the external API contextWindow reads, and this function is the adapter that owns the assignment
  process.env.PI_MODELS_PATH = value
}

afterEach(() => {
  setPiModelsPath(originalPiModelsPath)
})

const assistantTurn = (
  usage: Readonly<Record<string, unknown>>,
  stopReason = 'end_turn',
): Readonly<Record<string, unknown>> => ({
  type: 'message_end',
  message: {
    role: 'assistant',
    stopReason,
    content: [{ type: 'text', text: 'done' }],
    usage,
  },
})

test(
  [
    'given data/pi-agent::contextTokensOf',
    'when the provider reports totalTokens',
    'it should prefer that number',
  ].join(', '),
  () => {
    // given
    const usage = { totalTokens: 1234, input: 1, output: 1 }

    // when
    const actual = contextTokensOf(usage)

    // then
    expect(actual).toEqual(1234)
  },
)

test(
  [
    'given data/pi-agent::contextTokensOf',
    'when totalTokens is absent',
    'it should sum the parts including cache reads',
  ].join(', '),
  () => {
    // given
    const usage = { input: 100, output: 50, cacheRead: 2000, cacheWrite: 10 }

    // when
    const actual = contextTokensOf(usage)

    // then
    expect(actual).toEqual(2160)
  },
)

test(
  [
    'given data/pi-agent::addTurn',
    'when two turns are folded in',
    'it should accumulate every component and its cost',
  ].join(', '),
  () => {
    // given
    const first = {
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      reasoning: 3,
      cost: {
        input: 0.1,
        output: 0.2,
        cacheRead: 0.01,
        cacheWrite: 0.02,
        total: 0.33,
      },
    }
    const second = {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 1,
      cost: { input: 0.01, output: 0.01, total: 0.02 },
    }

    // when
    const actual = addTurn(addTurn(emptyUsage, first, 18), second, 2)

    // then
    expect({
      input_tokens: actual.input_tokens,
      output_tokens: actual.output_tokens,
      cache_read_tokens: actual.cache_read_tokens,
      cache_write_tokens: actual.cache_write_tokens,
      reasoning_tokens: actual.reasoning_tokens,
      total_tokens: actual.total_tokens,
    }).toEqual({
      input_tokens: 11,
      output_tokens: 6,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
      reasoning_tokens: 4,
      total_tokens: 20,
    })
    expect(actual.input_cost).toBeCloseTo(0.11, 10)
    expect(actual.output_cost).toBeCloseTo(0.21, 10)
    expect(actual.total_cost).toBeCloseTo(0.35, 10)
  },
)

test(
  [
    'given data/pi-agent::createToolCallTracker',
    'when a tool call is announced, started, and ended',
    'it should emit exactly one record, at the end, with its span',
  ].join(', '),
  () => {
    // given
    const tracker = createToolCallTracker()
    const announcement = {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call_1',
            name: 'bash',
            arguments: { command: 'ls   -la  src' },
          },
        ],
      },
    }

    // when
    const onAnnounce = tracker.observe(announcement)
    const onStart = tracker.observe({
      type: 'tool_execution_start',
      toolCallId: 'call_1',
      toolName: 'bash',
      args: { command: 'ls -la src' },
    })
    const onEnd = tracker.observe({
      type: 'tool_execution_end',
      toolCallId: 'call_1',
      toolName: 'bash',
      args: { command: 'ls -la src' },
      result: { content: [{ type: 'text', text: 'README.md' }] },
    })

    // then
    expect(onAnnounce).toBeUndefined()
    expect(onStart).toBeUndefined()
    expect(onEnd?.tool).toEqual('bash')
    expect(onEnd?.label).toEqual('bash: ls -la src')
    expect(onEnd?.ok).toEqual(true)
    expect(onEnd?.result_snippet).toEqual('README.md')
    expect(typeof onEnd?.started_at).toEqual('string')
    expect(typeof onEnd?.ended_at).toEqual('string')
    expect(typeof onEnd?.duration_ms).toEqual('number')
  },
)

test(
  [
    'given data/pi-agent::createToolCallTracker',
    'when a tool call ends with an error flag',
    'it should record the failure rather than drop the call',
  ].join(', '),
  () => {
    // given
    const tracker = createToolCallTracker()

    // when
    const actual = tracker.observe({
      type: 'tool_execution_end',
      toolCallId: 'call_2',
      toolName: 'read',
      args: { path: 'missing.ts' },
      isError: true,
      result: { content: [{ type: 'text', text: 'ENOENT' }] },
    })

    // then
    expect(actual?.ok).toEqual(false)
    expect(actual?.label).toEqual('read: missing.ts')
  },
)

test(
  [
    'given data/pi-agent::toolLabel',
    'when no primary argument is present',
    'it should fall back to the first string argument',
  ].join(', '),
  () => {
    // given
    const args = { depth: 2, needle: 'auth handler' }

    // when
    const actual = toolLabel('custom', args)

    // then
    expect(actual).toEqual('custom: auth handler')
  },
)

test(
  [
    'given data/pi-agent::foldMessageEnd',
    'when an aborted turn follows a good one',
    'it should bill both but keep the good occupancy reading',
  ].join(', '),
  () => {
    // given
    const good = assistantTurn({ totalTokens: 5000, cost: { total: 0.5 } })
    const aborted = assistantTurn({ totalTokens: 12 }, 'aborted')

    // when
    const actual = foldMessageEnd(
      foldMessageEnd(EMPTY_STREAM_STATE, good),
      aborted,
    )

    // then
    expect(actual.tokens).toEqual(5012)
    expect(actual.contextTokens).toEqual(5000)
    expect(actual.cost).toBeCloseTo(0.5, 10)
  },
)

test(
  [
    'given data/pi-agent::foldMessageEnd',
    'when a later assistant turn carries text',
    'it should keep the last message rather than the first',
  ].join(', '),
  () => {
    // given
    const first = assistantTurn({ totalTokens: 10 })
    const second = {
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'end_turn',
        content: [{ type: 'text', text: '{"status":"success"}' }],
        usage: { totalTokens: 20 },
      },
    }

    // when
    const actual = foldMessageEnd(
      foldMessageEnd(EMPTY_STREAM_STATE, first),
      second,
    )

    // then
    expect(actual.text).toEqual('{"status":"success"}')
    expect(actual.contextTokens).toEqual(20)
  },
)

const piRequest = (overrides: Partial<TPiRequest> = {}): TPiRequest => ({
  prompt: 'do the thing',
  systemPrompt: 'you are a builder',
  model: 'provider/model',
  thinking: 'medium',
  sessionId: 'crust-1-builder',
  sessionDir: '/tmp/sessions',
  rawOutputPath: '/tmp/raw.jsonl',
  tools: undefined,
  extensions: [],
  skills: [],
  cwd: '/repo',
  ...overrides,
})

test(
  [
    'given data/pi-agent::buildArgv',
    'when routing resolved skills for this call',
    'it should pass each one with its own --skill flag',
  ].join(', '),
  () => {
    // given
    const request = piRequest({ skills: ['skills/code-review', 'skills/fp'] })

    // when
    const actual = buildArgv(request, { provider: 'p', modelId: 'm' }, 'pi')

    // then
    expect(actual).toContain('--skill')
    expect(actual.join(' ')).toContain('--skill skills/code-review')
    expect(actual.join(' ')).toContain('--skill skills/fp')
  },
)

test(
  [
    'given data/pi-agent::buildArgv',
    'when the change matched no skill rule',
    'it should pass no --skill flag at all',
  ].join(', '),
  () => {
    // given
    const request = piRequest()

    // when
    const actual = buildArgv(request, { provider: 'p', modelId: 'm' }, 'pi')

    // then
    expect(actual).not.toContain('--skill')
  },
)

test(
  [
    'given data/pi-agent::buildArgv',
    'when an agent is spawned',
    'it should run pi as an RPC server rather than a one-shot print',
  ].join(', '),
  () => {
    // given
    const request = piRequest()

    // when
    const actual = buildArgv(request, { provider: 'p', modelId: 'm' }, 'pi')

    // then — RPC keeps stdin open as a command channel, which is the only way
    // to reach a model mid-run
    expect(actual).toContain('--mode')
    expect(actual[actual.indexOf('--mode') + 1]).toBe('rpc')
    expect(actual).not.toContain('-p')
  },
)

test(
  [
    'given data/pi-agent::buildArgv',
    'when the prompt is built',
    'it should NOT ride in argv, because RPC takes it as a command',
  ].join(', '),
  () => {
    // given
    const request = piRequest()

    // when
    const actual = buildArgv(request, { provider: 'p', modelId: 'm' }, 'pi')

    // then — RPC mode rejects @file prompt arguments outright, and a prompt
    // left in argv would be read as one
    expect(actual).not.toContain('do the thing')
  },
)

test(
  [
    'given data/pi-agent::buildArgv',
    'when any agent is spawned',
    "it should append its role to pi's system prompt rather than replace it",
  ].join(', '),
  () => {
    // given
    const request = piRequest({ systemPrompt: 'you are the builder' })

    // when
    const actual = buildArgv(request, { provider: 'p', modelId: 'm' }, 'pi')

    // then
    expect(actual).toContain('--append-system-prompt')
    expect(actual).not.toContain('--system-prompt')
  },
)

test(
  [
    'given data/pi-agent::buildArgv',
    'when any agent is spawned',
    'it should leave context-file and skill discovery enabled',
  ].join(', '),
  () => {
    // given
    const request = piRequest()

    // when
    const actual = buildArgv(request, { provider: 'p', modelId: 'm' }, 'pi')

    // then — an agent starts where a developer in this repository starts
    expect(actual).not.toContain('-nc')
    expect(actual).not.toContain('--no-context-files')
    expect(actual).not.toContain('-ns')
    expect(actual).not.toContain('--no-skills')
  },
)

test(
  [
    'given data/pi-agent::contextWindow',
    'when the model is registered in ~/.pi/agent/models.json',
    'it should read the ceiling from the registry rather than the catalog',
  ].join(', '),
  () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), 'crust-pi-models-'))
    const path = join(dir, 'models.json')
    writeFileSync(
      path,
      JSON.stringify({
        providers: {
          anthropic: {
            models: [{ id: 'opus', contextWindow: 200_000 }],
          },
        },
      }),
    )
    setPiModelsPath(path)

    // when
    const actual = contextWindow('anthropic', 'opus')

    // then
    expect(actual).toEqual(200_000)
    rmSync(dir, { recursive: true, force: true })
  },
)

test(
  [
    'given data/pi-agent::textOf',
    'when the container carries no content array at all',
    'it should return an empty string rather than throw',
  ].join(', '),
  () => {
    // given, when
    const actual = textOf({ role: 'assistant' })

    // then
    expect(actual).toEqual('')
  },
)

test(
  [
    'given data/pi-agent::deltaText',
    'when the delta is an array, a string, an object with text, and nested content',
    'it should read the text out of every shape pi sends',
  ].join(', '),
  () => {
    // given, when, then
    expect(deltaText('plain')).toEqual('plain')
    expect(deltaText(undefined)).toEqual('')
    expect(deltaText(null)).toEqual('')
    expect(deltaText(42)).toEqual('')
    expect(deltaText(['a', 'b'])).toEqual('ab')
    expect(deltaText({ text: 'leaf' })).toEqual('leaf')
    expect(deltaText({ content: [{ text: 'nested' }] })).toEqual('nested')
  },
)

test(
  [
    'given data/pi-agent::parseJsonLine',
    'when the line is a JSON object, invalid JSON, or a bare JSON scalar',
    'it should parse the object, and skip everything else without throwing',
  ].join(', '),
  () => {
    // given, when, then
    expect(parseJsonLine('{"type":"agent_settled"}')).toEqual({
      type: 'agent_settled',
    })
    expect(parseJsonLine('not json at all')).toBeUndefined()
    expect(parseJsonLine('"just a string"')).toBeUndefined()
  },
)

test(
  [
    'given data/pi-agent::createToolCallTracker',
    'when tool_execution_start arrives with no call id',
    'it should ignore the announcement rather than track an unkeyed call',
  ].join(', '),
  () => {
    // given
    const tracker = createToolCallTracker()

    // when
    const onStart = tracker.observe({
      type: 'tool_execution_start',
      toolCallId: undefined,
      toolName: 'bash',
      args: {},
    })
    const onUnknown = tracker.observe({ type: 'agent_settled' })

    // then — neither produces a record, and an unrecognised event type is a
    // no-op rather than a thrown error
    expect(onStart).toBeUndefined()
    expect(onUnknown).toBeUndefined()
  },
)

test(
  [
    'given data/pi-agent::foldMessageEnd',
    'when the message is not from the assistant',
    'it should leave the running state untouched',
  ].join(', '),
  () => {
    // given
    const userTurn = {
      type: 'message_end',
      message: { role: 'user', content: [] },
    }

    // when
    const actual = foldMessageEnd(EMPTY_STREAM_STATE, userTurn)

    // then
    expect(actual).toEqual(EMPTY_STREAM_STATE)
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when a harness closes passages with thinking_end and text_end',
    'it should emit the completed text on the channel it belongs to',
  ].join(', '),
  () => {
    // given
    const tracker = createNarrationTracker()

    // when
    const thinking = tracker.observe({
      type: 'thinking_end',
      content: 'reasoning about it',
    })
    const text = tracker.observe({
      type: 'text_end',
      content: 'the answer',
    })

    // then
    expect(thinking?.channel).toEqual('thinking')
    expect(thinking?.text).toEqual('reasoning about it')
    expect(text?.channel).toEqual('text')
    expect(text?.text).toEqual('the answer')
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when the harness announces turns itself with turn_start',
    'it should advance the turn on the second turn_start, not the first',
  ].join(', '),
  () => {
    // given
    const tracker = createNarrationTracker()

    // when
    tracker.observe({ type: 'turn_start' })
    const afterFirst = tracker.turn()
    tracker.observe({ type: 'turn_start' })
    const afterSecond = tracker.turn()

    // then — the first turn_start opens turn 1, which is already open
    expect(afterFirst).toEqual(1)
    expect(afterSecond).toEqual(2)
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when the harness marks its own turns and then sends message_end',
    'it should NOT advance the turn a second time for the same boundary',
  ].join(', '),
  () => {
    // given
    const tracker = createNarrationTracker()
    tracker.observe({ type: 'turn_start' })

    // when
    tracker.observe({
      type: 'message_end',
      message: { role: 'assistant', content: [] },
    })

    // then — message_end only advances the turn for a harness that never
    // announced turn_start at all
    expect(tracker.turn()).toEqual(1)
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when the harness never announces turn_start',
    'it should advance the turn on message_end instead',
  ].join(', '),
  () => {
    // given
    const tracker = createNarrationTracker()

    // when
    tracker.observe({
      type: 'message_end',
      message: { role: 'assistant', content: [] },
    })

    // then
    expect(tracker.turn()).toEqual(2)
  },
)
