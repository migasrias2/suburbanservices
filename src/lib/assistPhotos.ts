// bathroom_assist_requests.before_media / after_media hold { type, url, name, size }
// objects (see AssistMedia), though older rows and types allow bare url strings.
// Only http(s) urls are returned, since they end up in <img src> and window.open.
export const toAssistPhotoUrls = (media: unknown): string[] => {
  if (!Array.isArray(media)) return []
  return media
    .map((entry) => (typeof entry === 'string' ? entry : (entry as { url?: unknown } | null)?.url))
    .filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url.trim()))
    .map((url) => url.trim())
}
