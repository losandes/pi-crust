export const buildProductionCss = async (): Promise<string> => {
  const { build } = await import('vite')
  const result = await build({
    root: new URL('../../../../', import.meta.url).pathname,
    logLevel: 'silent',
    build: { write: false },
  })
  return (Array.isArray(result) ? result : [result])
    .flatMap((output) => ('output' in output ? output.output : []))
    .flatMap((asset) =>
      asset.type === 'asset' && asset.fileName.endsWith('.css')
        ? [
            typeof asset.source === 'string'
              ? asset.source
              : new TextDecoder().decode(asset.source),
          ]
        : [],
    )
    .join('\n')
}
