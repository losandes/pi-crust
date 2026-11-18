import type { ComponentType, ReactNode } from 'react'

type TIconProps = Readonly<{
  size?: number
  strokeWidth?: number
  className?: string
}>

export const DetailSection = ({
  title,
  icon: Icon,
  count,
  trailing,
  open,
  onToggle,
  children,
}: Readonly<{
  title: string
  /** Lucide icon rendered before the title. */
  icon?: ComponentType<TIconProps>
  /** Shown after the title; omit for sections without a natural count. */
  count?: number
  /** Phrasing content rendered last on the header line, open or closed. */
  trailing?: ReactNode
  open: boolean
  onToggle: () => void
  children?: ReactNode
}>) => (
  <section className="mb-3.5">
    <button
      type="button"
      // Issue #171 SC3: unchanged appearance; the removed rule supplied the native button font.
      className="[font-family:revert] @container flex w-full cursor-pointer items-center gap-2 rounded-t-md border-0 border-b-[length:var(--border-width)] border-border-soft px-2 py-1.5 text-left text-base/[normal] font-bold tracking-wider text-dim lowercase hover:bg-panel-2 hover:text-text focus-visible:shadow-(--ring) focus-visible:outline-none"
      onClick={onToggle}
    >
      <span className="flex-none text-faint">{open ? '\u25be' : '\u25b8'}</span>
      {Icon !== undefined && (
        <Icon className="flex-none text-faint" size={19} strokeWidth={2} />
      )}
      <span className="min-w-0 @max-sm:wrap-anywhere">{title}</span>
      {count !== undefined && (
        <span className="font-medium text-dim">({count})</span>
      )}
      {trailing}
    </button>
    {open && <div className="pt-2.5">{children}</div>}
  </section>
)
