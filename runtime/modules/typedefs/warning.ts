/**
 * What a run REPORTS about the working tree, rather than acts on.
 *
 * pi-crust used to answer an unexplained change by undoing it, which assumed
 * it knew whose change it was. It does not: a developer editing the same
 * branch while a run works is a supported way to use this tool, and nothing
 * in a diff distinguishes their save from an agent's write. So the answer to
 * everything it cannot attribute is a warning — named, recorded, and carried
 * to the end of the run, where a person decides.
 *
 * The exception is a call pi-crust CAN attribute: a tool call naming a
 * protected or gitignored path is refused before it runs, and the refusal is
 * reported here too. That is the same record reaching the same surfaces, not
 * a second mechanism.
 *
 * One event name, one shape, four readers: the terminal at the end of a run,
 * `just crust report`, the visualizer's session screen, and the visualizer's
 * Activity screen. Recomputing this in four places is how four surfaces come
 * to disagree about what happened.
 */

/**
 * Why a warning was raised.
 *
 *   unexpected  a path changed during an Activity Run that was not already
 *               dirty and that the Activity did not report. Unattributable.
 *   overstep    a path outside the Activity's `writes` changed, or history
 *               moved under an Activity that was not committing. Detected
 *               exactly as before; no longer fatal, and never undone.
 *   refusal     a tool call was governed by the path policy — blocked before
 *               it ran, or allowed and recorded under `stop` or `warn`.
 *   uncommitted an Activity's gates passed, it declared `commit: true`, and
 *               git refused the commit. The work is in the tree; nothing was
 *               staged back, unstaged, or signed on anybody's behalf.
 *   outside_workspace  a claimed path resolved only against the VCS root, not
 *               the workspace -- a monorepo workspace legitimately owning
 *               work that lives above it. Never fails the gate; see
 *               specs/todos/FIX-WORKSPACE-AND-VCS-ROOTS.md -- 1.3.3.
 */
export type TWarningKind =
  | 'unexpected'
  | 'overstep'
  | 'refusal'
  | 'uncommitted'
  | 'outside_workspace'

/** The `log` event name every warning is written under, and read back by. */
export const WARNING_EVENT = 'tree_warning'

export type TTreeWarning = Readonly<{
  kind: TWarningKind
  /**
   * The Activities that were running when it happened.
   *
   * One name in the ordinary case. A concurrent Stage raises ONE warning for
   * the Stage rather than one per Activity saying the same thing, because
   * the paths are exactly as unattributable between two siblings as they are
   * between an agent and a developer — and three copies of an answer nobody
   * can act on is noise, not evidence.
   */
  activities: readonly string[]
  /** the Activity Runs it belongs to — what the Activity screen matches on */
  activityRunIds: readonly string[]
  /** the Stage the Activities belonged to; the Activity name when serial */
  stage: string
  paths: readonly string[]
  /** what this particular warning adds, beyond what its kind already says */
  note: string
}>

const UNATTRIBUTABLE =
  'These files changed while the Activity ran and it did not report them.\n' +
  "They may be the Activity's work, or yours — pi-crust cannot tell.\n" +
  'Nothing was changed back.'

/** The sentence under a group of paths, which is the whole point of the kind. */
export const warningExplanation = (kind: TWarningKind): string =>
  kind === 'unexpected'
    ? UNATTRIBUTABLE
    : kind === 'overstep'
      ? 'This Activity changed paths outside what it declared it writes.\n' +
        'Nothing was changed back — the tree is yours to settle.'
      : kind === 'refusal'
        ? 'The path policy governed these tool calls. A blocked call never ran.'
        : kind === 'uncommitted'
          ? 'The work is in the working tree. Nothing was staged back, unstaged, ' +
            "or signed on anybody's behalf — commit it yourself when you are " +
            'ready.'
          : 'These paths exist above the workspace, inside the repository it is ' +
            'nested in — a supported layout, not a mistake. Resolved and acted ' +
            'on exactly as a path inside the workspace would be.'

const headline = (warning: TTreeWarning): string =>
  `${warning.activities.join(', ')} (${warning.stage})`

/** The three kinds a tool call or an observed diff can raise, counted together. */
const ATTRIBUTION_KINDS: readonly TWarningKind[] = [
  'unexpected',
  'overstep',
  'refusal',
]

