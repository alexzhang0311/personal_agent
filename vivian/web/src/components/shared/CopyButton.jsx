import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { copyTextToClipboard } from '../../utils/clipboard'

export default function CopyButton({ content, inline }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      className={inline ? undefined : 'copy-btn'}
      onClick={async () => {
        const didCopy = await copyTextToClipboard(content)
        if (!didCopy) return
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
      style={{
        position: inline ? 'relative' : 'absolute',
        top: inline ? undefined : 8,
        right: inline ? undefined : 8,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '2px',
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        transition: 'color 150ms ease',
        opacity: inline ? 1 : undefined,
      }}
    >
      {copied
        ? <Check size={14} strokeWidth={1.5} />
        : <Copy size={14} strokeWidth={1.5} />}
    </button>
  )
}
