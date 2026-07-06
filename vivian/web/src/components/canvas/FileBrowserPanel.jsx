import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, FileText, FolderTree, Copy, Check, ChevronDown, ChevronLeft, CornerDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import hljs from 'highlight.js/lib/core'
import 'highlight.js/styles/github-dark.css'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import yaml from 'highlight.js/lib/languages/yaml'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import markdown from 'highlight.js/lib/languages/markdown'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import useFileBrowserStore from '../../stores/fileBrowserStore'
import useChatStore from '../../stores/chatStore'
import useSidebarStore from '../../stores/sidebarStore'
import useAuthStore from '../../stores/authStore'
import { copyTextToClipboard } from '../../utils/clipboard'
import { downloadFile, listDirectory } from '../../api/userFiles'
import RichFilePreview from '../shared/RichFilePreview'
import Tabs, { SlidingTabGroup, SlidingTabIndicator } from '../shared/Tabs'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import MermaidDiagram from '../markdown/MermaidDiagram'
import ExcalidrawDiagram from '../markdown/ExcalidrawDiagram'
import SelectedFilePopup from '../shared/SelectedFilePopup'
import getLineFromNode from '../../utils/getLineFromNode'
import { getFileIcon } from '../../utils/fileIcons'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('python', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('plaintext', () => ({ contains: [] }))

const EXT_TO_LANG = {
  '.py': 'python', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
  '.go': 'go', '.rs': 'rust', '.java': 'java', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.sql': 'sql', '.css': 'css', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.html': 'html', '.htm': 'html', '.md': 'markdown', '.markdown': 'markdown',
  '.ini': 'ini', '.conf': 'ini', '.env': 'ini', '.toml': 'ini',
  '.dockerfile': 'dockerfile',
  '.excalidraw': 'json',
}

function detectLanguage(filePath) {
  if (!filePath) return 'plaintext'
  const lower = filePath.toLowerCase()
  if (lower.endsWith('/dockerfile') || lower === 'dockerfile') return 'dockerfile'
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return EXT_TO_LANG[lower.slice(dot)] || 'plaintext'
}

const PLAIN_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv', '.log', '.conf', '.ini',
  '.env', '.dockerfile', '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.cpp',
  '.h', '.hpp', '.swift', '.kt', '.scala', '.r', '.lua', '.sh', '.sql',
  '.excalidraw',
])

function fileName(filePath) {
  if (!filePath) return '(untitled)'
  const parts = filePath.split('/').filter(Boolean)
  return parts[parts.length - 1] || filePath
}

function normalizePath(filePath) {
  if (!filePath) return ''
  if (filePath === '/') return '/'
  return filePath.replace(/\/+$/, '')
}

function dirname(filePath) {
  const normalized = normalizePath(filePath)
  if (!normalized || normalized === '/') return normalized
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index)
}

function joinPath(base, name) {
  if (!base || base === '/') return `/${name}`
  return `${normalizePath(base)}/${name}`
}

function isWithinPath(filePath, rootPath) {
  const file = normalizePath(filePath)
  const root = normalizePath(rootPath)
  if (!file || !root || root === '~') return false
  return file === root || file.startsWith(`${root}/`)
}

function getAncestorDirs(rootPath, targetDir) {
  const root = normalizePath(rootPath)
  const target = normalizePath(targetDir)
  if (!root || !target || !isWithinPath(target, root)) return root ? [root] : []
  const dirs = [root]
  let current = root
  const remainder = target.slice(root.length).replace(/^\/+/, '')
  if (!remainder) return dirs
  for (const part of remainder.split('/')) {
    current = joinPath(current, part)
    dirs.push(current)
  }
  return dirs
}

