import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { formatDateTime } from '../../utils/formatTime'

function formatBytes(bytes) {
  if (bytes == null) return ''
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function getFileLabel(file) {
  return file.original_name || file.name || file.path || ''
}

function getFileDate(file) {
  const value = file.uploaded_at || file.upload_date || file.modified
  if (!value) return ''
  // Numeric values are epoch SECONDS (backend sends st.st_mtime for
  // current-directory files); strings are ISO dates from the upload API.
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date)
}

export default function FilePicker({ files, query, onSelect, onClose, activeIndex, loading, positionStyle }) {
  const { t } = useTranslation()
  const listRef = useRef(null)
  const activeRef = useRef(null)

  const q = query.toLowerCase()
  const filtered = q
    ? files.filter((f) => getFileLabel(f).toLowerCase().includes(q) || (f.path || '').toLowerCase().includes(q))
    : files
  const uploadedFiles = filtered.filter((f) => f.source !== 'current')
  const currentFiles = filtered.filter((f) => f.source === 'current')

  // Scroll active item into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const popupPosition = positionStyle || {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 4,
  }

  const headerEl = (
    <div
      className="px-3 pt-2 pb-2"
      style={{
        color: 'var(--text-secondary)',
        fontSize: 12,
        fontWeight: 400,
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 2,
      }}
    >
      {t('filePicker.header')}
    </div>
  )

  const renderSection = (title, sectionFiles, offset) => {
    if (sectionFiles.length === 0) return null
    return (
      <div>
        <div
          className="px-3 py-1 uppercase"
          style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
          }}
        >
          {title}
        </div>
        {sectionFiles.map((file, idx) => {
          const flatIndex = offset + idx
          const isActive = flatIndex === activeIndex
          const label = getFileLabel(file)
          const dateText = getFileDate(file)
          const metaText = file.source === 'current' ? (file.directory || file.path || '') : formatBytes(file.size)
          return (
            <div
              key={file.uuid || file.path || `${file.source}-${label}-${flatIndex}`}
              ref={isActive ? activeRef : null}
              className="flex items-center gap-2 px-3 py-1 cursor-pointer"
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--cyan)' : '2px solid transparent',
                transition: 'background 150ms ease',
              }}
              onClick={() => onSelect(file)}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent'
              }}
            >
              <FileText size={13} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
              <span
                className="truncate"
                title={file.path || label}
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: 13,
                  minWidth: 0,
                }}
              >
                {label}
              </span>
              <span className="flex-1 min-w-0" />
              {metaText && (
                <span
                  className="truncate flex-shrink-0"
                  title={metaText}
                  style={{
                    color: 'var(--text-dim)',
                    fontSize: 11,
                    maxWidth: 180,
                  }}
                >
                  {metaText}
                </span>
              )}
              {dateText && (
                <span
                  className="flex-shrink-0"
                  style={{
                    color: 'var(--text-dim)',
                    fontSize: 11,
                  }}
                >
                  {dateText}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className="file-picker-popup"
        style={{
          ...popupPosition,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 4,
          padding: '0 0 8px 0',
          zIndex: 50,
        }}
      >
        {headerEl}
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-3 py-2 flex items-center gap-2">
            <div className="skeleton" style={{ width: 14, height: 14, borderRadius: 2 }} />
            <div className="skeleton" style={{ width: 150, height: 14, borderRadius: 2 }} />
            <div className="flex-1" />
            <div className="skeleton" style={{ width: 40, height: 10, borderRadius: 2 }} />
          </div>
        ))}
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div
        className="file-picker-popup"
        style={{
          ...popupPosition,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 4,
          padding: 0,
          zIndex: 50,
        }}
      >
        {headerEl}
        <div className="px-3 py-2">
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            {t('filePicker.noFiles')}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="file-picker-popup"
      style={{
        ...popupPosition,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 4,
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 50,
        padding: '0 0 4px 0',
      }}
    >
      {headerEl}
      {renderSection(t('filePicker.uploadedFiles'), uploadedFiles, 0)}
      {renderSection(t('filePicker.currentDirectory'), currentFiles, uploadedFiles.length)}
    </div>
  )
}

export function getFilteredFiles(files, query) {
  const q = query.toLowerCase()
  return q
    ? files.filter((f) => getFileLabel(f).toLowerCase().includes(q) || (f.path || '').toLowerCase().includes(q))
    : files
}
