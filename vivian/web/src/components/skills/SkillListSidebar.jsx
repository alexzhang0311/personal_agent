import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Search, Upload, RefreshCw, PanelLeftClose, PanelLeft, Settings, ToggleLeft, ToggleRight, Package, ArrowDownUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSidebarStore from '../../stores/sidebarStore'
import useSkillsStore from '../../stores/skillsStore'
import useAuthStore from '../../stores/authStore'
import useUiStore from '../../stores/uiStore'
import useSkillHubStore from '../../stores/skillHubStore'
import useSkillSyncStore from '../../stores/skillSyncStore'
import SettingsPopover from '../settings/SettingsPopover'

const SYNC_MENU_WIDTH = 280
const SYNC_MENU_GAP = 4
const SYNC_MENU_MARGIN = 4
const SYNC_MENU_ESTIMATED_HEIGHT = 88

export default function SkillListSidebar() {
  const { t } = useTranslation()
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)
  const authUser = useAuthStore((s) => s.user)
  const toggleSettingsPopover = useUiStore((s) => s.toggleSettingsPopover)
  const openHub = useSkillHubStore((s) => s.openHub)
  const openPushSync = useSkillSyncStore((s) => s.openPushSync)
  const openPullSync = useSkillSyncStore((s) => s.openPullSync)

  const skills = useSkillsStore((s) => s.skills)
  const skillsLoading = useSkillsStore((s) => s.skillsLoading)
  const searchQuery = useSkillsStore((s) => s.searchQuery)
  const setSearchQuery = useSkillsStore((s) => s.setSearchQuery)
  const levelFilter = useSkillsStore((s) => s.levelFilter)
  const setLevelFilter = useSkillsStore((s) => s.setLevelFilter)
  const selectedSkill = useSkillsStore((s) => s.selectedSkill)
  const selectSkill = useSkillsStore((s) => s.selectSkill)
  const uploadSkill = useSkillsStore((s) => s.uploadSkill)
  const uploading = useSkillsStore((s) => s.uploading)
  const fetchSkills = useSkillsStore((s) => s.fetchSkills)
  const fetchSkillsConfig = useSkillsStore((s) => s.fetchSkillsConfig)
  const toggleSkill = useSkillsStore((s) => s.toggleSkill)

  // Fetch config on mount
  useEffect(() => {
    fetchSkillsConfig()
  }, [fetchSkillsConfig])

  const fileInputRef = useRef(null)
  const uploadLevelRef = useRef('project')
  const uploadBtnRef = useRef(null)
  const syncBtnRef = useRef(null)
  const syncMenuRef = useRef(null)
  const [showUploadMenu, setShowUploadMenu] = useState(false)
  const [showSyncMenu, setShowSyncMenu] = useState(false)
  const [syncMenuPosition, setSyncMenuPosition] = useState(null)

  const isAdmin = authUser?.role === 'admin'

  // Close popover on outside click
  useEffect(() => {
    if (!showUploadMenu) return
    const handler = (e) => {
      if (uploadBtnRef.current && !uploadBtnRef.current.contains(e.target)) {
        setShowUploadMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showUploadMenu])

  useEffect(() => {
    if (!showSyncMenu) return
    const handler = (e) => {
      const inButton = syncBtnRef.current?.contains(e.target)
      const inMenu = syncMenuRef.current?.contains(e.target)
      if (!inButton && !inMenu) {
        setShowSyncMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSyncMenu])

  const updateSyncMenuPosition = () => {
    const rect = syncBtnRef.current?.getBoundingClientRect()
    if (!rect) return

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const canOpenToLeft = rect.right - SYNC_MENU_WIDTH >= SYNC_MENU_MARGIN
    const openToRight = collapsed || !canOpenToLeft

    let left = openToRight
      ? rect.right + SYNC_MENU_GAP
      : rect.right - SYNC_MENU_WIDTH
    if (left + SYNC_MENU_WIDTH > viewportWidth - SYNC_MENU_MARGIN) {
      left = Math.max(SYNC_MENU_MARGIN, viewportWidth - SYNC_MENU_WIDTH - SYNC_MENU_MARGIN)
    }

    const preferredTop = rect.bottom + SYNC_MENU_GAP
    const top = Math.max(
      SYNC_MENU_MARGIN,
      Math.min(preferredTop, viewportHeight - SYNC_MENU_ESTIMATED_HEIGHT - SYNC_MENU_MARGIN),
    )

    setSyncMenuPosition({ left, top, width: SYNC_MENU_WIDTH })
  }

  useEffect(() => {
    if (!showSyncMenu) return
    updateSyncMenuPosition()
    window.addEventListener('resize', updateSyncMenuPosition)
    window.addEventListener('scroll', updateSyncMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateSyncMenuPosition)
      window.removeEventListener('scroll', updateSyncMenuPosition, true)
    }
  }, [showSyncMenu, collapsed])

  const handleUploadClick = () => {
    if (isAdmin) {
      setShowUploadMenu((v) => !v)
    } else {
      handleUpload('project')
    }
  }

  const handleSyncClick = () => {
    if (!showSyncMenu) updateSyncMenuPosition()
    setShowSyncMenu((v) => !v)
  }

  const handlePushSync = () => {
    setShowSyncMenu(false)
    openPushSync()
  }

  const handlePullSync = () => {
    setShowSyncMenu(false)
    openPullSync()
  }

  const filteredSkills = skills.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesLevel = levelFilter === 'all' || s.level === levelFilter
    return matchesSearch && matchesLevel
  })

  const projectSkills = filteredSkills.filter((s) => s.level === 'project')
  const globalSkills = filteredSkills.filter((s) => s.level === 'global')

  const handleUpload = (level) => {
    uploadLevelRef.current = level
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await uploadSkill(uploadLevelRef.current, file)
    } catch (err) {
      console.error('Upload failed:', err)
    }
    e.target.value = ''
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center flex-1 p-2">
        <button
          style={{
            width: 32, height: 32, background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
            transition: 'color 150ms ease',
          }}
          onClick={() => handleUpload('project')}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('skills.upload')}
        >
          <Upload size={14} strokeWidth={1.5} />
        </button>
        <div ref={syncBtnRef} className="relative">
          <button
            style={{
              width: 32, height: 32, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
              transition: 'color 150ms ease',
            }}
            onClick={handleSyncClick}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('skillSync.title')}
          >
            <ArrowDownUp size={14} strokeWidth={1.5} />
          </button>
          {showSyncMenu && (
            <SyncDropdownMenu menuRef={syncMenuRef} position={syncMenuPosition} onPush={handlePushSync} onPull={handlePullSync} />
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.tar,.tar.gz,.tgz,.gz,.skill,application/zip,application/gzip,application/x-gzip,application/x-tar"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <div className="flex-1" />
        {/* Settings icon */}
        <div className="relative flex flex-col items-center gap-1">
          <SettingsPopover />
          <button
            style={{
              width: 32, height: 32, background: 'transparent', border: 'none',
              borderRadius: '4px', cursor: 'pointer', color: 'var(--text-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 150ms ease',
            }}
            onClick={toggleSettingsPopover}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('sidebar.settings')}
          >
            <Settings size={16} strokeWidth={1.5} />
          </button>
        </div>
        {/* Toggle */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          <button
            style={{
              width: 28, height: 28, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
              transition: 'color 150ms ease, background 150ms ease',
            }}
            onClick={toggleCollapsed}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
            title={t('sidebar.expand')}
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <div
        className="px-3 py-2 uppercase font-semibold flex-shrink-0"
        style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 14, borderBottom: '1px solid var(--border-subtle)' }}
      >
        {t('tabs.skills')}
      </div>

      {/* Search + Upload */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div
          className="flex items-center gap-1 flex-1 px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}
        >
          <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            className="flex-1"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', minWidth: 0, fontSize: 13,
            }}
            placeholder={t('skills.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button
          className="flex items-center justify-center"
          style={{
            width: 28, height: 28, background: 'transparent',
            border: '1px solid var(--border)', borderRadius: '4px',
            cursor: 'pointer',
            color: 'var(--text-dim)', transition: 'color 150ms ease, border-color 150ms ease',
          }}
          onClick={fetchSkills}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          title="Refresh"
        >
          <RefreshCw size={12} strokeWidth={1.5} />
        </button>
        <div ref={syncBtnRef} className="relative">
          <button
            className="flex items-center justify-center"
            style={{
              width: 28, height: 28, background: 'transparent',
              border: '1px solid var(--border)', borderRadius: '4px',
              cursor: 'pointer',
              color: 'var(--text-dim)', transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onClick={handleSyncClick}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            title={t('skillSync.title')}
          >
            <ArrowDownUp size={12} strokeWidth={1.5} />
          </button>
          {showSyncMenu && (
            <SyncDropdownMenu menuRef={syncMenuRef} position={syncMenuPosition} onPush={handlePushSync} onPull={handlePullSync} />
          )}
        </div>
        <div ref={uploadBtnRef} className="relative">
          <button
            className="flex items-center justify-center"
            style={{
              width: 28, height: 28, background: 'transparent',
              border: '1px solid var(--border)', borderRadius: '4px',
              cursor: uploading ? 'wait' : 'pointer',
              color: 'var(--text-dim)', transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onClick={handleUploadClick}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            title={t('skills.upload')}
            disabled={uploading}
          >
            <Upload size={12} strokeWidth={1.5} />
          </button>
          {showUploadMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-strong)',
                borderRadius: 4,
                padding: '4px 0',
                zIndex: 50,
                minWidth: 140,
              }}
            >
              <button
                className="flex items-center gap-2 w-full px-3 py-2"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
                  transition: 'background 150ms ease',
                }}
                onClick={() => { setShowUploadMenu(false); handleUpload('project') }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {t('skills.upload')}
              </button>
              <button
                className="flex items-center gap-2 w-full px-3 py-2"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--green)', fontSize: 13, textAlign: 'left',
                  transition: 'background 150ms ease',
                }}
                onClick={() => { setShowUploadMenu(false); handleUpload('global') }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {t('skills.uploadGlobal')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Skill Hub button */}
      <div className="px-3 py-1">
        <button
          className="flex items-center justify-center gap-2 w-full px-2 py-1"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)', borderRadius: 4,
            cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: 13,
            transition: 'color 150ms ease, border-color 150ms ease, background 150ms ease',
          }}
          onClick={openHub}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'transparent' }}
        >
          <Package size={14} strokeWidth={1.5} />
          <span>{t('skillHub.title')}</span>
        </button>
      </div>

      {/* Level filter chips */}
      <div className="flex items-center gap-1 px-3 py-1">
        {['all', 'project', 'global'].map((level) => {
          const isActive = levelFilter === level
          const label = level === 'all' ? t('sidebar.all') : level === 'project' ? t('skills.project') : t('skills.global')
          return (
            <button
              key={level}
              className="px-2 py-1 uppercase"
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                border: isActive ? '1px solid var(--border-strong)' : '1px solid transparent',
                borderRadius: 4,
                cursor: 'pointer',
                color: isActive ? 'var(--text-primary)' : 'var(--text-dim)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                transition: 'color 150ms ease, background 150ms ease, border-color 150ms ease',
              }}
              onClick={() => setLevelFilter(level)}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' } }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.tar,.tar.gz,.tgz,.gz,.skill,application/zip,application/gzip,application/x-gzip,application/x-tar"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto py-1">
        {skillsLoading ? (
          <div className="flex flex-col gap-1 px-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 36, borderRadius: 2 }} />
            ))}
          </div>
        ) : (
          <>
            {/* Project skills */}
            {projectSkills.length > 0 && (
              <>
                <div
                  className="px-3 py-1 uppercase font-semibold"
                  style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', fontSize: 12 }}
                >
                  {t('skills.project')}
                </div>
                {projectSkills.map((skill) => (
                  <SkillItem
                    key={`project-${skill.name}`}
                    skill={skill}
                    isActive={selectedSkill?.level === 'project' && selectedSkill?.name === skill.name}
                    onClick={() => selectSkill('project', skill.name)}
                    showToggle
                    onToggle={() => toggleSkill(skill.name)}
                  />
                ))}
              </>
            )}

            {/* Global skills */}
            {globalSkills.length > 0 && (
              <>
                <div
                  className="px-3 py-1 uppercase text-xs font-semibold"
                  style={{ color: 'var(--text-dim)', letterSpacing: '0.06em', marginTop: projectSkills.length > 0 ? 8 : 0 }}
                >
                  {t('skills.global')}
                </div>
                {globalSkills.map((skill) => (
                  <SkillItem
                    key={`global-${skill.name}`}
                    skill={skill}
                    isActive={selectedSkill?.level === 'global' && selectedSkill?.name === skill.name}
                    onClick={() => selectSkill('global', skill.name)}
                    showToggle
                    onToggle={() => toggleSkill(skill.name)}
                  />
                ))}
              </>
            )}

            {filteredSkills.length === 0 && (
              <div className="px-3 py-4" style={{ color: 'var(--text-dim)', textAlign: 'center', fontSize: 13 }}>
                {t('skills.noSkills')}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom: Settings + Toggle */}
      <div
        className="p-2 flex items-center"
        style={{ borderTop: '1px solid var(--border-subtle)', justifyContent: 'space-between' }}
      >
        <div className="relative">
          <SettingsPopover />
          <button
            className="flex items-center gap-2"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: '4px 6px', borderRadius: '4px',
              fontSize: 13, transition: 'color 150ms ease, background 150ms ease',
            }}
            onClick={toggleSettingsPopover}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
            title={t('sidebar.settings')}
          >
            <Settings size={14} strokeWidth={1.5} />
            <span>{t('sidebar.settings')}</span>
          </button>
        </div>
        <button
          style={{
            width: 28, height: 28, background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text-dim)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
            transition: 'color 150ms ease, background 150ms ease',
          }}
          onClick={toggleCollapsed}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent' }}
          title={t('sidebar.collapse')}
        >
          <PanelLeftClose size={16} strokeWidth={1.5} />
        </button>
      </div>
    </>
  )
}

