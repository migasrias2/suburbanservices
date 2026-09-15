import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getNavigation, type UserType } from './navigation'

/**
 * The menu and the route guard are two separate lists of the same fact, and
 * nothing has ever forced them to agree. When they drift the failure is silent
 * and looks like a dead button: RequireAuth answers a disallowed role with
 * `<Navigate to={HOME_FOR_ROLE[role]} replace />`, so the tap navigates
 * straight back to the dashboard the user was already on. No error, no toast,
 * nothing in the console.
 *
 * That is exactly how ops managers lost Clock In — `/clock-in` was gated to
 * ["cleaner"] while opsNavigation() put it in the sidebar AND the phone's
 * bottom tab bar. This test is the thing that makes the two lists agree.
 */

const ROLES: UserType[] = ['cleaner', 'manager', 'ops_manager', 'admin']

/** Every role the nav is built for; the denylist only removes items. */
const NAMES_BY_ROLE: Record<UserType, string> = {
  cleaner: 'Test Cleaner',
  manager: 'Test Manager',
  ops_manager: 'Test Ops',
  admin: 'Test Admin',
}

type RouteAccess =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'roles'; roles: string[] }

/**
 * Reads the access rule for each route out of App.tsx.
 *
 * Parsing the source rather than importing it because App.tsx declares its
 * guards inline in JSX and mounts a BrowserRouter, so there is no exported
 * table to assert against and no way to render it under a MemoryRouter. Every
 * <Route> there is written on one line, which is what makes this tractable.
 */
const parseRouteAccess = (): Map<string, RouteAccess> => {
  const source = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')
  const routes = new Map<string, RouteAccess>()

  for (const line of source.split('\n')) {
    const path = line.match(/<Route\s+path="([^"]+)"/)?.[1]
    if (!path) continue

    if (!line.includes('<RequireAuth')) {
      routes.set(path, { kind: 'public' })
      continue
    }

    const roles = line.match(/roles=\{\[([^\]]*)\]\}/)?.[1]
    if (roles === undefined) {
      routes.set(path, { kind: 'authenticated' })
      continue
    }

    routes.set(path, {
      kind: 'roles',
      roles: roles
        .split(',')
        .map((role) => role.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean),
    })
  }

  return routes
}

const routeAccess = parseRouteAccess()

describe('App.tsx route parsing', () => {
  // Guards the parser itself: a formatting change that broke the regex would
  // otherwise turn every assertion below green by finding nothing to check.
  it('finds the routes it is meant to check', () => {
    expect(routeAccess.size).toBeGreaterThan(20)
  })

  it('reads the roles off a gated route', () => {
    expect(routeAccess.get('/admin/users')).toEqual({ kind: 'roles', roles: ['admin'] })
  })

  it('reads an ungated authenticated route', () => {
    expect(routeAccess.get('/profile')).toEqual({ kind: 'authenticated' })
  })
})

describe.each(ROLES)('%s navigation', (role) => {
  const navigation = getNavigation(role, NAMES_BY_ROLE[role])
  const destinations = [
    ...navigation.sections.flatMap((section) => section.items),
    ...navigation.tabs,
  ]
  const paths = [...new Set(destinations.map((item) => item.path))]

  it.each(paths)('can actually open %s', (path) => {
    const access = routeAccess.get(path)

    expect(access, `${path} is in the ${role} menu but has no route in App.tsx`).toBeDefined()

    if (access?.kind === 'roles') {
      expect(
        access.roles,
        `${path} is in the ${role} menu but RequireAuth only allows [${access.roles.join(', ')}] — ` +
          'the tap will silently bounce back to the dashboard',
      ).toContain(role)
    }
  })
})
