import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { createMarkdownComponents } from './markdownComponents'

function normalizeLeadingMetadataBreaks(content) {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)(?=\r?\n|$)/)
  if (!match) return content

  const [, start, body, end] = match
  const normalizedBody = body
    .split(/\r?\n/)
    .map((line) => `${line}  `)
    .join('\n')

  return `${start}${normalizedBody}${end}${content.slice(match[0].length)}`
}

export default function MarkdownRenderer({ content, mermaidCollapsible = false }) {
  const components = useMemo(
    () => createMarkdownComponents({ mermaidCollapsible }),
    [mermaidCollapsible]
  )
  if (!content) return null

  const normalizedContent = normalizeLeadingMetadataBreaks(content)

  return (
    <div className="markdown-body overflow-hidden" style={{ wordBreak: 'break-word' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  )
}
