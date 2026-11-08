/** CLI prompt arg: a file path resolves to its contents, else inline text. */

import { isFile, readText } from '../../../../lib/system'
export const resolvePrompt = (arg: string): string =>
  isFile(arg) ? readText(arg) : arg
