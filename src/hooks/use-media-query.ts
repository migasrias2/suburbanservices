import * as React from 'react'

const getMatch = (query: string): boolean => {
  if (typeof window === 'undefined' || !query) {
    return false
  }
  return window.matchMedia(query).matches
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(() => getMatch(query))

  React.useEffect(() => {
    if (typeof window === 'undefined' || !query) {
      return
    }

    const mediaQueryList = window.matchMedia(query)
    const handleChange = () => setMatches(mediaQueryList.matches)

    handleChange()

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange)
    } else {
      // Safari < 14 fallback
      // @ts-expect-error - older browsers
      mediaQueryList.addListener(handleChange)
    }

    return () => {
      if (typeof mediaQueryList.removeEventListener === 'function') {
        mediaQueryList.removeEventListener('change', handleChange)
      } else {
        // Safari < 14 fallback
        // @ts-expect-error - older browsers
        mediaQueryList.removeListener(handleChange)
      }
    }
  }, [query])

  return matches
}


