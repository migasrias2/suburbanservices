import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type DateRange = {
  start: Date
  end: Date
}

export const defaultAnalyticsRange = (days = 14): DateRange => {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

export const toIsoRange = (range: DateRange): { start: string; end: string } => ({
  start: range.start.toISOString(),
  end: range.end.toISOString(),
})

export const capitalizeWords = (value: string) =>
  value.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())

export const formatRelativeTime = (date: string | Date) => {
  const target = typeof date === 'string' ? new Date(date) : date
  const diff = target.getTime() - Date.now()
  const minutes = Math.round(diff / (1000 * 60))
  if (minutes <= 1) return 'in a minute'
  if (minutes < 60) return `in ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours === 1) return 'in 1 hour'
  return `in ${hours} hours`
}
