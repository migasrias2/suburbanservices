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
