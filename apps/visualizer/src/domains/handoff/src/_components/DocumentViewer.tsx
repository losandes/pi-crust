/**
 * A handoff document, read without leaving the page.
 *
 * `<dialog showModal>` for the same reasons the confirm dialog uses it: focus
 * trapping, inertness, Escape and screen-reader semantics come from the
 * platform and are the parts a hand-rolled overlay silently omits.
 *
 * Three ways out, because nothing here is destroyed by closing: Escape, the
 * close button, and clicking away from the panel. The last is a real
 * <button> filling the dialog behind the panel rather than a click handler
 * on the dialog itself — which is both why the a11y rules are satisfied
 * honestly and why it works from a keyboard. The confirm dialog beside this
 * one deliberately has no such escape, and the difference is the point:
 * dismissing a document loses nothing, dismissing a confirmation loses the
 * action you came to take.
 *
 * Markdown is rendered; anything else is shown as the text it is. The one
 * thing never done is handing model-written content to the browser as HTML.
 */
import { useEffect, useRef, useState } from 'react'
import { Prose } from '@/lib/_components'
import { cx } from '@/lib/cx'
import { renderMarkdown } from '@/lib/markdown'
import { fetchHandoffFile, handoffHref } from '../io/fetch-handoff-file'
import type { TArtifact } from '../usecases/artifacts'

const ACTION = {
  raw: 'text-dim! no-underline hover:text-text! focus-visible:text-text!',
  close: '',
} as const
const BUTTON =
  'shrink-0 cursor-pointer rounded-full border-(length:--border-width) border-border-soft bg-transparent px-3 py-1 font-mono text-sm text-dim hover:border-accent hover:text-text focus-visible:border-accent focus-visible:text-text'

const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path)

export const DocumentViewer = ({
  artifact,
  runId,
  workspace,
  onClose,
}: Readonly<{
  /** The document to show, or undefined when the viewer is closed. */
  artifact: TArtifact | undefined
  runId: string
  workspace: string | undefined
  onClose: () => void
}>) => {
  const ref = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')

  const open = artifact !== undefined

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (artifact === undefined) return
    let live = true
    setText('')
    setProblem('')
    fetchHandoffFile(runId, artifact.path, workspace)
      .then((body) => {
        if (live) setText(body)
      })
      .catch((cause: unknown) => {
        // A document that cannot be read is worth saying out loud: it was
        // listed, so something expected it to be there.
        if (live)
          setProblem(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      live = false
    }
  }, [artifact, runId, workspace])

  return (
    <dialog
      ref={ref}
      className="m-0 h-dvh max-h-dvh w-dvw max-w-dvw overflow-hidden border-0 bg-transparent p-4 backdrop:bg-bg/55 backdrop:brightness-0 open:flex open:items-center open:justify-center"
      onCancel={(event) => {
        // Escape fires `cancel` without telling React; without this the state
        // that opened the viewer stays set and it never opens again.
        event.preventDefault()
        onClose()
      }}
      aria-label={
        artifact?.title === '' ? artifact.name : (artifact?.title ?? '')
      }
    >
      {/*
        The click-away target: a real button filling the dialog behind the
        panel, so it is reachable, announced and operable by keyboard rather
        than a mouse-only affordance bolted to a non-interactive element.
      */}
      <button
        type="button"
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        aria-label="close this document"
        onClick={onClose}
      />
      {/* Keep a reading-sized minimum, capped by the available dialog space
          so the close control remains reachable on short screens. */}
      <div className="@container relative flex min-h-[min(100%,--spacing(128))] max-h-full w-full min-w-0 max-w-6xl flex-col overflow-hidden rounded-2xl border-(length:--border-width) border-border [background:var(--surface)] text-text">
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-4.5 pt-3.5 pb-1.5">
          <span className="min-w-0 text-base font-semibold wrap-anywhere">
            <span aria-hidden="true">📎</span>{' '}
            {artifact === undefined || artifact.title === ''
              ? (artifact?.name ?? '')
              : artifact.title}
          </span>
          <span className="flex-1" />
          {artifact !== undefined && (
            <a
              className={cx(BUTTON, ACTION.raw)}
              href={handoffHref(runId, artifact.path, workspace)}
              target="_blank"
              rel="noreferrer"
            >
              open raw
            </a>
          )}
          <button
            type="button"
            className={cx(BUTTON, ACTION.close)}
            onClick={onClose}
          >
            close
          </button>
        </header>
        <p className="m-0 shrink-0 px-4.5 pb-2.5 font-mono text-xs text-dim wrap-anywhere">
          {artifact?.path}
        </p>
        <div className="min-h-0 overflow-auto px-4.5 pb-4.5">
          {problem !== '' && <div className="error-bar">{problem}</div>}
          {problem === '' && text === '' && (
            <div className="faint">loading…</div>
          )}
          {text !== '' &&
            (artifact !== undefined && isMarkdown(artifact.path) ? (
              // Safe: renderMarkdown HTML-escapes all input before producing
              // any tag, which matters more here than anywhere else in the app
              // — this is a document a model wrote.
              <Prose html={renderMarkdown(text)} variant="handoff-document" />
            ) : (
              <pre className="m-0 font-mono text-sm! whitespace-pre-wrap wrap-anywhere">
                {text}
              </pre>
            ))}
        </div>
      </div>
    </dialog>
  )
}
