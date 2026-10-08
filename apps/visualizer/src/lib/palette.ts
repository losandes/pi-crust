/**
 * Agent colours, resolved against the theme instead of pasted into config.
 *
 * The roster used to carry hex. Those hexes were chosen against the dark
 * theme, so on the light theme a lane label sat at roughly 1.7:1 on white and
 * in high contrast they quietly defeated the ratios that theme exists to
 * guarantee. The theme layer had already solved this for everything else —
 * every hue is a channel triple that each theme restates — and agent colours
 * routed around it.
 *
 * So the roster names a ROLE and the theme owns the value. `amber` resolves
 * to `rgb(var(--amber-rgb))`, which re-resolves the moment a theme changes,
 * including for runs recorded months ago: the trace stores the name it was
 * given, never a colour, so an old run renders correctly in a theme that did
 * not exist when it ran.
 *
 * Hex still works, and is the escape hatch. A stamped repository somewhere
 * already has hexes, and somebody will want one that is not in the palette —
 * but a hex is theme-unaware by definition, and its contrast is the author's
 * problem rather than the theme's.
 */

/**
 * The roles an agent may take, in the order they are handed out.
 *
 * `red` is deliberately absent: it means a failed phase everywhere else in
 * this interface, and an agent permanently wearing the failure colour would
 * be read as broken at a glance.
 */
export const AGENT_ROLES = [
  'blue',
  'amber',
  'green',
  'purple',
  'cyan',
  'pink',
  'violet',
  'orange',
  'teal',
  'indigo',
  'rose',
  'lime',
] as const

export type TAgentRole = (typeof AGENT_ROLES)[number]

const ROLES: ReadonlySet<string> = new Set(AGENT_ROLES)

export const isAgentRole = (value: string): value is TAgentRole =>
  ROLES.has(value)

const HEX = /^#?([0-9a-f]{6})$/i

/**
 * A colour usable in an inline style, at full strength or with alpha.
 *
 * One function for both forms, because every caller needs both and a pair
 * that could disagree about what `cyan` means is a bug waiting to happen.
 * The CSS relative-alpha syntax `rgb(R G B / a)` is why the theme stores
 * channel triples rather than finished colours.
 */
export const paletteColor = (color: string, alpha = 1): string => {
  const name = color.trim()
  if (isAgentRole(name)) {
    return alpha >= 1
      ? `rgb(var(--${name}-rgb))`
      : `rgb(var(--${name}-rgb) / ${alpha})`
  }
  const hex = HEX.exec(name)
  if (hex?.[1] !== undefined) {
    const value = Number.parseInt(hex[1], 16)
    const channels = `${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff}`
    return alpha >= 1 ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`
  }
  // Unreadable or absent: the caller already chose a fallback role for this
  // lane, so returning a colour here would override their choice with a
  // guess. `transparent` is visibly wrong, which is the point.
  return 'transparent'
}

/**
 * The role an agent wears: what it asked for, else one picked by position.
 *
 * Position rather than a hash of the name, because what matters in a
 * waterfall is that the lanes on screen TOGETHER differ — and adjacent
 * indices are guaranteed to, where a hash is only probably different.
 */
/**
 * A colour role per watched working tree, assigned by position.
 *
 * Same reasoning as agent lanes: what matters is that the trees on screen
 * TOGETHER differ, and adjacent indices are guaranteed to differ where a
 * hash is only probably different. Sorting first means the assignment does
 * not shuffle when a tree with no runs yet starts producing them.
 *
 * A tree's colour can collide with an agent's. That is tolerable because the
 * two never take the same SHAPE — a workspace is a text chip, an agent is a
 * lane or a dot — and avoiding it would mean reserving half the palette from
 * the lanes, which are the thing people actually read.
 */
export const workspaceRoles = (
  labels: readonly string[],
): ReadonlyMap<string, string> =>
  new Map(
    labels
      .toSorted((left, right) => left.localeCompare(right))
      .map((label, index) => [
        label,
        AGENT_ROLES[index % AGENT_ROLES.length] ?? 'blue',
      ]),
  )

export const agentRole = (
  configured: string | undefined,
  index: number,
): string => {
  const named = (configured ?? '').trim()
  if (named !== '') return named
  return AGENT_ROLES[index % AGENT_ROLES.length] ?? 'blue'
}
