import type { TRecipeDoc } from './recipe-docs'

export const renderCommandList = (docs: readonly TRecipeDoc[]): string => {
  const width = Math.max(0, ...docs.map((doc) => doc.name.length))
  return docs
    .map((doc) => `${doc.name.padEnd(width)}  ${doc.summary}`)
    .join('\n')
}
