/** `/api/themes`, scoped to one workspace when the route names one. */
export const themesUrl = (workspace?: string): string =>
  workspace === undefined || workspace === ''
    ? '/api/themes'
    : `/api/themes?workspace=${encodeURIComponent(workspace)}`
