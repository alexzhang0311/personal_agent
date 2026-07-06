import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useResizable } from '../../hooks/useResizable'
import useMcpStore from '../../stores/mcpStore'
import useAuthStore from '../../stores/authStore'
import useUiStore from '../../stores/uiStore'

function maskValue(value) {
  if (!value || value.length <= 8) return '****'
  return value.slice(0, 3) + '****' + value.slice(-4)
}

function isSensitiveHeader(key) {
  const lower = key.toLowerCase()
  return lower.includes('auth') || lower.includes('token') || lower.includes('key') || lower.includes('secret')
}

export default function MCPServerMeta() {
  const { t } = useTranslation()
  const serverDetail = useMcpStore((s) => s.serverDetail)
  const detailLoading = useMcpStore((s) => s.detailLoading)
  const selectedServer = useMcpStore((s) => s.selectedServer)
  const capabilities = useMcpStore((s) => s.capabilities)
  const metaPanelWidth = useMcpStore((s) => s.metaPanelWidth)
  const setMetaPanelWidth = useMcpStore((s) => s.setMetaPanelWidth)
  const openEditDialog = useMcpStore((s) => s.openEditDialog)
  const deleteServer = useMcpStore((s) => s.deleteServer)
  const authUser = useAuthStore((s) => s.user)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const { dragging, onMouseDown } = useResizable({
    initial: metaPanelWidth,
    min: 240,
    max: 480,
    direction: 'right',
    onResize: setMetaPanelWidth,
  })

  const canModify = selectedServer?.level === 'project' || authUser?.role === 'admin'

  const handleDelete = () => {
    if (!selectedServer) return
    showConfirmDialog({
      title: t('mcp.deleteServerTitle'),
      message: t('mcp.deleteServerMessage', { name: selectedServer.name }),
      confirmLabel: t('sidebar.delete'),
      danger: true,
      requireText: selectedServer.name,
      onConfirm: () => deleteServer(selectedServer.level, selectedServer.name),
    })
  }

  return (
    <div
      className="flex flex-col flex-shrink-0 overflow-hidden relative"
      style={{
        width: metaPanelWidth,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="font-semibold truncate flex-1" style={{ color: 'var(--text-primary)', fontSize: 14 }}>
          {serverDetail?.name || selectedServer?.name}
        </span>
        {canModify && (
          <button
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: 2, transition: 'color 150ms ease',
            }}
            onClick={() => serverDetail && openEditDialog(serverDetail)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('mcp.editServer')}
          >
            <Pencil size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {detailLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="skeleton" style={{ height: 12, width: 60, borderRadius: 2 }} />
                <div className="skeleton" style={{ height: 16, width: `${90 - i * 10}%`, borderRadius: 2 }} />
              </div>
            ))}
          </div>
        ) : serverDetail ? (
          <div className="flex flex-col gap-4">
            <MetaField label={t('mcp.type')}>
              <span
                className="uppercase px-1"
                style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                  color: serverDetail.type === 'http' ? 'var(--cyan)' : 'var(--purple)',
                  border: `1px solid ${serverDetail.type === 'http' ? 'var(--cyan)' : 'var(--purple)'}`,
                  borderRadius: 2, lineHeight: '18px', display: 'inline-block',
                }}
              >
                {serverDetail.type}
              </span>
            </MetaField>

            <MetaField label={t('mcp.url')}>
              <span className="break-words" style={{ color: 'var(--text-primary)', fontSize: 13, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                {serverDetail.url}
              </span>
            </MetaField>

            <MetaField label={t('mcp.timeout')}>
              <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                {t('mcp.timeoutSeconds', { value: serverDetail.timeout })}
              </span>
            </MetaField>

            {serverDetail.headers && serverDetail.headers.length > 0 && (
              <MetaField label={t('mcp.headers')}>
                <div className="flex flex-col gap-1">
                  {serverDetail.headers.map((h, i) => (
                    <div key={i} className="flex gap-2" style={{ fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                        {h.key}:
                      </span>
                      <span style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                        {isSensitiveHeader(h.key) ? maskValue(h.value) : h.value}
                      </span>
                    </div>
                  ))}
                </div>
              </MetaField>
            )}

            <MetaField label={t('mcp.level')}>
              <span
                className="uppercase px-1"
                style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                  color: serverDetail.level === 'global' ? 'var(--green)' : 'var(--text-secondary)',
                  border: `1px solid ${serverDetail.level === 'global' ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius: 2, lineHeight: '18px', display: 'inline-block',
                }}
              >
                {serverDetail.level}
              </span>
            </MetaField>

            {capabilities?.server_name && (
              <MetaField label={t('mcp.serverVersion')}>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                  {capabilities.server_name}{capabilities.server_version ? ` v${capabilities.server_version}` : ''}
                </span>
              </MetaField>
            )}
          </div>
        ) : null}
      </div>

      {/* Delete button */}
      {canModify && serverDetail && (
        <div className="px-3 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button
            className="flex items-center gap-2 w-full justify-center py-2"
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 4, cursor: 'pointer', color: 'var(--text-dim)',
              fontSize: 13, transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onClick={handleDelete}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {t('mcp.deleteServer')}
          </button>
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 4,
          cursor: 'col-resize',
          background: dragging ? 'var(--blue)' : 'transparent',
          transition: 'background 100ms ease', zIndex: 10,
        }}
        onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = 'var(--blue)' }}
        onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = 'transparent' }}
      />
    </div>
  )
}

function MetaField({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="uppercase font-semibold" style={{ color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.06em' }}>
        {label}
      </span>
      {children}
    </div>
  )
}
