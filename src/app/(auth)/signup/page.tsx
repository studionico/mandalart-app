import LoginForm from '@/components/auth/LoginForm'
import OAuthButtons from '@/components/auth/OAuthButtons'
import Link from 'next/link'

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-center mb-8">アカウント作成</h1>

        <OAuthButtons />

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs text-gray-400">
            <span className="bg-white px-2">または</span>
          </div>
        </div>

        <LoginForm mode="signup" />

        <p className="text-center text-sm text-gray-500 mt-6">
          すでにアカウントをお持ちの方は{' '}
          <Link href="/login" className="text-blue-600 hover:underline">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  )
}
