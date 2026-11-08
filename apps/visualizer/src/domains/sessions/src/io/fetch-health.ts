import { getJson } from '@/lib/api-client'
import type { HealthResponse } from '../typedefs/session'

export function fetchHealth(): Promise<HealthResponse> {
  return getJson('/api/health') as Promise<HealthResponse>
}
