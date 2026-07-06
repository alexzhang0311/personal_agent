import { Trash2, Puzzle, Cable, Clock, Webhook } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import useUiStore from '../../stores/uiStore'
import Chip from '../shared/Chip'

const TABS = [
  { id: 'skills', icon: Puzzle, labelKey: 'admin.tabSkills' },
  { id: 'mcp', icon: Cable, labelKey: 'admin.tabMCP' },
  { id: 'scheduled', icon: Clock, labelKey: 'admin.tabScheduler' },
  { id: 'hooks', icon: Webhook, labelKey: 'admin.tabHooks' },
]

export default function UserInspectPanel() {
  const { t } = useTranslation()
  const inspectedUser = useAdminStore((s) => s.inspectedUser)
  const inspectedTab = useAdminStore((s) => s.inspectedTab)
  const setInspectedTab = useAdminStore((s) => s.setInspectedTab)
  const users = useAdminStore((s) => s.users)

  const user = users.find((u) => u.username === inspectedUser)

  if (!inspectedUser || !user) {
    return (
      <div
        className="flex items-center justify-center flex-1"
        style={{ color: 'var(--text-dim)', fontSize: 13 }}
      >
        {t('admin.selectUserToInspect')}
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header: username + role */}
      <div
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 14 }}>
          {user.username}
        </span>
        <Chip color={user.role === 'admin' ? 'var(--green)' : 'var(--text-secondary)'}>
          {user.role.toUpperCase()}
        </Chip>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center gap-0 px-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {TABS.map((tab) => {
          const isActive = inspectedTab === tab.id
          return (
            <button
              key={tab.id}
              className="flex items-center gap-1 px-3 py-2 text-sm"
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--blue)' : '2px solid transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'color 150ms ease',
                marginBottom: -1,
              }}
              onClick={() => setInspectedTab(tab.id)}
            >
              <tab.icon size={12} strokeWidth={1.5} />
              {t(tab.labelKey)}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {inspectedTab === 'skills' && <SkillsTabContent username={inspectedUser} />}
        {inspectedTab === 'mcp' && <McpTabContent username={inspectedUser} />}
        {inspectedTab === 'scheduled' && <SchedulerTabContent username={inspectedUser} />}
        {inspectedTab === 'hooks' && <HooksTabContent username={inspectedUser} />}
      </div>
    </div>
  )
}

function SkillsTabContent({ username }) {
  const { t } = useTranslation()
  const skills = useAdminStore((s) => s.inspectedUserSkills)
  const loading = useAdminStore((s) => s.inspectedUserSkillsLoading)
  const deleteInspectedUserSkill = useAdminStore((s) => s.deleteInspectedUserSkill)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const handleDelete = (skill) => {
    showConfirmDialog({
      title: t('admin.deleteSkillTitle'),
      message: t('admin.deleteSkillMessage', { name: skill.name, user: username }),
      confirmLabel: t('admin.delete'),
      danger: true,
      requireText: skill.name,
      onConfirm: () => deleteInspectedUserSkill(username, skill.level, skill.name),
    })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 2 }} />
        ))}
      </div>
    )
  }

  if (!skills || skills.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ color: 'var(--text-dim)', fontSize: 13, paddingTop: 40 }}
      >
        {t('admin.noSkillsForUser')}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {skills.map((skill) => (
        <SkillRow
          key={`${skill.level}-${skill.name}`}
          skill={skill}
          onDelete={() => handleDelete(skill)}
        />
      ))}
      <style>{`
        .skill-row:hover .skill-delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}

function SkillRow({ skill, onDelete }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 skill-row"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex flex-col gap-0 flex-1 min-w-0">
        <span
          className="text-sm truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {skill.name}
        </span>
        {skill.description && (
          <span
            className="text-xs truncate"
            style={{ color: 'var(--text-dim)' }}
          >
            {skill.description}
          </span>
        )}
      </div>
      <Chip color={skill.level === 'global' ? 'var(--green)' : 'var(--text-secondary)'}>
        {skill.level.toUpperCase()}
      </Chip>
      <button
        className="skill-delete-btn"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          color: 'var(--text-dim)',
          opacity: 0,
          transition: 'color 150ms ease, opacity 150ms ease',
        }}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
      >
        <Trash2 size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

function McpTabContent({ username }) {
  const { t } = useTranslation()
  const servers = useAdminStore((s) => s.inspectedUserMcpServers)
  const loading = useAdminStore((s) => s.inspectedUserMcpLoading)
  const deleteServer = useAdminStore((s) => s.deleteInspectedUserMcpServer)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const handleDelete = (srv) => {
    showConfirmDialog({
      title: t('mcp.deleteServerTitle'),
      message: t('mcp.deleteServerMessage', { name: srv.name }),
      confirmLabel: t('sidebar.delete'),
      danger: true,
      requireText: srv.name,
      onConfirm: () => deleteServer(username, srv.level, srv.name),
    })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 2 }} />
        ))}
      </div>
    )
  }

  if (!servers || servers.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ color: 'var(--text-dim)', fontSize: 13, paddingTop: 40 }}
      >
        {t('admin.noMcpForUser')}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {servers.map((srv) => (
        <McpServerRow
          key={`${srv.level}-${srv.name}`}
          server={srv}
          onDelete={() => handleDelete(srv)}
        />
      ))}
      <style>{`
        .mcp-row:hover .mcp-delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}

