import { useState, useCallback } from 'react'
import { AlertTriangle, Check, X, Terminal, FileText, FilePenLine, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Chip from '../shared/Chip'

const DANGEROUS_PATTERNS = /\b(rm\s|sudo\s|chmod\s|chown\s|mkfs\s|dd\s)/

function ToolInputDisplay({ toolName, input }) {
  if (toolName === 'Bash' && input?.command) {
    return (
      <div
        className="px-3 py-2 text-xs overflow-x-auto"
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: 2,
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        <span style={{ color: 'var(--text-dim)' }}>$ </span>
        {input.command}
      </div>
    )
  }

  if (toolName === 'Write' && input?.file_path) {
    const preview = input.content
      ? input.content.length > 200
        ? input.content.slice(0, 200) + '\u2026'
        : input.content
      : null
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <FileText size={12} strokeWidth={1.5} />
          <span style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{input.file_path}</span>
        </div>
        {preview && (
          <div
            className="px-3 py-2 text-xs overflow-x-auto"
            style={{
              background: 'var(--bg-elevated)',
              borderRadius: 2,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              color: 'var(--text-dim)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            {preview}
          </div>
        )}
      </div>
    )
  }

  if (toolName === 'Edit' && input?.file_path) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <FilePenLine size={12} strokeWidth={1.5} />
          <span style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{input.file_path}</span>
        </div>
        {input.old_string && (
          <div
            className="px-3 py-2 text-xs overflow-x-auto"
            style={{
              background: 'var(--bg-elevated)',
              borderRadius: 2,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            <div style={{ color: 'var(--red)' }}>- {input.old_string}</div>
            <div style={{ color: 'var(--green)' }}>+ {input.new_string}</div>
          </div>
        )}
      </div>
    )
  }

  if (toolName === 'Read' && input?.file_path) {
    return (
      <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <Eye size={12} strokeWidth={1.5} />
        <span style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>{input.file_path}</span>
      </div>
    )
  }

  // Generic: show tool name + JSON
  return (
    <div
      className="px-3 py-2 text-xs overflow-x-auto"
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 2,
        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        color: 'var(--text-dim)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 160,
        overflowY: 'auto',
      }}
    >
      {JSON.stringify(input, null, 2)}
    </div>
  )
}

