import { useState, useEffect, useMemo } from 'react'
import { Plus, UsersRound, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSubagentsStore from '../../stores/subagentsStore'
import useUiStore from '../../stores/uiStore'

export default function SubAgentsSidebar({ collapsed = false }) {
  const { t } = useTranslation()
  const list = useSubagentsStore((s) => s.list)
  const listLoading = useSubagentsStore((s) => s.listLoading)
  const selectedName = useSubagentsStore((s) => s.selectedName)
  const dirty = useSubagentsStore((s) => s.dirty)
  const selectAgent = useSubagentsStore((s) => s.selectAgent)
  const startNewAgent = useSubagentsStore((s) => s.startNewAgent)
  const loadList = useSubagentsStore((s) => s.loadList)
  const loadCatalog = useSubagentsStore((s) => s.loadCatalog)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const [search, setSearch] = useState('')

  useEffect(() => {
    loadList()
    loadCatalog()
  }, [loadList, loadCatalog])

  const filtered = useMemo(() => {
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q)
    )
  }, [list, search])

  const guarded = (action) => {
    if (!dirty) {
      action()
      return
    }
    showConfirmDialog({
      title: t('subagents.unsavedTitle'),
      message: t('subagents.unsavedMessage'),
      confirmLabel: t('subagents.discardConfirm'),
      danger: true,
      onConfirm: action,
    })
  }

  if (collapsed) {
    return (
      <button
        style={{
          width: 32,
          height: 32,
          background: 'transparent',
          border: 'none',
          borderLeft: selectedName ? '2px solid var(--blue)' : '2px solid transparent',
          borderRadius: '4px',
          cursor: 'pointer',
          color: selectedName ? 'var(--text-primary)' : 'var(--text-dim)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={t('tabs.subagents')}
      >
        <UsersRound size={14} strokeWidth={1.5} />
      </button>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header with new button */}
      <div className="flex items-center justify-between px-3 py-2">
        <span
          className="uppercase font-semibold"
          style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.06em' }}
        >
          {t('subagents.listTitle')}
        </span>
        <button
          onClick={() => guarded(() => startNewAgent())}
          className="flex items-center gap-1 px-2"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 11,
            height: 22,
            transition: 'border-color 150ms ease, color 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--blue)'
            e.currentTarget.style.color = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
        >
          <Plus size={12} strokeWidth={1.5} />
          {t('subagents.new')}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div
          className="flex items-center gap-2 px-2"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            height: 26,
          }}
        >
          <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('subagents.search')}
            className="flex-1"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: 12,
              outline: 'none',
            }}
          />
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '0 12px' }} />

      <div className="flex-1 overflow-y-auto py-1">
        {listLoading && (
          <div className="px-3 py-3" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {t('subagents.loading')}
          </div>
        )}

        {!listLoading && filtered.length === 0 && (
          <div
            className="px-3 py-3"
            style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}
          >
            {list.length === 0 ? t('subagents.empty.list') : t('subagents.empty.search')}
          </div>
        )}

        {filtered.map((agent) => {
          const isActive = selectedName === agent.name
          return (
            <button
              key={agent.name}
              className="flex w-full items-start"
              style={{
                minHeight: 56,
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                border: 'none',
                borderLeft: isActive ? '2px solid var(--blue)' : '2px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                padding: '8px 12px',
                transition: 'background 150ms ease',
              }}
              onClick={() => guarded(() => selectAgent(agent.name))}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent'
              }}
            >
              <div className="flex flex-col gap-1 flex-1" style={{ minWidth: 0 }}>
                <span
                  className="font-semibold truncate"
                  style={{ fontSize: 13, color: 'var(--text-primary)' }}
                >
                  {agent.name}
                </span>
                <span
                  className="truncate"
                  style={{ fontSize: 11, color: 'var(--text-dim)' }}
                >
                  {agent.description || '—'}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
