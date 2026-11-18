import type { TWorkReference } from '../typedefs/work-source'

const ISSUE_URL =
  /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)(#[\w-]+)?/g
const ISSUE_QUALIFIED = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+)\b/g
const ISSUE_NUMBER = /(?<![\w/#])#(\d+)\b/g
const DOCUMENT_SUFFIX = /\.(md|markdown)$/i

type TLocated = Readonly<{ at: number; reference: TWorkReference }>
type TScan = Readonly<{ text: string; found: readonly TLocated[] }>

export const findWorkReferences = (
  request: string,
  promptPath: string | undefined,
): readonly TWorkReference[] => {
  if (promptPath !== undefined && DOCUMENT_SUFFIX.test(promptPath)) {
    return [{ kind: 'document', written: promptPath, path: promptPath }]
  }
  const issues = [ISSUE_URL, ISSUE_QUALIFIED, ISSUE_NUMBER].reduce<TScan>(
    (scan, pattern) => {
      const matches = [...scan.text.matchAll(pattern)]
      return {
        text: scan.text.replace(pattern, (text) => ' '.repeat(text.length)),
        found: [
          ...scan.found,
          ...matches.map(
            (match): TLocated => ({
              at: match.index,
              reference: {
                kind: 'github-issue',
                written: match[0],
                repository:
                  pattern === ISSUE_NUMBER ? '' : `${match[1]}/${match[2]}`,
                number: Number(match[pattern === ISSUE_NUMBER ? 1 : 3]),
              },
            }),
          ),
        ],
      }
    },
    { text: request, found: [] },
  )
  const documents = [...issues.text.matchAll(/\S+/g)].flatMap(
    (match): readonly TLocated[] => {
      const strip = (token: string): string => {
        const next = token
          .replace(/^[`'"()[\]<>]+|[`'"()[\]<>]+$/g, '')
          .replace(/[.,;:!?]+$/g, '')
        return next === token ? token : strip(next)
      }
      const token = strip(match[0])
      return DOCUMENT_SUFFIX.test(token) && !token.includes('://')
        ? [
            {
              at: match.index,
              reference: { kind: 'document', written: token, path: token },
            },
          ]
        : []
    },
  )
  return [...issues.found, ...documents]
    .toSorted((a, b) => a.at - b.at)
    .map((item) => item.reference)
}
