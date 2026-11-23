export const taskArtifactName = ({
  name,
  index,
}: Readonly<{ name: string; index: number }>): string =>
  `${String(index).padStart(2, '0')}_${name.replaceAll(/[^A-Za-z0-9_.-]/g, '_')}.log`
