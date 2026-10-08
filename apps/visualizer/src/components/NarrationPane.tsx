import { ArrowDown } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { fmtClock } from '../lib/format'
import {
  isAtBottom,
  shouldOfferJump,
  turnsOf,
  type TTurn,
} from '../lib/narration'
import type { TConsult } from '../lib/consult'
import type { Envelope, EventRow } from '../lib/types'
import { DecisionRequest } from './DecisionRequest'
import styles from './NarrationPane.module.css'
import { hasCode, splitFencesAndJson } from '../lib/fences'
import { highlightJsonText } from '../lib/highlight'

/** The one sentence a step ends on, out of its envelope. */
const summaryOf = (envelope: Envelope | undefined): string => {
  if (envelope?.payload_json == null) return ''
  try {
    const payload: unknown = JSON.parse(envelope.payload_json)
    const summary =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).summary
        : undefined
    return typeof summary === 'string' ? summary : ''
  } catch (error) {
    // A step whose output did not parse still has its thinking above; a
    // broken tail must not take the readable part of the pane with it.
    void error
    return ''
  }
}

/**
 * A reading pane for one agent's run: what it thought, then what it said.
 *
 * The tool-call rail is gone. Every call it showed is in the events tab with
 * its arguments and its result, so the rail was a second, poorer copy of a
 * record that already existed — and it cost half the width of the column a
 * person actually reads.
 *
 * Two things now close the pane, in the order a conversation would have
 * them: the step's final output, and — when the run stopped here — what it
 * is waiting for. Both used to live above the waterfall, which put the end
 * of the conversation above its beginning.
 */