function ConfirmDangerDialog({ toolName, command, onConfirm, onCancel, t }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
      }}
    >
      <div
        className="flex flex-col gap-3 p-4"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          maxWidth: 420,
          width: '90%',
          animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
          <span className="font-semibold" style={{ color: 'var(--red)', fontSize: 13 }}>
            {t('permissionRequest.dangerousCommand')}
          </span>
        </div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {t('permissionRequest.dangerousMessage')}
        </div>
        <div
          className="px-3 py-2 text-xs"
          style={{
            background: 'var(--bg-elevated)',
            borderRadius: 2,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          <span style={{ color: 'var(--text-dim)' }}>$ </span>
          {command}
        </div>
        <div className="flex justify-end gap-2" style={{ marginTop: 4 }}>
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs font-semibold"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
            }}
          >
            {t('confirm.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1 text-xs font-semibold"
            style={{
              background: 'var(--red)',
              border: 'none',
              borderRadius: 4,
              color: 'var(--text-inverse)',
              cursor: 'pointer',
              transition: 'opacity 150ms ease',
            }}
          >
            {t('permissionRequest.allowAnyway')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PermissionRequestCard({ block, onRespond }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState('pending') // pending | allowed | denied
  const [showDangerConfirm, setShowDangerConfirm] = useState(false)

  const toolName = block.tool_name
  const input = block.input || {}
  const requestId = block.request_id
  const isRisky = !!block.risky
  const matchedRule = block.matched_rule
  // Backend-generated reason (present for risky invocations); fall back to
  // the generic i18n reminder so non-risky requests still show something.
  const reasonText = block.reason || t('permissionRequest.confirmHint')

  const isDangerous = toolName === 'Bash' && input.command && DANGEROUS_PATTERNS.test(input.command)

  const handleAllow = useCallback(() => {
    if (isDangerous) {
      setShowDangerConfirm(true)
      return
    }
    setStatus('allowed')
    onRespond(requestId, 'allow')
  }, [isDangerous, onRespond, requestId])

  const handleConfirmDanger = useCallback(() => {
    setShowDangerConfirm(false)
    setStatus('allowed')
    onRespond(requestId, 'allow')
  }, [onRespond, requestId])

  const handleDeny = useCallback(() => {
    setStatus('denied')
    onRespond(requestId, 'deny', 'User denied permission')
  }, [onRespond, requestId])

  // Collapsed allowed state
  if (status === 'allowed') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          borderLeft: '2px solid var(--green)',
          background: 'var(--bg-surface)',
          borderRadius: 4,
        }}
      >
        <Check size={14} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
        <span className="text-xs uppercase font-semibold" style={{ color: 'var(--green)', letterSpacing: '0.06em' }}>
          {t('permissionRequest.allowed')}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
          {toolName}
          {toolName === 'Bash' && input.command && (
            <span style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", marginLeft: 6 }}>
              $ {input.command.length > 60 ? input.command.slice(0, 60) + '\u2026' : input.command}
            </span>
          )}
        </span>
      </div>
    )
  }

  // Collapsed denied state
  if (status === 'denied') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          borderLeft: '2px solid var(--red)',
          background: 'var(--bg-surface)',
          borderRadius: 4,
        }}
      >
        <X size={14} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
        <span className="text-xs uppercase font-semibold" style={{ color: 'var(--red)', letterSpacing: '0.06em' }}>
          {t('permissionRequest.denied')}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
          {toolName}
        </span>
      </div>
    )
  }

  // Active pending state
  const toolIcon = toolName === 'Bash' ? Terminal : FileText

  return (
    <>
      {showDangerConfirm && (
        <ConfirmDangerDialog
          toolName={toolName}
          command={input.command}
          onConfirm={handleConfirmDanger}
          onCancel={() => setShowDangerConfirm(false)}
          t={t}
        />
      )}
      <div
        style={{
          borderLeft: isRisky ? '2px solid var(--red)' : '2px solid var(--yellow)',
          border: '1px solid var(--border)',
          borderLeftWidth: 2,
          borderLeftColor: isRisky ? 'var(--red)' : 'var(--yellow)',
          borderRadius: 4,
          background: 'var(--bg-surface)',
          padding: 16,
        }}
      >
        {/* Risky top banner -- only when admin policy flagged this invocation */}
        {isRisky && (
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{
              background: 'color-mix(in srgb, var(--red) 12%, transparent)',
              borderRadius: 2,
              marginBottom: 12,
            }}
          >
            <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--red)' }} />
            <span
              className="text-xs uppercase font-semibold"
              style={{ color: 'var(--red)', letterSpacing: '0.06em' }}
            >
              {t('permissionRequest.riskyBanner')}
            </span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <AlertTriangle size={16} strokeWidth={1.5} style={{ color: isRisky ? 'var(--red)' : 'var(--yellow)' }} />
          <span
            className="text-xs uppercase font-semibold"
            style={{ color: isRisky ? 'var(--red)' : 'var(--yellow)', letterSpacing: '0.06em' }}
          >
            {t('permissionRequest.title')}
          </span>
        </div>

        {/* Tool chip */}
        <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{t('permissionRequest.tool')}:</span>
          <span
            className="inline-flex items-center gap-1 px-2 py-0 text-xs font-semibold"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--cyan)',
              borderRadius: 2,
              fontSize: 11,
            }}
          >
            {(() => { const Icon = toolIcon; return <Icon size={12} strokeWidth={1.5} /> })()}
            {toolName}
          </span>
          {isRisky && <Chip color="var(--red)">{t('permissionRequest.riskyChip')}</Chip>}
        </div>

        {/* Tool input display */}
        <div style={{ marginBottom: isRisky && matchedRule ? 6 : 16 }}>
          <ToolInputDisplay toolName={toolName} input={input} />
        </div>

        {/* Matched rule hint -- dim monospace below the tool input */}
        {isRisky && matchedRule && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-dim)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              marginBottom: 10,
            }}
          >
            {t('permissionRequest.matchedRule')}: {matchedRule}
          </div>
        )}

        {/* Confirm reminder -- backend-supplied `reason` for risky calls,
            i18n fallback for everything else. */}
        <div
          className="flex items-start gap-2 px-3 py-2"
          style={{
            background: 'var(--bg-elevated)',
            borderLeft: `2px solid ${isRisky ? 'var(--red)' : 'var(--yellow)'}`,
            borderRadius: 2,
            marginBottom: 14,
          }}
        >
          <AlertTriangle
            size={12}
            strokeWidth={1.5}
            style={{
              color: isRisky ? 'var(--red)' : 'var(--yellow)',
              flexShrink: 0,
              marginTop: 2,
            }}
          />
          <span
            className="text-xs"
            style={{
              color: 'var(--text-secondary)',
              wordBreak: 'break-word',
              lineHeight: 1.5,
            }}
          >
            {reasonText}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleDeny}
            className="px-3 py-1 text-xs font-semibold"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--red)',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--red)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            {t('permissionRequest.deny')}
          </button>
          <button
            onClick={handleAllow}
            className="px-3 py-1 text-xs font-semibold"
            style={{
              background: 'var(--blue)',
              border: 'none',
              borderRadius: 4,
              color: 'var(--text-inverse)',
              cursor: 'pointer',
              transition: 'opacity 150ms ease',
            }}
          >
            {t('permissionRequest.allow')}
          </button>
        </div>
      </div>
    </>
  )
}
