import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BathroomAssistPanel } from '@/components/qr/BathroomAssistPanel'
import { Info } from 'lucide-react'

interface AssistanceBoardProps {
  cleanerId: string
  cleanerName: string
}

export const AssistanceBoard: React.FC<AssistanceBoardProps> = ({ cleanerId, cleanerName }) => {
  return (
    <div className="space-y-8">
      <Card className="border-none shadow-xl rounded-[28px]">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3 text-lg font-semibold text-gray-900">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <Info className="h-5 w-5 text-[#00339B]" />
            </div>
            How it works
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: 'Accept a request',
              description: 'Tap “Accept” so teammates know you’re handling the bathroom.'
            },
            {
              title: 'Fix & capture',
              description: 'Handle the issue, add notes, and upload after photos as proof.'
            },
            {
              title: 'Close it out',
              description: 'Mark resolved—customers instantly see the update on their dashboard.'
            }
          ].map((step) => (
            <div key={step.title} className="rounded-3xl border border-blue-100 bg-blue-50/30 p-4">
              <h3 className="text-sm font-semibold text-[#00339B]">{step.title}</h3>
              <p className="mt-1 text-xs text-gray-600">{step.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <BathroomAssistPanel cleanerId={cleanerId} cleanerName={cleanerName} />
    </div>
  )
}
