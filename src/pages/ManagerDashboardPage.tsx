import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { ManagerDashboard } from '../components/dashboard/ManagerDashboard'
import { getStoredCleanerName } from '../lib/identity'

export default function ManagerDashboardPage() {
  const navigate = useNavigate()
  const [managerId, setManagerId] = useState<string>('')
  const [managerName, setManagerName] = useState<string>('')
  const [userType, setUserType] = useState<'manager' | 'ops_manager' | 'admin'>('manager')

  useEffect(() => {
    // Check if user is logged in as manager or admin
    const storedUserType = localStorage.getItem('userType')
    const userId = localStorage.getItem('userId')
    const userName = getStoredCleanerName()

    if ((storedUserType !== 'manager' && storedUserType !== 'admin' && storedUserType !== 'ops_manager') || !userId || !userName) {
      navigate('/login')
      return
    }

    setManagerId(userId)
    setManagerName(userName)
    setUserType(storedUserType as 'manager' | 'ops_manager' | 'admin')
  }, [navigate])

  if (!managerId || !managerName) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-[#f4f4f4]">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={managerName}>
      <ManagerDashboard
        managerId={managerId}
        managerName={managerName}
        role={userType}
      />
    </Sidebar07Layout>
  )
}
