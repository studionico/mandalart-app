import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import {
  signInWithEmail, signUpWithEmail, signInWithOAuth,
} from '@/lib/api/auth'

type Props = {
  open: boolean
  onClose: () => void
}

type Mode = 'signin' | 'signup'

export default function AuthDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function reset() {
    setEmail('')
    setPassword('')
    setError(null)
    setInfo(null)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'signin') {
        const { error } = await signInWithEmail(email, password)
        if (error) throw error
        handleClose()
      } else {
        const { error, data } = await signUpWithEmail(email, password)
        if (error) throw error
        if (data.session) {
          handleClose()
        } else {
          setInfo('確認メールを送信しました。メール内のリンクからサインインしてください。')
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleOAuth(provider: 'google' | 'github') {
    setSubmitting(true)
    setError(null)
    try {
      const { error } = await signInWithOAuth(provider)
      if (error) throw error
      setInfo('ブラウザで認証してください。完了後アプリに戻ります。')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={mode === 'signin' ? 'サインイン' : '新規登録'}>
      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
        <div>
          <label className="text-xs text-gray-500">メールアドレス</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            disabled={submitting}
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
        {info && <p className="text-xs text-blue-600">{info}</p>}

        <Button type="submit" disabled={submitting}>
          {submitting ? '処理中...' : mode === 'signin' ? 'サインイン' : '新規登録'}
        </Button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setInfo(null) }}
          className="text-xs text-blue-600 hover:underline"
        >
          {mode === 'signin' ? 'アカウントをお持ちでない方は新規登録' : 'すでにアカウントをお持ちの方はサインイン'}
        </button>
      </form>

      <div className="mt-5 pt-4 border-t border-gray-100 flex flex-col gap-2">
        <p className="text-xs text-gray-500 text-center">外部アカウントでサインイン</p>
        <Button variant="secondary" onClick={() => handleOAuth('google')} disabled={submitting}>
          Google でサインイン
        </Button>
        <Button variant="secondary" onClick={() => handleOAuth('github')} disabled={submitting}>
          GitHub でサインイン
        </Button>
      </div>
    </Modal>
  )
}
