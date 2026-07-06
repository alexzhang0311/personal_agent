import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import hljs from 'highlight.js/lib/core'
import 'highlight.js/styles/github-dark.css'
import useSkillHubStore from '../../stores/skillHubStore'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import CopyButton from '../shared/CopyButton'

export default function HubFileViewer() {
  const { t } = useTranslation()
  const selectedFile = useSkillHubStore((s) => s.selectedFile)
  const fileContent = useSkillHubStore((s) => s.fileContent)
  const fileLoading = useSkillHubStore((s) => s.fileLoading)

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

  return (
    <div style={{
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
          {selectedFile}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {fileContent?.content && !fileContent?.is_binary && (
            <CopyButton content={fileContent.content} inline />
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: '1 1 0%',
        overflow: 'auto',
        minWidth: 0,
        minHeight: 0,
        width: '100%',
      }}>
        {fileContent?.is_binary ? (
          <div
            className="flex items-center justify-center h-full"
            style={{ color: 'var(--text-dim)', fontSize: 13 }}
          >
            {t('skills.binaryFile')}
          </div>
        ) : isMarkdown ? (
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
