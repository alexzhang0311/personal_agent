import { useState } from 'react'
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react'
import useChatStore from '../../stores/chatStore'
import { useSSE } from '../../hooks/useSSE'
import { copyTextToClipboard } from '../../utils/clipboard'

export default function ErrorBlock({ message }) {
  const [copied, setCopied] = useState(false)
  const lastUserPrompt = useChatStore((s) => s.lastUserPrompt)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const { sendMessage } = useSSE()

  const errorInfo = message?.errorInfo || {}
  const errorCode = errorInfo.code || message?.error_code || message?.error || 'unknown'
  const attempts = errorInfo.attempts || message?.attempts || null
  const apiStatus = errorInfo.api_error_status ?? null
  const detail = errorInfo.message || message?.error_message || extractText(message) || 'Upstream API error'

  const { title, body } = titleAndBodyForStatus(apiStatus, detail)

  const handleRetry = () => {
    if (isStreaming) return
    if (!lastUserPrompt) return
    sendMessage(
      lastUserPrompt.message,
      lastUserPrompt.permissionMode,
      lastUserPrompt.attachments,
      lastUserPrompt.attachmentsMeta,
      lastUserPrompt.images,
    )
  }

  const handleCopy = async () => {
    const payload = {
      error_code: errorCode,
      attempts,
      message: detail,
      raw_detail: errorInfo.raw_detail || null,
    }
    const ok = await copyTextToClipboard(JSON.stringify(payload, null, 2))
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 800)
  }

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        borderLeft: '2px solid var(--red)',
        borderRadius: 2,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--red)', flexShrink: 0 }} />
        <span
          className="uppercase font-semibold"
          style={{ color: 'var(--red)', fontSize: 11, letterSpacing: '0.06em' }}
        >
          {title}
        </span>
        {apiStatus != null && (
          <span
            className="text-xs"
            style={{
              color: 'var(--text-dim)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            }}
          >
            (HTTP {apiStatus})
          </span>
        )}
        {apiStatus == null && errorCode && (
          <span
            className="text-xs"
            style={{
              color: 'var(--text-dim)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            }}
          >
            ({errorCode})
          </span>
        )}
      </div>
      <div
        className="text-xs"
        style={{
          color: 'var(--text-secondary)',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {body}
      </div>
      {attempts && (
        <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
          Failed after {attempts} attempt{attempts === 1 ? '' : 's'}.
        </div>
      )}
      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
        <button
          type="button"
          onClick={handleRetry}
          disabled={isStreaming || !lastUserPrompt}
          className="inline-flex items-center gap-1 px-2 py-1"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'transparent',
            color: isStreaming || !lastUserPrompt ? 'var(--text-dim)' : 'var(--text-primary)',
            fontSize: 12,
            cursor: isStreaming || !lastUserPrompt ? 'default' : 'pointer',
            transition: 'border-color 150ms ease, color 150ms ease',
          }}
          onMouseEnter={(e) => {
            if (isStreaming || !lastUserPrompt) return
            e.currentTarget.style.borderColor = 'var(--blue)'
            e.currentTarget.style.color = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = isStreaming || !lastUserPrompt ? 'var(--text-dim)' : 'var(--text-primary)'
          }}
        >
          <RefreshCw size={12} strokeWidth={1.5} />
          Retry
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-2 py-1"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'transparent',
            color: copied ? 'var(--green)' : 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            transition: 'color 150ms ease, border-color 150ms ease',
          }}
          onMouseEnter={(e) => {
            if (copied) return
            e.currentTarget.style.borderColor = 'var(--blue)'
            e.currentTarget.style.color = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = copied ? 'var(--green)' : 'var(--text-secondary)'
          }}
        >
          {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </div>
  )
}

function extractText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((b) => b?.type === 'text' && typeof b?.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim() || null
}

function titleAndBodyForStatus(status, fallbackDetail) {
  if (status === 429) {
    return {
      title: 'Rate limited',
      body: fallbackDetail || 'Anthropic rate-limited this request. Wait until reset before retrying.',
    }
  }
  if (status === 503 || status === 529) {
    return {
      title: 'Server overloaded',
      body: fallbackDetail || 'Anthropic is temporarily overloaded. Retry in a moment.',
    }
  }
  if (typeof status === 'number' && status >= 500) {
    return {
      title: 'Server error',
      body: fallbackDetail || 'Upstream server error.',
    }
  }
  return {
    title: 'Upstream API error',
    body: fallbackDetail || 'Upstream API error.',
  }
}
