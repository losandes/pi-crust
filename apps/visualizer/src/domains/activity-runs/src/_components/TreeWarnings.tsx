/**
 * What the run could not account for, where the run is being read.
 *
 * It is a report, not a question: nothing is waiting on the reader, nothing
 * was undone, and there is no button here. That is the whole claim the panel
 * makes, so it is styled as a note rather than as an alert — an alert reads
 * as "something is broken", and the usual cause is a developer saving a file
 * in their own repository while the run worked.
 */
import { TriangleAlert } from 'lucide-react'
import { cx } from '@/lib/cx'
import type { TTreeWarning } from '../usecases/warnings'
import { warningExplanation, warningTitle } from '../usecases/warnings'

const KINDS: readonly TTreeWarning['kind'][] = [
  'unexpected',
  'overstep',
  'refusal',
  'uncommitted',
]

export const TreeWarnings = ({
  warnings,
  standalone = false,
}: Readonly<{
  warnings: readonly TTreeWarning[]
  /**
   * On the page itself rather than inside a column that owns its gutter.
   *
   * Same arrangement as the decision request, and for the same reason: the
   * Activity screen renders this inside a padded column, so a horizontal
   * margin baked into the panel would double there, and the session page has
   * no padding of its own, so without one the panel runs to the edge of the
   * window while every card beside it does not.
   */
  standalone?: boolean
}>) => {
  if (warnings.length === 0) return undefined

  return (
    <div
      className={cx(
        'my-3 flex min-w-0 flex-col gap-4 rounded-lg border-(length:--border-width) border-border-soft border-l-3 border-l-amber bg-panel-2 px-4 py-3.5 wrap-anywhere',
        standalone && 'mx-7 mt-5',
      )}
    >
      {KINDS.map((kind) => {
        const group = warnings.filter((warning) => warning.kind === kind)
        if (group.length === 0) return undefined

        return (
          <section key={kind} className="flex min-w-0 flex-col gap-2">
            <h5 className="m-0 flex items-center gap-2 text-base font-bold tracking-[0.05em] text-amber lowercase">
              <TriangleAlert className="shrink-0" size={16} strokeWidth={2} />
              {warningTitle(kind)}
            </h5>
            {group.map((warning, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two warnings in one group can be identical in stage, Activity Runs and paths and differ only in their note, so position is the only identity they have; the list is rebuilt whole and never reorders
              <div key={index} className="flex min-w-0 flex-col gap-1">
                {/* Issue #90 §1.4.2 requires unchanged type: retain 15px as 0.9375rem, not a rounded text step. */}
                <span className="text-[0.9375rem] font-semibold">
                  {warning.activities.join(', ')}
                  <span className="text-dim"> ({warning.stage})</span>
                </span>
                <ul className="m-0 list-disc pl-4.5">
                  {warning.paths.map((path, pathIndex) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: a warning records one entry per match, so the same path legitimately appears twice; position is the only identity these lines have, and the list never reorders
                      key={pathIndex}
                      className="font-mono text-sm leading-normal"
                    >
                      {path}
                    </li>
                  ))}
                </ul>
                {warning.note !== '' && (
                  <p className="m-0 text-sm leading-normal text-dim">
                    {warning.note}
                  </p>
                )}
              </div>
            ))}
            <p className="m-0 text-sm leading-normal text-dim">
              {warningExplanation(kind)}
            </p>
          </section>
        )
      })}
    </div>
  )
}