function extensionFor(tab) {
  if (tab.extension) {
    return tab.extension.startsWith('.') ? tab.extension.toLowerCase() : `.${tab.extension.toLowerCase()}`
  }
  const name = tab.name || fileName(tab.filePath)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function formatLineLocator(startLine, endLine) {
  if (!startLine || !endLine) return ''
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`
}

function elementFromNode(node) {
  if (!node) return null
  return node.nodeType === 1 ? node : node.parentElement
}

function safelyIntersects(range, node) {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

function getPptxSlideNumber(slide, root) {
  if (!slide) return null
  for (const className of Array.from(slide.classList || [])) {
    const match = className.match(/^pptx-preview-slide-wrapper-(\d+)$/)
    if (match) return Number(match[1]) + 1
  }
  const slides = Array.from(root?.querySelectorAll?.('.pptx-preview-slide-wrapper') || [])
  const index = slides.indexOf(slide)
  return index >= 0 ? index + 1 : null
}

function getPptxBoxBounds(box, slide) {
  if (!box || !slide) return ''
  const boxRect = box.getBoundingClientRect()
  const slideRect = slide.getBoundingClientRect()
  const values = [
    boxRect.left - slideRect.left,
    boxRect.top - slideRect.top,
    boxRect.width,
    boxRect.height,
  ].map((value) => Math.round(value))
  return `x=${values[0]}, y=${values[1]}, width=${values[2]}, height=${values[3]}`
}

function getPptxSelectionMeta(range, root) {
  if (!range || !root) return null
  const startEl = elementFromNode(range.startContainer)
  let slide = startEl?.closest?.('.pptx-preview-slide-wrapper') || null
  if (!slide || !root.contains(slide)) {
    slide = Array.from(root.querySelectorAll('.pptx-preview-slide-wrapper')).find((candidate) => safelyIntersects(range, candidate)) || null
  }
  if (!slide) return null

  const slideNumber = getPptxSlideNumber(slide, root)
  const allBoxes = Array.from(slide.querySelectorAll('.text-wrapper'))
    .filter((box) => box.textContent?.trim())
  const selectedBoxes = allBoxes.filter((box) => safelyIntersects(range, box))
  const boxIndexes = selectedBoxes
    .map((box) => allBoxes.indexOf(box) + 1)
    .filter((index) => index > 0)

  const boxIndex = boxIndexes.length === 1
    ? String(boxIndexes[0])
    : boxIndexes.length > 1
      ? boxIndexes.join(',')
      : ''
  const boxLabel = boxIndexes.length === 1
    ? `Box ${boxIndexes[0]}`
    : boxIndexes.length > 1
      ? `Boxes ${boxIndexes.join(',')}`
      : ''
  const slideLabel = slideNumber ? `Slide ${slideNumber}` : 'Slide'

  return {
    slideNumber,
    boxIndex,
    boxLabel,
    boxBounds: getPptxBoxBounds(selectedBoxes[0], slide),
    locator: [slideLabel, boxLabel].filter(Boolean).join(' · '),
  }
}

function isPlainText(tab) {
  const mime = (tab.mimeType || '').toLowerCase()
  if (mime.startsWith('text/')) return true
  if (mime === 'application/json' || mime.includes('xml') || mime.includes('yaml')) return true
  return PLAIN_TEXT_EXTENSIONS.has(extensionFor(tab))
}

function ModeButton({ active, children, onClick, position }) {
  const radius = position === 'left' ? '4px 0 0 4px' : position === 'right' ? '0 4px 4px 0' : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 text-xs"
      style={{
        background: active ? 'var(--bg-elevated)' : 'transparent',
        border: 'none',
        borderRadius: radius,
        color: active ? 'var(--text-primary)' : 'var(--text-dim)',
        cursor: 'pointer',
        transition: 'color 150ms ease, background 150ms ease',
      }}
    >
      {children}
    </button>
  )
}

function CopyPathButton({ path }) {
  const [copied, setCopied] = useState(false)
  if (!path) return null
  return (
    <button
      type="button"
      onClick={async () => {
        const didCopy = await copyTextToClipboard(path)
        if (!didCopy) return
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
      title="Copy full path"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        border: 'none',
        background: 'transparent',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        cursor: 'pointer',
        padding: 0,
        transition: 'color 150ms ease',
        flexShrink: 0,
      }}
    >
      {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
    </button>
  )
}

function RawTextView({ tab, onTextLoaded }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent('')

    downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' })
      .then((blob) => blob.text())
      .then((text) => {
        if (!cancelled) {
          setContent(text)
          onTextLoaded?.(text)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tab.filePath, tab.refreshKey, onTextLoaded])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton" style={{ width: '100%', height: 16 }} />
        <div className="skeleton" style={{ width: '80%', height: 16 }} />
        <div className="skeleton" style={{ width: '60%', height: 16 }} />
      </div>
    )
  }

  if (error) {
    return <div className="p-4 text-xs" style={{ color: 'var(--red)' }}>{error}</div>
  }

  return <HighlightedCode content={content} language={detectLanguage(tab.filePath)} />
}

function HighlightedCode({ content, language }) {
  const highlighted = useMemo(() => {
    if (!content) return null
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(content, { language }).value
      }
      return hljs.highlightAuto(content).value
    } catch {
      return null
    }
  }, [content, language])

  const lines = useMemo(() => {
    if (!content) return []
    const raw = content.replace(/\n$/, '')
    if (!highlighted) {
      return raw.split('\n').map((line) => ({ text: line, html: null }))
    }
    return highlighted.replace(/\n$/, '').split('\n').map((html) => ({ text: null, html }))
  }, [content, highlighted])

  const gutterWidth = String(lines.length).length * 8 + 16

  return (
    <div className="overflow-auto" style={{ height: '100%', background: 'var(--bg-elevated)' }}>
      <table style={{
        borderCollapse: 'collapse',
        fontSize: 12,
        lineHeight: 1.6,
        fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        width: '100%',
        tableLayout: 'fixed',
      }}>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td style={{
                width: gutterWidth,
                minWidth: gutterWidth,
                padding: i === 0
                  ? '12px 8px 0 12px'
                  : i === lines.length - 1
                    ? '0 8px 12px 12px'
                    : '0 8px 0 12px',
                textAlign: 'right',
                color: 'var(--text-dim)',
                userSelect: 'none',
                verticalAlign: 'top',
                borderRight: '1px solid var(--border)',
                position: 'sticky',
                left: 0,
                background: 'var(--bg-elevated)',
                zIndex: 1,
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
  )
}

function NonPlainRawNotice({ onPreview }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center flex-1 p-4">
      <div
        className="px-3 py-3"
        style={{
          borderLeft: '2px solid var(--yellow)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          maxWidth: 360,
        }}
      >
        <div className="font-semibold uppercase" style={{ color: 'var(--yellow)', letterSpacing: '0.06em', marginBottom: 6 }}>
          {t('fileBrowser.binaryRawTitle', 'Non-plain-text file')}
        </div>
        <div style={{ marginBottom: 10 }}>
          {t('fileBrowser.binaryRawHint', 'Raw view is not available for this file. Switch to Preview to inspect it.')}
        </div>
        <button
          type="button"
          onClick={onPreview}
          className="text-xs font-semibold uppercase"
          style={{
            border: '1px solid var(--border)',
            borderLeft: '2px solid var(--blue)',
            background: 'transparent',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            letterSpacing: '0.06em',
            padding: '5px 8px',
          }}
        >
          {t('fileBrowser.switchToPreview', 'Switch to Preview')}
        </button>
      </div>
    </div>
  )
}

function MarkdownPreviewView({ tab, onTextLoaded }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent('')
    downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' })
      .then((blob) => blob.text())
      .then((text) => {
        if (!cancelled) {
          setContent(text)
          onTextLoaded?.(text)
        }
      })
      .catch((err) => { if (!cancelled) setError(err?.message || String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tab.filePath, tab.refreshKey, onTextLoaded])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton" style={{ width: '100%', height: 16 }} />
        <div className="skeleton" style={{ width: '80%', height: 16 }} />
        <div className="skeleton" style={{ width: '60%', height: 16 }} />
      </div>
    )
  }
  if (error) return <div className="p-4 text-xs" style={{ color: 'var(--red)' }}>{error}</div>

  return (
    <div className="overflow-auto" style={{ height: '100%', padding: '12px 16px' }}>
      <MarkdownRenderer content={content} />
    </div>
  )
}

function MermaidPreviewView({ tab, onTextLoaded }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent('')
    downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' })
      .then((blob) => blob.text())
      .then((text) => {
        if (!cancelled) {
          setContent(text)
          onTextLoaded?.(text)
        }
      })
      .catch((err) => { if (!cancelled) setError(err?.message || String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tab.filePath, tab.refreshKey, onTextLoaded])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton" style={{ width: '100%', height: 16 }} />
        <div className="skeleton" style={{ width: '80%', height: 200 }} />
      </div>
    )
  }
  if (error) return <div className="p-4 text-xs" style={{ color: 'var(--red)' }}>{error}</div>

  return (
    <div
      className="overflow-hidden"
      style={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        padding: '12px 16px',
        boxSizing: 'border-box',
      }}
    >
      <MermaidDiagram code={content} fill />
    </div>
  )
}

function ExcalidrawPreviewView({ tab, onTextLoaded }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent('')
    downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' })
      .then((blob) => blob.text())
      .then((text) => {
        if (!cancelled) {
          setContent(text)
          onTextLoaded?.(text)
        }
      })
      .catch((err) => { if (!cancelled) setError(err?.message || String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tab.filePath, tab.refreshKey, onTextLoaded])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton" style={{ width: '100%', height: 16 }} />
        <div className="skeleton" style={{ width: '80%', height: 200 }} />
      </div>
    )
  }
  if (error) return <div className="p-4 text-xs" style={{ color: 'var(--red)' }}>{error}</div>

  return (
    <div
      className="overflow-hidden"
      style={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        minHeight: 0,
        padding: '12px 16px',
        boxSizing: 'border-box',
      }}
    >
      <ExcalidrawDiagram code={content} fill />
    </div>
  )
}

function CodePreviewView({ tab, onTextLoaded }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent('')
    downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' })
      .then((blob) => blob.text())
      .then((text) => {
        if (!cancelled) {
          setContent(text)
          onTextLoaded?.(text)
        }
      })
      .catch((err) => { if (!cancelled) setError(err?.message || String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tab.filePath, tab.refreshKey, onTextLoaded])

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <div className="skeleton" style={{ width: '100%', height: 16 }} />
        <div className="skeleton" style={{ width: '80%', height: 16 }} />
      </div>
    )
  }
  if (error) return <div className="p-4 text-xs" style={{ color: 'var(--red)' }}>{error}</div>

  return <HighlightedCode content={content} language={detectLanguage(tab.filePath)} />
}

const RICH_PREVIEW_EXTS = new Set([
  '.html', '.htm', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.xlsx', '.xls', '.csv', '.tsv', '.pptx', '.docx',
])

function PreviewView({ tab, onTextLoaded }) {
  const ext = extensionFor(tab).toLowerCase()

  if (ext === '.md' || ext === '.markdown') {
    return <MarkdownPreviewView tab={tab} onTextLoaded={onTextLoaded} />
  }

  if (ext === '.mmd' || ext === '.mermaid') {
    return <MermaidPreviewView tab={tab} onTextLoaded={onTextLoaded} />
  }

  if (ext === '.excalidraw') {
    return <ExcalidrawPreviewView tab={tab} onTextLoaded={onTextLoaded} />
  }

  if (RICH_PREVIEW_EXTS.has(ext)) {
    return <RichFilePreviewView tab={tab} />
  }

  if (isPlainText(tab)) {
    return <CodePreviewView tab={tab} onTextLoaded={onTextLoaded} />
  }

  return <RichFilePreviewView tab={tab} />
}

function RichFilePreviewView({ tab }) {
  const previewFile = useMemo(() => {
    const name = tab.name || fileName(tab.filePath)
    return {
      name,
      path: tab.filePath,
      ext: extensionFor(tab),
      mime_type: tab.mimeType || null,
    }
  }, [tab])

  const loadBlob = useCallback(
    async () => downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' }),
    [tab.filePath, tab.refreshKey]
  )
  const loadText = useCallback(async () => {
    const blob = await downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' })
    return blob.text()
  }, [tab.filePath, tab.refreshKey])
  const loadArrayBuffer = useCallback(async () => {
    const blob = await downloadFile(tab.filePath, { cacheBustKey: tab.refreshKey, cacheMode: 'no-store' })
    return blob.arrayBuffer()
  }, [tab.filePath, tab.refreshKey])

  return (
    <RichFilePreview
      file={previewFile}
      cacheKey={`${tab.filePath}:${tab.refreshKey}:${tab.mimeType || ''}`}
      loadText={loadText}
      loadArrayBuffer={loadArrayBuffer}
      loadBlob={loadBlob}
    />
  )
}

function FileTreeSidebar({
  activeTab,
  rootPath,
  treeOpen,
  treeWidth,
  setTreeOpen,
  openFileTab,
}) {
  const { t } = useTranslation()
  const [expandedDirs, setExpandedDirs] = useState({})
  const [dirCache, setDirCache] = useState({})
  const activeFilePath = activeTab?.filePath || ''

  const loadDir = useCallback(async (path) => {
    if (!path) return
    setDirCache((cache) => {
      const current = cache[path]
      if (current?.loading || current?.entries) return cache
      return { ...cache, [path]: { loading: true, entries: null, error: null } }
    })
    try {
      const data = await listDirectory(path)
      setDirCache((cache) => ({
        ...cache,
        [path]: {
          loading: false,
          entries: data.entries || [],
          resolvedPath: data.path || path,
          error: null,
        },
      }))
    } catch (error) {
      setDirCache((cache) => ({
        ...cache,
        [path]: {
          loading: false,
          entries: [],
          error: error?.message || String(error),
        },
      }))
    }
  }, [])

  useEffect(() => {
    if (!rootPath) return
    const dirs = getAncestorDirs(rootPath, dirname(activeFilePath))
    setExpandedDirs((current) => {
      const next = { ...current }
      dirs.forEach((dir) => { next[dir] = true })
      return next
    })
    dirs.forEach((dir) => loadDir(dir))
  }, [activeFilePath, loadDir, rootPath])

  const toggleDir = (path) => {
    setExpandedDirs((current) => ({ ...current, [path]: !current[path] }))
    loadDir(path)
  }

  const renderDirectory = (path, label, depth = 0) => {
    const expanded = Boolean(expandedDirs[path])
    const state = dirCache[path]
    const entries = state?.entries || []
    const loading = state?.loading
    const error = state?.error
    const bodyId = `file-browser-dir-${encodeURIComponent(path)}`

    return (
      <div key={path}>
        <button
          type="button"
          onClick={() => toggleDir(path)}
          className="flex items-center gap-1 w-full min-w-0"
          title={path}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: `5px 8px 5px ${8 + depth * 12}px`,
            textAlign: 'left',
          }}
          onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
          aria-expanded={expanded}
          aria-controls={bodyId}
        >
          <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={13} strokeWidth={1.5} />
          </AnimatedChevron>
          {getFileIcon({ name: label, type: 'directory' }, 13)}
          <span className="truncate text-sm" style={{ minWidth: 0, fontWeight: depth === 0 ? 600 : 400 }}>
            {label}
          </span>
        </button>

        <AnimatedCollapse open={expanded} id={bodyId} animateHeight={false}>
          {() => (
          <div>
            {loading && (
              <div className="text-xs" style={{ color: 'var(--text-dim)', padding: `4px 8px 4px ${32 + depth * 12}px` }}>
                ...
              </div>
            )}
            {!loading && error && (
              <div className="text-xs" title={error} style={{ color: 'var(--red)', padding: `4px 8px 4px ${32 + depth * 12}px` }}>
                {error}
              </div>
            )}
            {!loading && !error && entries.map((entry) => {
              const childPath = joinPath(path, entry.name)
              if (entry.type === 'directory') {
                return renderDirectory(childPath, entry.name, depth + 1)
              }

              const active = normalizePath(childPath) === normalizePath(activeFilePath)
              return (
                <button
                  key={childPath}
                  type="button"
                  onClick={() => openFileTab({
                    filePath: childPath,
                    name: entry.name,
                    size: entry.size,
                    source: 'FileTree',
                  })}
                  className="flex items-center gap-2 w-full min-w-0"
                  title={childPath}
                  style={{
                    border: 'none',
                    borderLeft: active ? '2px solid var(--blue)' : '2px solid transparent',
                    background: active ? 'var(--bg-elevated)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: `5px 8px 5px ${22 + (depth + 1) * 12}px`,
                    textAlign: 'left',
                  }}
                  onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = 'var(--bg-elevated)' }}
                  onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = 'transparent' }}
                >
                  {getFileIcon(entry, 13)}
                  <span className="truncate text-sm" style={{ minWidth: 0, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                    {entry.name}
                  </span>
                </button>
              )
            })}
          </div>
          )}
        </AnimatedCollapse>
      </div>
    )
  }

  if (!treeOpen) {
    return (
      <button
        type="button"
        onClick={() => setTreeOpen(true)}
        title={t('fileBrowser.fileTree', 'File tree')}
        className="flex items-start justify-center flex-shrink-0"
        style={{
          width: 30,
          border: 'none',
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          paddingTop: 10,
        }}
      >
        <FolderTree size={16} strokeWidth={1.5} />
      </button>
    )
  }

  return (
    <aside
      className="flex flex-col flex-shrink-0"
      style={{
        width: treeWidth,
        minWidth: 112,
        maxWidth: 560,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        position: 'relative',
      }}
    >
      <div
        className="flex items-center"
        style={{
          height: 32,
          padding: '0 10px 0 8px',
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-dim)',
          gap: 6,
        }}
      >
        <span
          className="text-xs font-semibold uppercase"
          style={{ letterSpacing: '0.06em' }}
        >
          {t('fileBrowser.tree', 'Files')}
        </span>
        <button
          type="button"
          onClick={() => setTreeOpen(false)}
          title={t('fileBrowser.collapseTree', 'Collapse file tree')}
          className="flex items-center flex-shrink-0"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            padding: 0,
            marginLeft: 'auto',
            height: 32,
            justifyContent: 'flex-end',
          }}
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: '4px 0' }}>
        {rootPath
          ? renderDirectory(rootPath, fileName(rootPath) || rootPath, 0)
          : (
            <div className="text-xs" style={{ color: 'var(--text-dim)', padding: '8px' }}>
              {t('fileBrowser.empty', 'Open a file from the chat to preview it here')}
            </div>
          )}
      </div>

    </aside>
  )
}

export default function FileBrowserPanel() {
  const { t } = useTranslation()
  const treeRef = useRef(null)
  const [treeOpen, setTreeOpen] = useState(true)
  const [treeWidth, setTreeWidth] = useState(156)
  const [draggingTree, setDraggingTree] = useState(false)
  const previewContentRef = useRef(null)
  const fileTextRef = useRef('')
  const tooltipSetAtRef = useRef(0)
  const [tooltip, setTooltip] = useState(null)
  const [selectedFileData, setSelectedFileData] = useState(null)

  const handleTextLoaded = useCallback((text) => {
    fileTextRef.current = text || ''
  }, [])

  const onTreeResizeMouseDown = useCallback((e) => {
    e.preventDefault()
    setDraggingTree(true)

    const onMouseMove = (ev) => {
      const left = treeRef.current?.getBoundingClientRect().left || 0
      // Tree never takes more than 60% of the panel — the preview must stay usable.
      const containerWidth = treeRef.current?.parentElement?.getBoundingClientRect().width || 560
      const maxWidth = Math.min(560, containerWidth * 0.6)
      const nextWidth = Math.min(maxWidth, Math.max(112, ev.clientX - left))
      setTreeWidth(nextWidth)
    }
    const onMouseUp = () => {
      setDraggingTree(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])
  const sessionId = useChatStore((s) => s.sessionId)
  const sidebarSessions = useSidebarStore((s) => s.sessions)
  const authUser = useAuthStore((s) => s.user)
  const tabs = useFileBrowserStore((s) => s.tabs)
  const activeTabId = useFileBrowserStore((s) => s.activeTabId)
  const setActiveTab = useFileBrowserStore((s) => s.setActiveTab)
  const closeFile = useFileBrowserStore((s) => s.closeFile)
  const closeAllFiles = useFileBrowserStore((s) => s.closeAllFiles)
  const setMode = useFileBrowserStore((s) => s.setMode)
  const refreshFile = useFileBrowserStore((s) => s.refreshFile)
  const openFileTab = useFileBrowserStore((s) => s.openFile)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null
  const activeSession = sidebarSessions.find((session) => session.sessionId === sessionId || session.id === sessionId)
  const activeCwd = activeSession?.cwd || authUser?.workspace || ''
  const treeRootPath = useMemo(() => {
    const fileDir = dirname(activeTab?.filePath || '')
    if (activeCwd && (!activeTab?.filePath || isWithinPath(activeTab.filePath, activeCwd))) return activeCwd
    return fileDir || activeCwd || '~'
  }, [activeCwd, activeTab?.filePath])

  useEffect(() => {
    fileTextRef.current = ''
    setTooltip(null)
    setSelectedFileData(null)
  }, [activeTab?.id, activeTab?.refreshKey, activeTab?.mode])

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

      if ((!startLine || !endLine) && fileTextRef.current) {
        const src = fileTextRef.current
        const idx = src.indexOf(text)
        if (idx >= 0) {
          startLine = src.slice(0, idx).split('\n').length
          endLine = startLine + text.split('\n').length - 1
        }
      }

      if (!startLine || !endLine) {
        startLine = 1
        endLine = Math.max(1, text.split('\n').length)
      }

      tooltipSetAtRef.current = Date.now()
      setTooltip({
        x: e.clientX + 8,
        y: e.clientY + 8,
        startLine: Math.min(startLine, endLine),
        endLine: Math.max(startLine, endLine),
        selectedText: text,
        pptxMeta: getPptxSelectionMeta(range, previewContentRef.current),
      })
    }

    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [])

  useEffect(() => {
    const onSelectionChange = () => {
      if (Date.now() - tooltipSetAtRef.current < 150) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) setTooltip(null)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const handleAskVivianClick = useCallback(() => {
    if (!tooltip || !activeTab) return
    const selStart = tooltip.startLine
    const selEnd = tooltip.endLine
    const language = detectLanguage(activeTab.filePath) || ''
    const ext = extensionFor(activeTab).toLowerCase()
    const isPptx = ext === '.pptx' || ext === '.ppt'
    const pptxMeta = isPptx ? tooltip.pptxMeta : null
    const locator = isPptx
      ? (pptxMeta?.locator || 'Slide')
      : formatLineLocator(selStart, selEnd)

    setSelectedFileData({
      kind: isPptx ? 'pptx' : 'plain-text',
      filePath: activeTab.filePath,
      fileName: activeTab.name || fileName(activeTab.filePath),
      locator,
      startLine: selStart,
      endLine: selEnd,
      content: tooltip.selectedText,
      contentFormat: 'text',
      language,
      slideNumber: pptxMeta?.slideNumber || null,
      boxIndex: pptxMeta?.boxIndex || '',
      boxLabel: pptxMeta?.boxLabel || '',
      boxBounds: pptxMeta?.boxBounds || '',
      anchorX: tooltip.x,
      anchorY: tooltip.y,
    })
    setTooltip(null)
    window.getSelection()?.removeAllRanges()
  }, [tooltip, activeTab])

  if (tabs.length === 0 || !activeTab) {
    return (
      <div className="flex items-center justify-center flex-1" style={{ color: 'var(--text-dim)' }}>
        <span className="text-xs">{t('fileBrowser.empty', 'Open a file from the chat to preview it here')}</span>
      </div>
    )
  }

  const plain = isPlainText(activeTab)
  const mode = activeTab.mode || 'preview'

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      <SlidingTabGroup id="file-browser-tabs">
      <div
        className="flex items-stretch flex-shrink-0 min-w-0"
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
      <div className="flex items-center overflow-x-auto min-w-0" style={{ flex: 1 }}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 min-w-0"
              style={{
                position: 'relative',
                height: 34,
                maxWidth: 180,
                flexShrink: 0,
                border: 'none',
                borderRight: '1px solid var(--border-subtle)',
                borderBottom: '2px solid transparent',
                background: active ? 'var(--bg-elevated)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '0 8px',
              }}
              title={tab.filePath}
            >
              {active && <SlidingTabIndicator layoutId="file-browser-tab-indicator" />}
              <FileText size={12} strokeWidth={1.5} style={{ color: active ? 'var(--blue)' : 'var(--text-dim)', flexShrink: 0, position: 'relative', zIndex: 1 }} />
              <span className="truncate text-xs" style={{ fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", minWidth: 0, position: 'relative', zIndex: 1 }}>
                {tab.name}
              </span>
              <span
                onClick={(event) => {
                  event.stopPropagation()
                  closeFile(tab.id)
                }}
                style={{ display: 'inline-flex', color: 'var(--text-dim)', position: 'relative', zIndex: 1 }}
              >
                <X size={12} strokeWidth={1.5} />
              </span>
            </button>
          )
        })}
      </div>
        {tabs.length > 1 && (
          <button
            type="button"
            onClick={closeAllFiles}
            title={t('fileBrowser.closeAll', 'Close all')}
            className="flex items-center gap-1 text-xs font-semibold uppercase flex-shrink-0"
            style={{
              height: 34,
              borderTop: 'none',
              borderRight: 'none',
              borderBottom: 'none',
              borderLeft: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              letterSpacing: '0.06em',
              padding: '0 12px',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={12} strokeWidth={1.5} />
            {t('fileBrowser.closeAll', 'Close all')}
          </button>
        )}
      </div>
      </SlidingTabGroup>

      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-base)' }}
      >
        <span
          className="truncate text-xs"
          title={activeTab.filePath}
          style={{
            flex: 1,
            minWidth: 0,
            color: 'var(--text-secondary)',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          }}
        >
          {activeTab.filePath}
        </span>
        <CopyPathButton path={activeTab.filePath} />
        <button
          type="button"
          onClick={() => refreshFile(activeTab.id)}
          title={t('fileBrowser.refresh', 'Refresh')}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <RefreshCw size={12} strokeWidth={1.5} />
        </button>
        <Tabs
          tabs={[{ id: 'raw', label: 'Raw' }, { id: 'preview', label: 'Preview' }]}
          activeKey={mode}
          onChange={(_, tab) => setMode(activeTab.id, tab.id)}
          variant="frame"
          className="flex items-center"
          style={{ border: '1px solid var(--border)', borderRadius: '4px' }}
          indicatorStyle={{ border: 'none', borderRadius: '4px' }}
          buttonClassName="px-2 py-1 text-xs"
          buttonStyle={{ borderRadius: '4px' }}
          getButtonStyle={({ active }) => ({
            color: active ? 'var(--text-primary)' : 'var(--text-dim)',
          })}
        />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--bg-base)' }}>
        <div ref={treeRef} className="flex min-h-0 flex-shrink-0">
          <FileTreeSidebar
            activeTab={activeTab}
            rootPath={treeRootPath}
            treeOpen={treeOpen}
            treeWidth={treeWidth}
            setTreeOpen={setTreeOpen}
            openFileTab={openFileTab}
          />
        </div>
        {treeOpen && (
          <div
            onMouseDown={onTreeResizeMouseDown}
            onMouseEnter={(e) => {
              if (!draggingTree) e.currentTarget.style.background = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              if (!draggingTree) e.currentTarget.style.background = 'var(--border-subtle)'
            }}
            style={{
              width: 4,
              cursor: 'col-resize',
              background: draggingTree ? 'var(--blue)' : 'var(--border-subtle)',
              transition: draggingTree ? 'none' : 'background 100ms ease',
              flexShrink: 0,
              zIndex: 5,
            }}
          />
        )}
        {draggingTree && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              cursor: 'col-resize',
              background: 'transparent',
            }}
          />
        )}
        <div ref={previewContentRef} className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          {mode === 'raw'
            ? plain
              ? <RawTextView tab={activeTab} onTextLoaded={handleTextLoaded} />
              : <NonPlainRawNotice onPreview={() => setMode(activeTab.id, 'preview')} />
            : <PreviewView tab={activeTab} onTextLoaded={handleTextLoaded} />}
        </div>
      </div>

      {tooltip && createPortal(
        <button
          type="button"
          className="flex items-center gap-1"
          onClick={handleAskVivianClick}
          onMouseDown={(e) => e.preventDefault()}
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
          <CornerDownLeft size={14} strokeWidth={1.5} />
          {t('quote.provideFeedback')}
        </button>,
        document.body
      )}

      {selectedFileData && createPortal(
        <SelectedFilePopup
          data={selectedFileData}
          onClose={() => setSelectedFileData(null)}
        />,
        document.body
      )}
    </div>
  )
}
