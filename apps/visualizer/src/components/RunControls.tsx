import { Check, KeyRound, Play, Send, X } from 'lucide-react'
import { useState } from 'react'
import {
  sendConsult,
  sendDecision,
  sendResume,
  sendMessage,
  sendSteer,
  type TWriteResult,
} from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
import { SteerDialog } from './SteerDialog'
import { readToken, writeToken } from '../lib/token'
import { hrefFor } from '../lib/router'
import styles from './RunControls.module.css'

/**
 * What a reader can DO to a run, from the page they are already watching.
 *
 * Three situations now, not two:
 *
 *   running   the agent is working, so you can steer it, queue a follow-up,
 *             or stop it
 *   waiting   the agent has stopped for you, so you answer, carry on without
 *             answering, or send it back — all three resume the run, because
 *             all three mean "carry on"
 *   finished  the field is DISABLED rather than absent
 *
 * The third is new, and it is about where the eye goes. The controls used to
 * vanish on a finished run, so the chat column collapsed and the page
 * relaid itself the moment a run ended. A disabled field says the same
 * thing — there is nobody to talk to — without moving everything else.
 */
export const RunControls = ({
  runId,
  status,
  workspace,
  consultStep,
  onConsultSent,
  onMessageSent,
  replaying = [],
  standalone = false,
}: Readonly<{
  runId: string
  status: string
  /** The tree holding this run, so a steer reaches the right agent's inbox. */
  workspace?: string
  /**
   * The activity whose conversation is on screen, when one is.
   *
   * A finished run has nobody listening AT THE RUN, but the activity's own agent
   * still remembers everything — so this is where asking it belongs, in the
   * field that was otherwise disabled with an apology in it.
   */
  consultStep?: string
  /**
   * What was just sent to that activity, for the caller to show immediately.
   *
   * A consult rejoins a conversation of a hundred thousand tokens and takes
   * minutes; the event carrying it is written once, at the END, with the
   * question and the answer together. So between pressing the button and the
   * reply landing there was nothing on screen at all — a banner saying it was
   * sent, and a conversation that had not changed. A person cannot tell that
   * apart from a message that went nowhere.
   */
  onConsultSent?: (mode: 'ask' | 'amend', question: string) => void
  /**
   * Fired after a steer or a follow-up is ACCEPTED, so the pane beside this
   * one can echo it into the conversation immediately, the same "only on
   * result.ok" rule `onConsultSent` already follows.
   */
  onMessageSent?: (kind: 'steer' | 'follow_up', text: string) => void
  /**
   * The activities a steer from here would replay, in the order the run took.
   *
   * Passed in rather than derived here, because only the caller has the
   * activityRuns — and the dialog names them, since "steer from here" otherwise
   * hides the cost that all of them run again.
   */
  replaying?: readonly string[]
  /** true on the page with no activity selected, where it owns its own gutter */
  standalone?: boolean
}>) => {
  const [text, setText] = useState('')
  const [token, setToken] = useState(readToken)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [steering, setSteering] = useState(false)
  const [branchRunId, setBranchRunId] = useState('')

  const running = status === 'running'
  const waiting = status === 'waiting'
  const live = running || waiting
  /*
   * A finished run has nobody listening at the RUN, but a activity's own agent
   * still has the whole conversation. That is the one thing you can do here,
   * so it occupies the field that used to be disabled with an apology.
   */
  const canConsult = !live && (consultStep ?? '') !== ''
  /*
   * A failed run is the one that can be picked up. A successful one has
   * nothing to resume — every Activity Run is already green, and resuming
   * would re-launch a chain that would skip all of it.
   */
  const failed = status === 'fail'

  const settle = (result: TWriteResult, said: string): void => {
    setBusy(false)
    if (result.ok) {
      setProblem('')
      setDone(said)
      setText('')
      return
    }
    setDone('')
    setProblem(result.problem)
  }

  /*
   * `onSent` fires only when the write was ACCEPTED, so a refused send leaves
   * no trace of itself in the conversation. The conversation is what a reader
   * trusts; a message in it that never reached an agent is worse than none.
   */
  const act = (
    run: () => Promise<TWriteResult>,
    said: string,
    onSent?: (result: Readonly<{ ok: true; data: unknown }>) => void,
  ): void => {
    setBusy(true)
    void run().then((result) => {
      settle(result, said)
      if (result.ok) {
        onSent?.(result)
      }
    })
  }

  const needsText = (what: string): boolean => {
    if (text.trim() !== '') return false
    setProblem(`Write what you want to say before you ${what}.`)
    return true
  }

  return (
    <section
      className={
        standalone ? `${styles.controls} ${styles.standalone}` : styles.controls
      }
    >
      <header className={styles.head}>
        {running
          ? 'This run is working. You can reach it.'
          : waiting
            ? 'This run is waiting for you.'
            : canConsult
              ? `This run has finished. ${consultStep} still remembers it.` +
                (failed
                  ? ' Asking or amending changes a document — it does not' +
                    ' continue the run. Pick it up when what broke is fixed.'
                  : '')
              : 'This run has finished.'}
      </header>

      <textarea
        className={styles.text}
        value={text}
        rows={3}
        disabled={!(live || canConsult)}
        placeholder={
          running
            ? 'Tell the agent something — it arrives between tool calls, in context.'
            : waiting
              ? 'Your answer. It enters the next stage as a fact attributed to you.'
              : canConsult
                ? failed
                  ? 'Ask this activity a question, tell it what to change, or ' +
                    'type a note — it is sent as a standing instruction every ' +
                    'activity reads when you pick the run back up.'
                  : 'Ask this activity a question, or tell it what to change.'
                : 'Nothing is listening.'
        }
        onChange={(event) => setText(event.target.value)}
      />

      <div className={styles.actions}>
        {live && running ? (
          <>
            <button
              type="button"
              disabled={busy}
              className={styles.primary}
              onClick={() =>
                needsText('steer') ||
                act(
                  () => sendMessage(runId, 'steer', text, workspace),
                  'steering sent \u2014 it will appear in the conversation above',
                  () => onMessageSent?.('steer', text),
                )
              }
            >
              <Send size={15} /> steer now
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                needsText('queue it') ||
                act(
                  () => sendMessage(runId, 'follow_up', text, workspace),
                  'queued for when it finishes \u2014 it will appear in the conversation above',
                  () => onMessageSent?.('follow_up', text),
                )
              }
            >
              queue for after
            </button>
            {/*
              Destructive and irreversible mid-turn, so it is last, plain, and
              it asks. Everything the current activity has done in this turn goes
              with it, and a button that throws away twenty minutes of work on
              one click is a button somebody will eventually hit by accident.
            */}
            <button
              type="button"
              disabled={busy}
              className={styles.danger}
              onClick={() => setConfirmAbort(true)}
            >
              <X size={15} /> abort
            </button>
          </>
        ) : waiting ? (
          <>
            <button
              type="button"
              disabled={busy}
              className={styles.primary}
              onClick={() =>
                act(
                  () => sendDecision(runId, 'approve', text, workspace),
                  'approved — the run is continuing',
                )
              }
            >
              <Check size={15} /> continue without answering
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                needsText('answer') ||
                act(
                  () => sendDecision(runId, 'answer', text, workspace),
                  'answered — the run is continuing',
                )
              }
            >
              answer and continue
            </button>
            <button
              type="button"
              disabled={busy}
              className={styles.danger}
              onClick={() =>
                needsText('reject') ||
                act(
                  () => sendDecision(runId, 'reject', text, workspace),
                  'sent back — the stage will redo its work',
                )
              }
            >
              reject and send back
            </button>
          </>
        ) : canConsult ? (
          <>
            {/*
              Two buttons rather than a mode menu, and amend is marked,
              because they read identically otherwise and only one of them
              can change a file.
            */}
            <button
              type="button"
              disabled={busy}
              className={styles.primary}
              title="Answers from the conversation it still remembers. Changes nothing."
              onClick={() =>
                needsText('ask') ||
                act(
                  () =>
                    sendConsult(runId, consultStep ?? '', 'ask', text, workspace),
                  'asked — the answer appears in the conversation when it replies',
                  () => onConsultSent?.('ask', text),
                )
              }
            >
              <Send size={15} /> ask
            </button>
            <button
              type="button"
              disabled={busy}
              className={styles.amend}
              title="Lets this activity rewrite ITS OWN documents. Every other activity's stay read-only."
              onClick={() =>
                needsText('amend') ||
                act(
                  () =>
                    sendConsult(runId, consultStep ?? '', 'amend', text, workspace),
                  'amending — the result appears in the conversation when it replies',
                  () => onConsultSent?.('amend', text),
                )
              }
            >
              amend this activity's document
            </button>
            {failed && (
              <button
                type="button"
                disabled={busy}
                className={styles.primary}
                title={
                  text.trim() === ''
                    ? 'Re-launches the run exactly as it was started, skipping every Activity Run already recorded successful.'
                    : 'Re-launches the run, and carries what you typed as a standing instruction every activity from here reads.'
                }
                onClick={() =>
                  act(
                    () => sendResume(runId, workspace, text),
                    text.trim() === ''
                      ? 'picked up where it stopped — nothing already green re-runs'
                      : 'picked up where it stopped — your note is now a standing ' +
                        'instruction every activity from here reads',
                  )
                }
              >
                <Play size={15} /> pick it up where it stopped
              </button>
            )}
            {/*
              Steering is the heavy one: it re-runs this activity and everything
              after it. It opens a dialog rather than acting, because the
              choice it needs — overwrite or branch — has no safe default.
            */}
            <button
              type="button"
              disabled={busy || replaying.length === 0}
              className={styles.danger}
              title="Re-runs this activity and every activity after it with your instruction."
              onClick={() => needsText('steer') || setSteering(true)}
            >
              steer from here…
            </button>
          </>
        ) : undefined}
      </div>

      {done !== '' && <p className={styles.done}>{done}</p>}
      {/*
        Only rendered after a successful branch: the id comes back in the
        response because the server mints it before the detached child has
        written a row, and this is the one place that id is worth a click.
      */}
      {branchRunId !== '' && (
        <p className={styles.done}>
          <a href={hrefFor(branchRunId, undefined, workspace)}>
            open the new run ({branchRunId})
          </a>
        </p>
      )}
      {problem !== '' && <p className={styles.problem}>{problem}</p>}

      {/*
        The token field appears only once something has been refused. Asking
        for a secret before anybody needs it trains people to paste it without
        reading, and most sessions never write at all.
      */}
      {problem !== '' && (
        <div className={styles.token}>
          <KeyRound size={15} />
          <input
            type="password"
            className={styles.tokenInput}
            value={token}
            placeholder="CRUST_TOKEN"
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              writeToken(token)
              setProblem('Token saved. Try that again.')
            }}
          >
            save token
          </button>
        </div>
      )}

      <SteerDialog
        open={steering}
        activity={consultStep ?? ''}
        replaying={replaying}
        note={text}
        branchReady={true}
        onCancel={() => setSteering(false)}
        onChoose={(target) => {
          setSteering(false)
          setBranchRunId('')
          act(
            () => sendSteer(runId, consultStep ?? '', target, text, workspace),
            target === 'overwrite'
              ? 'steering sent — these activities are running again'
              : 'branching — a new run is starting; its link appears below',
            (result) => {
              if (target !== 'branch') return
              const data = result.data as Readonly<{ branch_run_id?: unknown }>
              if (typeof data.branch_run_id === 'string' && data.branch_run_id !== '') {
                setBranchRunId(data.branch_run_id)
              }
            },
          )
        }}
      />

      <ConfirmDialog
        open={confirmAbort}
        title="abort this run?"
        body={
          'The activity that is running loses the turn it is in — whatever it has ' +
          'thought, read or written since its last recorded output goes with ' +
          'it. Earlier activities keep their results, and the run can be started ' +
          'again from the beginning.'
        }
        confirmLabel="abort the run"
        onCancel={() => setConfirmAbort(false)}
        onConfirm={() => {
          setConfirmAbort(false)
          act(() => sendMessage(runId, 'abort', '', workspace), 'abort sent')
        }}
      />
    </section>
  )
}
