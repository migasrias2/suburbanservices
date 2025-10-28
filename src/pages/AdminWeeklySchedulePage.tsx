import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { WeeklyCalendarView } from '@/components/admin/WeeklyCalendarView'
import { fetchWeeklyVisits, type WeeklyVisit } from '@/services/scheduleService'
import { getStoredCleanerName } from '@/lib/identity'

const AdminWeeklySchedulePage: React.FC = () => {
  const navigate = useNavigate()
  const [userName, setUserName] = useState<string>('')
  const [visits, setVisits] = useState<WeeklyVisit[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    const storedRole = localStorage.getItem('userType')
    const storedName = getStoredCleanerName()

    if (storedRole !== 'admin' || !storedName) {
      navigate('/login')
      return
    }

    setUserName(storedName)

    const loadVisits = async () => {
      try {
        const data = await fetchWeeklyVisits()
        setVisits(data)
      } catch (error) {
        console.error('Failed to load weekly visits', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadVisits()
  }, [navigate])

  if (!userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="admin" userName={userName}>
      {isLoading ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-3xl border border-dashed border-blue-200 bg-blue-50/50">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="mt-3 text-sm font-medium text-[#00339B]">Loading schedule...</p>
        </div>
      ) : (
        <WeeklyCalendarView visits={visits} />
      )}
    </Sidebar07Layout>
  )
}

export default AdminWeeklySchedulePage



