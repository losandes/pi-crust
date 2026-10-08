import { Check, KeyRound, Send, X } from 'lucide-react'
import { useState } from 'react'
import {
  sendConsult,
  sendDecision,
  sendMessage,
  sendSteer,
  type TWriteResult,
} from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
import { SteerDialog } from './SteerDialog'
import { readToken, writeToken } from '../lib/token'
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
  replaying = [],
  standalone = false,
}: Readonly<{
  runId: string
  status: string
  /** The tree holding this run, so a steer reaches the right agent's inbox. */
  workspace?: string
  /**
   * The step whose conversation is on screen, when one is.
   *
   * A finished run has nobody listening AT THE RUN, but the step's own agent
   * still remembers everything — so this is where asking it belongs, in the
   * field that was otherwise disabled with an apology in it.
   */
  consultStep?: string
  /**
   * The steps a steer from here would replay, in the order the run took.
   *
   * Passed in rather than derived here, because only the caller has the
   * phases — and the dialog names them, since "steer from here" otherwise
   * hides the cost that all of them run again.
   */
  replaying?: readonly string[]
  /** true on the page with no step selected, where it owns its own gutter */
  standalone?: boolean
}>) => {
  const [text, setText] = useState('')
  const [token, setToken] = useState(readToken)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [steering, setSteering] = useState(false)

  const running = status === 'running'
  const waiting = status === 'waiting'
  const live = running || waiting
  /*
   * A finished run has nobody listening at the RUN, but a step's own agent
   * still has the whole conversation. That is the one thing you can do here,
   * so it occupies the field that used to be disabled with an apology.
   */
  const canConsult = !live && (consultStep ?? '') !== ''

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

  const act = (run: () => Promise<TWriteResult>, said: string): void => {
    setBusy(true)
    void run().then((result) => settle(result, said))
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
              ? `This run has finished. ${consultStep} still remembers it.`
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
                ? 'Ask this step a question, or tell it what to change.'
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
                  'steering sent',
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
                  'queued for when it finishes',
                )
              }
            >
              queue for after
            </button>
            {/*
              Destructive and irreversible mid-turn, so it is last, plain, and
              it asks. Everything the current step has done in this turn goes
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
                )
              }
            >
              <Send size={15} /> ask
            </button>
            <button
              type="button"
              disabled={busy}
              className={styles.amend}
              title="Lets this step rewrite ITS OWN documents. Every other step's stay read-only."
              onClick={() =>
                needsText('amend') ||
                act(
                  () =>
                    sendConsult(runId, consultStep ?? '', 'amend', text, workspace),
                  'amending — the result appears in the conversation when it replies',
                )
              }
            >
              amend this step's document
            </button>
            {/*
              Steering is the heavy one: it re-runs this step and everything
              after it. It opens a dialog rather than acting, because the
              choice it needs — overwrite or branch — has no safe default.
            */}
            <button
              type="button"
              disabled={busy || replaying.length === 0}
              className={styles.danger}
              title="Re-runs this step and every step after it with your instruction."
              onClick={() => needsText('steer') || setSteering(true)}
            >
              steer from here…
            </button>
          </>
        ) : undefined}
      </div>

      {done !== '' && <p className={styles.done}>{done}</p>}
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
        step={consultStep ?? ''}
        replaying={replaying}
        note={text}
        /*
         * Branching is designed and not built. The button says so instead of
         * quietly doing the other thing — which, here, would discard the work
         * somebody chose branch precisely to keep.
         */
        branchReady={false}
        onCancel={() => setSteering(false)}
        onChoose={(target) => {
          setSteering(false)
          act(
            () => sendSteer(runId, consultStep ?? '', target, text, workspace),
            target === 'overwrite'
              ? 'steering sent — these steps are running again'
              : 'branching — a new run is starting from this step',
          )
        }}
      />

      <ConfirmDialog
        open={confirmAbort}
        title="abort this run?"
        body={
          'The step that is running loses the turn it is in — whatever it has ' +
          'thought, read or written since its last recorded output goes with ' +
          'it. Earlier steps keep their results, and the run can be started ' +
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
