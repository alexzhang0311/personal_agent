import { useState, useRef, useCallback, useEffect } from 'react'
import { X, Send, GripHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import useUiStore from '../../stores/uiStore'
import useTaskStore from '../../stores/taskStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import useFileBrowserStore from '../../stores/fileBrowserStore'

function buildTemplate(lang, data, comments) {
  const { source, skillName, filePath, startLine, endLine, selectedText, language, noLineNumbers } = data
  if (source === 'file') {
    if (lang === 'zh') {
      const lines = [
        `帮我看一下这个文件：${filePath}`,
        '',
        `**首先，请读取文件 \`${filePath}\` 的完整内容，以便了解完整上下文。**`,
        '',
        `- 我选中的内容：`,
      ]
      if (!noLineNumbers) lines.push(`  - 行号：${startLine} - ${endLine}`)
      lines.push(
        `  - 内容：`,
        '```' + (language || ''),
        selectedText,
        '```',
        '',
        `以下是我的意见：`,
        comments,
        '',
        `请先阅读完整文件，然后结合上下文审查我选中的部分，告诉我你打算如何改进，然后请我确认。`,
        `使用 AskUserQuestion 工具向我了解更多细节。`,
      )
      return lines.join('\n')
    }
    const lines = [
      `Help me with this file: ${filePath}`,
      '',
      `**First, please read the full content of \`${filePath}\` so you have the complete context.**`,
      '',
      `- The content I selected:`,
    ]
    if (!noLineNumbers) lines.push(`  - Line number: ${startLine} - ${endLine}`)
    lines.push(
      `  - Content:`,
      '```' + (language || ''),
      selectedText,
      '```',
      '',
      `Here are my comments:`,
      comments,
      '',
      `Please read the full file first, then review my selected section in context, tell me how you would improve it, and ask me for confirmation.`,
      `You use AskUserQuestion tool to ask me for more detail.`,
    )
    return lines.join('\n')
  }
  // source === 'skill' (default)
  if (lang === 'zh') {
    return [
      `帮我优化技能：${skillName}`,
      `- 相关文件位于：${filePath}`,
      `- 我需要优化的内容位于：`,
      `  - 行号：${startLine} - ${endLine}`,
      `  - 内容：`,
      '```' + (language || ''),
      selectedText,
      '```',
      '',
      `以下是我的意见：`,
      comments,
      '',
      `请对照当前技能和我的意见，告诉我你打算如何优化，并请我审阅确认。`,
      `使用 AskUserQuestion 工具向我了解更多细节。`,
    ].join('\n')
  }
  return [
    `Help to optimize the skill: ${skillName}`,
    `- The related file is located in: ${filePath}`,
    `- The content I need to optimize is located in:`,
    `  - Line number: ${startLine} - ${endLine}`,
    `  - Content:`,
    '```' + (language || ''),
    selectedText,
    '```',
    '',
    `Here are my comments:`,
    comments,
    '',
    `Cross-check with the current skill and my comments, tell me how you would optimize it and ask me for review.`,
    `You use AskUserQuestion tool to ask me for more detail.`,
  ].join('\n')
}

const POPUP_WIDTH = 440
const MIN_WIDTH = 340

export default function OptimizePopup({ data, onClose }) {
  const { t } = useTranslation()
  const [comment, setComment] = useState('')
  const textareaRef = useRef(null)

  // Position anchored to the selected text, offset slightly right+down
  const initX = Math.min(data.anchorX || 200, window.innerWidth - POPUP_WIDTH - 16)
  const initY = Math.min((data.anchorY || 200) + 8, window.innerHeight - 300)
  const [pos, setPos] = useState({ x: Math.max(0, initX), y: Math.max(0, initY) })

  const [width, setWidth] = useState(POPUP_WIDTH)
  const [height, setHeight] = useState(null) // null = auto, number = user-resized

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Escape to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Drag handlers
  const onDragStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX - pos.x
    const startY = e.clientY - pos.y
    const onMove = (ev) => {
      setPos({ x: ev.clientX - startX, y: ev.clientY - startY })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pos])

  // Diagonal resize via bottom-right corner
  const popupRef = useRef(null)
  const onResizeStart = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = width
    // Capture current rendered height if not yet user-resized
    const startH = height ?? (popupRef.current?.offsetHeight || 380)
    const onMove = (ev) => {
      setWidth(Math.max(MIN_WIDTH, startW + (ev.clientX - startX)))
      setHeight(Math.max(240, startH + (ev.clientY - startY)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, height])

  const handleSend = () => {
    const language = useUiStore.getState().language
    const comments = comment.trim() || '(no comments)'

    if (data.source === 'file') {
      // File source: set fileReference + inputText, no auto-send
      onClose()

      if (!data.keepSession) {
        // Clear current chat and reset to a fresh session
        useChatStore.getState().clearMessages()
        useTaskStore.getState().clearTasks()
        useFileOpsStore.getState().clearFileOps()
        useFileBrowserStore.getState().clear()
        useUiStore.getState().clearPlanContent()
        useUiStore.getState().hideCanvas()
        useChatStore.getState().setPermissionMode('plan')
      }

      // Set file reference card in chat input
      useChatStore.getState().setFileReference({
        filePath: data.filePath,
        startLine: data.startLine,
        endLine: data.endLine,
        selectedText: data.selectedText,
        language: data.language || '',
        previewLines: data.previewLines,
      })

      // Set user comments as input text
      useChatStore.getState().setInputText(comments !== '(no comments)' ? comments : '')

      // Store the template for send time
      const template = buildTemplate(language, data, comments)
      useChatStore.getState().setFileReferenceTemplate(template)

      if (!data.keepSession) {
        // Switch to vivian tab only when starting a fresh session
        useUiStore.getState().setActiveNavTab('vivian')
      }
    } else {
      // Skill source: auto-send flow (original behavior)
      const template = buildTemplate(language, data, comments)
      onClose()

      useChatStore.getState().clearMessages()
      useTaskStore.getState().clearTasks()
      useFileOpsStore.getState().clearFileOps()
      useFileBrowserStore.getState().clear()
      useUiStore.getState().clearPlanContent()
      useUiStore.getState().hideCanvas()

      useChatStore.getState().setPermissionMode('plan')
      useChatStore.getState().setInputText(template)
      useChatStore.getState().setPendingOptimize({ autoSend: true })
      useUiStore.getState().setActiveNavTab('vivian')
    }
  }

  const isFileSource = data.source === 'file'
  const popupTitle = isFileSource ? t('optimize.helpWithFileTitle') : t('optimize.title')

  // Gutter width based on max line number
  const maxLineNum = data.previewLines?.length
    ? data.previewLines[data.previewLines.length - 1].lineNum
    : data.endLine
  const gutterW = String(maxLineNum).length * 8 + 12

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width,
        ...(height != null ? { height } : {}),
        maxHeight: '80vh',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      {/* Title bar — draggable */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          cursor: 'grab',
          userSelect: 'none',
        }}
        onMouseDown={onDragStart}
      >
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {popupTitle}
        </span>
        <button
          className="flex items-center justify-center"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            padding: 2,
            transition: 'color 150ms ease',
          }}
          onClick={onClose}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col p-3 gap-3 overflow-y-auto" style={{ minHeight: 0 }}>
        {/* Quote block — with or without line numbers */}
        <div style={{
          borderLeft: isFileSource ? '2px solid var(--cyan)' : '2px solid var(--purple)',
          background: 'var(--bg-elevated)',
          borderRadius: '0 4px 4px 0',
          overflow: 'hidden',
        }}>
          <div
            className="px-3 py-1"
            style={{
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: 11,
              color: 'var(--text-secondary)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              wordBreak: 'break-all',
            }}
          >
            {data.noLineNumbers
              ? data.filePath
              : `${data.filePath} : L${data.startLine}-L${data.endLine}`}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {data.noLineNumbers ? (
              <pre
                style={{
                  margin: 0,
                  padding: '8px 12px',
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                {data.selectedText || ' '}
              </pre>
            ) : (
              <table style={{
                borderCollapse: 'collapse',
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                width: '100%',
              }}>
                <tbody>
                  {(data.previewLines || []).map((line) => (
                    <tr key={line.lineNum}>
                      <td style={{
                        width: gutterW,
                        minWidth: gutterW,
                        padding: '0 6px 0 8px',
                        textAlign: 'right',
                        color: 'var(--text-dim)',
                        userSelect: 'none',
                        verticalAlign: 'top',
                        borderRight: '1px solid var(--border)',
                      }}>
                        {line.lineNum}
                      </td>
                      <td style={{
                        padding: '0 10px 0 8px',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        color: line.isSelected ? 'var(--text-primary)' : 'var(--text-dim)',
                        background: line.isSelected ? 'transparent' : 'var(--bg-base)',
                        opacity: line.isSelected ? 1 : 0.6,
                      }}>
                        {line.text || ' '}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Comment area — grows when popup is resized */}
        <div className="flex-1 flex flex-col gap-1" style={{ minHeight: 56 }}>
          <label
            className="text-xs font-normal flex-shrink-0"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('optimize.yourComments')}
          </label>
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={isFileSource ? t('optimize.fileCommentPlaceholder') : t('optimize.commentPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            className="flex-1 text-sm"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              padding: '8px 10px',
              resize: 'none',
              outline: 'none',
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 13,
              lineHeight: 1.5,
              minHeight: 40,
              transition: 'border-color 150ms ease',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--blue)' }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
          />
        </div>

        {/* Send button */}
        <div className="flex justify-end">
          <button
            className="flex items-center gap-1 px-3 py-1"
            style={{
              background: 'var(--blue)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              transition: 'opacity 150ms ease',
            }}
            onClick={handleSend}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          >
            {t('optimize.send')}
            <Send size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Resize handle — bottom-right corner (diagonal) */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          cursor: 'nwse-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
        }}
        onMouseDown={onResizeStart}
      >
        <GripHorizontal size={12} strokeWidth={1.5} style={{ transform: 'rotate(-45deg)' }} />
      </div>
    </div>
  )
}
