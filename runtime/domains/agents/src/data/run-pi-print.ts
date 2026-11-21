import { spawn } from 'node:child_process'

export const runPiPrint = async (
  argv: readonly string[],
  cwd: string,
): Promise<Readonly<{ ok: boolean; output: string }>> =>
  new Promise((settle) => {
    const [binary, ...rest] = argv
    /*
     * stdin IGNORED, deliberately. With the default pipe, pi's print mode
     * waits on a stdin that nobody is going to close and the consult hangs
     * forever — observed as a 600-second timeout against a real run, where
     * the same argv from a terminal answered in seconds.
     */
    const child = spawn(binary ?? 'pi', rest, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // The joined text, accumulated as text: `chunks.join('')` was the only
    // thing the array was ever used for.
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('close', (code) => settle({ ok: code === 0, output }))
  })
