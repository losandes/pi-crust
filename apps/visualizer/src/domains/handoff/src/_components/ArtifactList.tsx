/**
 * The documents a activity produced, as cards you can open.
 *
 * One card per document rather than one card listing them all, because the
 * useful context is per-document: the agent's own summary of what it
 * concluded is what turns a filename into something a reader can decide
 * whether to open, and it belongs to one file.
 *
 * A document nobody claimed still gets a card, a thinner one. Over-reporting
 * is deliberate — a file a activity forgot to report is still a file somebody
 * would otherwise go hunting for — and the thinness is honest about how much
 * is known.
 */
import type { KeyboardEvent, MouseEvent } from 'react'
import { cx } from '@/lib/cx'
import type { TArtifact } from '../usecases/artifacts'

const CARD: Readonly<Record<TArtifact['source'], string>> = {
  reported: 'border-border-soft',
  observed: 'border-border-soft',
  missing: 'border-red [&>span:last-child]:text-red',
  system: 'border-border-soft opacity-62',
}

/**
 * Whether the click that just happened was somebody selecting text.
 *
 * A card opens on click AND its path must be selectable, which conflict:
 * finishing a drag-select fires a click. The selection is the tell \u2014 if the
 * user has highlighted something, they were copying a path, not asking for
 * the document.
 */
const isSelecting = (): boolean => {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed
}

const LABEL: Readonly<Record<TArtifact['source'], string>> = {
  reported: '',
  observed: 'not reported by the activity',
  missing: 'reported but not found',
  system: '',
}

export const ArtifactList = ({
  artifacts,
  onOpen,
}: Readonly<{
  artifacts: readonly TArtifact[]
  onOpen: (artifact: TArtifact) => void
}>) => {
  if (artifacts.length === 0) return <div className="faint">no documents</div>

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {artifacts.map((artifact) => (
        /*
         * A div with button semantics rather than a <button>, because a
         * button's contents cannot be selected \u2014 and a path you cannot copy
         * is a path you have to retype. Keyboard and screen-reader behaviour
         * are restored explicitly, which is the cost of the choice.
         */
        // biome-ignore lint/a11y/useSemanticElements: a <button> forbids selecting the path, which is the point of showing it
        <div
          key={artifact.path}
          role="button"
          tabIndex={artifact.source === 'missing' ? -1 : 0}
          aria-disabled={artifact.source === 'missing'}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (artifact.source === 'missing') return
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onOpen(artifact)
          }}
          className={cx(
            'flex w-full min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl border-(length:--border-width) bg-panel-2 px-3.5 py-3 text-left font-card text-text wrap-anywhere hover:border-accent focus-visible:border-accent',
            CARD[artifact.source],
          )}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            // A missing file has nothing to open; the card exists to report
            // the discrepancy, so it says so rather than opening nothing.
            if (artifact.source === 'missing') return
            if (isSelecting()) return
            event.preventDefault()
            onOpen(artifact)
          }}
        >
          <span className="flex items-baseline gap-2">
            <span aria-hidden="true">📎</span>
            <span className="min-w-0 font-semibold">
              {artifact.title === '' ? artifact.name : artifact.title}
            </span>
          </span>
          <span className="font-mono text-xs text-dim wrap-anywhere">
            {artifact.path}
          </span>
          {artifact.summary !== '' && (
            <span className="text-sm/normal text-dim">{artifact.summary}</span>
          )}
          {LABEL[artifact.source] !== '' && (
            <span className="text-xs text-amber">{LABEL[artifact.source]}</span>
          )}
        </div>
      ))}
    </div>
  )
}
