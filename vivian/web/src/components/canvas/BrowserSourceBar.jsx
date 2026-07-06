import { useEffect, useMemo, useState } from 'react'
import { FileCode, Bot, ChevronDown, RefreshCcw, Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useBrowserDebugStore from '../../stores/browserDebugStore'
import useChatStore from '../../stores/chatStore'
import { downloadFile } from '../../api/userFiles'
import {
  FILE_SOURCE_CURRENT,
  collectBrowserFilesFromSession,
} from '../../utils/fileArtifacts'

const BTN_BASE = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  padding: '4px 8px',
  fontSize: 12,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
}

function IconButton({ label, icon: Icon, trailingIcon: TrailingIcon, onClick, title, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      style={{
        ...BTN_BASE,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderColor: active ? 'var(--blue)' : 'var(--border)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)'
        if (!active) e.currentTarget.style.borderColor = 'var(--border-strong)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = active ? 'var(--text-primary)' : 'var(--text-secondary)'
        e.currentTarget.style.borderColor = active ? 'var(--blue)' : 'var(--border)'
      }}
    >
      {Icon && <Icon size={14} strokeWidth={1.5} />}
      {label && <span>{label}</span>}
      {TrailingIcon && <TrailingIcon size={12} strokeWidth={1.5} />}
    </button>
  )
}

function SourceDropdown({ source, label, icon: Icon, onPick }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const messages = useChatStore((s) => s.messages)
  const subagentContent = useChatStore((s) => s.subagentContent)
  const sessionFiles = useMemo(() => {
    if (source !== FILE_SOURCE_CURRENT) return []
    return collectBrowserFilesFromSession(messages, subagentContent, FILE_SOURCE_CURRENT)
      .slice(-8)
  }, [messages, subagentContent, source])

  useEffect(() => {
    if (!open) return
    const onClick = () => setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div style={{ position: 'relative' }} onMouseDown={(e) => e.stopPropagation()}>
      <IconButton
        icon={Icon}
        trailingIcon={ChevronDown}
        label={label}
        onClick={() => setOpen((v) => !v)}
        active={open}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 220,
            zIndex: 50,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {sessionFiles.length === 0 && (
            <div
              className="px-2 py-2 text-xs"
              style={{ color: 'var(--text-dim)' }}
            >
              {t('canvas.browser.currentEmpty', 'No current HTML files yet')}
            </div>
          )}
          {sessionFiles.map((file) => (
            <button
              key={`session-file-${file.filePath}`}
              type="button"
              onClick={async () => {
                setOpen(false)
                try {
                  const blob = await downloadFile(file.filePath, { cacheMode: 'no-store' })
                  const text = await blob.text()
                  onPick({
                    html: text,
                    label: file.name || file.filePath,
                    origin: file.browserSource || source,
                    filePath: file.filePath,
                  })
                } catch (err) {
                  console.error('[browser-debug] failed to load file:', err)
                }
              }}
              className="flex items-center gap-2"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                padding: '6px 8px',
                fontSize: 12,
                textAlign: 'left',
                borderRadius: 2,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <FileCode size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)' }} />
              <span className="truncate">{file.name || file.filePath}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ModeToggle() {
  const { t } = useTranslation()
  const mode = useBrowserDebugStore((s) => s.mode)
  const setMode = useBrowserDebugStore((s) => s.setMode)
  const items = [
    { key: 'inspect', label: t('canvas.browser.modeInspect', 'Inspect') },
    { key: 'interact', label: t('canvas.browser.modeInteract', 'Interact') },
  ]
  return (
    <div
      className="flex items-center"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {items.map((it) => {
        const active = mode === it.key
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => setMode(it.key)}
            style={{
              background: active ? 'var(--bg-elevated)' : 'transparent',
              border: 'none',
              borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              transition: 'color 150ms ease, background 150ms ease',
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export default function BrowserSourceBar() {
  const { t } = useTranslation()
  const setHtmlSource = useBrowserDebugStore((s) => s.setHtmlSource)
  const htmlSource = useBrowserDebugStore((s) => s.htmlSource)
  const reload = useBrowserDebugStore((s) => s.reload)
  const modalOpen = useBrowserDebugStore((s) => s.modalOpen)
  const openModal = useBrowserDebugStore((s) => s.openModal)
  const closeModal = useBrowserDebugStore((s) => s.closeModal)

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 flex-shrink-0 min-w-0"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <div className="flex items-center gap-2 min-w-0" style={{ flexWrap: 'wrap' }}>
        <span
          className="uppercase"
          style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            letterSpacing: '0.06em',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {t('canvas.browser.loadFileFrom', 'Load File from:')}
        </span>
        <SourceDropdown
          source={FILE_SOURCE_CURRENT}
          icon={Bot}
          label={t('canvas.browser.sourceCurrent', 'Current Agent session')}
          onPick={(src) => {
            if (!src.html) return
            setHtmlSource(src)
          }}
        />
      </div>

      {htmlSource?.label && (
        <span
          className="truncate"
          title={htmlSource.label}
          style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            maxWidth: 160,
          }}
        >
          {htmlSource.label}
        </span>
      )}

      <div className="flex-1" />

      <ModeToggle />

      <IconButton
        icon={RefreshCcw}
        onClick={reload}
        title={t('canvas.browser.reload', 'Reload')}
      />
      <IconButton
        icon={modalOpen ? Minimize2 : Maximize2}
        onClick={() => (modalOpen ? closeModal() : openModal())}
        title={modalOpen ? t('canvas.browser.exitFullscreen', 'Exit full screen') : t('canvas.browser.fullscreen', 'Full screen')}
      />
    </div>
  )
}
