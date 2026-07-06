import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Cpu, Search } from 'lucide-react'
import useSettingsStore from '../../stores/settingsStore'

export default function ModelSelector() {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const models = useSettingsStore((s) => s.models)
  const modelsLoading = useSettingsStore((s) => s.modelsLoading)
  const selectedModel = useSettingsStore((s) => s.selectedModel)
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel)
  const fetchModels = useSettingsStore((s) => s.fetchModels)
  const env = useSettingsStore((s) => s.env)
  const dropdownRef = useRef(null)
  const filterRef = useRef(null)

  // Default model from env
  const defaultModel = env?.ANTHROPIC_MODEL || null
  const displayModel = selectedModel || defaultModel || 'model'

  const filteredModels = useMemo(() => {
    if (!filter.trim()) return models
    const q = filter.toLowerCase()
    return models.filter((m) => m.id.toLowerCase().includes(q))
  }, [models, filter])

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
        setFilter('')
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (open && filterRef.current) {
      filterRef.current.focus()
    }
  }, [open])

  const handleOpen = () => {
    if (!open && models.length === 0 && !modelsLoading) {
      fetchModels()
    }
    if (open) setFilter('')
    setOpen(!open)
  }

  const handleSelect = (modelId) => {
    // If selecting the default model, clear the override
    setSelectedModel(modelId === defaultModel ? null : modelId)
    setOpen(false)
    setFilter('')
  }

  // Truncate model name for display
  const truncatedName = displayModel.length > 20
    ? displayModel.slice(0, 18) + '...'
    : displayModel

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="flex items-center gap-1 px-2"
        style={{
          height: 28,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          cursor: 'pointer',
          color: selectedModel ? 'var(--cyan)' : 'var(--text-dim)',
          fontSize: 12,
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          transition: 'color 150ms ease, border-color 150ms ease',
          maxWidth: 180,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
        onClick={handleOpen}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-strong)'
          e.currentTarget.style.color = 'var(--text-secondary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.color = selectedModel ? 'var(--cyan)' : 'var(--text-dim)'
        }}
        title={displayModel}
      >
        <Cpu size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />
        <span className="truncate">{truncatedName}</span>
        <ChevronDown size={10} strokeWidth={1.5} style={{ flexShrink: 0 }} />
      </button>

      <div
        className="absolute right-0 flex flex-col"
        style={{
          bottom: '100%',
          marginBottom: 4,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          minWidth: 200,
          maxWidth: 320,
          maxHeight: 280,
          zIndex: 50,
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(4px)',
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 200ms cubic-bezier(0.16, 1, 0.3, 1), transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
          {/* Search filter */}
          {!modelsLoading && models.length > 0 && (
            <div
              className="flex items-center gap-2 px-2 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                ref={filterRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter models..."
                className="flex-1 py-2 text-xs"
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                  fontSize: 12,
                  minWidth: 0,
                }}
              />
            </div>
          )}

          {/* Model list */}
          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            {modelsLoading ? (
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                Loading models...
              </div>
            ) : models.length === 0 ? (
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                No models available
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                No matches
              </div>
            ) : (
              filteredModels.map((m) => {
                const isActive = (selectedModel || defaultModel) === m.id
                return (
                  <button
                    key={m.id}
                    className="flex items-center w-full px-3 py-2 text-xs"
                    style={{
                      background: isActive ? 'var(--bg-surface)' : 'transparent',
                      border: 'none',
                      borderLeft: isActive ? '2px solid var(--cyan)' : '2px solid transparent',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                      fontSize: 12,
                      textAlign: 'left',
                      transition: 'background 150ms ease',
                      wordBreak: 'break-all',
                    }}
                    onClick={() => handleSelect(m.id)}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'var(--bg-surface)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {m.id}
                  </button>
                )
              })
            )}
          </div>
      </div>
    </div>
  )
}
