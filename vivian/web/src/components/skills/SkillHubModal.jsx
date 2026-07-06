import { useRef, useEffect, useMemo } from 'react'
import { Search, X, ArrowLeft, Download, Check, Upload, Trash2, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSkillHubStore from '../../stores/skillHubStore'
import useAuthStore from '../../stores/authStore'
import useUiStore from '../../stores/uiStore'
import HubFileTree from './HubFileTree'
import HubFileViewer from './HubFileViewer'
import LucideIcon from './LucideIcon'

export default function SkillHubModal() {
  const { t } = useTranslation()
  const open = useSkillHubStore((s) => s.open)
  const closeHub = useSkillHubStore((s) => s.closeHub)
  const selectedSkill = useSkillHubStore((s) => s.selectedSkill)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeHub() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, closeHub])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 1000,
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeHub()
      }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 'min(1100px, 92vw)',
          height: 'min(720px, 88vh)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          animation: 'modal-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {selectedSkill ? <DetailView /> : <GridView />}
      </div>

      <style>{`
        @keyframes modal-scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function GridView() {
  const { t } = useTranslation()
  const skills = useSkillHubStore((s) => s.skills)
  const skillsLoading = useSkillHubStore((s) => s.skillsLoading)
  const searchQuery = useSkillHubStore((s) => s.searchQuery)
  const setSearchQuery = useSkillHubStore((s) => s.setSearchQuery)
  const closeHub = useSkillHubStore((s) => s.closeHub)
  const selectSkill = useSkillHubStore((s) => s.selectSkill)
  const uploadSkill = useSkillHubStore((s) => s.uploadSkill)
  const uploading = useSkillHubStore((s) => s.uploading)
  const authUser = useAuthStore((s) => s.user)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const isAdmin = authUser?.role === 'admin'
  const fileInputRef = useRef(null)

  const filteredSkills = useMemo(() => {
    if (!searchQuery) return skills
    const lq = searchQuery.toLowerCase()
    return skills.filter((s) =>
      s.name.toLowerCase().includes(lq) ||
      (s.description && s.description.toLowerCase().includes(lq))
    )
  }, [skills, searchQuery])

  const handleUploadClick = () => {
    showConfirmDialog({
      title: t('skillHub.uploadConfirmTitle'),
      message: t('skillHub.uploadConfirmMessage'),
      confirmLabel: t('skillHub.upload'),
      onConfirm: () => fileInputRef.current?.click(),
    })
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await uploadSkill(file)
    } catch (err) {
      console.error('Hub upload failed:', err)
    }
    e.target.value = ''
  }

  return (
    <>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <Package size={16} strokeWidth={1.5} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <span className="font-bold" style={{ color: 'var(--text-primary)', fontSize: 16 }}>
          {t('skillHub.title')}
        </span>
        <div className="flex-1" />

        {/* Search */}
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            width: 220,
          }}
        >
          <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            className="flex-1"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', minWidth: 0, fontSize: 13,
            }}
            placeholder={t('skillHub.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Admin upload */}
        {isAdmin && (
          <button
            className="flex items-center gap-1 px-3 py-1"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              cursor: uploading ? 'wait' : 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 13,
              transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onClick={handleUploadClick}
            disabled={uploading}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          >
            <Upload size={14} strokeWidth={1.5} />
            {t('skillHub.upload')}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.tar,.tar.gz,.tgz,.gz,.skill,application/zip,application/gzip,application/x-gzip,application/x-tar"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* Close */}
        <button
          className="flex items-center justify-center"
          style={{
            width: 28, height: 28, background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text-dim)', borderRadius: 4,
            transition: 'color 150ms ease',
          }}
          onClick={closeHub}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '24px 32px' }}>
        {skillsLoading ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 35,
          }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton" style={{ height: 96, borderRadius: 4 }} />
            ))}
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {t('skillHub.noSkills')}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 35,
          }}>
            {filteredSkills.map((skill) => (
              <SkillCard key={skill.name} skill={skill} onSelect={() => selectSkill(skill)} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function SkillCard({ skill, onSelect }) {
  const { t } = useTranslation()
  const authUser = useAuthStore((s) => s.user)
  const deleteSkill = useSkillHubStore((s) => s.deleteSkill)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const isAdmin = authUser?.role === 'admin'

  const handleDelete = (e) => {
    e.stopPropagation()
    showConfirmDialog({
      title: t('skillHub.deleteTitle'),
      message: t('skillHub.deleteMessage', { name: skill.name }),
      confirmLabel: t('sidebar.delete'),
      danger: true,
      requireText: skill.name,
      onConfirm: () => deleteSkill(skill.name),
    })
  }

  return (
    <div
      className="flex flex-col gap-1 p-2 relative"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        cursor: 'pointer',
        transition: 'border-color 150ms ease',
      }}
      onClick={onSelect}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      <div className="flex items-center gap-2">
        <LucideIcon
          name={skill.icon}
          size={16}
          strokeWidth={1.5}
          style={{ color: skill.icon_color || 'var(--text-secondary)', flexShrink: 0 }}
        />
        <span className="font-semibold truncate" style={{ color: 'var(--text-primary)', fontSize: 14 }}>
          {skill.name}
        </span>
        <div className="flex-1" />
        {skill.installed && (
          <Check size={14} strokeWidth={1.5} style={{ color: 'var(--green)', flexShrink: 0 }} />
        )}
        {isAdmin && (
          <button
            className="flex items-center justify-center"
            style={{
              width: 20, height: 20, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-dim)', borderRadius: 2,
              transition: 'color 150ms ease',
            }}
            onClick={handleDelete}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('skillHub.deleteTitle')}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <span
        style={{
          color: 'var(--text-secondary)',
          fontSize: 12,
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {skill.description || ''}
      </span>
      <div className="flex items-center gap-2" style={{ marginTop: 'auto' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {skill.file_count} {t('skillHub.files')}
        </span>
        {skill.installed && (
          <span className="uppercase" style={{ color: 'var(--green)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}>
            {t('skillHub.installed')}
          </span>
        )}
      </div>
    </div>
  )
}

function DetailView() {
  const { t } = useTranslation()
  const selectedSkill = useSkillHubStore((s) => s.selectedSkill)
  const skillDetail = useSkillHubStore((s) => s.skillDetail)
  const backToGrid = useSkillHubStore((s) => s.backToGrid)
  const deliverSkill = useSkillHubStore((s) => s.deliverSkill)
  const delivering = useSkillHubStore((s) => s.delivering)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const installed = skillDetail?.installed ?? selectedSkill?.installed

  const handleInstall = () => {
    if (installed) {
      showConfirmDialog({
        title: t('skillHub.overwriteTitle'),
        message: t('skillHub.overwriteMessage', { name: selectedSkill.name }),
        confirmLabel: t('skillHub.overwrite'),
        danger: false,
        onConfirm: () => deliverSkill(selectedSkill.name),
      })
    } else {
      deliverSkill(selectedSkill.name)
    }
  }

  return (
    <>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <button
          className="flex items-center gap-1"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: 13,
            transition: 'color 150ms ease',
          }}
          onClick={backToGrid}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          {t('skillHub.back')}
        </button>
        <LucideIcon
          name={selectedSkill?.icon}
          size={16}
          strokeWidth={1.5}
          style={{ color: selectedSkill?.icon_color || 'var(--text-secondary)', flexShrink: 0 }}
        />
        <span className="font-bold truncate" style={{ color: 'var(--text-primary)', fontSize: 16 }}>
          {selectedSkill?.name}
        </span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-3 py-1"
          style={{
            background: installed ? 'transparent' : 'var(--blue)',
            border: installed ? '1px solid var(--border)' : '1px solid var(--blue)',
            borderRadius: 4,
            cursor: delivering ? 'wait' : 'pointer',
            color: installed ? 'var(--text-secondary)' : 'var(--text-inverse)',
            fontSize: 13,
            fontWeight: 600,
            transition: 'opacity 150ms ease',
            opacity: delivering ? 0.6 : 1,
          }}
          onClick={handleInstall}
          disabled={delivering}
        >
          <Download size={14} strokeWidth={1.5} />
          {installed ? t('skillHub.reinstall') : t('skillHub.install')}
        </button>
      </div>

      {/* Content: tree + viewer */}
      <div className="flex flex-1 overflow-hidden">
        <HubFileTree />
        <HubFileViewer />
      </div>
    </>
  )
}
