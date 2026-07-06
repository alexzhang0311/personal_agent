import { useId, useState } from 'react'
import { X, Download, Trash2, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useResizable } from '../../hooks/useResizable'
import FilePreview from './FilePreview'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'
import safeStorage from '../../utils/safeStorage'

const STORAGE_KEY = 'preview-drawer-width'
const MIN_WIDTH = 320
const MAX_WIDTH_VW = 0.6

function getStoredWidth() {
  const fallback = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.5))
  return safeStorage.getNumber(STORAGE_KEY, fallback, {
    min: MIN_WIDTH,
    max: Math.floor(window.innerWidth * MAX_WIDTH_VW),
  })
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

export default function FilePreviewDrawer({ file, onClose, onDownload, onDelete }) {
  const { t } = useTranslation()
  const [width, setWidthState] = useState(getStoredWidth)
  const [infoExpanded, setInfoExpanded] = useState(false)
  const infoBodyId = useId()

  const maxWidth = Math.floor(window.innerWidth * MAX_WIDTH_VW)

  const setWidth = (w) => {
    setWidthState(w)
    safeStorage.setItem(STORAGE_KEY, String(w))
  }

  const { dragging, onMouseDown } = useResizable({
    initial: width,
    min: MIN_WIDTH,
    max: maxWidth,
    direction: 'left',
    onResize: setWidth,
  })

  return (
    <div
      className="flex flex-col flex-shrink-0 relative"
      style={{
        width,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        height: '100%',
        overflow: 'hidden',
        animation: 'slideInRight 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Resize handle — left edge */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          cursor: 'col-resize',
          background: dragging ? 'var(--blue)' : 'transparent',
          transition: 'background 100ms ease',
          zIndex: 10,
        }}
        onMouseEnter={(e) => {
          if (!dragging) e.currentTarget.style.background = 'var(--blue)'
        }}
        onMouseLeave={(e) => {
          if (!dragging) e.currentTarget.style.background = 'transparent'
        }}
      />

      {/* Header: arrow + filename + actions + close */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* Expand/collapse arrow */}
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            transition: 'color 150ms ease',
          }}
          onClick={() => setInfoExpanded(!infoExpanded)}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('userData.fileInfo')}
          aria-expanded={infoExpanded}
          aria-controls={infoBodyId}
        >
          <AnimatedChevron open={infoExpanded}>
            <ChevronDown size={14} strokeWidth={1.5} />
          </AnimatedChevron>
        </button>

        {/* Filename */}
        <span className="flex-1 truncate font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
          {file.original_name}
        </span>

        {/* Download */}
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            transition: 'color 150ms ease',
          }}
          onClick={onDownload}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('userData.download')}
        >
          <Download size={14} strokeWidth={1.5} />
        </button>

        {/* Delete */}
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            transition: 'color 150ms ease',
          }}
          onClick={onDelete}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('userData.delete')}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>

        {/* Close */}
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            transition: 'color 150ms ease',
          }}
          onClick={onClose}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Collapsible metadata */}
      <AnimatedCollapse
        open={infoExpanded}
        id={infoBodyId}
        className="flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
        innerClassName="flex flex-col gap-2 px-4 py-3"
      >
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-dim)' }}>{t('userData.fileSize')}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{formatBytes(file.size)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-dim)' }}>{t('userData.uploadDate')}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{file.uploaded_at ? new Date(file.uploaded_at).toLocaleString() : file.upload_date}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-dim)' }}>{t('userData.fileType')}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{file.mime_type || file.ext}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-dim)' }}>UUID</span>
            <span
              className="truncate"
              style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 10, maxWidth: 200 }}
            >
              {file.uuid}
            </span>
          </div>
      </AnimatedCollapse>

      {/* Preview area */}
      <div className="flex-1 overflow-y-auto">
        <FilePreview file={file} />
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
