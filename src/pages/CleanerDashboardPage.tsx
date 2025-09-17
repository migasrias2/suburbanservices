import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { CleanerDashboard } from '../components/dashboard/CleanerDashboard'

export default function CleanerDashboardPage() {
  const navigate = useNavigate()
  const [cleanerId, setCleanerId] = useState<string>('')
  const [cleanerName, setCleanerName] = useState<string>('')

  useEffect(() => {
    // Check if user is logged in as cleaner
    const userType = localStorage.getItem('userType')
    const userId = localStorage.getItem('userId')
    const userName = localStorage.getItem('userName')

    if (userType !== 'cleaner' || !userId || !userName) {
      navigate('/login')
      return
    }

    setCleanerId(userId)
    setCleanerName(userName)
  }, [navigate])

  if (!cleanerId || !cleanerName) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="cleaner" userName={cleanerName}>
      <CleanerDashboard 
        cleanerId={cleanerId} 
        cleanerName={cleanerName} 
      />
    </Sidebar07Layout>
  )
}