const renderGroup = (
  warnings: readonly TTreeWarning[],
  kind: TWarningKind,
): readonly string[] => {
  const group = warnings.filter((warning) => warning.kind === kind)

  return group.length === 0
    ? []
    : [
        '',
        ...group.flatMap((warning) => [
          `  ${headline(warning)}`,
          ...warning.paths.map((path) => `    - ${path}`),
          ...(warning.note === '' ? [] : [`    ${warning.note}`]),
        ]),
        '',
        ...warningExplanation(kind)
          .split('\n')
          .map((line) => `  ${line}`),
      ]
}

/**
 * Paths resolved outside the workspace are information, not a fault -- a
 * nested workspace owning work above it is a supported layout (1.3.3,
 * 1.5.3). Counted and headlined on its own, with no \u26a0, so a run of a
 * correct configuration does not read as something gone wrong.
 */
const renderOutsideWorkspace = (
  warnings: readonly TTreeWarning[],
): readonly string[] => {
  const group = warnings.filter((warning) => warning.kind === 'outside_workspace')
  if (group.length === 0) {
    return []
  }
  const total = group.reduce((sofar, warning) => sofar + warning.paths.length, 0)

  return [
    `${total} claim(s) resolved outside the workspace, inside the repository`,
    ...renderGroup(group, 'outside_workspace'),
  ]
}

/**
 * Every warning a run raised, as lines a terminal or a report can print.
 *
 * Grouped by kind so a reader meets one explanation per class rather than one
 * per path, and empty for a run that raised none — a surface asking for them
 * prints nothing at all rather than an encouraging empty heading.
 *
 * `uncommitted` renders as its own block with its own headline, counted
 * separately from the three attribution kinds: the existing `⚠ <n>
 * unexplained change(s) during this run` line reports what pi-crust could
 * not tell apart from the developer's own edits, and a commit git refused is
 * a different claim — whose work it is was never in question.
 */
export const renderWarnings = (
  warnings: readonly TTreeWarning[],
): readonly string[] => {
  if (warnings.length === 0) {
    return []
  }
  const attributable = warnings.filter((warning) =>
    ATTRIBUTION_KINDS.includes(warning.kind),
  )
  const uncommitted = warnings.filter((warning) => warning.kind === 'uncommitted')
  const attributableTotal = attributable.reduce(
    (sofar, warning) => sofar + warning.paths.length,
    0,
  )
  const uncommittedTotal = uncommitted.reduce(
    (sofar, warning) => sofar + warning.paths.length,
    0,
  )

  return [
    ...(attributable.length === 0
      ? []
      : [
          `\u26a0 ${attributableTotal} unexplained change(s) during this run`,
          ...ATTRIBUTION_KINDS.flatMap((kind) => renderGroup(attributable, kind)),
        ]),
    ...(uncommitted.length === 0
      ? []
      : [
          `\u26a0 ${uncommittedTotal} commit(s) this run could not make`,
          ...renderGroup(uncommitted, 'uncommitted'),
        ]),
    ...renderOutsideWorkspace(warnings),
  ]
}

/** A traced payload read back as a warning, tolerating anything older. */
export const warningFromPayload = (
  payload: Readonly<Record<string, unknown>>,
): TTreeWarning | undefined => {
  const strings = (value: unknown): readonly string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : []
  const kind = payload.kind
  if (
    kind !== 'unexpected' &&
    kind !== 'overstep' &&
    kind !== 'refusal' &&
    kind !== 'uncommitted' &&
    kind !== 'outside_workspace'
  ) {
    return undefined
  }

  return {
    kind,
    activities: strings(payload.activities),
    activityRunIds: strings(payload.activity_run_ids),
    stage: typeof payload.stage === 'string' ? payload.stage : '',
    paths: strings(payload.paths),
    note: typeof payload.note === 'string' ? payload.note : '',
  }
}

/** The payload shape, so every writer files the same keys. */
export const warningPayload = (
  warning: TTreeWarning,
): Readonly<Record<string, unknown>> => ({
  kind: warning.kind,
  activities: warning.activities,
  activity_run_ids: warning.activityRunIds,
  stage: warning.stage,
  paths: warning.paths,
  note: warning.note,
})
