import { ArrowDown } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Envelope, EventRow } from '@/domains/decisions'
import { DecisionRequest } from '@/domains/decisions'
import { fmtClock } from '@/lib/format'
import { hasCode, highlightJsonText, splitFencesAndJson } from '@/lib/markdown'
import type { TConsult, TPendingConsult } from '../usecases/consult'
import {
  conversationOf,
  developerMessagesOf,
  type TDeveloperMessage,
} from '../usecases/messages'
import {
  isAtBottom,
  shouldOfferJump,
  type TTurn,
  turnsOf,
} from '../usecases/narration'
import styles from './NarrationPane.module.css'

/** The one sentence a activity ends on, out of its envelope. */
const summaryOf = (envelope: Envelope | undefined): string => {
  if (envelope?.payload_json == null) return ''
  // biome-ignore lint/plugin/no-intermediate-try-catch: a activity whose output did not parse still has its thinking above, and a broken tail must not take the readable part of the pane with it
  try {
    const payload: unknown = JSON.parse(envelope.payload_json)
    const summary =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).summary
        : undefined
    return typeof summary === 'string' ? summary : ''
  } catch (error) {
    // A activity whose output did not parse still has its thinking above; a
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
 * them: the activity's final output, and — when the run stopped here — what it
 * is waiting for. Both used to live above the waterfall, which put the end
 * of the conversation above its beginning.
 */
export const NarrationPane = ({
  events,
  agent,
  envelope,
  activityRunStatus,
  consults,
  pending,
  pendingMessage,
  runId,
  runStatus,
}: Readonly<{
  events: readonly EventRow[]
  agent: string
  /** Questions a person put to this activity after it finished, with replies. */
  consults: readonly TConsult[]
  /** A consult that has been accepted and has not answered yet. */
  pending?: TPendingConsult
  /**
   * A steer or follow-up just sent and not yet traced back, shown as an
   * unanswered message the instant it is accepted — the same immediacy
   * `pending` already gives a consult.
   */
  pendingMessage?: Readonly<{ kind: string; text: string }>
  /** the activity's final output, rendered as the last message it sent */
  envelope?: Envelope
  /** the ACTIVITY's status — it colours the last message, not the run's */
  activityRunStatus: string
  runId: string
  runStatus: string
}>) => {
  const turns = turnsOf(events)
  const messages = developerMessagesOf(events)
  const conversation = conversationOf(turns, messages)
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
    const arrived = conversation.length - seen.current
    seen.current = conversation.length
    if (following) {
      node.scrollTop = node.scrollHeight
      setMissed(0)
    } else if (arrived > 0) {
      setMissed((count) => count + arrived)
    }
  }, [conversation.length, following])

  const onScroll = useCallback(() => {
    const node = scroller.current
    if (node === null) return
    const bottom = isAtBottom(
      node.scrollTop,
      node.scrollHeight,
      node.clientHeight,
    )
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
          {conversation.length === 0 && (
            <div className="faint">nothing recorded for {agent} yet</div>
          )}
          {conversation.map((item) =>
            item.kind === 'turn' ? (
              <TurnNarration key={`turn-${item.turn.turn}`} turn={item.turn} />
            ) : (
              <DeveloperMessageCard
                key={item.message.id}
                message={item.message}
              />
            ),
          )}
          {/*
            A steer or follow-up just accepted, before its own event has
            landed — the same immediacy `pending` already gives a consult, so
            a person never has to wonder whether a send went anywhere.
          */}
          {pendingMessage !== undefined && (
            <article className={styles.asked}>
              <span className={styles.askedMark}>you</span>
              <p className={styles.askedText}>{pendingMessage.text}</p>
            </article>
          )}

          {/*
            The end of the turn, coloured by how it ended: green for a activity
            that succeeded, red for one that failed. The colour is the point
            — it is what tells a reader scrolling past that this is the
            outcome rather than one more paragraph of thinking.
          */}
          {summary !== '' && (
            <div
              className={`${styles.final} ${
                activityRunStatus === 'fail' ? styles.finalFail : styles.finalOk
              }`}
            >
              <span className={styles.finalKey}>
                {activityRunStatus === 'fail' ? 'it failed' : 'its answer'}
              </span>
              <p className={styles.finalText}>{summary}</p>
            </div>
          )}

          {/*
            Last, because it IS last: the activity spoke, and this is the sentence
            that follows. It renders itself only while the run is waiting.
          */}
          <DecisionRequest runId={runId} status={runStatus} />

          {/*
            Questions put to this activity after it finished, and its replies.
            They belong in the conversation because that is what they are:
            the conversation continuing after the activity ended. A person's
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
                  {/*
                    Through the same block as a turn, because it IS one: a
                    consult answers with a full Report, and a bare paragraph
                    rendered that envelope as one unbroken wall of prose with
                    its fences showing. What a reader does with an answer —
                    read the JSON, copy a field — needs it to be code.
                  */}
                  <NarrationBlock channel="text" text={consult.answer} />
                </article>
              )}
              {consult.amended.length > 0 && (
                <p className={styles.amended}>
                  amended {consult.amended.join(', ')} — the activities after
                  this one ran against the previous version
                </p>
              )}
              {consult.restored.length > 0 && (
                <p className={styles.reverted}>
                  put back {consult.restored.join(', ')}, which belongs to
                  another activity
                </p>
              )}
            </div>
          ))}

          {/*
            What was just said, before anything has answered it.
            The consult event is written once, at the end, carrying the
            question and the answer together — so without this the
            conversation stays unchanged for minutes after a person presses
            a button, which reads exactly like a message that went nowhere.
          */}
          {pending !== undefined && (
            <div>
              <article className={styles.asked}>
                <span className={styles.askedMark}>you · {pending.mode}</span>
                <p className={styles.askedText}>{pending.question}</p>
              </article>
              <article className={`${styles.turn} ${styles.awaiting}`}>
                <span className={styles.turnMark}>{agent}</span>
                <p className={styles.segment}>
                  rejoining its session — this takes as long as the activity
                  itself did, and the reply lands here
                </p>
              </article>
            </div>
          )}
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
            className={
              segment.open ? `${styles.code} ${styles.codeOpen}` : styles.code
            }
            data-language={segment.language || undefined}
          >
            {segment.language === 'json' ? (
              <code
                // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightJsonText escapes its input
                dangerouslySetInnerHTML={{
                  __html: highlightJsonText(segment.text),
                }}
              />
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
      <span className="faint">
        {' '}
        {fmtClock(new Date(turn.at).toISOString())}
      </span>
    </span>
    {turn.blocks.map((block) => (
      <NarrationBlock
        key={block.id}
        channel={block.channel}
        text={block.text}
      />
    ))}
    {turn.blocks.length === 0 && (
      <p className={`${styles.thinking} faint`}>no narration for this turn</p>
    )}
  </article>
)

/**
 * What a person said, never styled as the agent's own thinking.
 *
 * Reuses the `asked` styling the consult thread already carries, so a
 * reader's words look the same wherever they appear in a conversation: a
 * steer, a queued follow-up, an abort, or a standing instruction an activity
 * was actually given.
 */
const DeveloperMessageCard = ({
  message,
}: Readonly<{ message: TDeveloperMessage }>) => (
  <article className={styles.asked}>
    <span className={styles.askedMark}>
      {message.from} ·{' '}
      {message.kind === 'standing' ? 'standing instruction' : message.kind}
      <span className="faint">
        {' '}
        {fmtClock(new Date(message.at).toISOString())}
      </span>
    </span>
    <p className={styles.askedText}>
      {message.kind === 'abort' ? 'aborted this activity run' : message.text}
    </p>
  </article>
)
