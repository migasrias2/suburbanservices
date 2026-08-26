import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { CleanerDashboard } from '../components/dashboard/CleanerDashboard'
import { getStoredCleanerName } from '../lib/identity'

/**
 * The cleaner's landing screen. Replaces dropping them straight onto a camera:
 * they now see where they are, what they've done today, and what's next before
 * being asked to scan anything.
 */
export default function CleanerHomePage() {
  const navigate = useNavigate()
  const [cleanerId, setCleanerId] = useState('')
  const [cleanerName, setCleanerName] = useState('')

  useEffect(() => {
    const userType = localStorage.getItem('userType')
    const userId = localStorage.getItem('userId')
    const userName = getStoredCleanerName()

    if (userType !== 'cleaner' || !userId || !userName) {
      navigate('/login')
      return
    }

    setCleanerId(userId)
    setCleanerName(userName)
  }, [navigate])

  if (!cleanerId || !cleanerName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-[#00339B]" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="cleaner" userName={cleanerName}>
      <CleanerDashboard cleanerId={cleanerId} cleanerName={cleanerName} />
    </Sidebar07Layout>
  )
}
