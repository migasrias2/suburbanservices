import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { AreaTasksPage as AreaTasksContent } from '@/components/areas/AreaTasksPage'
import { getStoredCleanerName } from '@/lib/identity'

export default function AreaTasksPage() {
  const navigate = useNavigate()
  const [userType, setUserType] = useState<'manager' | 'admin' | 'cleaner' | ''>('')
  const [userName, setUserName] = useState('')

  useEffect(() => {
    const type = localStorage.getItem('userType') as 'manager' | 'admin' | 'cleaner' | null
    const name = getStoredCleanerName()
    const id = localStorage.getItem('userId')

    if (!type || type !== 'admin' || !name || !id) {
      navigate('/login')
      return
    }

    setUserType(type)
    setUserName(name)
  }, [navigate])

  if (!userType || !userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <AreaTasksContent />
    </Sidebar07Layout>
  )
}


