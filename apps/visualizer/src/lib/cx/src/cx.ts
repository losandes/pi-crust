/** Joins the class names that apply, dropping the ones that do not. */
export const cx = (...parts: readonly (string | false | undefined)[]): string =>
  parts
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ')
