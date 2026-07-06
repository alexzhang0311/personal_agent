import { useEffect, useMemo, useState, useCallback } from 'react'
import { Search, FileText, Trash2, Download, MoreVertical, CheckSquare, Square, ArrowUp, ArrowDown, Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useUserDataStore from '../../stores/userDataStore'
import useUiStore from '../../stores/uiStore'
import { downloadFile } from '../../api/files'
import { copyTextToClipboard } from '../../utils/clipboard'
import FilePreviewDrawer from './FilePreviewDrawer'
import { formatDateTime } from '../../utils/formatTime'

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function getFileIcon(ext) {
  return FileText
}

const EXT_TO_MIME = {
  pdf: 'application/pdf',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  md: 'text/markdown',
  py: 'text/x-python',
  java: 'text/x-java',
  go: 'text/x-go',
  rs: 'text/x-rust',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/toml',
  sh: 'text/x-shellscript',
  log: 'text/plain',
}

function getMimeType(ext) {
  if (!ext) return 'application/octet-stream'
  return EXT_TO_MIME[ext.toLowerCase().replace(/^\./, '')] || 'application/octet-stream'
}

function FileTableSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="skeleton" style={{ width: 16, height: 16 }} />
          <div className="skeleton" style={{ width: 16, height: 16 }} />
          <div className="skeleton flex-1" style={{ height: 13 }} />
          <div className="skeleton" style={{ width: 100, height: 13 }} />
          <div className="skeleton" style={{ width: 60, height: 13 }} />
          <div className="skeleton" style={{ width: 80, height: 13 }} />
        </div>
      ))}
    </div>
  )
}

function SortableHeader({ label, field, sortField, sortDir, onSort, width, textAlign, flex }) {
  const isActive = sortField === field
  return (
    <button
      className={`flex items-center gap-1 uppercase${flex ? ' flex-1' : ''}`}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        color: isActive ? 'var(--text-secondary)' : 'var(--text-dim)',
        width,
        flexShrink: flex ? undefined : 0,
        minWidth: 0,
        textAlign: textAlign || 'left',
        justifyContent: textAlign === 'right' ? 'flex-end' : 'flex-start',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        letterSpacing: 'inherit',
        transition: 'color 150ms ease',
      }}
      onClick={() => onSort(field)}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-dim)' }}
    >
      <span className="truncate">{label}</span>
      {isActive && (sortDir === 'asc'
        ? <ArrowUp size={10} strokeWidth={1.5} style={{ flexShrink: 0 }} />
        : <ArrowDown size={10} strokeWidth={1.5} style={{ flexShrink: 0 }} />
      )}
    </button>
  )
}

function CopyPathButton({ path }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="copy-path-btn"
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        transition: 'color 150ms ease',
        flexShrink: 0,
      }}
      title={path}
      onClick={(e) => {
        e.stopPropagation()
        copyTextToClipboard(path)
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-dim)' }}
    >
      {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
    </button>
  )
}

