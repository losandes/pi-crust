import { BookOpen, CircleDollarSign, Coins, PenLine, Timer } from 'lucide-react'
import type { ComponentType } from 'react'
import { cx } from '@/lib/cx'
import { fmtCost, fmtDuration, fmtTokens } from '@/lib/format'

export type TStatKind = 'cost' | 'tokens' | 'runtime' | 'read' | 'written'

type TIconProps = Readonly<{
  size?: number
  strokeWidth?: number
  className?: string
}>

const ICONS: Readonly<Record<TStatKind, ComponentType<TIconProps>>> = {
  cost: CircleDollarSign,
  tokens: Coins,
  runtime: Timer,
  read: BookOpen,
  written: PenLine,
}

/**
 * Every chip explains itself on hover. The token numbers in particular are
 * read wrong without one — the headline is billed volume, not distinct tokens.
 */
const TITLES: Readonly<Record<TStatKind, string>> = {
  cost: 'Cost — dollars billed for this run, all agents combined.',
  tokens:
    'Tokens exchanged (billed) — everything sent or generated, counted once per turn. ' +
    'Each turn re-sends the whole conversation, so this is far larger than the ' +
    'conversation itself: it is spend, not size. The gap between it and read + ' +
    'written is cached context re-read on later turns.',
  runtime:
    'Duration — wall-clock from the first activityRun starting to the last one ending.',
  read:
    'Read — raw tokens the models took in: prompts, file contents and tool results, ' +
    'counted the first time they enter the context. Excludes cached re-reads of ' +
    'material already counted here.',
  written:
    'Written — tokens the models actually generated. Each one produced exactly ' +
    'once, so this is a true count of output.',
}

export const StatChip = ({
  kind,
  value,
  compact = false,
}: Readonly<{
  kind: TStatKind
  /** Raw value — cost in dollars, tokens as a count, runtime in milliseconds. */
  value: number | undefined
  /** Bare value, no pill chrome — for tight spots like waterfall blocks. */
  compact?: boolean
}>) => {
  const Icon = ICONS[kind]
  const text =
    kind === 'cost'
      ? fmtCost(value)
      : kind === 'runtime'
        ? fmtDuration(value ?? Number.NaN)
        : fmtTokens(value)

  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-full text-base whitespace-nowrap',
        compact
          ? 'border-none p-0'
          : 'border-[length:var(--border-width)] border-border-soft bg-panel-2/60 px-3 py-0.5',
      )}
      title={TITLES[kind]}
    >
      <Icon
        className="flex-none text-faint"
        size={compact ? 17 : 19}
        strokeWidth={2}
      />
      <span
        className={cx(
          'font-mono tabular-nums',
          compact ? 'text-dim' : 'text-text',
        )}
      >
        {text}
      </span>
    </span>
  )
}
