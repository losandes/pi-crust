export type TUiListener = Readonly<{ host: string; port: number }>

export const uiListenerFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
): TUiListener | undefined => {
  const host = env.CRUST_UI_HOST?.trim()
  if (!host) return undefined
  const raw = env.CRUST_FE_PORT ?? ''
  const port = Number(raw)
  return {
    host,
    port:
      /^\d+$/.test(raw) && Number.isInteger(port) && port <= 65535
        ? port
        : 4601,
  }
}

export const uiAddresses = (
  host: string,
  port: number,
  interfaces: Readonly<
    Record<
      string,
      | readonly Readonly<{
          address: string
          family: string
          internal: boolean
        }>[]
      | undefined
    >
  >,
): readonly string[] => {
  if (host === '127.0.0.1') return [`http://localhost:${port}`]
  if (host === '0.0.0.0')
    return [
      `http://localhost:${port}`,
      ...Object.values(interfaces).flatMap((entries) =>
        (entries ?? [])
          .filter((entry) => entry.family === 'IPv4' && !entry.internal)
          .map((entry) => `http://${entry.address}:${port}`),
      ),
    ]
  return [`http://${host.includes(':') ? `[${host}]` : host}:${port}`]
}
