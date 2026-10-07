import { describe, expect, it } from 'vitest'
import { toAssistPhotoUrls } from './assistPhotos'

describe('toAssistPhotoUrls', () => {
  it('reads the { type, url } objects the report form and cleaners save', () => {
    const media = [
      { type: 'before', url: 'https://x.supabase.co/a.jpg', name: 'a.jpg', size: 10 },
      { type: 'before', url: 'https://x.supabase.co/b.jpg' },
    ]
    expect(toAssistPhotoUrls(media)).toEqual(['https://x.supabase.co/a.jpg', 'https://x.supabase.co/b.jpg'])
  })

  it('accepts plain url strings too', () => {
    expect(toAssistPhotoUrls(['https://x.supabase.co/c.jpg'])).toEqual(['https://x.supabase.co/c.jpg'])
  })

  it('returns nothing for null, non-arrays and entries without a usable url', () => {
    expect(toAssistPhotoUrls(null)).toEqual([])
    expect(toAssistPhotoUrls({ url: 'https://x.supabase.co/d.jpg' })).toEqual([])
    expect(toAssistPhotoUrls([{ type: 'after' }, '', '   ', 42, { url: 'javascript:alert(1)' }])).toEqual([])
  })
})