function ActionsMenu({ file, onDownload, onDelete }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()

  return (
    <div className="relative">
      <button
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-dim)',
          padding: 4,
          transition: 'color 150ms ease',
        }}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
      >
        <MoreVertical size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 50 }} onClick={() => setOpen(false)} />
          <div
            className="absolute flex flex-col py-1"
            style={{
              right: 0,
              top: '100%',
              zIndex: 51,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              minWidth: 140,
            }}
          >
            <button
              className="flex items-center gap-2 px-3 py-2 text-xs"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                transition: 'background 150ms ease',
                textAlign: 'left',
              }}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onDownload()
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Download size={12} strokeWidth={1.5} />
              {t('userData.download')}
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 text-xs"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--red)',
                transition: 'background 150ms ease',
                textAlign: 'left',
              }}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onDelete()
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Trash2 size={12} strokeWidth={1.5} />
              {t('userData.delete')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function UserFiles() {
  const { t } = useTranslation()
  const files = useUserDataStore((s) => s.files)
  const filesLoading = useUserDataStore((s) => s.filesLoading)
  const fetchFiles = useUserDataStore((s) => s.fetchFiles)
  const selectedFileUuids = useUserDataStore((s) => s.selectedFileUuids)
  const toggleFileSelection = useUserDataStore((s) => s.toggleFileSelection)
  const selectAllFiles = useUserDataStore((s) => s.selectAllFiles)
  const clearSelection = useUserDataStore((s) => s.clearSelection)
  const deleteFiles = useUserDataStore((s) => s.deleteFiles)
  const previewFile = useUserDataStore((s) => s.previewFile)
  const setPreviewFile = useUserDataStore((s) => s.setPreviewFile)
  const searchQuery = useUserDataStore((s) => s.searchQuery)
  const setSearchQuery = useUserDataStore((s) => s.setSearchQuery)
  const dateFilter = useUserDataStore((s) => s.dateFilter)
  const setDateFilter = useUserDataStore((s) => s.setDateFilter)
  const extFilter = useUserDataStore((s) => s.extFilter)
  const setExtFilter = useUserDataStore((s) => s.setExtFilter)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const [sortField, setSortField] = useState(null) // 'name' | 'mime' | 'size' | 'date'
  const [sortDir, setSortDir] = useState('asc')

  const handleSort = useCallback((field) => {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }, [sortField])

  useEffect(() => { fetchFiles() }, [dateFilter])

  const filteredFiles = useMemo(() => {
    let result = files
    if (searchQuery) {
      result = result.filter((f) => f.original_name.toLowerCase().includes(searchQuery.toLowerCase()))
    }
    if (extFilter) {
      result = result.filter((f) => (f.ext || '').toLowerCase() === extFilter)
    }
    if (sortField) {
      result = [...result].sort((a, b) => {
        let cmp = 0
        switch (sortField) {
          case 'name':
            cmp = (a.original_name || '').localeCompare(b.original_name || '')
            break
          case 'mime':
            cmp = getMimeType(a.ext).localeCompare(getMimeType(b.ext))
            break
          case 'size':
            cmp = (a.size || 0) - (b.size || 0)
            break
          case 'date':
            cmp = new Date(a.uploaded_at || a.upload_date || 0).getTime() - new Date(b.uploaded_at || b.upload_date || 0).getTime()
            break
        }
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [files, searchQuery, extFilter, sortField, sortDir])

  const totalSize = useMemo(() => files.reduce((s, f) => s + (f.size || 0), 0), [files])

  const uniqueDates = useMemo(() => {
    const dates = new Set(files.map((f) => f.upload_date))
    return [...dates].sort().reverse()
  }, [files])

  const uniqueExts = useMemo(() => {
    const exts = new Set(files.map((f) => (f.ext || '').toLowerCase()).filter(Boolean))
    return [...exts].sort()
  }, [files])

  const allSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selectedFileUuids.has(f.uuid))

  const handleDownload = async (file) => {
    try {
      const blob = await downloadFile(file.uuid)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.original_name
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const handleDeleteFile = (file) => {
    showConfirmDialog({
      title: t('userData.deleteFileTitle'),
      message: t('userData.deleteFileMessage', { name: file.original_name }),
      confirmLabel: t('admin.delete'),
      danger: true,
      onConfirm: () => deleteFiles([file.uuid]),
    })
  }

  const handleDeleteSelected = () => {
    const uuids = [...selectedFileUuids]
    showConfirmDialog({
      title: t('userData.deleteSelectedTitle'),
      message: t('userData.deleteSelectedMessage', { count: uuids.length }),
      confirmLabel: t('admin.delete'),
      danger: true,
      onConfirm: () => deleteFiles(uuids),
    })
  }

  return (
    <div className="flex flex-1" style={{ minHeight: 0, overflow: 'hidden' }}>
      {/* File table */}
      <div className="flex flex-col flex-1" style={{ minWidth: 0, minHeight: 0 }}>
        {/* Top bar */}
        <div
          className="flex items-center gap-4 px-6 py-3 flex-wrap"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {/* Stats */}
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {t('userData.fileStats', { count: files.length, size: formatBytes(totalSize) })}
          </span>

          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-1"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              flex: 1,
              maxWidth: 240,
            }}
          >
            <Search size={14} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <input
              className="flex-1"
              placeholder={t('userData.searchFiles')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: 12,
                minWidth: 0,
              }}
            />
          </div>

          {/* Date filter */}
          <select
            value={dateFilter || ''}
            onChange={(e) => setDateFilter(e.target.value || null)}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: 12,
              padding: '4px 8px',
              outline: 'none',
            }}
          >
            <option value="">{t('userData.allDates')}</option>
            {uniqueDates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* Ext filter */}
          <select
            value={extFilter || ''}
            onChange={(e) => setExtFilter(e.target.value || null)}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              fontSize: 12,
              padding: '4px 8px',
              outline: 'none',
            }}
          >
            <option value="">{t('userData.allTypes')}</option>
            {uniqueExts.map((ext) => (
              <option key={ext} value={ext}>{ext}</option>
            ))}
          </select>

          {/* Multi-select actions */}
          {selectedFileUuids.size > 0 && (
            <button
              className="flex items-center gap-1 px-3 py-1 text-xs"
              style={{
                background: 'transparent',
                border: '1px solid var(--red)',
                borderRadius: '4px',
                color: 'var(--red)',
                cursor: 'pointer',
                transition: 'background 150ms ease',
              }}
              onClick={handleDeleteSelected}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Trash2 size={12} strokeWidth={1.5} />
              {t('userData.deleteSelected', { count: selectedFileUuids.size })}
            </button>
          )}
        </div>

        {/* Hint */}
        <div className="flex items-center gap-2 px-6 py-1" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          <Copy size={11} strokeWidth={1.5} />
          <span>{t('userData.copyPathHint')}</span>
        </div>

        {/* Table header */}
        <div
          className="flex items-center gap-3 px-4 py-2 text-xs uppercase"
          style={{
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-dim)',
            letterSpacing: '0.06em',
            fontWeight: 600,
          }}
        >
          <button
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)' }}
            onClick={() => allSelected ? clearSelection() : selectAllFiles()}
          >
            {allSelected ? <CheckSquare size={14} strokeWidth={1.5} /> : <Square size={14} strokeWidth={1.5} />}
          </button>
          <span style={{ width: 20, flexShrink: 0 }} />
          <SortableHeader label={t('userData.fileName')} field="name" sortField={sortField} sortDir={sortDir} onSort={handleSort} flex />
          <SortableHeader label={t('userData.fileMimeType')} field="mime" sortField={sortField} sortDir={sortDir} onSort={handleSort} width={160} />
          <SortableHeader label={t('userData.fileSize')} field="size" sortField={sortField} sortDir={sortDir} onSort={handleSort} width={80} textAlign="right" />
          <SortableHeader label={t('userData.uploadDate')} field="date" sortField={sortField} sortDir={sortDir} onSort={handleSort} width={140} textAlign="right" />
          <span style={{ width: 62 }} />
        </div>

        {/* File rows */}
        <div className="flex-1 overflow-y-auto">
          {filesLoading ? (
            <FileTableSkeleton />
          ) : filteredFiles.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--text-dim)', padding: '40px 20px', textAlign: 'center' }}>
              {t('userData.noFiles')}
            </div>
          ) : (
            filteredFiles.map((file) => {
              const isSelected = selectedFileUuids.has(file.uuid)
              const isPreview = previewFile?.uuid === file.uuid
              const Icon = getFileIcon(file.ext)
              return (
                <div
                  key={file.uuid}
                  className="flex items-center gap-3 px-4 py-2"
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: isPreview ? 'var(--bg-elevated)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 150ms ease',
                  }}
                  onClick={() => setPreviewFile(isPreview ? null : file)}
                  onMouseEnter={(e) => {
                    if (!isPreview) e.currentTarget.style.background = 'var(--bg-surface)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isPreview) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {/* Checkbox */}
                  <button
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: isSelected ? 'var(--blue)' : 'var(--text-dim)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFileSelection(file.uuid)
                    }}
                  >
                    {isSelected ? <CheckSquare size={14} strokeWidth={1.5} /> : <Square size={14} strokeWidth={1.5} />}
                  </button>

                  {/* Icon */}
                  <Icon size={16} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />

                  {/* Filename */}
                  <span className="flex-1 truncate text-sm" style={{ color: 'var(--text-primary)', minWidth: 0 }}>
                    {file.original_name}
                  </span>

                  {/* MIME Type */}
                  <span className="text-xs truncate" style={{ width: 160, flexShrink: 0, color: 'var(--text-dim)' }}>
                    {getMimeType(file.ext)}
                  </span>

                  {/* Size */}
                  <span className="text-xs" style={{ width: 80, flexShrink: 0, textAlign: 'right', color: 'var(--text-dim)' }}>
                    {formatBytes(file.size)}
                  </span>

                  {/* Date */}
                  <span className="text-xs" style={{ width: 140, flexShrink: 0, textAlign: 'right', color: 'var(--text-dim)' }}>
                    {file.uploaded_at ? formatDateTime(file.uploaded_at) : file.upload_date}
                  </span>

                  {/* Copy server path + Actions */}
                  {file.path && <CopyPathButton path={file.path} />}
                  <ActionsMenu
                    file={file}
                    onDownload={() => handleDownload(file)}
                    onDelete={() => handleDeleteFile(file)}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Preview drawer */}
      {previewFile && (
        <FilePreviewDrawer
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={() => handleDownload(previewFile)}
          onDelete={() => handleDeleteFile(previewFile)}
        />
      )}
    </div>
  )
}
