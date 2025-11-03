import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard'
import { getStoredCleanerName } from '@/lib/identity'

const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string>('')
  const [userName, setUserName] = useState<string>('')
  const [role, setRole] = useState<'manager' | 'admin'>('manager')

  useEffect(() => {
    const storedRole = localStorage.getItem('userType')
    const storedId = localStorage.getItem('userId')
    const storedName = getStoredCleanerName()

    if ((storedRole !== 'manager' && storedRole !== 'admin') || !storedId || !storedName) {
      navigate('/login')
      return
    }

    setRole(storedRole)
    setUserId(storedId)
    setUserName(storedName)
  }, [navigate])

  if (!userId || !userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={role} userName={userName}>
      <AnalyticsDashboard managerId={role === 'manager' ? userId : null} role={role} />
    </Sidebar07Layout>
  )
}

export default AnalyticsPage








