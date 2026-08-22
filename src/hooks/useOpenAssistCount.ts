import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import { AssistRequestService } from '@/services/assistRequestService'

/**
 * Live count of bathroom assist requests still waiting on a cleaner.
 *
 * Mirrors BathroomAssistPanel: realtime for speed, plus a 30s poll as the
 * fallback for site wifi that blocks websockets. Opens no subscription when
 * disabled, so non-cleaner roles pay nothing for it.
 */
export const useOpenAssistCount = (enabled: boolean) => {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setCount(await AssistRequestService.countOpen())
    } catch (error) {
      console.warn('Failed to load open assist count', error)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }

    refresh()

    const channel = supabase
      .channel('assist-open-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bathroom_assist_requests' }, () => {
        refresh()
      })
      .subscribe()

    const interval = setInterval(refresh, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [enabled, refresh])

  return count
}
