import { useEffect, useState, useMemo, useRef } from 'react'
import { Pencil, Trash2, Plus, Search, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useAdminStore from '../../stores/adminStore'
import useAuthStore from '../../stores/authStore'
import useUiStore from '../../stores/uiStore'
import * as adminApi from '../../api/admin'
import Chip from '../shared/Chip'
import CopyButton from '../shared/CopyButton'
import UserInspectPanel from './UserInspectPanel'

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="skeleton" style={{ width: 80, height: 13 }} />
          <div className="skeleton" style={{ width: 48, height: 13 }} />
          <div className="skeleton" style={{ width: 28, height: 13 }} />
          <div className="skeleton" style={{ width: 60, height: 13 }} />
          <div className="skeleton" style={{ width: 40, height: 13 }} />
        </div>
      ))}
    </div>
  )
}

function ApiKeyPopover({ apiKey }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!apiKey) {
    return <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
  }

  return (
    <div ref={ref} className="relative" style={{ display: 'inline-flex' }}>
      <button
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          color: open ? 'var(--text-primary)' : 'var(--text-dim)',
          transition: 'color 150ms ease',
        }}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.color = 'var(--text-dim)' }}
        title={t('admin.showApiKey')}
      >
        <Eye size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            padding: '8px 12px',
            zIndex: 50,
            minWidth: 240,
            maxWidth: 360,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center gap-2 text-xs"
            style={{
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
            }}
          >
            <span style={{ flex: 1 }}>{apiKey}</span>
            <CopyButton content={apiKey} inline />
          </div>
        </div>
      )}
    </div>
  )
}

function CreateUserDialog({ onClose, onCreated }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!username.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await adminApi.createUser({ username: username.trim(), password: password || null, role })
      onCreated()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    outline: 'none',
    width: '100%',
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-4 p-6"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: '4px',
          maxWidth: 400,
          width: '90%',
          animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-md" style={{ color: 'var(--text-primary)' }}>
          {t('admin.createUser')}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
              {t('admin.username')}
            </label>
            <input
              className="px-2 py-1 text-sm"
              style={inputStyle}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
              {t('admin.password')}
            </label>
            <input
              className="px-2 py-1 text-sm"
              type="password"
              style={inputStyle}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('admin.passwordHint')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
              {t('admin.role')}
            </label>
            <select
              className="px-2 py-1 text-sm"
              style={inputStyle}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        {error && (
          <div className="text-xs" style={{ color: 'var(--red)' }}>{error}</div>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1 text-sm"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
            }}
            onClick={onClose}
          >
            {t('confirm.cancel')}
          </button>
          <button
            className="px-3 py-1 text-sm"
            style={{
              background: 'var(--blue)',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-inverse)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting || !username.trim() ? 0.4 : 1,
              transition: 'opacity 150ms ease',
            }}
            disabled={submitting || !username.trim()}
            onClick={handleSubmit}
          >
            {t('admin.create')}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes scale-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

