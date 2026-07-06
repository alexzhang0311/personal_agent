import { useState } from 'react'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { login } from '../../api/auth'
import useAuthStore from '../../stores/authStore'

export default function LoginPage() {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const setToken = useAuthStore((s) => s.setToken)
  const setUser = useAuthStore((s) => s.setUser)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!username.trim()) {
      setError(t('auth.usernameRequired'))
      return
    }
    if (!password) {
      setError(t('auth.passwordRequired'))
      return
    }

    setSubmitting(true)
    try {
      const res = await login(username.trim(), password)
      setToken(res.access_token)
      setUser(res.user)
    } catch (err) {
      setError(err.message || t('auth.loginFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    fontFamily: "'Noto Sans', sans-serif",
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 150ms ease',
  }

  // Visible keyboard-focus indication (inputs suppress the UA outline).
  const focusProps = {
    onFocus: (e) => { e.target.style.borderColor = 'var(--blue)' },
    onBlur: (e) => { e.target.style.borderColor = 'var(--border)' },
  }

  const labelStyle = {
    display: 'block',
    marginBottom: '4px',
    color: 'var(--text-secondary)',
    fontSize: '12px',
    fontWeight: 400,
  }

  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: '100vh', background: 'var(--bg-base)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        style={{
          width: '100%',
          maxWidth: '360px',
          padding: '32px 24px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
        }}
      >
        <div className="flex items-center gap-2 justify-center" style={{ marginBottom: '8px' }}>
          <Bot size={24} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />
          <span className="font-bold" style={{ color: 'var(--text-primary)', fontSize: '20px' }}>
            {t('auth.signInTitle')}
          </span>
        </div>

        {error && (
          <p className="text-xs" style={{ color: 'var(--red)', margin: 0 }}>{error}</p>
        )}

        <div>
          <label style={labelStyle}>{t('auth.username')}</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            autoComplete="username"
            autoFocus
            {...focusProps}
          />
        </div>

        <div>
          <label style={labelStyle}>{t('auth.password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete="current-password"
            {...focusProps}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="text-sm font-semibold"
          style={{
            width: '100%',
            padding: '8px 16px',
            background: 'var(--blue)',
            color: 'var(--text-inverse)',
            border: 'none',
            borderRadius: '4px',
            cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.6 : 1,
            transition: 'opacity 150ms ease',
            marginTop: '4px',
          }}
        >
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </div>
  )
}
