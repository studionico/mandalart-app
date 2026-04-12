'use client'

import { useState, useEffect } from 'react'
import { syncPendingUpdates } from '@/lib/offline'

export function useOffline() {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    setIsOffline(!navigator.onLine)

    function handleOnline() {
      setIsOffline(false)
      syncPendingUpdates().catch(console.error)
    }
    function handleOffline() {
      setIsOffline(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOffline }
}
