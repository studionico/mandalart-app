import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ error: null })
    window.location.hash = '#/dashboard'
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-white dark:bg-gray-950 p-8">
          <div className="max-w-md text-center">
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">
              予期しないエラーが発生しました
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 break-all">
              {this.state.error.message}
            </p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              ダッシュボードに戻る
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
