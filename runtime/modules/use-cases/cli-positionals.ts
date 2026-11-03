/**
 * The positional-argument guard shared by `resume`, `steer` and `decide`.
 *
 * All three pick a positional out of argv by excluding what starts with
 * `--`, which has the same hazard `parse-cli.ts` had before short flags
 * forced a fix: an unrecognised flag is read as a positional instead of
 * being refused by name. `resume.ts` and `steer.ts` both run `main()` at
 * import, so the guard has to live somewhere importable to be unit-tested at
 * all without spawning a subprocess — this module, and each CLI's own flag
 * spec, are that somewhere.
 *
 * None of these three CLIs gets short flags: see adr-free rationale in
 * issue #54 — only `run` does, and `-h` is never reserved.
 */

export type TSiblingCli = Readonly<{
  /** flags that consume the token after them */
  valueFlags: readonly string[]
  /** flags that take nothing */
  switches: readonly string[]
}>

export const RESUME_CLI: TSiblingCli = {
  valueFlags: ['--note'],
  switches: ['--detach'],
}

export const STEER_CLI: TSiblingCli = {
  valueFlags: ['--seeding', '--branch-id'],
  switches: ['--overwrite', '--branch'],
}

export const DECIDE_CLI: TSiblingCli = {
  valueFlags: ['--note', '--file', '--db', '--config'],
  switches: ['--detach'],
}

/**
 * The positional arguments, with an unrecognised `-` token refused by name.
 *
 * The token after a value-taking flag is always that flag's value, never a
 * flag itself and never positional — so `--note "-9 is wrong"` keeps "-9 is
 * wrong" as the note instead of being read as an unknown flag. A
 * `--flag=value` token is matched on the part before `=` and is otherwise
 * read exactly as it is today for these three CLIs, which is not at all:
 * none of them supports the inline form, and this does not add it.
 *
 * Throws `unknown flag: <name>`; the caller prints its own USAGE after it.
 */
export const positionalArgs = (
  argv: readonly string[],
  cli: TSiblingCli,
): readonly string[] => {
  type TAcc = Readonly<{ positional: readonly string[]; skipNext: boolean }>
  const { positional } = argv.reduce<TAcc>(
    (acc, token) => {
      if (acc.skipNext) {
        return { positional: acc.positional, skipNext: false }
      }
      const name = token.includes('=')
        ? token.slice(0, token.indexOf('='))
        : token
      if (cli.switches.includes(name)) {
        return { positional: acc.positional, skipNext: false }
      }
      if (cli.valueFlags.includes(name)) {
        return { positional: acc.positional, skipNext: !token.includes('=') }
      }
      if (token === '-' || token === '--' || token.startsWith('-')) {
        throw new Error(`unknown flag: ${name}`)
      }
      return { positional: [...acc.positional, token], skipNext: false }
    },
    { positional: [], skipNext: false },
  )
  return positional
}
