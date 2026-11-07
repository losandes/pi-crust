import { getJson } from '@/lib/api-client'
import type { WorkspaceInfo } from '../typedefs/session'

export function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
  return getJson('/api/workspaces') as Promise<WorkspaceInfo[]>
}
