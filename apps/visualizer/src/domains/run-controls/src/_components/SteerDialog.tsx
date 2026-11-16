/**
 * Choosing what happens to the path you are steering away from.
 *
 * Three buttons and no default, deliberately. Overwrite discards the work
 * the steered activities already produced; branch keeps both as two runs. A
 * primary button on that choice would make the destructive one the habit,
 * so neither is primary and both are typed out in full.
 *
 * The instruction itself is not asked for here — it was typed in the field
 * that opened this dialog, and showing it back is what lets somebody check
 * they are about to send what they meant.
 */
import { useEffect, useRef } from 'react'
import { cx } from '@/lib/cx'

const BUTTON =
  'flex cursor-pointer flex-col items-start gap-1 rounded-xl border-(length:--border-width) border-border-soft bg-transparent px-3.5 py-2.5 text-left font-mono text-sm'
const ACTION = {
  cancel: 'text-text hover:border-text focus-visible:border-text',
  overwrite: 'text-amber hover:border-amber focus-visible:border-amber',
  branch:
    'text-text enabled:hover:border-accent focus-visible:border-accent disabled:cursor-default disabled:opacity-50',
} as const
const HINT = 'font-card text-xs text-dim whitespace-normal'

export const SteerDialog = ({
  open,
  activity,
  replaying,
  note,
  branchReady,
  onChoose,
  onCancel,
}: Readonly<{
  open: boolean
  activity: string
  /** Every activity this will re-run, in the order the run actually took. */
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
      className="m-auto max-h-full w-fit max-w-xl overflow-auto rounded-2xl border-(length:--border-width) border-border bg-panel px-5.5 py-5 font-card text-text wrap-anywhere backdrop:bg-bg/55 backdrop:brightness-0"
      onCancel={(event) => {
        // Escape means cancel, and the browser does not tell React.
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 className="mt-0 mb-2.5 text-lg font-bold">
        Send this run back to {activity}
      </h2>

      <p className="mt-0 mb-3 leading-relaxed">
        {/*
          Naming every activity that will re-run, because "steer from here" hides
          the cost: the activities are a chain and all of them run again.
        */}
        {replaying.length} activity{replaying.length === 1 ? '' : 's'} will run
        again, in this order: <strong>{replaying.join(' → ')}</strong>.
      </p>

      <blockquote className="mx-0 mt-0 mb-4 border-l-3 border-blue bg-panel-2 px-3 py-2.5 leading-relaxed whitespace-pre-wrap wrap-anywhere">
        {note}
      </blockquote>

      <div className="flex flex-col gap-2">
        {/* Cancel first in the DOM, so Tab reaches the way out before the
            two ways forward. */}
        <button
          type="button"
          className={cx(BUTTON, ACTION.cancel)}
          onClick={onCancel}
        >
          cancel
        </button>
        <button
          type="button"
          className={cx(BUTTON, ACTION.overwrite)}
          onClick={() => onChoose('overwrite')}
        >
          overwrite
          <span className={HINT}>
            these activities rewrite their own documents; what they produced
            before is not kept
          </span>
        </button>
        <button
          type="button"
          className={cx(BUTTON, ACTION.branch)}
          disabled={!branchReady}
          onClick={() => onChoose('branch')}
        >
          branch
          <span className={HINT}>
            {branchReady
              ? 'a new run, seeded from this one up to this activity; both outcomes stay readable'
              : 'not built yet — it would need a new run seeded from this one'}
          </span>
        </button>
      </div>
    </dialog>
  )
}
