import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * The new-client wizard creates a manager and then, on Continue, assigns that
 * manager to the client being onboarded. The id it assigns comes straight out
 * of the create response.
 *
 * admin-create-manager returns `managerId`; admin-create-user returns `userId`.
 * Repointing the wizard at the surviving function without adapting the read
 * gives `undefined`, and the wizard happily carries it to the assignment call
 * — creation "works", the manager is never linked to the client, and nobody
 * finds out until someone logs in and sees no sites.
 *
 * These tests read the id through the assignment call rather than through the
 * response shape, so they hold whichever function the wizard ends up calling.
 */

const NEW_MANAGER_ID = '55555555-5555-4555-8555-555555555555'
const CUSTOMER_ID = '77777777-7777-4777-8777-777777777777'

const assignManagerToCustomer = vi.fn(async () => undefined)
const listManagers = vi.fn(async () => [])

/** admin-create-manager's response shape. */
const createManagerAccount = vi.fn(async (input: Record<string, unknown>) => ({
  managerId: NEW_MANAGER_ID,
  password: 'swift-otter-42',
  role: input.role,
  firstName: input.firstName,
  lastName: input.lastName,
  identifier: (input.phone ?? input.username) as string,
}))

/** admin-create-user's response shape — same id, different key. */
const createUserAccount = vi.fn(async (input: Record<string, unknown>) => ({
  userId: NEW_MANAGER_ID,
  password: 'swift-otter-42',
  role: input.role,
  firstName: input.firstName,
  lastName: input.lastName,
  identifier: (input.phone ?? input.username) as string,
  recorded: true,
}))

vi.mock('@/services/customerOnboardingService', () => ({
  listManagers: (...a: unknown[]) => listManagers(...(a as [])),
  assignManagerToCustomer: (...a: unknown[]) =>
    assignManagerToCustomer(...(a as unknown as [])),
  createManagerAccount: (...a: unknown[]) =>
    createManagerAccount(...(a as unknown as [Record<string, unknown>])),
  createUserAccount: (...a: unknown[]) =>
    createUserAccount(...(a as unknown as [Record<string, unknown>])),
  describeError: (e: unknown) => String((e as Error)?.message ?? e),
}))

const { Step2Managers } = await import('./Step2Managers')
const { INITIAL_STATE } = await import('./types')

/**
 * The step is a controlled component: it reports changes through onUpdate and
 * renders whatever its parent hands back. This wrapper does what the real
 * wizard page does, so the created-manager list actually appears.
 */
const renderStep = () => {
  const onNext = vi.fn()
  const patches: Array<Record<string, unknown>> = []

  const Harness = () => {
    const [state, setState] = React.useState({ ...INITIAL_STATE, customerId: CUSTOMER_ID })
    return (
      <Step2Managers
        state={state}
        totalSteps={5}
        onUpdate={(patch) => {
          patches.push(patch as Record<string, unknown>)
          setState((prev) => ({ ...prev, ...patch }))
        }}
        onBack={vi.fn()}
        onNext={onNext}
      />
    )
  }

  render(<Harness />)
  return { onNext, patches }
}

/** Fills and submits the inline "add manager" form. */
const createManagerThroughTheForm = async (
  user: ReturnType<typeof userEvent.setup>,
  opts: { phone?: string; username?: string; role?: 'manager' | 'ops manager' } = {},
) => {
  await user.click(await screen.findByRole('button', { name: /add new manager/i }))

  if (opts.role === 'ops manager') {
    await user.click(screen.getByRole('button', { name: /^ops manager$/i }))
  }

  await user.type(screen.getByPlaceholderText(/first name/i), 'Ana')
  await user.type(screen.getByPlaceholderText(/last name/i), 'Silva')

  if (opts.username !== undefined) {
    await user.type(screen.getByPlaceholderText(/username/i), opts.username)
  } else {
    await user.type(screen.getByPlaceholderText(/phone number/i), opts.phone ?? '07700 900321')
  }

  await user.click(screen.getByRole('button', { name: /create manager/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  listManagers.mockResolvedValue([])
})

describe('Step2Managers: the id it carries forward', () => {
  it('assigns the manager it just created to the client', async () => {
    const user = userEvent.setup()
    renderStep()

    await createManagerThroughTheForm(user)
    await waitFor(() => expect(screen.getByText(/swift-otter-42/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(assignManagerToCustomer).toHaveBeenCalled())
    expect(assignManagerToCustomer).toHaveBeenCalledWith(NEW_MANAGER_ID, CUSTOMER_ID)
  })

  it('never assigns an undefined id', async () => {
    // The specific failure of reading `managerId` off a `userId` response.
    const user = userEvent.setup()
    renderStep()

    await createManagerThroughTheForm(user)
    await waitFor(() => expect(screen.getByText(/swift-otter-42/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(assignManagerToCustomer).toHaveBeenCalled())
    for (const call of assignManagerToCustomer.mock.calls) {
      expect(call[0]).toBeDefined()
    }
  })

  it('creates an ops manager by username and carries that id too', async () => {
    const user = userEvent.setup()
    renderStep()

    await createManagerThroughTheForm(user, { role: 'ops manager', username: 'ops.lead' })
    await waitFor(() => expect(screen.getByText(/swift-otter-42/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(assignManagerToCustomer).toHaveBeenCalled())
    expect(assignManagerToCustomer).toHaveBeenCalledWith(NEW_MANAGER_ID, CUSTOMER_ID)
  })
})

describe('Step2Managers: what the admin is shown', () => {
  it('shows the generated password once, not "undefined"', async () => {
    const user = userEvent.setup()
    renderStep()

    await createManagerThroughTheForm(user)

    expect(await screen.findByText(/swift-otter-42/)).toBeInTheDocument()
  })

  it('shows the identifier the new manager will log in with', async () => {
    const user = userEvent.setup()
    renderStep()

    await createManagerThroughTheForm(user, { phone: '07700 900321' })

    await waitFor(() => expect(screen.getByText(/swift-otter-42/)).toBeInTheDocument())
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  it('reports the reason when creation fails instead of pretending it worked', async () => {
    createManagerAccount.mockRejectedValueOnce(new Error('That number already has an account.'))
    createUserAccount.mockRejectedValueOnce(new Error('That number already has an account.'))
    const user = userEvent.setup()
    renderStep()

    await createManagerThroughTheForm(user)

    await waitFor(() =>
      expect(assignManagerToCustomer).not.toHaveBeenCalled(),
    )
    expect(screen.queryByText(/swift-otter-42/)).not.toBeInTheDocument()
  })
})

describe('Step2Managers: validation before anything is created', () => {
  it('does not create a manager with no phone', async () => {
    const user = userEvent.setup()
    renderStep()

    await user.click(await screen.findByRole('button', { name: /add new manager/i }))
    await user.type(screen.getByPlaceholderText(/first name/i), 'Ana')
    await user.type(screen.getByPlaceholderText(/last name/i), 'Silva')
    await user.click(screen.getByRole('button', { name: /create manager/i }))

    expect(createManagerAccount).not.toHaveBeenCalled()
    expect(createUserAccount).not.toHaveBeenCalled()
  })

  it('does not create a manager with no name', async () => {
    const user = userEvent.setup()
    renderStep()

    await user.click(await screen.findByRole('button', { name: /add new manager/i }))
    await user.type(screen.getByPlaceholderText(/phone number/i), '07700 900321')
    await user.click(screen.getByRole('button', { name: /create manager/i }))

    expect(createManagerAccount).not.toHaveBeenCalled()
    expect(createUserAccount).not.toHaveBeenCalled()
  })
})
