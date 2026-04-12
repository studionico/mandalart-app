// デスクトップ版: 認証は任意（クラウド同期時のみ使用）
// 現時点ではローカルモードのみ実装

export async function signOut(): Promise<void> {
  // TODO: Supabase 同期有効時に実装
}

export async function getSession() {
  return null
}

export async function signIn(_email: string, _password: string) {
  return { error: new Error('Auth not available in desktop mode') }
}

export async function signUp(_email: string, _password: string) {
  return { error: new Error('Auth not available in desktop mode') }
}

export async function signInWithGoogle() {
  return { error: new Error('Auth not available in desktop mode') }
}

export async function signInWithGitHub() {
  return { error: new Error('Auth not available in desktop mode') }
}
