/**
 * The topic, ignoring `--config` and its value: the `help` recipe always
 * passes `--config {{config}}`, so the first remaining positional argument
 * is the recipe a developer named, if any.
 */
export const topicOf = (argv: readonly string[]): string | undefined => {
  const at = argv.indexOf('--config')
  const withoutConfig =
    at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)]

  return withoutConfig.find((token) => !token.startsWith('-'))
}
