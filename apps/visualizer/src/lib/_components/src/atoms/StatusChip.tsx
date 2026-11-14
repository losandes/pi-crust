import type { ActivityRunStatus, SessionStatus } from '@shared/types'
import { Check, Circle, Hand, History, LoaderCircle, X } from 'lucide-react'
import type { ComponentType } from 'react'
import { cx } from '@/lib/cx'

type TIconProps = Readonly<{
  size?: number
  strokeWidth?: number
  className?: string
}>

const ICONS: Readonly<Record<string, ComponentType<TIconProps>>> = {
  success: Check,
  fail: X,
  running: LoaderCircle,
  queued: Circle,
  /*
   * A hand, not an hourglass. An hourglass says time is passing; this run is
   * not passing time, it is stopped until somebody does something.
   */
  waiting: Hand,
  superseded: History,
}

const TONE: Readonly<Partial<Record<string, string>>> = {
  success:
    'border-ok/[calc(var(--edge-alpha)*100%)] bg-ok/9 text-ok shadow-[0_0_--spacing(3)_rgb(var(--ok-rgb)/0.12)]',
  fail: 'border-fail/[calc(var(--edge-alpha)*100%)] bg-fail/9 text-fail shadow-[0_0_--spacing(3)_rgb(var(--fail-rgb)/0.12)]',
  running:
    'border-busy/[calc(var(--edge-alpha)*100%)] bg-busy/9 text-busy shadow-[0_0_--spacing(3)_rgb(var(--busy-rgb)/0.18)]',
  queued: 'border-border text-dim border-dashed',
  waiting:
    'border-waiting/[calc(var(--edge-alpha)*100%)] bg-waiting/12 text-waiting shadow-[0_0_--spacing(3.5)_rgb(var(--waiting-rgb)/0.22)]',
  superseded: 'border-border text-dim line-through',
} satisfies Readonly<Record<SessionStatus | ActivityRunStatus, string>>

export const StatusChip = ({ status }: Readonly<{ status: string }>) => {
  const Icon = ICONS[status] ?? Circle
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-full border-[length:var(--border-width)] py-0.5 pr-3 pl-2.5 text-base whitespace-nowrap',
        TONE[status] ?? 'border-border text-dim',
      )}
    >
      <Icon
        className={cx(
          'flex-none',
          status === 'running' && 'animate-[crust-spin_1.1s_linear_infinite]',
        )}
        size={18}
        strokeWidth={2.5}
      />
      {status}
    </span>
  )
}