export const NarrationPane = ({
  events,
  agent,
  envelope,
  phaseStatus,
  consults,
  runId,
  runStatus,
}: Readonly<{
  events: readonly EventRow[]
  agent: string
  /** Questions a person put to this step after it finished, with replies. */
  consults: readonly TConsult[]
  /** the step's final output, rendered as the last message it sent */
  envelope?: Envelope
  /** the STEP's status — it colours the last message, not the run's */
  phaseStatus: string
  runId: string
  runStatus: string
}>) => {
  const turns = turnsOf(events)
  const [following, setFollowing] = useState(true)
  const [missed, setMissed] = useState(0)

  const scroller = useRef<HTMLDivElement | null>(null)
  const seen = useRef(0)

  /**
   * Follow the live edge only while the reader is at it.
   *
   * useLayoutEffect rather than useEffect: scrolling after paint shows one
   * frame of the old position, which reads as a flicker on every new message.
   */
  useLayoutEffect(() => {
    const node = scroller.current
    if (node === null) return
    const arrived = turns.length - seen.current
    seen.current = turns.length
    if (following) {
      node.scrollTop = node.scrollHeight
      setMissed(0)
    } else if (arrived > 0) {
      setMissed((count) => count + arrived)
    }
  }, [turns.length, following])

  const onScroll = useCallback(() => {
    const node = scroller.current
    if (node === null) return
    const bottom = isAtBottom(node.scrollTop, node.scrollHeight, node.clientHeight)
    setFollowing(bottom)
    if (bottom) setMissed(0)
  }, [])

  const jumpToLatest = () => {
    const node = scroller.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
    setFollowing(true)
    setMissed(0)
  }


  const summary = summaryOf(envelope)

  return (
    <div className={styles.pane}>
      {/*
        No explicit height: the chat column sets it, and the pane fills what
        it is given. It used to carry its own, which inside a framed column
        meant two heights disagreeing — a scrollbar on the pane and another
        on the column around it.
      */}
      <div className={styles.scroller} onScroll={onScroll} ref={scroller}>
        <div className={styles.narration}>
          {turns.length === 0 && (
            <div className="faint">nothing recorded for {agent} yet</div>
          )}
          {turns.map((turn) => (
            <TurnNarration key={turn.turn} turn={turn} />
          ))}

          {/*
            The end of the turn, coloured by how it ended: green for a step
            that succeeded, red for one that failed. The colour is the point
            — it is what tells a reader scrolling past that this is the
            outcome rather than one more paragraph of thinking.
          */}
          {summary !== '' && (
            <div
              className={`${styles.final} ${
                phaseStatus === 'fail' ? styles.finalFail : styles.finalOk
              }`}
            >
              <span className={styles.finalKey}>
                {phaseStatus === 'fail' ? 'it failed' : 'its answer'}
              </span>
              <p className={styles.finalText}>{summary}</p>
            </div>
          )}

          {/*
            Last, because it IS last: the step spoke, and this is the sentence
            that follows. It renders itself only while the run is waiting.
          */}
          <DecisionRequest runId={runId} status={runStatus} />

          {/*
            Questions put to this step after it finished, and its replies.
            They belong in the conversation because that is what they are:
            the conversation continuing after the step ended. A person's
            message is coloured as a person's, since a reader must never
            have to work out who said a thing.
          */}
          {consults.map((consult) => (
            <div key={`${consult.at}-${consult.question}`}>
              <article className={styles.asked}>
                <span className={styles.askedMark}>you · {consult.mode}</span>
                <p className={styles.askedText}>{consult.question}</p>
              </article>
              {consult.answer !== '' && (
                <article className={styles.turn}>
                  <span className={styles.turnMark}>{agent}</span>
                  <p className={styles.segment}>{consult.answer}</p>
                </article>
              )}
              {consult.amended.length > 0 && (
                <p className={styles.amended}>
                  amended {consult.amended.join(', ')} — the steps after this
                  one ran against the previous version
                </p>
              )}
              {consult.restored.length > 0 && (
                <p className={styles.reverted}>
                  put back {consult.restored.join(', ')}, which belongs to
                  another step
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {shouldOfferJump(following, missed) && (
        <button type="button" className={styles.jump} onClick={jumpToLatest}>
          <ArrowDown size={16} /> {missed} new
        </button>
      )}

    </div>
  )
}

/**
 * One narration block: prose as prose, fenced code as code.
 *
 * Highlighting is applied to JSON only, because that is the fence whose shape
 * the factory itself defines — every agent's Report contract is JSON, and it
 * is the one an eye needs help scanning. Guessing at highlighting for twenty
 * other languages would cost more than it reveals at this size.
 */
const NarrationBlock = ({
  channel,
  text,
}: Readonly<{ channel: string; text: string }>) => {
  const className = channel === 'thinking' ? styles.thinking : styles.text

  if (!hasCode(text)) {
    return <p className={className}>{text}</p>
  }

  return (
    <div className={className}>
      {splitFencesAndJson(text).map((segment, index) =>
        segment.kind === 'prose' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments have no id and are re-derived whole on every change
          <p key={index} className={styles.segment}>
            {segment.text}
          </p>
        ) : (
          <pre
            // biome-ignore lint/suspicious/noArrayIndexKey: segments have no id and are re-derived whole on every change
            key={index}
            className={segment.open ? `${styles.code} ${styles.codeOpen}` : styles.code}
            data-language={segment.language || undefined}
          >
            {segment.language === 'json' ? (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightJsonText escapes its input
              <code dangerouslySetInnerHTML={{ __html: highlightJsonText(segment.text) }} />
            ) : (
              <code>{segment.text}</code>
            )}
          </pre>
        ),
      )}
    </div>
  )
}

/*
 * A turn is a card now, not a button.
 *
 * It was clickable to highlight its row in the tool-call rail, and the rail
 * is gone — so the hover highlight pointed at nothing and the whole block
 * announced itself to a screen reader as a control that does nothing when
 * pressed. It reads like the decision cards beside it instead.
 */
const TurnNarration = ({ turn }: Readonly<{ turn: TTurn }>) => (
  <article className={styles.turn}>
    <span className={styles.turnMark}>
      {turn.turn === 0 ? 'untraced' : `turn ${turn.turn}`}
      <span className="faint"> {fmtClock(new Date(turn.at).toISOString())}</span>
    </span>
    {turn.blocks.map((block) => (
      <NarrationBlock key={block.id} channel={block.channel} text={block.text} />
    ))}
    {turn.blocks.length === 0 && (
      <p className={`${styles.thinking} faint`}>no narration for this turn</p>
    )}
  </article>
)

