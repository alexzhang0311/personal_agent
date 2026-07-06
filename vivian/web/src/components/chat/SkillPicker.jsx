import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

export default function SkillPicker({ skills, query, onSelect, onClose, activeIndex, loading, positionStyle }) {
  const { t } = useTranslation()
  const listRef = useRef(null)
  const activeRef = useRef(null)

  // Filter skills by query
  const q = query.toLowerCase()
  const filtered = q
    ? skills.filter((s) => s.name.toLowerCase().includes(q))
    : skills

  const projectSkills = filtered.filter((s) => s.level === 'project')
  const globalSkills = filtered.filter((s) => s.level === 'global')

  // Scroll active item into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const popupPosition = positionStyle || {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 4,
  }

  // Build flat list for index mapping
  const flatList = [...projectSkills, ...globalSkills]

  const headerEl = (
    <div
      className="px-3 pt-2 pb-2"
      style={{
        color: 'var(--text-secondary)',
        fontSize: 12,
        fontWeight: 400,
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 2,
      }}
    >
      {t('skillPicker.header')}
    </div>
  )

  if (loading) {
    return (
      <div
        className="skill-picker-popup"
        style={{
          ...popupPosition,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 4,
          padding: '0 0 8px 0',
          zIndex: 50,
        }}
      >
        {headerEl}
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-3 py-2 flex items-center gap-2">
            <div className="skeleton" style={{ width: 120, height: 14, borderRadius: 2 }} />
            <div className="flex-1" />
            <div className="skeleton" style={{ width: 50, height: 10, borderRadius: 2 }} />
          </div>
        ))}
      </div>
    )
  }

  if (flatList.length === 0) {
    return (
      <div
        className="skill-picker-popup"
        style={{
          ...popupPosition,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 4,
          padding: 0,
          zIndex: 50,
        }}
      >
        {headerEl}
        <div className="px-3 py-2">
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            {t('skillPicker.noMatch')}
          </span>
        </div>
      </div>
    )
  }

  let runningIndex = 0

  const renderItem = (skill) => {
    const idx = runningIndex++
    const isActive = idx === activeIndex
    return (
      <div
        key={`${skill.level}-${skill.name}`}
        ref={isActive ? activeRef : null}
        className="flex items-center gap-2 px-3 py-1 cursor-pointer"
        style={{
          background: isActive ? 'var(--bg-elevated)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--blue)' : '2px solid transparent',
          transition: 'background 150ms ease',
        }}
        onClick={() => onSelect(skill.name)}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent'
        }}
      >
        <ChevronRight size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <span
          className="truncate"
          style={{
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: 13,
            minWidth: 0,
          }}
        >
          {skill.name}
        </span>
        <span className="flex-1 min-w-0" />
        <span
          className="uppercase flex-shrink-0"
          style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            letterSpacing: '0.06em',
            fontWeight: 600,
          }}
        >
          {skill.level === 'project' ? t('skillPicker.project') : t('skillPicker.global')}
        </span>
      </div>
    )
  }

  const renderDescription = (skill, idx) => {
    if (!skill.description) return null
    return (
      <div
        key={`desc-${skill.level}-${skill.name}`}
        className="px-3 pb-1 truncate"
        style={{
          paddingLeft: 34,
          color: 'var(--text-dim)',
          fontSize: 12,
        }}
      >
        {skill.description}
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="skill-picker-popup"
      style={{
        ...popupPosition,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 4,
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 50,
        padding: '0 0 4px 0',
      }}
    >
      {headerEl}
      {projectSkills.length > 0 && (
        <>
          <div
            className="px-3 pt-2 pb-1 uppercase"
            style={{
              color: 'var(--text-dim)',
              fontSize: 11,
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            {t('skillPicker.project')}
          </div>
          {projectSkills.map((skill) => (
            <div key={`${skill.level}-${skill.name}`}>
              {renderItem(skill)}
              {renderDescription(skill)}
            </div>
          ))}
        </>
      )}
      {globalSkills.length > 0 && (
        <>
          <div
            className="px-3 pt-2 pb-1 uppercase"
            style={{
              color: 'var(--text-dim)',
              fontSize: 11,
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            {t('skillPicker.global')}
          </div>
          {globalSkills.map((skill) => (
            <div key={`${skill.level}-${skill.name}`}>
              {renderItem(skill)}
              {renderDescription(skill)}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// Helper to get the filtered count (used by parent for keyboard nav)
export function getFilteredSkills(skills, query) {
  const q = query.toLowerCase()
  const filtered = q
    ? skills.filter((s) => s.name.toLowerCase().includes(q))
    : skills
  return filtered
}
