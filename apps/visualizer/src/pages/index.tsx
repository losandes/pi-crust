import { SessionsList } from '@/domains/sessions'
import DefaultLayout from '@/layouts/default-layout'

/** #/ — the session list. */
export default function SessionsPage() {
  return (
    <DefaultLayout>
      <SessionsList />
    </DefaultLayout>
  )
}
