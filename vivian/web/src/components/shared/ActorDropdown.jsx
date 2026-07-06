import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Searchable dropdown for selecting an actor.
 * @param {{ actors: {actor:string, count:number}[], selected: string|null, onSelect: (v:string|null)=>void }} props
 */
export default function ActorDropdown({ actors, selected, onSelect }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  const inputRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus search input when opening
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  const filtered = search
    ? actors.filter((a) => a.actor.toLowerCase().includes(search.toLowerCase()))
    : actors

  const label = selected || t('admin.filterAll')

  return (
    <div ref={ref} className="relative" style={{ minWidth: 160 }}>
      {/* Trigger */}
      <button
        className="flex items-center gap-2 px-3 py-1"
        style={{
          width: '100%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 12,
          transition: 'border-color 150ms ease',
          justifyContent: 'space-between',
        }}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate" style={{ flex: 1, textAlign: 'left' }}>{label}</span>
        {selected ? (
          <X
            size={12}
            strokeWidth={1.5}
            style={{ flexShrink: 0, color: 'var(--text-dim)' }}
            onClick={(e) => { e.stopPropagation(); onSelect(null); setOpen(false) }}
          />
        ) : (
          <ChevronDown
            size={12}
            strokeWidth={1.5}
            style={{
              flexShrink: 0,
              color: 'var(--text-dim)',
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 150ms ease',
            }}
          />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute flex flex-col"
          style={{
            top: 'calc(100% + 4px)',
            right: 0,
            width: 220,
            maxHeight: 260,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          {/* Search input */}
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              className="flex-1"
              placeholder={t('admin.searchActor')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: 12,
                minWidth: 0,
              }}
            />
          </div>

          {/* Options list */}
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 210 }}>
            {/* All option */}
            <DropdownItem
              label={t('admin.filterAll')}
              isActive={selected === null}
              onClick={() => { onSelect(null); setOpen(false); setSearch('') }}
            />

            {filtered.map(({ actor, count }) => (
              <DropdownItem
                key={actor}
                label={actor}
                count={count}
                isActive={selected === actor}
                onClick={() => { onSelect(actor); setOpen(false); setSearch('') }}
              />
            ))}

            {filtered.length === 0 && (
              <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-dim)', textAlign: 'center' }}>
                {t('settings.noMatches')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DropdownItem({ label, count, isActive, onClick }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{
        cursor: 'pointer',
        background: isActive ? 'var(--bg-surface)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 12,
        borderLeft: isActive ? '2px solid var(--blue)' : '2px solid transparent',
        transition: 'background 150ms ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-surface)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <span className="truncate" style={{ flex: 1 }}>{label}</span>
      {count != null && (
        <span style={{ color: 'var(--text-dim)', fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{count}</span>
      )}
    </div>
  )
}
