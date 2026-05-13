import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { NewCustomerWizard } from '@/components/admin/newCustomer/NewCustomerWizard'
import { getStoredCleanerName } from '@/lib/identity'

export default function NewCustomerPage() {
  const navigate = useNavigate()
  const [userType, setUserType] = useState<'admin' | null>(null)
  const [userName, setUserName] = useState<string>('')

  useEffect(() => {
    const storedType = localStorage.getItem('userType')
    const storedId = localStorage.getItem('userId')
    const storedName = getStoredCleanerName()

    if (storedType !== 'admin' || !storedId || !storedName) {
      navigate('/login')
      return
    }

    setUserType('admin')
    setUserName(storedName)
  }, [navigate])

  if (!userType || !userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="py-4 sm:py-8">
        <NewCustomerWizard />
      </div>
    </Sidebar07Layout>
  )
}
