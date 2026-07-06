import { useTranslation } from 'react-i18next'
import ErrorBoundary from '../shared/ErrorBoundary'

export default function MessageListBoundary({ children, resetKey }) {
  const { t } = useTranslation()

  return (
    <ErrorBoundary
      resetKey={resetKey}
      title={t('chat.renderErrorTitle')}
      description={t('chat.renderErrorMessage')}
      retryLabel={t('chat.renderErrorRetry')}
    >
      {children}
    </ErrorBoundary>
  )
}
