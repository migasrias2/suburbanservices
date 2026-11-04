import React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SiteRef } from '@/lib/siteDashboard/types'

interface SitePickerProps {
  sites: SiteRef[]
  value: string | null
  onChange: (key: string) => void
}

export const SitePicker: React.FC<SitePickerProps> = ({ sites, value, onChange }) => (
  <Select value={value ?? undefined} onValueChange={onChange}>
    <SelectTrigger className="h-10 w-full rounded-full sm:w-72" aria-label="Choose a site">
      <SelectValue placeholder="Choose a site" />
    </SelectTrigger>
    <SelectContent>
      {sites.map((site) => (
        <SelectItem key={site.key} value={site.key}>
          {site.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)
