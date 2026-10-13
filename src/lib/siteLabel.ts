/**
 * QR areas at some sites are named just "Clock In" / "Clock Out". That name
 * describes the poster, not the place, so it must never become a shift's site:
 * for weeks every shift at those sites was saved with site "Clock In".
 */
const CLOCK_AREA_PATTERN = /^\s*(clock|check)[\s_-]*(in|out)\s*$/i

export function isClockAreaName(value?: string | null): boolean {
  return typeof value === 'string' && CLOCK_AREA_PATTERN.test(value)
}

const clean = (value?: string | null): string => (typeof value === 'string' ? value.trim() : '')

/**
 * The best human site name a QR code offers: its explicit site, then its area
 * (unless that area is just a clock poster), then the customer, then the raw id.
 */
export function pickSiteLabel(input: {
  siteName?: string | null
  areaName?: string | null
  customerName?: string | null
  siteId?: string | null
}): string {
  const candidates = [input.siteName, input.areaName, input.customerName, input.siteId]
  for (const candidate of candidates) {
    const value = clean(candidate)
    if (value && !isClockAreaName(value)) return value
  }
  return 'Site'
}
