/**
 * A question asked before something irreversible happens.
 *
 * Built on `<dialog showModal>` rather than on a div with a high z-index,
 * because the platform already does the parts that are easy to get wrong:
 * focus moves into the dialog and is trapped there, the rest of the page goes
 * inert, Escape closes it, and a screen reader announces it as a dialog. A
 * hand-rolled overlay gets none of that for free and most implementations
 * quietly skip all four.
 *
 * It takes the words rather than inventing them. "Are you sure?" tells a
 * reader nothing they did not already know; what they need is what will be
 * LOST, named by the caller who knows.
 */
import { useEffect, useRef } from 'react'
import { cx } from '@/lib/cx'

const BUTTON_CLASSES =
  'cursor-pointer rounded-sm border-[length:var(--border-width)] border-border bg-panel px-3.5 py-1.5 font-sans text-[0.86rem] leading-normal text-text'

export const ConfirmDialog = ({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'cancel',
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
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
      className="max-w-md rounded-md border-[length:var(--border-width)] border-fail/[calc(var(--edge-alpha)*100%)] bg-panel-2 px-5 py-4 text-text backdrop:bg-bg/55 backdrop:brightness-0"
      /*
       * Escape means "no", and the browser fires `cancel` for it without
       * telling React — so without this the state that opened the dialog
       * stays true and it can never be opened again.
       *
       * Clicking the backdrop does NOT dismiss it. A backdrop click handler
       * on a <dialog> is a click target with no keyboard equivalent, and for
       * a dialog whose other button destroys work, "I clicked slightly off
       * the panel" should not be one of the ways out.
       */
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 className="m-0 mb-2 text-base font-[650] text-fail">{title}</h2>
      <p className="m-0 mb-4 text-[0.86rem] leading-normal text-dim">{body}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={cx(BUTTON_CLASSES, 'hover:bg-panel-3')}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={cx(BUTTON_CLASSES, 'hover:bg-fail/22')}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
