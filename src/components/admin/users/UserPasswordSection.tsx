import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react'
import {
  MIN_PASSWORD_LENGTH,
  getUserPassword,
  setUserPassword,
  type StoredPassword,
} from '@/services/userPasswordService'
import { describeError, type ManagedUser } from '@/services/customerOnboardingService'
import { fullName } from './userDisplay'

interface UserPasswordSectionProps {
  user: ManagedUser
}

/**
 * Shows the recorded password for one staff member and lets an admin replace
 * it.
 *
 * There is nothing to show for accounts created before `user_passwords`
 * existed: Supabase Auth only ever stored a bcrypt hash of their password, and
 * a hash cannot be turned back into the original. Those accounts read as "not
 * recorded" until someone sets a new password here.
 */
export const UserPasswordSection: React.FC<UserPasswordSectionProps> = ({ user }) => {
  const { toast } = useToast()
  const [stored, setStored] = useState<StoredPassword | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isChoosing, setIsChoosing] = useState(false)
  const [chosen, setChosen] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const userId = user.user_id
  // Changing your own password invalidates the session this page is running in.
  const isSelf = userId === localStorage.getItem('userId')

  useEffect(() => {
    let cancelled = false

    // Every piece of transient state is keyed to one person. Without this
    // reset, switching profiles would show the previous cleaner's password
    // still revealed in the new panel.
    setStored(null)
    setLoading(true)
    setLoadFailed(false)
    setRevealed(false)
    setCopied(false)
    setIsChoosing(false)
    setChosen('')

    getUserPassword(userId)
      .then((result) => {
        if (cancelled) return
        setStored(result)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadFailed(true)
        toast({
          title: 'Could not load password',
          description: describeError(err),
          variant: 'destructive',
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [userId, toast])

  const copy = async () => {
    if (!stored) return
    try {
      await navigator.clipboard.writeText(stored.password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  const applyPassword = async (password: string) => {
    setIsSaving(true)
    try {
      const result = await setUserPassword({ userId, role: user.role, password })
      setStored({ password: result.password, updatedAt: result.updatedAt })
      // Reveal on purpose: the admin just made this change and needs to read
      // the value out to the person it belongs to.
      setRevealed(true)
      setIsChoosing(false)
      setChosen('')

      if (result.recorded) {
        toast({ title: 'Password updated', description: `${fullName(user)} can log in with it now.` })
      } else {
        toast({
          title: 'Password updated, but not saved for display',
          description: 'Copy it now — it will not appear on this profile.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Could not update password',
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
        Password
      </h3>

      {loading ? (
        <div className="h-[60px] animate-pulse rounded-2xl bg-gray-100" />
      ) : stored ? (
        <div className="rounded-2xl border border-gray-100">
          <div className="flex items-center gap-2 px-4 py-3">
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-gray-900">
              {revealed ? stored.password : '•'.repeat(12)}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'Hide password' : 'Show password'}
              className="h-8 w-8 shrink-0 rounded-full p-0 text-gray-500 hover:bg-gray-100"
            >
              {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={copy}
              aria-label="Copy password"
              className="h-8 w-8 shrink-0 rounded-full p-0 text-gray-500 hover:bg-gray-100"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="border-t border-gray-50 px-4 py-2 text-xs text-gray-400">
            Set {formatSetAt(stored.updatedAt)}
          </p>
        </div>
      ) : loadFailed ? (
        <div className="rounded-2xl bg-gray-50 px-4 py-4 text-sm text-gray-600">
          Couldn't load this password. Close the panel and reopen it to try again.
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl bg-gray-50 px-4 py-4 text-sm text-gray-600">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <span>
            Not recorded. This account was created before passwords were kept, and the original
            can't be recovered — set a new one to show it here.
          </span>
        </div>
      )}

      {isChoosing ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">New password</Label>
            <Input
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              autoComplete="off"
              className="h-11 rounded-2xl border-gray-200 bg-gray-50/70 px-4 font-mono"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setIsChoosing(false)
                setChosen('')
              }}
              className="rounded-full text-gray-600"
            >
              Cancel
            </Button>
            <Button
              onClick={() => applyPassword(chosen)}
              disabled={isSaving || chosen.trim().length < MIN_PASSWORD_LENGTH}
              className="rounded-full bg-[#00339B] px-5 text-white hover:bg-[#002d7a]"
            >
              {isSaving ? 'Saving…' : 'Save password'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => applyPassword('')}
            disabled={isSaving}
            className="rounded-full text-gray-600 hover:bg-gray-100"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {isSaving ? 'Working…' : 'Generate new'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setIsChoosing(true)}
            disabled={isSaving}
            className="rounded-full text-gray-600 hover:bg-gray-100"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Set specific
          </Button>
        </div>
      )}

      {isSelf && (
        <p className="mt-3 text-xs leading-relaxed text-amber-600">
          This is your own account — changing it may sign you out of this session.
        </p>
      )}
    </section>
  )
}

/**
 * "today" / "yesterday" / a plain date. Anything more precise is noise: the
 * only question an admin asks here is whether this is the password the person
 * was last given.
 */
function formatSetAt(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'at an unknown time'

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000)

  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
