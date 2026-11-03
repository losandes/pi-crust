import { expect, test } from 'bun:test'
import { createNarrationTracker, deltaText } from './pi-agent'

const deltas = (
  tracker: ReturnType<typeof createNarrationTracker>,
  events: readonly Readonly<Record<string, unknown>>[],
) => events.map((event) => tracker.observe(event)).filter(Boolean)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when the harness wraps its token stream inside another event',
    'it should still find the narration',
  ].join(', '),
  () => {
    // given — pi's real shape, as the first live run revealed: the envelope is
    // `message_update` and the interesting event is one level down. Reading
    // only the outer type finds nothing, and says nothing about finding
    // nothing.
    const tracker = createNarrationTracker()

    // when
    const emitted = deltas(tracker, [
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'thinking_delta',
          delta: 'the config may be stale',
        },
      },
      { type: 'message_end' },
    ])

    // then
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.channel).toBe('thinking')
    expect(emitted[0]?.text).toBe('the config may be stale')
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when the harness closes a passage with its full content',
    'it should emit that once rather than once per delta and once again at the end',
  ].join(', '),
  () => {
    // given — pi streams deltas AND then closes with the reassembled text
    const tracker = createNarrationTracker()

    // when
    const emitted = deltas(tracker, [
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'the config ' },
      },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'thinking_delta',
          delta: 'may be stale',
        },
      },
      {
        type: 'message_update',
        assistantMessageEvent: {
          type: 'thinking_end',
          content: 'the config may be stale',
        },
      },
      { type: 'message_end' },
    ])

    // then — the harness's own reassembly is authoritative, and the deltas it
    // was built from are dropped rather than emitted beside it
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.text).toBe('the config may be stale')
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when a turn streams many deltas',
    'it should emit one record for the turn rather than one per token',
  ].join(', '),
  () => {
    // given — pi streams a few characters at a time
    const tracker = createNarrationTracker()

    // when
    const emitted = deltas(tracker, [
      { type: 'text_delta', delta: 'I will ' },
      { type: 'text_delta', delta: 'read the ' },
      { type: 'text_delta', delta: 'config first.' },
      { type: 'message_end' },
    ])

    // then — tracing every delta would write thousands of rows per activityRun
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.text).toBe('I will read the config first.')
    expect(emitted[0]?.turn).toBe(1)
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when reasoning is followed by prose in the same turn',
    'it should separate them, because they are read differently',
  ].join(', '),
  () => {
    // given
    const tracker = createNarrationTracker()

    // when
    const emitted = deltas(tracker, [
      { type: 'thinking_delta', delta: 'the config may be stale' },
      { type: 'text_delta', delta: 'Reading the config.' },
      { type: 'message_end' },
    ])

    // then
    expect(emitted.map((record) => record?.channel)).toEqual([
      'thinking',
      'text',
    ])
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when a tool call happens between two passages of thinking',
    'it should give the later passage a new turn so the call cannot be attributed to it',
  ].join(', '),
  () => {
    // given — the join between narration and calls is the turn, not the clock
    const tracker = createNarrationTracker()

    // when
    tracker.observe({ type: 'text_delta', delta: 'first I will look' })
    tracker.observe({ type: 'message_end' })
    const turnOfTheCall = tracker.turn()
    tracker.observe({ type: 'text_delta', delta: 'now I understand' })
    tracker.observe({ type: 'message_end' })

    // then — two agents' events interleave, so adjacency in time is not causation
    expect(turnOfTheCall).toBe(2)
    expect(tracker.turn()).toBe(3)
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when the agent exits mid-sentence',
    'it should still surface what was said',
  ].join(', '),
  () => {
    // given — a killed or crashed agent never emits its closing message_end
    const tracker = createNarrationTracker()
    tracker.observe({ type: 'text_delta', delta: 'I am about to' })

    // when
    const actual = tracker.flush()

    // then — what it was saying when it died is often the useful part
    expect(actual?.text).toBe('I am about to')
  },
)

test(
  [
    'given data/pi-agent::createNarrationTracker',
    'when a turn produced no text at all',
    'it should emit nothing rather than an empty record',
  ].join(', '),
  () => {
    // given — a turn that only called a tool
    const tracker = createNarrationTracker()

    // when
    const actual = tracker.observe({ type: 'message_end' })

    // then
    expect(actual).toBeUndefined()
  },
)

test(
  [
    'given data/pi-agent::deltaText',
    'when a harness spells the delta as an object or a content array',
    'it should read all the shapes rather than only the bare string',
  ].join(', '),
  () => {
    // given — which shape arrives depends on the provider, not on this code
    const shapes = [
      'plain',
      { text: 'wrapped' },
      [{ text: 'in ' }, { text: 'parts' }],
      { content: [{ text: 'nested' }] },
    ]

    // when
    const actual = shapes.map(deltaText)

    // then — a pane that silently shows nothing for one provider is worse
    // than no pane at all
    expect(actual).toEqual(['plain', 'wrapped', 'in parts', 'nested'])
  },
)
