import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Folder, FileText, Download, Upload, ChevronRight, Image, FileCode, Search, ArrowUp, ArrowDown, Copy, Check, Sparkles } from 'lucide-react'
import { getFileIcon } from '../../utils/fileIcons'
import { useTranslation } from 'react-i18next'
import hljs from 'highlight.js/lib/core'
import 'highlight.js/styles/github-dark.css'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import yaml from 'highlight.js/lib/languages/yaml'
import jsonLang from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import goLang from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import markdown from 'highlight.js/lib/languages/markdown'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import ruby from 'highlight.js/lib/languages/ruby'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import lua from 'highlight.js/lib/languages/lua'
import perl from 'highlight.js/lib/languages/perl'
import scss from 'highlight.js/lib/languages/scss'
import CopyButton from '../shared/CopyButton'
import OptimizePopup from '../shared/OptimizePopup'
import getLineFromNode from '../../utils/getLineFromNode'
import { copyTextToClipboard } from '../../utils/clipboard'
import { listDirectory, previewFile, downloadFile, uploadUserFile } from '../../api/userFiles'
import { uploadAdminFile } from '../../api/adminFiles'
import { useResizable } from '../../hooks/useResizable'
import useAuthStore from '../../stores/authStore'
import safeStorage from '../../utils/safeStorage'
import { formatDateTime } from '../../utils/formatTime'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('json', jsonLang)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('go', goLang)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('lua', lua)
hljs.registerLanguage('perl', perl)
hljs.registerLanguage('plaintext', () => ({ contains: [] }))

const EXT_TO_LANG = {
  '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
  '.jsx': 'javascript', '.tsx': 'typescript',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.html': 'html', '.css': 'css', '.scss': 'scss',
  '.sql': 'sql', '.go': 'go', '.rs': 'rust', '.java': 'java',
  '.kt': 'kotlin', '.rb': 'ruby', '.c': 'c', '.cpp': 'cpp',
  '.h': 'c', '.hpp': 'cpp', '.swift': 'swift',
  '.lua': 'lua', '.pl': 'perl', '.md': 'markdown',
  '.toml': 'ini', '.ini': 'ini', '.cfg': 'ini', '.conf': 'ini',
  '.properties': 'ini', '.env': 'ini',
}

const NAME_TO_LANG = {
  'Makefile': 'bash', 'Dockerfile': 'dockerfile',
  '.bashrc': 'bash', '.bash_profile': 'bash', '.bash_logout': 'bash',
  '.zshrc': 'bash', '.zprofile': 'bash', '.zshenv': 'bash',
  '.profile': 'bash', '.gitignore': 'plaintext',
  '.gitconfig': 'ini', '.editorconfig': 'ini',
  '.npmrc': 'ini', '.yarnrc': 'yaml',
  '.prettierrc': 'json', '.eslintrc': 'json',
  '.dockerignore': 'plaintext',
}

function detectLanguage(filename) {
  if (NAME_TO_LANG[filename]) return NAME_TO_LANG[filename]
  const idx = filename.lastIndexOf('.')
  if (idx >= 0) {
    const ext = filename.slice(idx).toLowerCase()
    if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext]
  }
  return null
}

