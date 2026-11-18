export const HANDOFF_RULE = '---'
export const HANDOFF_DIVIDER_PREFIX = '> _Handoff: '
export const HANDOFF_DIVIDER_SUFFIX = '_'
export const HANDOFF_END_LINE = '> _End of handoffs_'
export const IMPORTED_WORK_FILE = 'imported-work.md'
export const IMPORTED_UNATTRIBUTED_FILE = 'imported-unattributed.md'

export type THandoffSection = Readonly<{ label: string; text: string }>
export type THandoffSplit = Readonly<{
  preamble: string
  sections: readonly THandoffSection[]
  epilogue: string
  dividers: number
}>

type TMarker = Readonly<{ at: number; label: string; end: boolean }>
type TFence = Readonly<{ character: string; length: number }>
type TScan = Readonly<{
  fence: TFence | undefined
  markers: readonly TMarker[]
  skip: number
}>

export const trimBlankLines = (text: string): string => {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const first = lines.findIndex((line) => !/^\s*$/.test(line))
  if (first < 0) return ''
  const last = lines.findLastIndex((line) => !/^\s*$/.test(line))
  return `${lines
    .slice(first, last + 1)
    .join('')
    .replace(/\r?\n$/, '')}\n`
}

export const splitHandoffSections = (text: string): THandoffSplit => {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const comparable = lines.map((line) =>
    line
      .replace(/\n$/, '')
      .replace(/\r$/, '')
      .replace(/[\t ]+$/, ''),
  )
  const scan = comparable.reduce<TScan>(
    (state, line, at) => {
      if (at < state.skip) return state
      if (state.fence !== undefined) {
        const closing = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1]
        return closing !== undefined &&
          closing[0] === state.fence.character &&
          closing.length >= state.fence.length
          ? { skip: state.skip, markers: state.markers, fence: undefined }
          : state
      }
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (opening !== undefined)
        return {
          skip: state.skip,
          markers: state.markers,
          fence: { character: opening[0] ?? '', length: opening.length },
        }
      if (line !== HANDOFF_RULE || comparable[at + 2] !== HANDOFF_RULE)
        return state
      const middle = comparable[at + 1] ?? ''
      const end = middle === HANDOFF_END_LINE
      const label =
        middle.startsWith(HANDOFF_DIVIDER_PREFIX) &&
        middle.endsWith(HANDOFF_DIVIDER_SUFFIX)
          ? middle.slice(
              HANDOFF_DIVIDER_PREFIX.length,
              -HANDOFF_DIVIDER_SUFFIX.length,
            )
          : ''
      if (!(end || label.trim() !== '')) return state
      return {
        fence: state.fence,
        skip: at + 3,
        markers: [...state.markers, { at, label, end }],
      }
    },
    { fence: undefined, markers: [], skip: 0 },
  )
  const first = scan.markers.find((marker) => !marker.end)
  if (first === undefined)
    return {
      preamble: trimBlankLines(text),
      sections: [],
      epilogue: '',
      dividers: 0,
    }
  const end = scan.markers.find((marker) => marker.end && marker.at > first.at)
  const dividers = scan.markers.filter(
    (marker) => !marker.end && (end === undefined || marker.at < end.at),
  )
  return {
    preamble: trimBlankLines(lines.slice(0, first.at).join('')),
    sections: dividers.map((marker, index) => ({
      label: marker.label,
      text: trimBlankLines(
        lines
          .slice(
            marker.at + 3,
            dividers[index + 1]?.at ?? end?.at ?? lines.length,
          )
          .join(''),
      ),
    })),
    epilogue:
      end === undefined ? '' : trimBlankLines(lines.slice(end.at + 3).join('')),
    dividers: dividers.length,
  }
}
