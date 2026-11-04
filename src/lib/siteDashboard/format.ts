/**
 * Every site is in England, so "today" and every clock time on the dashboard
 * are London's, whatever time zone the viewer's browser happens to be in.
 */
export const SITE_TIME_ZONE = 'Europe/London'

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const londonParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** London's offset from UTC at an instant, in ms (0 in winter, one hour in summer). */
const londonOffsetMs = (date: Date): number => {
  const p = londonParts(date)
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** The instant London's current day began. Correct across the clock changes, which happen at 01:00 UTC. */
export const startOfSiteDay = (now: Date): Date => {
  const p = londonParts(now)
  const utcMidnight = new Date(Date.UTC(p.year, p.month - 1, p.day))
  return new Date(utcMidnight.getTime() - londonOffsetMs(utcMidnight))
}

/** "14:52", London time; an em dash for a missing or unreadable time. */
export const formatClock = (iso: string | null | undefined): string => {
  const date = parse(iso)
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone: SITE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

/** "14:52" for today, "3 Nov 22:10" for anything earlier, so an old request never passes for a new one. */
export const formatClockWithDay = (iso: string | null | undefined, dayStart: Date): string => {
  const date = parse(iso)
  if (!date) return '—'
  if (date.getTime() >= dayStart.getTime()) return formatClock(iso)
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: SITE_TIME_ZONE, day: 'numeric', month: 'short' }).format(date)
  return `${day} ${formatClock(iso)}`
}

/** 5 -> "5 min", 72 -> "1h 12m", 120 -> "2h". */
export const formatMinutes = (minutes: number | null | undefined): string => {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return '—'
  const whole = Math.round(minutes)
  if (whole < 60) return `${whole} min`
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export const initials = (name: string | null | undefined): string => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || '?'
}

export const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`
