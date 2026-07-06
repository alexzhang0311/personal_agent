import { useState } from 'react'
import { RefreshCw, Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useMcpStore from '../../stores/mcpStore'
import { copyTextToClipboard } from '../../utils/clipboard'
import Tabs from '../shared/Tabs'

function mcpToolFullName(serverName, toolName) {
  return `mcp__${serverName}__${toolName}`
}

export default function MCPServerDetail() {
  const { t } = useTranslation()
  const capabilities = useMcpStore((s) => s.capabilities)
  const capabilitiesLoading = useMcpStore((s) => s.capabilitiesLoading)
  const capabilitiesError = useMcpStore((s) => s.capabilitiesError)
  const activeDetailTab = useMcpStore((s) => s.activeDetailTab)
  const setActiveDetailTab = useMcpStore((s) => s.setActiveDetailTab)
  const fetchCapabilities = useMcpStore((s) => s.fetchCapabilities)
  const selectedServer = useMcpStore((s) => s.selectedServer)
  const selectedTool = useMcpStore((s) => s.selectedTool)
  const selectTool = useMcpStore((s) => s.selectTool)

  const tabs = [
    { id: 'tools', label: t('mcp.tools'), count: capabilities?.tools?.length },
    { id: 'prompts', label: t('mcp.prompts'), count: capabilities?.prompts?.length },
    { id: 'resources', label: t('mcp.resources'), count: capabilities?.resources?.length },
  ]

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden"
      style={{ background: 'var(--bg-base)', minWidth: 0 }}
    >
      {/* Tab bar */}
      <div
        className="flex items-center gap-1 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <Tabs
          tabs={tabs}
          activeKey={activeDetailTab}
          onChange={(_, tab) => setActiveDetailTab(tab.id)}
          variant="frame"
          className="flex items-center gap-1"
          indicatorStyle={{ border: '1px solid var(--border-strong)' }}
          buttonClassName="px-3 py-1 uppercase"
          buttonStyle={{
            border: '1px solid transparent',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
          }}
          getButtonStyle={({ active, hovered }) => ({
            background: hovered && !active ? 'var(--bg-elevated)' : 'transparent',
            color: active ? 'var(--text-primary)' : hovered ? 'var(--text-secondary)' : 'var(--text-dim)',
          })}
          renderLabel={(tab) => (
            <>
              {tab.label}{tab.count != null ? ` (${tab.count})` : ''}
            </>
          )}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {capabilitiesLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 48, borderRadius: 2 }} />
            ))}
          </div>
        ) : capabilitiesError ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <span style={{ color: 'var(--red)', fontSize: 13 }}>{capabilitiesError}</span>
            <button
              className="flex items-center gap-1 px-3 py-1"
              style={{
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 4, cursor: 'pointer', color: 'var(--text-secondary)',
                fontSize: 12, transition: 'color 150ms ease, border-color 150ms ease',
              }}
              onClick={() => fetchCapabilities()}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <RefreshCw size={12} strokeWidth={1.5} />
              {t('mcp.retry')}
            </button>
          </div>
        ) : (
          <>
            {activeDetailTab === 'tools' && (
              <ToolsList tools={capabilities?.tools} selectedTool={selectedTool} onSelect={selectTool} serverName={selectedServer?.name} t={t} />
            )}
            {activeDetailTab === 'prompts' && <ItemsList items={capabilities?.prompts} borderColor="var(--purple)" emptyMsg={t('mcp.noPrompts')} />}
            {activeDetailTab === 'resources' && <ResourcesList resources={capabilities?.resources} t={t} />}
          </>
        )}
      </div>
    </div>
  )
}

function ToolNameCopy({ fullName }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="flex-shrink-0"
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
        color: copied ? 'var(--green)' : 'var(--text-dim)',
        transition: 'color 150ms ease',
      }}
      onClick={(e) => {
        e.stopPropagation()
        copyTextToClipboard(fullName)
        setCopied(true)
        setTimeout(() => setCopied(false), 800)
      }}
    >
      {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
    </button>
  )
}

function ToolsList({ tools, selectedTool, onSelect, serverName, t }) {
  if (!tools || tools.length === 0) {
    return <EmptyState message={t('mcp.noTools')} />
  }
  return (
    <div className="flex flex-col gap-1">
      {tools.map((tool) => {
        const isActive = selectedTool?.name === tool.name
        const fullName = serverName ? mcpToolFullName(serverName, tool.name) : tool.name
        return (
          <div
            key={tool.name}
            className="px-3 py-2"
            style={{
              background: isActive ? 'var(--bg-elevated)' : 'var(--bg-surface)',
              borderLeft: isActive ? '2px solid var(--blue)' : '2px solid var(--cyan)',
              borderRadius: '0 2px 2px 0',
              cursor: 'pointer',
              transition: 'background 150ms ease',
            }}
            onClick={() => onSelect(tool)}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = isActive ? 'var(--bg-elevated)' : 'var(--bg-surface)' }}
          >
            <div className="flex items-center gap-1">
              <span
                className="font-semibold truncate"
                style={{ color: 'var(--text-primary)', fontSize: 13, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", minWidth: 0 }}
              >
                {fullName}
              </span>
              <ToolNameCopy fullName={fullName} />
            </div>
            {tool.description && (
              <div className="truncate" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                {tool.description}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ItemsList({ items, borderColor, emptyMsg }) {
  if (!items || items.length === 0) {
    return <EmptyState message={emptyMsg} />
  }
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <div
          key={item.name}
          className="px-3 py-2"
          style={{ background: 'var(--bg-surface)', borderLeft: `2px solid ${borderColor}`, borderRadius: '0 2px 2px 0' }}
        >
          <div className="font-semibold truncate" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
            {item.name}
          </div>
          {item.description && (
            <div className="break-words" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
              {item.description}
            </div>
          )}
          {item.arguments && item.arguments.length > 0 && (
            <div className="flex flex-wrap gap-1" style={{ marginTop: 4 }}>
              {item.arguments.map((arg, i) => (
                <span key={i} className="px-1" style={{
                  fontSize: 10, color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 2,
                  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                }}>
                  {arg.name || JSON.stringify(arg)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ResourcesList({ resources, t }) {
  if (!resources || resources.length === 0) {
    return <EmptyState message={t('mcp.noResources')} />
  }
  return (
    <div className="flex flex-col gap-1">
      {resources.map((resource) => (
        <div
          key={resource.uri}
          className="px-3 py-2"
          style={{ background: 'var(--bg-surface)', borderLeft: '2px solid var(--green)', borderRadius: '0 2px 2px 0' }}
        >
          <div className="font-semibold truncate" style={{ color: 'var(--text-primary)', fontSize: 13 }}>
            {resource.name}
          </div>
          <div className="truncate" style={{ color: 'var(--text-dim)', fontSize: 11, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", marginTop: 2 }}>
            {resource.uri}
          </div>
          {resource.description && (
            <div className="break-words" style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
              {resource.description}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-dim)', fontSize: 13 }}>
      {message}
    </div>
  )
}
