import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
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
import useSkillsStore from '../../stores/skillsStore'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import CopyButton from '../shared/CopyButton'
import OptimizePopup from '../shared/OptimizePopup'
import getLineFromNode from '../../utils/getLineFromNode'

export default function SkillFileViewer({ animKey }) {
  const { t } = useTranslation()
  const selectedFile = useSkillsStore((s) => s.selectedFile)
  const selectedSkill = useSkillsStore((s) => s.selectedSkill)
  const skillDetail = useSkillsStore((s) => s.skillDetail)
  const fileContent = useSkillsStore((s) => s.fileContent)
  const fileLoading = useSkillsStore((s) => s.fileLoading)
  const viewMode = useSkillsStore((s) => s.viewMode)
  const setViewMode = useSkillsStore((s) => s.setViewMode)

  // Selection tooltip state
  const [tooltip, setTooltip] = useState(null) // { x, y, startLine, endLine, selectedText }
  // Optimize popup state
  const [optimizeData, setOptimizeData] = useState(null)
  const contentRef = useRef(null)

  const fullPath = skillDetail?.base_path && selectedFile
    ? `${skillDetail.base_path}/${selectedFile}`
    : selectedFile

  // Handle text selection in the code area (project-level skills only)
  const isProjectSkill = selectedSkill?.level === 'project'
  // Timestamp guard: prevent selectionchange from racing with mouseup
  const tooltipSetAtRef = useRef(0)

  // Listen on document so mouseup is caught even when drag ends outside content area
  useEffect(() => {
    const onMouseUp = (e) => {
      if (!isProjectSkill) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        return
      }

      const text = selection.toString()
      const range = selection.getRangeAt(0)

      // Make sure the selection overlaps our content area.
      // The commonAncestorContainer may be inside contentRef (normal)
      // or ABOVE it (browser lifts ancestor when selecting many rows).
      const ancestor = range.commonAncestorContainer
      if (contentRef.current
        && !contentRef.current.contains(ancestor)
        && !(ancestor.contains?.(contentRef.current))) {
        return
      }

      let startLine = getLineFromNode(range.startContainer, range.startOffset)
      let endLine = getLineFromNode(range.endContainer, Math.max(0, range.endOffset - 1))

      // Fallback: when selecting 3+ rows, browsers may lift range containers
      // above the table (to a wrapper div), causing getLineFromNode to fail.
      // Use range.intersectsNode to find the actual selected rows.
      if ((!startLine || !endLine) && contentRef.current) {
        const tbody = contentRef.current.querySelector('table')?.tBodies?.[0]
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

      if (!startLine || !endLine) {
        return
      }

      // Position tooltip near the mouse release point (always close to selection end)
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
  }, [isProjectSkill])

  // Hide tooltip when selection is cleared by clicking elsewhere
  useEffect(() => {
    const onSelectionChange = () => {
      // Ignore selectionchange events within 150ms of setting the tooltip,
      // as browsers may fire multiple events with a transiently collapsed selection.
      if (Date.now() - tooltipSetAtRef.current < 150) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        setTooltip(null)
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  // Handle clicking the optimize tooltip
  const handleOptimizeClick = useCallback(() => {
    if (!tooltip) return
    // Split full file into lines for context extraction
    const allLines = (fileContent?.content || '').replace(/\n$/, '').split('\n')
    const selStart = tooltip.startLine
    const selEnd = tooltip.endLine
    // +2 context lines before and after (for preview only, not sent in prompt)
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
    setOptimizeData({
      source: 'skill',
      skillName: selectedSkill?.name || '',
      filePath: fullPath || selectedFile || '',
      startLine: selStart,
      endLine: selEnd,
      selectedText: tooltip.selectedText,
      language: fileContent?.language || '',
      previewLines,
      // Anchor position for popup (viewport coords)
      anchorX: tooltip.x,
      anchorY: tooltip.y,
    })
    setTooltip(null)
    window.getSelection()?.removeAllRanges()
  }, [tooltip, selectedSkill, fullPath, selectedFile, fileContent])

  if (!selectedFile) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ background: 'var(--bg-base)', color: 'var(--text-dim)', fontSize: 13 }}
      >
        {t('skills.selectFile')}
      </div>
    )
  }

  if (fileLoading) {
    return (
      <div className="flex-1 flex flex-col" style={{ background: 'var(--bg-base)' }}>
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="skeleton" style={{ height: 16, width: 200, borderRadius: 2 }} />
        </div>
        <div className="flex-1 p-4 flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 14, width: `${80 - i * 10}%`, borderRadius: 2 }} />
          ))}
        </div>
      </div>
    )
  }

  const isMarkdown = selectedFile.endsWith('.md')
  const showToggle = isMarkdown

  return (
    <div key={animKey} className="skill-drawer-left" style={{
      flex: '1 1 0%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--bg-base)',
      minWidth: 0,
      maxWidth: '100%',
      width: 0,
    }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span
          className="text-xs truncate"
          style={{
            color: 'var(--text-secondary)',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {fullPath}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {showToggle && (
            <div className="flex items-center" style={{ border: '1px solid var(--border)', borderRadius: '4px' }}>
              <button
                className="px-2 py-1 text-xs"
                style={{
                  background: viewMode === 'preview' ? 'var(--bg-elevated)' : 'transparent',
                  border: 'none', borderRadius: '4px 0 0 4px', cursor: 'pointer',
                  color: viewMode === 'preview' ? 'var(--text-primary)' : 'var(--text-dim)',
                  transition: 'background 150ms ease, color 150ms ease',
                }}
                onClick={() => setViewMode('preview')}
              >
                {t('skills.preview')}
              </button>
              <button
                className="px-2 py-1 text-xs"
                style={{
                  background: viewMode === 'source' ? 'var(--bg-elevated)' : 'transparent',
                  border: 'none', borderRadius: '0 4px 4px 0', cursor: 'pointer',
                  color: viewMode === 'source' ? 'var(--text-primary)' : 'var(--text-dim)',
                  transition: 'background 150ms ease, color 150ms ease',
                }}
                onClick={() => setViewMode('source')}
              >
                {t('skills.source')}
              </button>
            </div>
          )}
          {fileContent?.content && !fileContent?.is_binary && (
            <CopyButton content={fileContent.content} inline />
          )}
        </div>
      </div>

      {/* Content — uses width:0 + flex:1 to force the flex item to take
          only the space allocated by the parent, never more. overflow:auto
          on this element then scrolls the code within that bounded area. */}
      <div
        ref={contentRef}
        style={{
          flex: '1 1 0%',
          overflow: 'auto',
          minWidth: 0,
          minHeight: 0,
          width: '100%',
          position: 'relative',
        }}
      >
        {fileContent?.is_binary ? (
          <div
            className="flex items-center justify-center h-full"
            style={{ color: 'var(--text-dim)', fontSize: 13 }}
          >
            {t('skills.binaryFile')}
          </div>
        ) : isMarkdown && viewMode === 'preview' ? (
          <div className="p-4">
            <MarkdownRenderer content={fileContent?.content || ''} />
          </div>
        ) : (
          <HighlightedCode
            content={fileContent?.content || ''}
            language={fileContent?.language}
          />
        )}
      </div>

      {/* Selection tooltip — portaled to body to avoid transform/transition containing block issues */}
      {tooltip && createPortal(
        <button
          className="flex items-center gap-1"
          onClick={handleOptimizeClick}
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
          {t('optimize.helpToOptimize')}
        </button>,
        document.body
      )}

      {/* Optimize floating popup — also portaled */}
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
    // Split highlighted HTML by newlines
    return highlighted.replace(/\n$/, '').split('\n').map((html) => ({ text: null, html }))
  }, [content, highlighted])

  const gutterWidth = String(lines.length).length * 8 + 16

  return (
    <div style={{ background: 'var(--bg-elevated)', width: '100%', maxWidth: '100%' }}>
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
