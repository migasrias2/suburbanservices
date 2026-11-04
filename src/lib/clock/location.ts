export type Coordinates = { latitude: number; longitude: number }

/**
 * One GPS reading, or null, within a hard time limit that includes any
 * permission prompt (M3). Location is evidence on the shift, but a clock scan
 * never waits on it for longer than this.
 */
export function requestLocationOnce(timeoutMs = 4_000): Promise<Coordinates | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: Coordinates | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => finish(null),
        { timeout: timeoutMs, enableHighAccuracy: true, maximumAge: 60_000 },
      )
    } catch {
      finish(null)
    }
  })
}
