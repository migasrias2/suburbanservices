import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { AreaTasksPage as AreaTasksContent } from '@/components/areas/AreaTasksPage'

export default function AreaTasksPage() {
  const navigate = useNavigate()
  const [userType, setUserType] = useState<'manager' | 'admin' | 'cleaner' | ''>('')
  const [userName, setUserName] = useState('')

  useEffect(() => {
    const type = localStorage.getItem('userType') as 'manager' | 'admin' | 'cleaner' | null
    const name = localStorage.getItem('userName')
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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#00339B] border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <AreaTasksContent />
    </Sidebar07Layout>
  )
}


