import type { ComponentType, ReactNode } from 'react'
import styles from './DetailSection.module.css'

type TIconProps = Readonly<{
  size?: number
  strokeWidth?: number
  className?: string
}>

export const DetailSection = ({
  title,
  icon: Icon,
  count,
  open,
  onToggle,
  children,
}: Readonly<{
  title: string
  /** Lucide icon rendered before the title. */
  icon?: ComponentType<TIconProps>
  /** Shown after the title; omit for sections without a natural count. */
  count?: number
  open: boolean
  onToggle: () => void
  children?: ReactNode
}>) => (
  <section className={styles.section}>
    <button type="button" className={styles.head} onClick={onToggle}>
      <span className={styles.chev}>{open ? '\u25be' : '\u25b8'}</span>
      {Icon !== undefined && (
        <Icon className={styles.icon} size={19} strokeWidth={2} />
      )}
      <span className={styles.title}>{title}</span>
      {count !== undefined && (
        <span className={`${styles.count} dim`}>({count})</span>
      )}
    </button>
    {open && <div className={styles.body}>{children}</div>}
  </section>
)
