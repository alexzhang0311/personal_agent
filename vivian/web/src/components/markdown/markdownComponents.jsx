import { createElement } from 'react'
import CopyButton from '../shared/CopyButton'
import MermaidDiagram from './MermaidDiagram'
import ExcalidrawDiagram from './ExcalidrawDiagram'

/**
 * Recursively extract plain text from a React node tree.
 * Used for copy-to-clipboard and line counting.
 */
function extractText(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node.props?.children != null) return extractText(node.props.children)
  return ''
}

/**
 * Split a rehype-highlight React element tree into lines,
 * preserving <span className="hljs-*"> wrappers on each line.
 *
 * Returns: Array<Array<string | ReactElement>>
 *   Each inner array is one line's worth of highlighted fragments.
 */
function splitHighlightedLines(node) {
  if (node == null) return [[]]

  // Plain text — split by newlines
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).split('\n').map((part) => (part ? [part] : []))
  }

  // Array of children — process each, merge consecutive results
  if (Array.isArray(node)) {
    let result = [[]]
    for (const child of node) {
      const childLines = splitHighlightedLines(child)
      if (childLines.length === 0) continue
      // Merge first line of child into current last line of result
      result[result.length - 1] = [...result[result.length - 1], ...childLines[0]]
      for (let i = 1; i < childLines.length; i++) {
        result.push(childLines[i])
      }
    }
    return result
  }

  // React element (e.g. <span className="hljs-keyword">...</span>)
  if (node?.props) {
    const { children: inner, ...props } = node.props
    const innerText = extractText(inner)

    // Fast path: no newlines inside this element — keep it whole
    if (!innerText.includes('\n')) {
      return [[node]]
    }

    // Slow path: split inner children, wrap each segment in a cloned element
    const innerLines = splitHighlightedLines(inner)
    return innerLines.map((lineFragments, i) => {
      if (lineFragments.length === 0) return []
      const content = lineFragments.length === 1 ? lineFragments[0] : lineFragments
      return [createElement(node.type, { ...props, key: `${props.className || 'el'}-l${i}` }, content)]
    })
  }

  return [[]]
}

function createMarkdownComponents({ mermaidCollapsible = false } = {}) {
  return {
  h1: ({ children }) => (
    <h1 style={{
      fontSize: 'var(--text-xl)', fontWeight: 700,
      color: 'var(--text-primary)', margin: '24px 0 12px',
      letterSpacing: 'var(--tracking-tight)',
      borderBottom: '1px solid var(--border)', paddingBottom: '8px',
    }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{
      fontSize: 'var(--text-lg)', fontWeight: 600,
      color: 'var(--text-primary)', margin: '20px 0 8px',
    }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{
      fontSize: 'var(--text-md)', fontWeight: 600,
      color: 'var(--text-secondary)', margin: '16px 0 6px',
    }}>{children}</h3>
  ),
  p: ({ children }) => (
    <p style={{
      fontSize: 'var(--text-base)', color: 'var(--text-primary)',
      lineHeight: 1.8, margin: '0 0 4px', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
    }}>{children}</p>
  ),
  code: ({ className, children, node, ...props }) => {
    // Check if this code is inside a <pre> (code block) or inline
    const isInline = !className && (!node?.position || node?.properties?.inline !== false) && !/\n/.test(String(children))
    if (isInline) {
      return (
        <code style={{
          background: 'var(--bg-elevated)', color: 'var(--cyan)',
          padding: '1px 5px', borderRadius: '3px', fontSize: '0.9em',
          border: '1px solid var(--border)',
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
        }}>{children}</code>
      )
    }
    return (
      <code className={className} {...props}>{children}</code>
    )
  },
  pre: ({ children }) => {
    const rawChildren = children?.props?.children
    const codeContent = extractText(rawChildren)
    const codeClassName = children?.props?.className || ''
    if (/\blanguage-excalidraw\b/.test(codeClassName)) {
      return <ExcalidrawDiagram code={codeContent} collapsible={mermaidCollapsible} />
    }
    if (/\blanguage-mermaid\b/.test(codeClassName)) {
      return <MermaidDiagram code={codeContent} collapsible={mermaidCollapsible} />
    }
    const highlightedLines = splitHighlightedLines(rawChildren)
    // Remove trailing empty line (from trailing \n)
    if (highlightedLines.length > 1 && highlightedLines[highlightedLines.length - 1].length === 0) {
      highlightedLines.pop()
    }
    const lineCount = highlightedLines.length
    const gutterDigits = Math.max(String(lineCount).length, 2)
    const gutterWidth = `calc(${gutterDigits}ch + 24px)`
    const cellPadding = (i, horizontalRight, horizontalLeft) => {
      const top = i === 0 ? 8 : 0
      const bottom = i === lineCount - 1 ? 8 : 0
      return `${top}px ${horizontalRight}px ${bottom}px ${horizontalLeft}px`
    }
    return (
      <div style={{ position: 'relative' }} className="copyable-block">
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: '4px', margin: '0 0 4px', overflowX: 'auto',
        }}>
          <table style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: 'var(--text-sm)',
            lineHeight: '20px',
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            wordBreak: 'normal',
            overflowWrap: 'normal',
          }}>
            <tbody>
              {highlightedLines.map((fragments, i) => (
                <tr key={i}>
                  <td style={{
                    width: gutterWidth,
                    minWidth: gutterWidth,
                    maxWidth: gutterWidth,
                    padding: cellPadding(i, 8, 12),
                    textAlign: 'right',
                    color: 'var(--text-dim)',
                    userSelect: 'none',
                    verticalAlign: 'middle',
                    borderRight: '1px solid var(--border)',
                    whiteSpace: 'nowrap',
                    wordBreak: 'normal',
                    overflowWrap: 'normal',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {i + 1}
                  </td>
                  <td style={{
                    padding: cellPadding(i, 16, 12),
                    whiteSpace: 'pre',
                    color: 'var(--text-primary)',
                    wordBreak: 'normal',
                    overflowWrap: 'normal',
                    verticalAlign: 'middle',
                  }}>
                    {fragments.length > 0 ? fragments : ' '}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CopyButton content={codeContent} />
      </div>
    )
  },
  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: '2px solid var(--border-strong)',
      paddingLeft: '12px', margin: '0 0 4px',
      color: 'var(--text-secondary)',
    }}>{children}</blockquote>
  ),
  ul: ({ children }) => (
    <ul style={{
      paddingLeft: '20px', margin: '0 0 4px',
      color: 'var(--text-primary)',
    }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{
      paddingLeft: '20px', margin: '0 0 4px',
      color: 'var(--text-primary)',
    }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{
      fontSize: 'var(--text-base)', lineHeight: 1.7,
      marginBottom: '4px',
    }}>{children}</li>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 4px' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: 'var(--text-sm)',
      }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{
      padding: '6px 12px', textAlign: 'left', fontWeight: 600,
      color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)',
      letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase',
      fontSize: 'var(--text-xs)',
    }}>{children}</th>
  ),
  td: ({ children }) => (
    <td style={{
      padding: '6px 12px', color: 'var(--text-primary)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>{children}</td>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: 'var(--blue)', textDecoration: 'none' }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{children}</em>
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt}
      style={{
        maxWidth: '100%', height: 'auto',
        borderRadius: '4px', border: '1px solid var(--border)',
        display: 'block', margin: '8px 0',
      }}
    />
  ),
  }
}

const markdownComponents = createMarkdownComponents()

export { createMarkdownComponents }
export default markdownComponents
