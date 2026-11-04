import React from 'react'
import { Navigate } from 'react-router-dom'
import { useClockSwitches } from '@/lib/clock/clockFlags'

/**
 * /scanner accepts every kind of code and clocks people in and out through the
 * old direct writes. On the new clock it sends them to /clock-in instead (M7),
 * where clock scans go through the server. With clock_v2 off it is unchanged.
 */
export const LegacyScannerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { clockV2 } = useClockSwitches()
  return clockV2 ? <Navigate to="/clock-in" replace /> : <>{children}</>
}
