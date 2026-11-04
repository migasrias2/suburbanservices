/** "14:52" in the viewer's locale; an em dash for a missing or unreadable time. */
export const formatClock = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
