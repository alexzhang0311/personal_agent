import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { gutter, GutterMarker } from '@codemirror/view'
import { vivianTheme } from './codemirrorTheme'

class ErrorMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span')
    el.style.color = 'var(--red)'
    el.style.fontSize = '12px'
    el.style.lineHeight = '1'
    el.textContent = '✖'
    return el
  }
}

class WarningMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span')
    el.style.color = 'var(--yellow)'
    el.style.fontSize = '12px'
    el.style.lineHeight = '1'
    el.textContent = '▲' // ▲
    return el
  }
}

const errorMarker = new ErrorMarker()
const warningMarker = new WarningMarker()

const BASIC_SETUP = {
  lineNumbers: true,
  bracketMatching: true,
  closeBrackets: true,
  indentOnInput: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  foldGutter: false,
  autocompletion: false,
  rectangularSelection: false,
}

export default function ScriptEditor({
  value,
  onChange,
  language = 'python',
  placeholder = '',
  minHeight = 140,
  maxHeight = 300,
  readOnly = false,
  diagnostics = [],
  expandable = true,
  modalFooter = null,
}) {
  const [expanded, setExpanded] = useState(false)

  const langExtension = useMemo(
    () => (language === 'shell' ? StreamLanguage.define(shell) : python()),
    [language]
  )

  // Build a map: line -> worst severity ('error' wins over 'warning')
  const diagKey = diagnostics.map((d) => `${d.line}:${d.severity}`).join(',')
  const diagGutter = useMemo(() => {
    const lineMap = new Map()
    for (const d of diagnostics) {
      const prev = lineMap.get(d.line)
      if (!prev || d.severity === 'error') lineMap.set(d.line, d.severity)
    }
    return gutter({
      class: 'cm-error-gutter',
      lineMarker(view, line) {
        const lineNo = view.state.doc.lineAt(line.from).number
        const sev = lineMap.get(lineNo)
        if (sev === 'error') return errorMarker
        if (sev) return warningMarker
        return null
      },
      initialSpacer: () => errorMarker,
    })
  }, [diagKey])

  // ESC closes the expanded modal
  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setExpanded(false) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded])

  const extensions = [langExtension, diagGutter, ...vivianTheme]

  return (
    <>
      <div
        className="relative"
        style={{
          border: '1px solid var(--border)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <CodeMirror
          value={value}
          onChange={onChange}
          extensions={extensions}
          placeholder={placeholder}
          readOnly={readOnly}
          theme="none"
          minHeight={`${minHeight}px`}
          maxHeight={`${maxHeight}px`}
          basicSetup={BASIC_SETUP}
        />

        {expandable && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Expand editor"
            className="absolute flex items-center justify-center"
            style={{
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              zIndex: 5,
              transition: 'color 150ms ease, background 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)'
              e.currentTarget.style.background = 'var(--bg-surface)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <Maximize2 size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {expanded && createPortal(
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-overlay)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col relative"
            style={{
              width: '70vw',
              maxWidth: 1100,
              height: '70vh',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setExpanded(false)}
              title="Close (ESC)"
              className="absolute flex items-center justify-center"
              style={{
                top: 8,
                right: 8,
                width: 28,
                height: 28,
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                color: 'var(--text-dim)',
                zIndex: 2,
                transition: 'color 150ms ease, background 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.background = 'var(--bg-surface)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-dim)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <X size={16} strokeWidth={1.5} />
            </button>

            {/* paddingTop keeps the editor's first line clear of the close button */}
            <div style={{ flex: 1, minHeight: 0, paddingTop: 44, display: 'flex' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <CodeMirror
                  value={value}
                  onChange={onChange}
                  extensions={extensions}
                  placeholder={placeholder}
                  readOnly={readOnly}
                  theme="none"
                  height="100%"
                  style={{ flex: 1, height: '100%' }}
                  basicSetup={BASIC_SETUP}
                />
              </div>
            </div>

            {modalFooter && (
              <div
                style={{
                  flexShrink: 0,
                  padding: '8px 12px',
                  borderTop: '1px solid var(--border-subtle)',
                  maxHeight: '40%',
                  overflowY: 'auto',
                }}
              >
                {modalFooter}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