function McpServerRow({ server, onDelete }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 mcp-row"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex flex-col gap-0 flex-1 min-w-0">
        <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
          {server.name}
        </span>
        <span className="text-xs truncate" style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
          {server.url}
        </span>
      </div>
      <span
        className="uppercase flex-shrink-0 px-1"
        style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
          color: server.type === 'http' ? 'var(--cyan)' : 'var(--purple)',
          border: `1px solid ${server.type === 'http' ? 'var(--cyan)' : 'var(--purple)'}`,
          borderRadius: 2, lineHeight: '16px',
        }}
      >
        {server.type}
      </span>
      <Chip color={server.level === 'global' ? 'var(--green)' : 'var(--text-secondary)'}>
        {server.level.toUpperCase()}
      </Chip>
      <button
        className="mcp-delete-btn"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 4, color: 'var(--text-dim)', opacity: 0,
          transition: 'color 150ms ease, opacity 150ms ease',
        }}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
      >
        <Trash2 size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

function triggerLabel(trigger) {
  if (!trigger) return ''
  if (trigger.type === 'cron') return `cron ${trigger.expr || ''}`
  if (trigger.type === 'interval') {
    if (trigger.weeks) return `interval ${trigger.weeks}w`
    if (trigger.days) return `interval ${trigger.days}d`
    if (trigger.hours) return `interval ${trigger.hours}h`
    if (trigger.minutes) return `interval ${trigger.minutes}m`
    if (trigger.seconds) return `interval ${trigger.seconds}s`
    return 'interval'
  }
  return trigger.type || ''
}

function SchedulerTabContent({ username }) {
  const { t } = useTranslation()
  const jobs = useAdminStore((s) => s.inspectedUserSchedulerJobs)
  const loading = useAdminStore((s) => s.inspectedUserSchedulerLoading)

  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 2 }} />
        ))}
      </div>
    )
  }

  if (!jobs || jobs.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ color: 'var(--text-dim)', fontSize: 13, paddingTop: 40 }}
      >
        {t('admin.noSchedulerJobsForUser')}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {jobs.map((job) => (
        <SchedulerJobRow key={job.id} job={job} />
      ))}
    </div>
  )
}

function SchedulerJobRow({ job }) {
  const status = (job.status || 'active').toLowerCase()
  const statusColor = status === 'active' ? 'var(--green)' : 'var(--yellow)'
  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 150ms ease',
        boxSizing: 'border-box',
        minWidth: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex flex-col gap-0 flex-1 min-w-0">
        <span
          className="text-sm truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {job.name}
        </span>
        <span
          className="text-xs truncate"
          style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}
        >
          {triggerLabel(job.trigger)}
        </span>
      </div>
      <Chip color={statusColor}>{status.toUpperCase()}</Chip>
    </div>
  )
}

function HooksTabContent({ username }) {
  const { t } = useTranslation()
  const hooks = useAdminStore((s) => s.inspectedUserHooks)
  const loading = useAdminStore((s) => s.inspectedUserHooksLoading)

  if (loading) {
    return (
      <div className="flex flex-col gap-1 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 2 }} />
        ))}
      </div>
    )
  }

  const builtins = hooks?.builtins || []
  const custom = hooks?.custom || []

  if (builtins.length === 0 && custom.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ color: 'var(--text-dim)', fontSize: 13, paddingTop: 40 }}
      >
        {t('admin.noActiveHooksForUser')}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {builtins.length > 0 && (
        <>
          <SectionHeader label={t('admin.hooksBuiltinHeader')} />
          {builtins.map((h) => (
            <BuiltinHookRow key={`builtin-${h.id}`} meta={h} />
          ))}
        </>
      )}
      {custom.length > 0 && (
        <>
          <SectionHeader label={t('admin.hooksCustomHeader')} />
          {custom.map((h, idx) => (
            <CustomHookRow key={`custom-${idx}-${h.event}`} handler={h} />
          ))}
        </>
      )}
    </div>
  )
}

function SectionHeader({ label }) {
  return (
    <div
      className="px-4 py-2 uppercase text-xs flex-shrink-0"
      style={{
        color: 'var(--text-secondary)',
        letterSpacing: '0.06em',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {label}
    </div>
  )
}

function BuiltinHookRow({ meta }) {
  const events = Array.isArray(meta.events) ? meta.events.join(', ') : ''
  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 150ms ease',
        boxSizing: 'border-box',
        minWidth: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex flex-col gap-0 flex-1 min-w-0">
        <span
          className="text-sm truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {meta.name}
        </span>
        {events && (
          <span
            className="text-xs truncate"
            style={{ color: 'var(--text-dim)' }}
          >
            {events}
          </span>
        )}
      </div>
      <Chip color="var(--purple)">BUILTIN</Chip>
      {meta.enforced && <Chip color="var(--orange)">ENFORCED</Chip>}
    </div>
  )
}

function CustomHookRow({ handler }) {
  const primary = `${handler.event} • ${handler.matcher || '*'}`
  const secondary = handler.command || handler.url || ''
  const typeLabel = (handler.type || 'command').toUpperCase()
  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 150ms ease',
        boxSizing: 'border-box',
        minWidth: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex flex-col gap-0 flex-1 min-w-0">
        <span
          className="text-sm truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {primary}
        </span>
        {secondary && (
          <span
            className="text-xs"
            style={{
              color: 'var(--text-dim)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            {secondary}
          </span>
        )}
      </div>
      <Chip color="var(--cyan)">{typeLabel}</Chip>
    </div>
  )
}
