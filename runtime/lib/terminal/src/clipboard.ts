/**
 * Putting a line on the clipboard, when there is a clipboard to put it on.
 *
 * A command builder that makes you select its output with the mouse has done
 * most of the work and stopped short of the useful part.
 *
 * Copying is a convenience, never a requirement: over ssh, in a container or
 * in CI there is no clipboard, and failing a command because a nicety was
 * unavailable would be absurd. Every path here reports what happened and
 * nothing throws — the line is printed either way, so the worst case is the
 * behaviour we had before.
 */

import { spawn } from 'node:child_process'
import { errorMessage } from '../../../../lib/typedefs'

export type TCopied = Readonly<{ copied: boolean; how: string }>

/**
 * The platform tools, in the order they are worth trying.
 *
 * Wayland before X11 because a Wayland session usually still has `xclip`
 * present and talking to an X server that is not the one you can see.
 */
const COPIERS: readonly Readonly<{
  command: readonly string[]
  how: string
}>[] = [
  { command: ['pbcopy'], how: 'pbcopy' },
  { command: ['wl-copy'], how: 'wl-copy' },
  { command: ['xclip', '-selection', 'clipboard'], how: 'xclip' },
  { command: ['xsel', '--clipboard', '--input'], how: 'xsel' },
]

/**
 * One attempt, settled rather than thrown.
 *
 * The error is kept, not swallowed. "Not installed" and "installed but it
 * exited 1" look identical from the outside and have completely different
 * answers, so whichever happened has to survive as far as the message.
 */
const tryCopy = async (
  command: readonly string[],
  text: string,
): Promise<Readonly<{ ok: boolean; reason: string }>> => {
  try {
    const child = spawn(command[0] ?? '', command.slice(1), {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    const finished = new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.stdin?.once('error', reject)
      child.once('close', (code) => resolve(code ?? 1))
    })
    child.stdin?.end(text)
    const code = await finished
    return code === 0
      ? { ok: true, reason: '' }
      : { ok: false, reason: `${command[0]} exited ${code}` }
  } catch (error: unknown) {
    // Spawning failed outright: almost always "not on PATH", which is the
    // normal state on a machine with a different clipboard, or none.
    return { ok: false, reason: `${command[0]}: ${errorMessage(error)}` }
  }
}

/**
 * Copy text, reporting how — or why not.
 *
 * `how` names the tool rather than saying "yes", because when a paste turns
 * out to hold the wrong thing the first question is which clipboard it went
 * to, and on Linux that is a real question with three answers.
 */
/**
 * Try each tool in turn, stopping at the first that works.
 *
 * Recursive rather than a loop with an accumulator, and sequential rather
 * than parallel: the first tool that works wins, and writing to four
 * clipboards at once on a machine that has two of them would make which one
 * landed a race.
 */
const firstWorking = async (
  remaining: readonly (typeof COPIERS)[number][],
  text: string,
  failures: readonly string[],
): Promise<TCopied> => {
  const [head, ...rest] = remaining
  if (head === undefined) return { copied: false, how: explain(failures) }

  const attempt = await tryCopy(head.command, text)
  return attempt.ok
    ? { copied: true, how: head.how }
    : firstWorking(rest, text, failures.concat(attempt.reason))
}

/**
 * Every tool missing is the ordinary case — ssh, a container, CI — and saying
 * so plainly beats four "command not found" lines. A tool that was PRESENT
 * and failed is not ordinary, so that reason is carried out.
 */
const explain = (failures: readonly string[]): string => {
  const interesting = failures.filter(
    (reason) => !/not found|ENOENT/i.test(reason),
  )
  return interesting.length === 0
    ? 'no clipboard tool here (pbcopy, wl-copy, xclip, xsel)'
    : `clipboard failed: ${interesting.join('; ')}`
}

export const copyToClipboard = (text: string): Promise<TCopied> =>
  firstWorking(COPIERS, text, [])
