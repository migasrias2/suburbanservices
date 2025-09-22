import React, { useState } from 'react'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Send } from 'lucide-react'

export default function ChatPage() {
  const userName = localStorage.getItem('userName') || 'Cleaner'
  const userType = (localStorage.getItem('userType') as 'cleaner' | 'manager' | 'admin') || 'cleaner'
  const [messages, setMessages] = useState<{ me: boolean; text: string }[]>([
    { me: false, text: 'Hi, please clock in at Bex-Sunward Park.' },
  ])
  const [text, setText] = useState('')

  const send = () => {
    if (!text.trim()) return
    setMessages((m) => [...m, { me: true, text }])
    setText('')
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="max-w-2xl mx-auto w-full">
        <Card className="rounded-3xl border-0 shadow-lg h-[70vh] flex flex-col">
          <CardHeader className="border-b border-gray-100">
            <CardTitle className="text-base font-semibold" style={{ color: '#00339B' }}>Chat</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto space-y-3 p-6">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.me ? 'justify-end' : 'justify-start'}`}>
                <div className={`px-4 py-3 rounded-full text-sm max-w-[75%] shadow-sm ${m.me ? 'bg-[#00339B] text-white' : 'bg-gray-100 text-gray-900'}`}>{m.text}</div>
              </div>
            ))}
          </CardContent>
          <div className="p-4 border-t flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" className="rounded-full" />
            <Button onClick={send} className="rounded-full" style={{ backgroundColor: '#00339B', color: '#fff' }}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      </div>
    </Sidebar07Layout>
  )
}


