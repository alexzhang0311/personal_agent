import { useId, useState } from 'react'
import { FileCode, X, ChevronDown } from 'lucide-react'
import { AnimatedChevron, AnimatedCollapse } from './Accordion'

export default function FileReferenceCard({ filePath, startLine, endLine, selectedText, language, onDismiss, collapsed: initialCollapsed }) {
  const [collapsed, setCollapsed] = useState(!!initialCollapsed)
  const bodyId = useId()
  const fileName = filePath ? filePath.split('/').pop() : ''
  const lines = selectedText ? selectedText.split('\n') : []
  const lineRange = `L${startLine}-L${endLine}`

  return (
    <div style={{
      borderLeft: '2px solid var(--cyan)',
      background: 'var(--bg-surface)',
      borderRadius: '0 4px 4px 0',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        className="flex items-center"
        style={{
          borderBottom: collapsed ? 'none' : '1px solid var(--border-subtle)',
          userSelect: 'none',
        }}
      >
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-1 min-w-0 flex-1"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            minWidth: 0,
            padding: '4px 12px',
            textAlign: 'left',
          }}
          onClick={() => setCollapsed(!collapsed)}
        >
          <FileCode size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
          <span className="truncate" style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            flex: 1,
            minWidth: 0,
          }}>
            {filePath || fileName}
          </span>
          <span className="flex-shrink-0" style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          }}>
            {lineRange}
          </span>
          <AnimatedChevron open={!collapsed} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={12} strokeWidth={1.5} />
          </AnimatedChevron>
        </button>
        {onDismiss && (
          <button
            className="flex items-center justify-center flex-shrink-0"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-dim)',
              padding: 0,
              marginLeft: 2,
              marginRight: 12,
              transition: 'color 150ms ease',
            }}
            onClick={(e) => {
              e.stopPropagation()
              onDismiss()
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Code snippet */}
      <AnimatedCollapse open={!collapsed && lines.length > 0} id={bodyId}>
        {() => (
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            <table style={{
              borderCollapse: 'collapse',
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              width: '100%',
            }}>
              <tbody>
                {lines.map((line, i) => {
                  const lineNum = startLine + i
                  const gutterW = String(endLine).length * 8 + 12
                  return (
                    <tr key={i}>
                      <td style={{
                        width: gutterW,
                        minWidth: gutterW,
                        padding: '0 6px 0 8px',
                        textAlign: 'right',
                        color: 'var(--text-dim)',
                        userSelect: 'none',
                        verticalAlign: 'top',
                        borderRight: '1px solid var(--border-subtle)',
                      }}>
                        {lineNum}
                      </td>
                      <td style={{
                        padding: '0 10px 0 8px',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                        color: 'var(--text-primary)',
                      }}>
                        {line || ' '}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AnimatedCollapse>
    </div>
  )
}
