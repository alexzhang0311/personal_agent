import { Component } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

class ErrorBoundaryInner extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Failed to render subtree', error, errorInfo)
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false })
    }
  }

  render() {
    const { children, title, description, retryLabel, compact } = this.props

    if (!this.state.hasError) {
      return children
    }

    const card = (
      <div
        className="flex items-start gap-3 px-4 py-3"
        style={{
          background: 'var(--bg-surface)',
          borderLeft: '2px solid var(--red)',
          borderRadius: '4px',
        }}
      >
        <AlertTriangle size={16} strokeWidth={1.5} style={{ color: 'var(--red)', marginTop: 2, flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </div>
          <div className="mt-1 text-sm" style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
            {description}
          </div>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-2 px-3 py-1 text-xs"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onClick={() => this.setState({ hasError: false })}
          >
            <RefreshCcw size={12} strokeWidth={1.5} />
            {retryLabel}
          </button>
        </div>
      </div>
    )

    if (compact) {
      return <div className="w-full min-w-0 my-2">{card}</div>
    }

    return (
      <div className="mx-auto my-4 w-full px-4" style={{ maxWidth: 900, width: '80%' }}>
        {card}
      </div>
    )
  }
}

export default function ErrorBoundary({ children, resetKey, title, description, retryLabel, compact = false }) {
  const { t } = useTranslation()

  return (
    <ErrorBoundaryInner
      resetKey={resetKey}
      compact={compact}
      title={title ?? t('shared.errorTitle')}
      description={description ?? t('shared.errorMessage')}
      retryLabel={retryLabel ?? t('shared.errorRetry')}
    >
      {children}
    </ErrorBoundaryInner>
  )
}