export default function UserManagement() {
  const { t } = useTranslation()
  const users = useAdminStore((s) => s.users)
  const usersLoading = useAdminStore((s) => s.usersLoading)
  const fetchUsers = useAdminStore((s) => s.fetchUsers)
  const openUserDrawer = useAdminStore((s) => s.openUserDrawer)
  const inspectedUser = useAdminStore((s) => s.inspectedUser)
  const setInspectedUser = useAdminStore((s) => s.setInspectedUser)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const authUser = useAuthStore((s) => s.user)
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  useEffect(() => { fetchUsers() }, [])

  const filteredUsers = useMemo(() => {
    let result = users
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter((u) => u.username.toLowerCase().includes(q))
    }
    if (roleFilter !== 'all') {
      result = result.filter((u) => u.role === roleFilter)
    }
    return result
  }, [users, searchQuery, roleFilter])

  const handleDelete = (username) => {
    showConfirmDialog({
      title: t('admin.deleteUserTitle'),
      message: t('admin.deleteUserMessage', { name: username }),
      confirmLabel: t('admin.delete'),
      requireText: username,
      danger: true,
      onConfirm: async () => {
        try {
          await adminApi.deleteUser(username)
          fetchUsers()
          // Clear inspected user if deleted
          if (inspectedUser === username) setInspectedUser(null)
        } catch (e) {
          console.error(e)
        }
      },
    })
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString()
  }

  return (
    <div className="flex flex-col" style={{ height: '100%', overflow: 'hidden' }}>
      {/* Header — spans full width */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{ padding: '20px 24px 0 24px' }}
      >
        <h2 className="font-semibold text-lg" style={{ color: 'var(--text-primary)', margin: 0 }}>
          {t('admin.userManagement')}
        </h2>
        <button
          className="flex items-center gap-1 px-3 py-1 text-sm"
          style={{
            background: 'var(--blue)',
            border: 'none',
            borderRadius: '4px',
            color: 'var(--text-inverse)',
            cursor: 'pointer',
            transition: 'opacity 150ms ease',
          }}
          onClick={() => setShowCreate(true)}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <Plus size={14} strokeWidth={1.5} />
          {t('admin.createUser')}
        </button>
      </div>

      {/* Split content */}
      <div className="flex flex-1 min-h-0" style={{ marginTop: 16 }}>
        {/* Left half: table */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: '50%', borderRight: '1px solid var(--border)', flexShrink: 0 }}
        >
          {/* Search & Filter bar */}
          <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0">
            <div
              className="flex items-center gap-2 flex-1 px-2 py-1"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
              }}
            >
              <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                className="flex-1"
                placeholder={t('admin.searchUsers')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  minWidth: 0,
                }}
              />
            </div>
            {['all', 'admin', 'user'].map((role) => {
              const isActive = roleFilter === role
              return (
                <button
                  key={role}
                  className="px-2 py-1 text-xs uppercase"
                  style={{
                    background: isActive ? 'var(--bg-elevated)' : 'transparent',
                    border: '1px solid ' + (isActive ? 'var(--border-strong)' : 'var(--border)'),
                    borderRadius: '4px',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    letterSpacing: '0.06em',
                    transition: 'all 150ms ease',
                    flexShrink: 0,
                  }}
                  onClick={() => setRoleFilter(role)}
                >
                  {role === 'all' ? t('admin.filterAll') : role}
                </button>
              )
            })}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {usersLoading ? (
              <TableSkeleton />
            ) : (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {/* Header row */}
                <div
                  className="flex items-center gap-3 px-4 py-2 text-xs uppercase"
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--text-secondary)',
                    letterSpacing: '0.06em',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span className="flex-1 min-w-0">{t('admin.username')}</span>
                  <span style={{ width: 60, flexShrink: 0 }}>{t('admin.role')}</span>
                  <span style={{ width: 32, flexShrink: 0, textAlign: 'center' }}>{t('admin.apiKey')}</span>
                  <span style={{ width: 72, flexShrink: 0 }}>{t('admin.created')}</span>
                  <span style={{ width: 52, flexShrink: 0, textAlign: 'right' }}>{t('admin.actions')}</span>
                </div>
                {/* Data rows */}
                {filteredUsers.map((user) => {
                  const isInspected = inspectedUser === user.username
                  return (
                    <div
                      key={user.username}
                      className="flex items-center gap-3 px-4 py-2"
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        borderLeft: isInspected ? '2px solid var(--blue)' : '2px solid transparent',
                        background: isInspected ? 'var(--bg-elevated)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 150ms ease',
                      }}
                      onClick={() => setInspectedUser(user.username)}
                      onMouseEnter={(e) => {
                        if (!isInspected) e.currentTarget.style.background = 'var(--bg-surface)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isInspected) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span
                        className="text-sm font-semibold flex-1 min-w-0 truncate"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {user.username}
                      </span>
                      <span style={{ width: 60, flexShrink: 0 }}>
                        <Chip color={user.role === 'admin' ? 'var(--green)' : 'var(--text-secondary)'}>
                          {user.role.toUpperCase()}
                        </Chip>
                      </span>
                      <span style={{ width: 32, flexShrink: 0, textAlign: 'center' }}>
                        <ApiKeyPopover apiKey={user.api_key} />
                      </span>
                      <span
                        className="text-xs font-light"
                        style={{ color: 'var(--text-dim)', width: 72, flexShrink: 0 }}
                      >
                        {formatDate(user.created_at)}
                      </span>
                      <span
                        className="flex items-center gap-1 justify-end"
                        style={{ width: 52, flexShrink: 0 }}
                      >
                        <button
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 4,
                            color: 'var(--text-dim)',
                            transition: 'color 150ms ease',
                          }}
                          onClick={(e) => { e.stopPropagation(); openUserDrawer(user.username) }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                          title={t('admin.edit')}
                        >
                          <Pencil size={14} strokeWidth={1.5} />
                        </button>
                        {user.username !== authUser?.username && (
                          <button
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 4,
                              color: 'var(--text-dim)',
                              transition: 'color 150ms ease',
                            }}
                            onClick={(e) => { e.stopPropagation(); handleDelete(user.username) }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                            title={t('admin.delete')}
                          >
                            <Trash2 size={14} strokeWidth={1.5} />
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right half: inspect panel */}
        <div className="flex flex-col" style={{ width: '50%', overflow: 'hidden' }}>
          <UserInspectPanel />
        </div>
      </div>

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={fetchUsers}
        />
      )}
    </div>
  )
}