function HighlightedPreview({ content, filename }) {
  const language = detectLanguage(filename)

  const lines = useMemo(() => {
    if (!content) return []
    const raw = content.replace(/\n$/, '')
    let highlighted = null
    try {
      if (language && hljs.getLanguage(language)) {
        highlighted = hljs.highlight(raw, { language }).value
      } else {
        highlighted = hljs.highlightAuto(raw).value
      }
    } catch { /* fallback to plain */ }

    if (highlighted) {
      return highlighted.split('\n').map((html) => ({ html }))
    }
    return raw.split('\n').map((text) => ({ text }))
  }, [content, language])

  const gutterWidth = String(lines.length).length * 8 + 24

  return (
    <div className="relative copyable">
      <CopyButton content={content} />
      <div className="overflow-x-auto" style={{ background: 'var(--bg-elevated)', borderRadius: 4 }}>
        <table style={{
          borderCollapse: 'collapse',
          fontSize: 12, lineHeight: 1.5,
          fontFamily: 'var(--font-mono)',
          width: '100%', tableLayout: 'fixed',
        }}>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td style={{
                  width: gutterWidth, minWidth: gutterWidth,
                  padding: i === 0
                    ? '12px 8px 0 12px'
                    : i === lines.length - 1
                      ? '0 8px 12px 12px'
                      : '0 8px 0 12px',
                  textAlign: 'right',
                  color: 'var(--text-dim)',
                  userSelect: 'none',
                  verticalAlign: 'top',
                  borderRight: '1px solid var(--border-subtle)',
                  position: 'sticky', left: 0,
                  background: 'var(--bg-elevated)',
                }}>
                  {i + 1}
                </td>
                {line.html != null ? (
                  <td
                    style={{
                      padding: i === 0
                        ? '12px 16px 0 12px'
                        : i === lines.length - 1
                          ? '0 16px 12px 12px'
                          : '0 16px 0 12px',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      color: 'var(--text-primary)',
                    }}
                    dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }}
                  />
                ) : (
                  <td style={{
                    padding: i === 0
                      ? '12px 16px 0 12px'
                      : i === lines.length - 1
                        ? '0 16px 12px 12px'
                        : '0 16px 0 12px',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    color: 'var(--text-primary)',
                  }}>
                    {line.text || ' '}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDate(ts) {
  if (!ts) return ''
  return formatDateTime(ts * 1000)
}

function getEntryIcon(entry) {
  return getFileIcon(entry, 14)
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

export default function FileManagerTab() {
  const { t } = useTranslation()
  const authUser = useAuthStore((s) => s.user)
  const isAdmin = authUser?.role === 'admin'
  const [pathInput, setPathInput] = useState(authUser?.workspace || '~')
  const [entries, setEntries] = useState([])
  const [resolvedPath, setResolvedPath] = useState('')
  const [parentPath, setParentPath] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  // Preview state
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState(null)
  const [selectedFileName, setSelectedFileName] = useState(null)

  // Selection tooltip + optimize popup state (Ask for Vivian)
  const [tooltip, setTooltip] = useState(null)
  const [optimizeData, setOptimizeData] = useState(null)
  const previewContentRef = useRef(null)
  const tooltipSetAtRef = useRef(0)

  // Upload state
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef(null)

  // Resizable file list width (default 50%)
  const [fileListWidth, setFileListWidth] = useState(() => (
    safeStorage.getNumber('file-explorer-list-width', 0, { min: 200, max: 800 })
  ))
  const handleListResize = useCallback((w) => {
    setFileListWidth(w)
    safeStorage.setItem('file-explorer-list-width', String(w))
  }, [])

  const fetchDir = useCallback(async (path) => {
    setLoading(true)
    setError(null)
    try {
      const data = await listDirectory(path)
      setEntries(data.entries)
      setResolvedPath(data.path)
      setParentPath(data.parent)
      setPathInput(data.path)
    } catch (e) {
      setError(e.message)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDir(authUser?.workspace || '~') }, [fetchDir, authUser?.workspace])

  const navigateTo = (path) => {
    if (!isAdmin && authUser?.workspace) {
      const target = path.replace(/\/+$/, '')
      const ws = authUser.workspace.replace(/\/+$/, '')
      if (!target.startsWith(ws + '/') && target !== ws) {
        setError('Access denied: path is outside your workspace')
        return
      }
    }
    setPreview(null)
    setPreviewImageUrl(null)
    setSelectedFileName(null)
    setSearchQuery('')
    setSortField(null)
    fetchDir(path)
  }

  const handleGo = () => {
    const val = pathInput.trim()
    if (!val) return
    if (!isAdmin) {
      if (val.includes('..')) {
        setError('Access denied: ".." is not allowed in path')
        return
      }
      if (authUser?.workspace) {
        const ws = authUser.workspace.replace(/\/+$/, '')
        if (!val.startsWith(ws + '/') && val !== ws) {
          setError('Access denied: path is outside your workspace')
          return
        }
      }
    }
    navigateTo(val)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleGo()
  }

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // Filter and sort entries
  const filteredEntries = useMemo(() => {
    let list = entries
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter((e) => e.name.toLowerCase().includes(q))
    }
    if (sortField) {
      list = [...list].sort((a, b) => {
        let cmp = 0
        if (sortField === 'name') {
          cmp = a.name.localeCompare(b.name)
        } else if (sortField === 'size') {
          cmp = (a.size ?? -1) - (b.size ?? -1)
        } else if (sortField === 'modified') {
          cmp = (a.modified ?? 0) - (b.modified ?? 0)
        }
        return sortDir === 'desc' ? -cmp : cmp
      })
    }
    return list
  }, [entries, searchQuery, sortField, sortDir])

  const handleFileClick = async (entry) => {
    const fullPath = resolvedPath === '/' ? `/${entry.name}` : `${resolvedPath}/${entry.name}`
    setSelectedFileName(entry.name)
    setPreviewLoading(true)
    setPreview(null)
    setPreviewImageUrl(null)
    try {
      const data = await previewFile(fullPath)
      setPreview(data)
      if (data.preview_url) {
        const blob = await downloadFile(fullPath)
        setPreviewImageUrl(URL.createObjectURL(blob))
      }
    } catch (e) {
      setPreview({ name: entry.name, path: fullPath, error: e.message })
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleDownload = async (entry) => {
    const fullPath = resolvedPath === '/' ? `/${entry.name}` : `${resolvedPath}/${entry.name}`
    try {
      const blob = await downloadFile(fullPath)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = entry.name
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadProgress(0)
    try {
      const uploadFn = isAdmin ? uploadAdminFile : uploadUserFile
      await uploadFn(resolvedPath, file, (p) => setUploadProgress(p))
      fetchDir(resolvedPath)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Text selection detection for "Ask for Vivian"
  useEffect(() => {
    const onMouseUp = (e) => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return

      const text = selection.toString()
      const range = selection.getRangeAt(0)
      const ancestor = range.commonAncestorContainer

      if (previewContentRef.current
        && !previewContentRef.current.contains(ancestor)
        && !(ancestor.contains?.(previewContentRef.current))) {
        return
      }

      let startLine = getLineFromNode(range.startContainer, range.startOffset)
      let endLine = getLineFromNode(range.endContainer, Math.max(0, range.endOffset - 1))

      // Fallback for multi-row selection
      if ((!startLine || !endLine) && previewContentRef.current) {
        const tbody = previewContentRef.current.querySelector('table')?.tBodies?.[0]
        if (tbody && tbody.rows.length > 0) {
          if (!startLine) {
            for (let i = 0; i < tbody.rows.length; i++) {
              if (range.intersectsNode(tbody.rows[i])) { startLine = i + 1; break }
            }
          }
          if (!endLine) {
            for (let i = tbody.rows.length - 1; i >= 0; i--) {
              if (range.intersectsNode(tbody.rows[i])) { endLine = i + 1; break }
            }
          }
        }
      }

      if (!startLine || !endLine) return

      tooltipSetAtRef.current = Date.now()
      setTooltip({
        x: e.clientX + 8,
        y: e.clientY + 8,
        startLine: Math.min(startLine, endLine),
        endLine: Math.max(startLine, endLine),
        selectedText: text,
      })
    }

    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [])

  // Hide tooltip when selection cleared
  useEffect(() => {
    const onSelectionChange = () => {
      if (Date.now() - tooltipSetAtRef.current < 150) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setTooltip(null)
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  // Handle "Ask for Vivian" tooltip click
  const handleAskVivianClick = useCallback(() => {
    if (!tooltip || !preview) return
    const allLines = (preview.content || '').replace(/\n$/, '').split('\n')
    const selStart = tooltip.startLine
    const selEnd = tooltip.endLine
    const ctxStart = Math.max(1, selStart - 2)
    const ctxEnd = Math.min(allLines.length, selEnd + 2)
    const previewLines = []
    for (let i = ctxStart; i <= ctxEnd; i++) {
      previewLines.push({
        lineNum: i,
        text: allLines[i - 1] || '',
        isSelected: i >= selStart && i <= selEnd,
      })
    }
    const language = detectLanguage(preview.name) || ''
    setOptimizeData({
      source: 'file',
      filePath: preview.path || '',
      startLine: selStart,
      endLine: selEnd,
      selectedText: tooltip.selectedText,
      language,
      previewLines,
      anchorX: tooltip.x,
      anchorY: tooltip.y,
    })
    setTooltip(null)
    window.getSelection()?.removeAllRanges()
  }, [tooltip, preview])

  // Handle Sparkles icon click in preview header (full file)
  const handleAskVivianFull = useCallback(() => {
    if (!preview?.content) return
    const allLines = preview.content.replace(/\n$/, '').split('\n')
    const totalLines = allLines.length
    const ctxEnd = Math.min(totalLines, 4)
    const previewLines = []
    for (let i = 1; i <= ctxEnd; i++) {
      previewLines.push({ lineNum: i, text: allLines[i - 1] || '', isSelected: true })
    }
    if (totalLines > 4) {
      previewLines.push({ lineNum: -1, text: `... (${totalLines - 4} more lines)`, isSelected: false })
    }
    const language = detectLanguage(preview.name) || ''
    setOptimizeData({
      source: 'file',
      filePath: preview.path || '',
      startLine: 1,
      endLine: totalLines,
      selectedText: preview.content.replace(/\n$/, ''),
      language,
      previewLines,
      anchorX: Math.min(window.innerWidth / 2, window.innerWidth - 460),
      anchorY: 120,
    })
  }, [preview])

  // Breadcrumb segments
  const segments = resolvedPath ? resolvedPath.split('/').filter(Boolean) : []
  const hasPreview = true

  // Stats
  const fileCount = entries.filter((e) => e.type === 'file').length
  const dirCount = entries.filter((e) => e.type === 'directory').length


  return (
    <div className="flex flex-col" style={{ minHeight: 0, height: '100%' }}>
      {/* Top bar: Breadcrumb + Path input */}
      <div
        className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 overflow-hidden" style={{ fontSize: 12, minWidth: 0 }}>
          <button
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--blue)', padding: '0 2px', fontSize: 12, flexShrink: 0,
            }}
            onClick={() => navigateTo('/')}
          >
            /
          </button>
          {segments.map((seg, i) => {
            const segPath = '/' + segments.slice(0, i + 1).join('/')
            const isLast = i === segments.length - 1
            return (
              <span key={segPath} className="flex items-center gap-1" style={{ minWidth: 0 }}>
                <ChevronRight size={10} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                {isLast ? (
                  <span className="truncate" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{seg}</span>
                ) : (
                  <button
                    className="truncate"
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--blue)', padding: 0, fontSize: 12,
                    }}
                    onClick={() => navigateTo(segPath)}
                  >
                    {seg}
                  </button>
                )}
              </span>
            )
          })}
        </div>

        {/* Upload */}
        <input type="file" ref={fileInputRef} onChange={handleUpload} style={{ display: 'none' }} />
        <button
          className="flex items-center gap-1 px-2 py-1 flex-shrink-0"
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, cursor: uploading ? 'wait' : 'pointer',
            color: 'var(--text-secondary)', fontSize: 12,
            transition: 'border-color 150ms ease',
          }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--blue)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <Upload size={12} strokeWidth={1.5} />
          <span>{t('settings.fileManagerUpload')}</span>
        </button>

        <div className="flex-1" />

        {/* Path input + Go */}
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, color: 'var(--text-primary)', padding: '4px 8px',
            fontSize: 12, fontFamily: 'var(--font-mono)',
            outline: 'none', flexShrink: 1, minWidth: 220, width: 280,
          }}
          placeholder={t('settings.fileManagerPath')}
        />
        <button
          className="px-2 py-1 flex-shrink-0"
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, cursor: 'pointer', color: 'var(--text-secondary)',
            fontSize: 12, transition: 'border-color 150ms ease',
          }}
          onClick={handleGo}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--blue)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          {t('settings.fileManagerGo')}
        </button>
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="flex-shrink-0" style={{ height: 2, background: 'var(--bg-elevated)' }}>
          <div style={{
            height: '100%', width: `${uploadProgress * 100}%`,
            background: 'var(--blue)', transition: 'width 150ms ease',
          }} />
        </div>
      )}

      {/* Search + stats bar */}
      <div
        className="flex items-center gap-4 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-dim)' }}>
          {dirCount} dirs, {fileCount} files
        </span>
        <div
          className="flex items-center gap-2 px-3 py-1"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
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
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 flex-shrink-0" style={{ color: 'var(--red)', fontSize: 12, borderBottom: '1px solid var(--border-subtle)' }}>
          {error}
        </div>
      )}

      {/* Main content: file list + preview side by side */}
      <div className="flex flex-1" style={{ minHeight: 0, overflow: 'hidden' }}>
        {/* File list pane */}
        <div
          className="flex flex-col"
          style={{
            minHeight: 0,
            width: fileListWidth || '50%',
            minWidth: 200,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
          }}
        >
          {/* Table header */}
          <div
            className="flex items-center gap-3 px-4 py-2 text-xs uppercase flex-shrink-0"
            style={{
              borderBottom: '1px solid var(--border)',
              color: 'var(--text-dim)',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            <span style={{ width: 16, flexShrink: 0 }} />
            <SortableHeader label={t('userData.fileName')} field="name" sortField={sortField} sortDir={sortDir} onSort={handleSort} flex />
            <SortableHeader label={t('userData.fileSize')} field="size" sortField={sortField} sortDir={sortDir} onSort={handleSort} width={80} textAlign="right" />
            <SortableHeader label="Modified" field="modified" sortField={sortField} sortDir={sortDir} onSort={handleSort} width={140} textAlign="right" />
          </div>

          {/* File rows */}
          <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
            {loading ? (
              <div className="flex flex-col gap-1 p-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 28, borderRadius: 2 }} />
                ))}
              </div>
            ) : (
              <>
                {/* Parent directory */}
                {parentPath && (
                  <div
                    className="flex items-center gap-3 px-4 py-2"
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      transition: 'background 150ms ease',
                    }}
                    onClick={() => navigateTo(parentPath)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <Folder size={14} strokeWidth={1.5} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
                    <span className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>..</span>
                    <span style={{ width: 80, flexShrink: 0 }} />
                    <span style={{ width: 140, flexShrink: 0 }} />
                  </div>
                )}

                {filteredEntries.length === 0 && !parentPath && (
                  <div className="text-sm" style={{ color: 'var(--text-dim)', padding: '40px 20px', textAlign: 'center' }}>
                    {t('settings.fileManagerEmpty')}
                  </div>
                )}

                {filteredEntries.map((entry) => {
                  const isSelected = entry.type === 'file' && entry.name === selectedFileName
                  return (
                    <div
                      key={entry.name}
                      className="flex items-center gap-3 px-4 py-2"
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'background 150ms ease',
                        background: isSelected ? 'var(--bg-elevated)' : 'transparent',
                        borderLeft: isSelected ? '2px solid var(--blue)' : '2px solid transparent',
                      }}
                      onClick={() => {
                        if (entry.type === 'directory') {
                          navigateTo(resolvedPath === '/' ? `/${entry.name}` : `${resolvedPath}/${entry.name}`)
                        } else {
                          handleFileClick(entry)
                        }
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-surface)' }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = isSelected ? 'var(--bg-elevated)' : 'transparent' }}
                    >
                      {/* Icon */}
                      <span style={{ flexShrink: 0 }}>{getEntryIcon(entry)}</span>

                      {/* Name */}
                      <span className="flex-1 truncate text-sm" style={{ color: 'var(--text-primary)', minWidth: 0 }}>
                        {entry.name}
                      </span>

                      {/* Size */}
                      <span className="text-xs" style={{ width: 80, flexShrink: 0, textAlign: 'right', color: 'var(--text-dim)' }}>
                        {entry.type === 'file' ? formatSize(entry.size) : ''}
                      </span>

                      {/* Modified */}
                      <span className="text-xs" style={{ width: 140, flexShrink: 0, textAlign: 'right', color: 'var(--text-dim)' }}>
                        {formatDate(entry.modified)}
                      </span>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        {/* Resize handle + Preview pane */}
        {hasPreview && (
          <>
            <ResizeHandle width={fileListWidth} onResize={handleListResize} />
            <div className="flex flex-col flex-1" style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
              {/* Preview header */}
              <div
                className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <span className="flex-1 truncate" style={{ color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {preview?.path || selectedFileName || ''}
                </span>
                {preview?.content != null && (
                  <button
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', padding: 4, transition: 'color 150ms ease',
                    }}
                    onClick={handleAskVivianFull}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--purple)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                    title={t('optimize.askForVivian')}
                  >
                    <Sparkles size={14} strokeWidth={1.5} />
                  </button>
                )}
                {preview?.path && <CopyPathBtn path={preview.path} />}
                {preview?.size != null && (
                  <span className="flex-shrink-0" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                    {formatSize(preview.size)}
                  </span>
                )}
                {preview && !preview.error && (
                  <button
                    className="flex-shrink-0"
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', padding: 4, transition: 'color 150ms ease',
                    }}
                    onClick={() => handleDownload({ name: preview.name })}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                    title={t('settings.fileManagerDownload')}
                  >
                    <Download size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>

              {/* Preview content */}
              <div ref={previewContentRef} className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
                {previewLoading ? (
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="skeleton" style={{ height: 16, borderRadius: 2 }} />
                    ))}
                  </div>
                ) : preview?.error ? (
                  <div style={{ color: 'var(--red)', fontSize: 13 }}>{preview.error}</div>
                ) : preview?.content != null ? (
                  <HighlightedPreview content={preview.content} filename={preview.name} />
                ) : preview?.mime_type === 'application/pdf' && previewImageUrl ? (
                  <object
                    data={previewImageUrl}
                    type="application/pdf"
                    style={{ width: '100%', height: '100%', minHeight: 500, border: 'none' }}
                  >
                    <div className="flex flex-col items-center gap-3 py-8" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                      <FileText size={32} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
                      <span>{t('settings.fileManagerPdfNotSupported', 'PDF preview not supported in this browser.')}</span>
                    </div>
                  </object>
                ) : previewImageUrl ? (
                  <img
                    src={previewImageUrl}
                    alt={preview?.name}
                    style={{ maxWidth: '100%', borderRadius: 4 }}
                  />
                ) : preview?.is_binary ? (
                  <div className="flex flex-col items-center gap-3 py-8" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    <FileText size={32} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
                    <span>{t('settings.fileManagerBinaryFile')}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{formatSize(preview.size)}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                    <FileText size={28} strokeWidth={1.5} style={{ color: 'var(--text-dim)', marginBottom: 8 }} />
                    <span>{t('settings.fileManagerSelectFile', 'Select a file to preview')}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* "Ask for Vivian" tooltip — portaled to body */}
      {tooltip && preview?.content != null && createPortal(
        <button
          className="flex items-center gap-1"
          onClick={handleAskVivianClick}
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 9999,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            transition: 'color 150ms ease, border-color 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)'
            e.currentTarget.style.borderColor = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <Sparkles size={14} strokeWidth={1.5} />
          {t('optimize.askForVivian')}
        </button>,
        document.body
      )}

      {/* Optimize popup — portaled to body */}
      {optimizeData && createPortal(
        <OptimizePopup
          data={optimizeData}
          onClose={() => setOptimizeData(null)}
        />,
        document.body
      )}
    </div>
  )
}

function CopyPathBtn({ path }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="flex-shrink-0"
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        padding: 4, transition: 'color 150ms ease',
      }}
      onClick={() => {
        copyTextToClipboard(path)
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
      title={path}
    >
      {copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />}
    </button>
  )
}

function ResizeHandle({ width, onResize }) {
  const { dragging, onMouseDown } = useResizable({
    initial: width,
    min: 200,
    max: 800,
    direction: 'right',
    onResize,
  })

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: 4,
        flexShrink: 0,
        cursor: 'col-resize',
        background: dragging ? 'var(--blue)' : 'transparent',
        transition: 'background 100ms ease',
      }}
      onMouseEnter={(e) => {
        if (!dragging) e.currentTarget.style.background = 'var(--blue)'
      }}
      onMouseLeave={(e) => {
        if (!dragging) e.currentTarget.style.background = 'transparent'
      }}
    />
  )
}
