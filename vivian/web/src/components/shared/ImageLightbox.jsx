import { useEffect, useCallback } from 'react'
import { X } from 'lucide-react'

export default function ImageLightbox({ src, alt, onClose }) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
        zIndex: 300,
      }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute flex items-center justify-center"
        style={{
          top: 16,
          right: 16,
          width: 36,
          height: 36,
          borderRadius: 4,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          zIndex: 301,
          transition: 'color 150ms ease, border-color 150ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.borderColor = 'var(--border-strong)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        <X size={18} strokeWidth={1.5} />
      </button>
      <img
        src={src}
        alt={alt || 'Full size image'}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 4,
          border: '1px solid var(--border)',
        }}
      />
    </div>
  )
}
