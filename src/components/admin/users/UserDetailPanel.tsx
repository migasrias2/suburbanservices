import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/use-toast'
import { Pencil, Save, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  deactivateUser,
  describeError,
  renameUser,
  type ManagedUser,
  type UserCustomerLink,
} from '@/services/customerOnboardingService'
import type { Customer } from '@/services/supabase'
import { UserPasswordSection } from './UserPasswordSection'
import { UserSitesSection } from './UserSitesSection'
import {
  AVATAR_BG,
  ROLE_LABEL,
  formatJoinedDate,
  fullName,
  initials,
  isSiteScopedRole,
} from './userDisplay'

interface UserDetailPanelProps {
  /** Null closes the panel. */
  user: ManagedUser | null
  customers: Customer[]
  /** This user's site links only — the parent filters the full set. */
  links: UserCustomerLink[]
  onClose: () => void
  onChanged: () => Promise<void> | void
}

export const UserDetailPanel: React.FC<UserDetailPanelProps> = ({
  user,
  customers,
  links,
  onClose,
  onChanged,
}) => {
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const userId = user?.user_id ?? null

  // Reset the transient forms whenever a different person is opened, so an
  // abandoned rename or a half-confirmed deactivate never leaks across users.
  useEffect(() => {
    setIsEditing(false)
    setConfirmingRemove(false)
    setEditFirst(user?.first_name ?? '')
    setEditLast(user?.last_name ?? '')
  }, [userId, user?.first_name, user?.last_name])

  if (!user) return null

  const saveName = async () => {
    if (!editFirst.trim()) {
      toast({ title: 'First name required', variant: 'destructive' })
      return
    }
    setIsSaving(true)
    try {
      await renameUser(user.role, user.user_id, editFirst.trim(), editLast.trim())
      await onChanged()
      setIsEditing(false)
      toast({ title: 'User renamed' })
    } catch (err) {
      toast({
        title: 'Could not save',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async () => {
    setIsRemoving(true)
    try {
      await deactivateUser(user.role, user.user_id)
      await onChanged()
      toast({ title: 'User deactivated' })
      onClose()
    } catch (err) {
      toast({
        title: 'Could not deactivate',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsRemoving(false)
      setConfirmingRemove(false)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* bg-white, not the sheet default: tailwind.config.ts maps `background` to
          hsl(var(--background)), and this project never defines that variable, so
          `bg-background` resolves to transparent and the page shows through. */}
      <SheetContent className="flex w-full flex-col gap-0 bg-white p-0 sm:max-w-md">
        <SheetHeader className="space-y-0 border-b border-gray-100 p-6 text-left">
          <div className="flex items-center gap-4 pr-8">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${AVATAR_BG[user.role]}`}
            >
              {initials(user)}
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-xl font-semibold text-gray-900">
                {fullName(user)}
              </SheetTitle>
              <SheetDescription className="truncate text-sm text-gray-500">
                {ROLE_LABEL[user.role]}
                {user.identifier ? ` · ${user.identifier}` : ''}
              </SheetDescription>
            </div>
          </div>
          {!user.is_active && (
            <div className="mt-4 rounded-full bg-gray-100 px-3 py-1 text-center text-xs font-medium text-gray-500">
              Deactivated — cannot log in
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-8 overflow-y-auto p-6">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              Details
            </h3>
            {isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-700">First name</Label>
                    <Input
                      value={editFirst}
                      onChange={(e) => setEditFirst(e.target.value)}
                      className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-700">Last name</Label>
                    <Input
                      value={editLast}
                      onChange={(e) => setEditLast(e.target.value)}
                      className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setIsEditing(false)}
                    className="rounded-full text-gray-600"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={saveName}
                    disabled={isSaving}
                    className="rounded-full bg-[#00339B] px-6 text-white hover:bg-[#002d7a]"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <dl className="overflow-hidden rounded-2xl border border-gray-100">
                <DetailRow
                  label={user.role === 'cleaner' || user.role === 'manager' ? 'Mobile' : 'Username'}
                  value={user.identifier ?? '—'}
                />
                <DetailRow label="Role" value={ROLE_LABEL[user.role]} />
                <DetailRow label="Status" value={user.is_active ? 'Active' : 'Deactivated'} />
                <DetailRow label="Added" value={formatJoinedDate(user.created_at)} />
              </dl>
            )}
          </section>

          <UserPasswordSection user={user} />

          {isSiteScopedRole(user.role) ? (
            <UserSitesSection
              user={user}
              customers={customers}
              links={links}
              onChanged={onChanged}
            />
          ) : (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                Sites
              </h3>
              <div className="flex items-start gap-3 rounded-2xl bg-gray-50 px-4 py-4 text-sm text-gray-600">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#00339B]" />
                <span>Admins already see every site, so there is nothing to link.</span>
              </div>
            </section>
          )}
        </div>

        <div className="border-t border-gray-100 p-6">
          {confirmingRemove && (
            <p className="mb-4 text-sm leading-relaxed text-gray-600">
              {fullName(user)} won't be able to log in. Their manager assignments and site links
              will be removed.
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            {!isEditing && (
              <Button
                variant="ghost"
                onClick={() => setIsEditing(true)}
                className="rounded-full text-gray-600 hover:bg-gray-100"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </Button>
            )}
            {user.is_active && (
              <div className="ml-auto flex items-center gap-2">
                {confirmingRemove ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmingRemove(false)}
                      className="rounded-full text-gray-600"
                    >
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                    <Button
                      onClick={remove}
                      disabled={isRemoving}
                      className="rounded-full bg-red-600 px-5 text-white hover:bg-red-700"
                    >
                      {isRemoving ? 'Deactivating…' : 'Confirm'}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmingRemove(true)}
                    className="rounded-full text-gray-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Deactivate
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4 border-b border-gray-50 px-4 py-3 last:border-b-0">
    <dt className="text-sm text-gray-500">{label}</dt>
    <dd className="min-w-0 truncate text-sm font-medium text-gray-900">{value}</dd>
  </div>
)
