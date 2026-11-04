import { useQuery } from '@tanstack/react-query'
import { loadPhotoSources } from '@/services/siteDashboardService'

/** Signed URLs last an hour (photoStorageService); refetch well before they expire. */
const PHOTO_SOURCE_STALE_MS = 45 * 60 * 1000

/** Full-size sources for a small group of photos, fetched only when `enabled`. */
export const usePhotoSources = (ids: number[], enabled: boolean) => {
  const sortedIds = [...ids].sort((a, b) => a - b)
  return useQuery({
    queryKey: ['site-dashboard-photo-sources', sortedIds.join(',')],
    queryFn: () => loadPhotoSources(sortedIds),
    enabled: enabled && sortedIds.length > 0,
    staleTime: PHOTO_SOURCE_STALE_MS,
    gcTime: PHOTO_SOURCE_STALE_MS,
    refetchOnWindowFocus: false,
  })
}