function SyncDropdownMenu({ menuRef, position, onPush, onPull }) {
  const { t } = useTranslation()
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 4,
        padding: '4px 0',
        zIndex: 900,
        width: position?.width ?? SYNC_MENU_WIDTH,
      }}
    >
      <button
        className="flex items-center gap-2 w-full px-3 py-2"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          fontSize: 13,
          textAlign: 'left',
          lineHeight: 1.45,
          transition: 'background 150ms ease, color 150ms ease',
        }}
        onClick={onPush}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t('skillSync.pushToAgent')}
        </span>
      </button>
      <button
        className="flex items-center gap-2 w-full px-3 py-2"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          fontSize: 13,
          textAlign: 'left',
          lineHeight: 1.45,
          transition: 'background 150ms ease, color 150ms ease',
        }}
        onClick={onPull}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}
      >
        <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t('skillSync.pullFromAgent')}
        </span>
      </button>
    </div>,
    document.body,
  )
}

function SkillItem({ skill, isActive, onClick, showToggle, onToggle }) {
  const enabled = skill.enabled !== false
  return (
    <div
      className="flex items-start gap-0 px-3 py-2"
      style={{
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--blue)' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'background 150ms ease',
        opacity: showToggle && !enabled ? 0.5 : 1,
      }}
      onClick={onClick}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex flex-col gap-0 flex-1 min-w-0">
        <span
          className="truncate"
          style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 14 }}
        >
          {skill.name}
        </span>
        {skill.description && (
          <span
            className="truncate"
            style={{ color: 'var(--text-dim)', fontSize: 12 }}
          >
            {skill.description}
          </span>
        )}
      </div>
      {showToggle && (
        <button
          className="flex items-center justify-center flex-shrink-0"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: enabled ? 'var(--green)' : 'var(--text-dim)',
            padding: '4px',
            marginTop: 0,
            transition: 'color 150ms ease',
          }}
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
          title={enabled ? 'Disable skill' : 'Enable skill'}
        >
          {enabled
            ? <ToggleRight size={24} strokeWidth={1.5} />
            : <ToggleLeft size={24} strokeWidth={1.5} />
          }
        </button>
      )}
    </div>
  )
}
