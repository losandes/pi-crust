export const DEFAULT_POLL_MS = 500

export const pollMsFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): number => {
  const value = env.CRUST_POLL_MS ?? ''
  const parsed = Number(value)
  return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(parsed)
    ? parsed
    : DEFAULT_POLL_MS
}
