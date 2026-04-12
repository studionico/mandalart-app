
import { useNavigate } from 'react-router-dom'
import { signOut } from '@/lib/api/auth'

export default function SignOutButton() {
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
    
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
