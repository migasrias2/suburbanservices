export type ScanPlatform = 'ios' | 'android' | 'other'

/**
 * Which camera rules apply. iPadOS reports itself as a Mac, so a "Mac" with a
 * touch screen counts as iOS. Every iOS browser is Safari's engine underneath.
 */
export const detectPlatform = (
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints ?? 0,
): ScanPlatform => {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'other'
}
