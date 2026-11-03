import { Check, Circle, Hand, History, LoaderCircle, X } from 'lucide-react'
import type { ComponentType } from 'react'
import styles from './StatusChip.module.css'

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

export const StatusChip = ({ status }: { status: string }) => {
  const Icon = ICONS[status] ?? Circle
  const tone = styles[status]
  return (
    <span
      className={tone === undefined ? styles.chip : `${styles.chip} ${tone}`}
    >
      <Icon className={styles.icon} size={18} strokeWidth={2.5} />
      {status}
    </span>
  )
}
