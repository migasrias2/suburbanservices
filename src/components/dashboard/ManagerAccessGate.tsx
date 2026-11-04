import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../ui/button'
import {
  resolveManagerAccess,
  type GrantedManagerAccess,
  type ManagerAccess,
  type ManagerAccessRole,
} from '../../services/managerAccessService'

export const UNLINKED_TITLE = "This login isn't linked to a site yet"
export const UNLINKED_BODY = 'Contact Suburban Services to finish setting up your access.'
export const LOOKUP_FAILED_TITLE = "We couldn't confirm which site this login belongs to"
export const LOOKUP_FAILED_BODY =
  'Nothing is shown until we can. Check your connection and try again, or contact Suburban Services.'

interface ManagerAccessGateProps {
  role: ManagerAccessRole
  managerId: string
  managerName?: string | null
  children: (access: GrantedManagerAccess) => ReactNode
}

type GateState = { kind: 'loading' } | { kind: 'resolved'; access: ManagerAccess }

/**
 * Renders a manager-facing screen only once we know what it may show. A client
 * login that is not linked to a site -- or whose links could not be loaded --
 * gets an explanation instead of the screen, so nothing below can fall back to
 * every client's data.
 */
export function ManagerAccessGate({ role, managerId, managerName, children }: ManagerAccessGateProps) {
  const [state, setState] = useState<GateState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })

    resolveManagerAccess({ role, managerId, managerName })
      .then((access) => {
        if (!cancelled) setState({ kind: 'resolved', access })
      })
      .catch((error) => {
        console.error('Could not resolve manager access', error)
        if (!cancelled) {
          setState({ kind: 'resolved', access: { status: 'unlinked', reason: 'lookup_failed' } })
        }
      })

    return () => {
      cancelled = true
    }
  }, [role, managerId, managerName, attempt])

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-label="Checking access">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/40 border-t-transparent" />
      </div>
    )
  }

  const { access } = state

  if (access.status === 'unlinked') {
    const lookupFailed = access.reason === 'lookup_failed'
    return (
      <div
        role="status"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <p className="text-base font-medium text-foreground">
          {lookupFailed ? LOOKUP_FAILED_TITLE : UNLINKED_TITLE}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {lookupFailed ? LOOKUP_FAILED_BODY : UNLINKED_BODY}
        </p>
        {lookupFailed && (
          <Button
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-full bg-primary px-6 text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </Button>
        )}
      </div>
    )
  }

  return <>{children(access)}</>
}
