'use client'

import { useRouter } from 'next/navigation'
import { signOut } from '@/lib/api/auth'

export default function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
    >
      ログアウト
    </button>
  )
}
