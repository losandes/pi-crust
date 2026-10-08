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
import { fetchHandoffFile, handoffHref } from '../lib/api'
import type { TArtifact } from '../lib/artifacts'
import { renderMarkdown } from '../lib/markdown'
import styles from './DocumentViewer.module.css'

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
        if (live) setProblem(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      live = false
    }
  }, [artifact, runId, workspace])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onCancel={(event) => {
        // Escape fires `cancel` without telling React; without this the state
        // that opened the viewer stays set and it never opens again.
        event.preventDefault()
        onClose()
      }}
      aria-label={artifact?.title === '' ? artifact.name : (artifact?.title ?? '')}
    >
      {/*
        The click-away target: a real button filling the dialog behind the
        panel, so it is reachable, announced and operable by keyboard rather
        than a mouse-only affordance bolted to a non-interactive element.
      */}
      <button
        type="button"
        className={styles.scrim}
        aria-label="close this document"
        onClick={onClose}
      />
      <div className={styles.panel}>
        <header className={styles.head}>
          <span className={styles.title}>
            <span aria-hidden="true">📎</span>{' '}
            {artifact === undefined || artifact.title === ''
              ? (artifact?.name ?? '')
              : artifact.title}
          </span>
          <span className={styles.spacer} />
          {artifact !== undefined && (
            <a
              className={styles.raw}
              href={handoffHref(runId, artifact.path, workspace)}
              target="_blank"
              rel="noreferrer"
            >
              open raw
            </a>
          )}
          <button type="button" className={styles.close} onClick={onClose}>
            close
          </button>
        </header>
        <p className={styles.path}>{artifact?.path}</p>
        <div className={styles.body}>
          {problem !== '' && <div className="error-bar">{problem}</div>}
          {problem === '' && text === '' && <div className="faint">loading…</div>}
          {text !== '' &&
            (artifact !== undefined && isMarkdown(artifact.path) ? (
              // Safe: renderMarkdown HTML-escapes all input before producing
              // any tag, which matters more here than anywhere else in the app
              // — this is a document a model wrote.
              <div
                className={styles.markdown}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes its input
                dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
              />
            ) : (
              <pre className={styles.plain}>{text}</pre>
            ))}
        </div>
      </div>
    </dialog>
  )
}
