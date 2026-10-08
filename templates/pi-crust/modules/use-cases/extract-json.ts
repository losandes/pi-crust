/**
 * Pull the final JSON object out of whatever the model actually said.
 *
 * The prompt asks for bare JSON, but a chatty turn wraps it in a fenced block
 * or surrounds it with prose. This is the thing standing between that and a
 * failed run, so the order matters: a fenced block that starts with `{` wins,
 * and otherwise the outermost braces in the whole response are taken.
 */

export const extractJson = (text: string): unknown => {
  const fenced = text.includes('```')
    ? text
        .split('```')
        .filter((_part, index) => index % 2 === 1)
        .map((block) =>
          (block.startsWith('json')
            ? block.slice('json'.length)
            : block
          ).trim(),
        )
        .find((block) => block.startsWith('{'))
    : undefined
  const candidate = fenced ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('no JSON object found in the response')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}
