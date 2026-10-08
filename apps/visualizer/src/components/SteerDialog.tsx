/**
 * Choosing what happens to the path you are steering away from.
 *
 * Three buttons and no default, deliberately. Overwrite discards the work
 * the steered steps already produced; branch keeps both as two runs. A
 * primary button on that choice would make the destructive one the habit,
 * so neither is primary and both are typed out in full.
 *
 * The instruction itself is not asked for here — it was typed in the field
 * that opened this dialog, and showing it back is what lets somebody check
 * they are about to send what they meant.
 */
import { useEffect, useRef } from 'react'
import styles from './SteerDialog.module.css'

export const SteerDialog = ({
  open,
  step,
  replaying,
  note,
  branchReady,
  onChoose,
  onCancel,
}: Readonly<{
  open: boolean
  step: string
  /** Every step this will re-run, in the order the run actually took. */
  replaying: readonly string[]
  note: string
  /** False until branching is built; the button says so rather than lying. */
  branchReady: boolean
  onChoose: (target: 'overwrite' | 'branch') => void
  onCancel: () => void
}>) => {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onCancel={(event) => {
        // Escape means cancel, and the browser does not tell React.
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 className={styles.title}>Send this run back to {step}</h2>

      <p className={styles.body}>
        {/*
          Naming every step that will re-run, because "steer from here" hides
          the cost: the steps are a chain and all of them run again.
        */}
        {replaying.length} step{replaying.length === 1 ? '' : 's'} will run
        again, in this order: <strong>{replaying.join(' → ')}</strong>.
      </p>

      <blockquote className={styles.note}>{note}</blockquote>

      <div className={styles.choices}>
        {/* Cancel first in the DOM, so Tab reaches the way out before the
            two ways forward. */}
        <button type="button" className={styles.cancel} onClick={onCancel}>
          cancel
        </button>
        <button
          type="button"
          className={styles.overwrite}
          onClick={() => onChoose('overwrite')}
        >
          overwrite
          <span className={styles.hint}>
            these steps rewrite their own documents; what they produced before
            is not kept
          </span>
        </button>
        <button
          type="button"
          className={styles.branch}
          disabled={!branchReady}
          onClick={() => onChoose('branch')}
        >
          branch
          <span className={styles.hint}>
            {branchReady
              ? 'a new run, seeded from this one up to this step; both outcomes stay readable'
              : 'not built yet — it would need a new run seeded from this one'}
          </span>
        </button>
      </div>
    </dialog>
  )
}
