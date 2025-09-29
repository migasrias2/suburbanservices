import * as React from "react"

const MOBILE_BREAKPOINT = 768

const getIsMobile = () =>
  typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(getIsMobile)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(mql.matches)

    // Support older browsers that still rely on addListener/removeListener
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange)
    } else {
      // @ts-ignore - Safari < 14
      mql.addListener(onChange)
    }

    setIsMobile(mql.matches)

    return () => {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", onChange)
      } else {
        // @ts-ignore - Safari < 14
        mql.removeListener(onChange)
      }
    }
  }, [])

  return isMobile
}
