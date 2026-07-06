import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import useUiStore from '../../stores/uiStore'
import {
  WelcomeScene,
  ChatScene,
  QuickActionsScene,
  PowerFeaturesScene,
  StructuredExecutionScene,
  InteractiveRunningScene,
  RewindBranchScene,
  CanvasLinkageScene,
  SkillSetupScene,
  McpSetupScene,
  PermissionModeScene,
  FeedbackScene,
} from './scenes'

const DEFAULT_PANEL_WIDTH = 920
const MIN_PANEL_WIDTH = 680
const MIN_PANEL_HEIGHT = 520
const VIEWPORT_MARGIN = 48
const SIDEBAR_WIDTH = 296

const GROUPS_CONFIG = [
  { id: 'intro', tKey: 'groups.intro' },
  { id: 'start-work', tKey: 'groups.startWork' },
  { id: 'extend', tKey: 'groups.extend' },
]

const DEFAULT_COLLAPSED_GROUPS = GROUPS_CONFIG.reduce((state, group) => {
  state[group.id] = false
  return state
}, {})

function getPanelBounds() {
  if (typeof window === 'undefined') {
    return {
      minWidth: MIN_PANEL_WIDTH,
      minHeight: MIN_PANEL_HEIGHT,
      maxWidth: DEFAULT_PANEL_WIDTH,
      maxHeight: 760,
    }
  }

  const maxWidth = Math.max(320, window.innerWidth - VIEWPORT_MARGIN)
  const maxHeight = Math.max(320, window.innerHeight - VIEWPORT_MARGIN)

  return {
    minWidth: Math.min(MIN_PANEL_WIDTH, maxWidth),
    minHeight: Math.min(MIN_PANEL_HEIGHT, maxHeight),
    maxWidth,
    maxHeight,
  }
}

const STEPS_CONFIG = [
  { id: 'welcome',         groupId: 'intro',       Scene: WelcomeScene,       loopMs: 2200, tKey: 'steps.welcome' },
  { id: 'chat',            groupId: 'start-work',  Scene: ChatScene,           loopMs: 5600, tKey: 'steps.chat' },
  { id: 'quick-actions',   groupId: 'start-work',  Scene: QuickActionsScene,   loopMs: 8000, tKey: 'steps.quickActions' },
  { id: 'power',           groupId: 'start-work',  Scene: PowerFeaturesScene,  loopMs: 6900, tKey: 'steps.power' },
  { id: 'permission-mode', groupId: 'start-work',  Scene: PermissionModeScene, loopMs: 3900, tKey: 'steps.permissionMode' },
  { id: 'feedback',        groupId: 'start-work',  Scene: FeedbackScene,       loopMs: 8400, tKey: 'steps.feedback' },
  { id: 'structured-execution', groupId: 'start-work', Scene: StructuredExecutionScene, loopMs: 12000, tKey: 'steps.structuredExecution' },
  { id: 'interactive-running',  groupId: 'start-work', Scene: InteractiveRunningScene,  loopMs: 13000, tKey: 'steps.interactiveRunning' },
  { id: 'rewind-branch',        groupId: 'start-work', Scene: RewindBranchScene,        loopMs: 12000, tKey: 'steps.rewindBranch' },
  { id: 'canvas-linkage',       groupId: 'start-work', Scene: CanvasLinkageScene,       loopMs: 11000, tKey: 'steps.canvasLinkage' },
  { id: 'skill-setup',     groupId: 'extend',      Scene: SkillSetupScene,     loopMs: 6100, tKey: 'steps.skillSetup' },
  { id: 'mcp-setup',       groupId: 'extend',      Scene: McpSetupScene,       loopMs: 8600, tKey: 'steps.mcpSetup' },
]

export default function IntroPanel() {
  const { t } = useTranslation()
  const introOpen = useUiStore((s) => s.introOpen)
  const closeIntro = useUiStore((s) => s.closeIntro)
  const [index, setIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [sceneCycle, setSceneCycle] = useState(0)
  const [panelSize, setPanelSize] = useState({ width: DEFAULT_PANEL_WIDTH, height: null })
  const [collapsedGroups, setCollapsedGroups] = useState({ ...DEFAULT_COLLAPSED_GROUPS })
  const [resizing, setResizing] = useState(false)
  const directionRef = useRef(1)
  const panelRef = useRef(null)

  const GROUPS = useMemo(() =>
    GROUPS_CONFIG.map((g) => ({ ...g, title: t(`intro.${g.tKey}`) })),
    [t]
  )
  const STEPS = useMemo(() =>
    STEPS_CONFIG.map((s) => ({
      ...s,
      title: t(`intro.${s.tKey}.title`),
      description: t(`intro.${s.tKey}.description`),
    })),
    [t]
  )

  const step = STEPS[index]
  const Scene = step?.Scene
  const isFirst = index === 0
  const isLast = index === STEPS.length - 1
  const panelBounds = getPanelBounds()
  const panelWidth = Math.max(
    panelBounds.minWidth,
    Math.min(panelSize.width, panelBounds.maxWidth)
  )
  const panelHeight = panelSize.height == null
    ? null
    : Math.max(
        panelBounds.minHeight,
        Math.min(panelSize.height, panelBounds.maxHeight)
      )

  const expandGroup = useCallback((groupId) => {
    setCollapsedGroups((current) => (
      current[groupId]
        ? { ...current, [groupId]: false }
        : current
    ))
  }, [])

  const toggleGroup = useCallback((groupId) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }))
  }, [])

  const goTo = useCallback((next) => {
    if (next === index) return
    directionRef.current = next > index ? 1 : -1
    expandGroup(STEPS_CONFIG[next].groupId)
    setIndex(next)
  }, [expandGroup, index])

  const handleNext = () => {
    if (isLast) {
      closeIntro()
      return
    }
    goTo(index + 1)
  }

  const handleBack = () => {
    if (!isFirst) goTo(index - 1)
  }

  const handleResizeStart = useCallback((direction) => (e) => {
    e.preventDefault()
    e.stopPropagation()

    const panel = panelRef.current
    if (!panel) return

    setResizing(true)
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = panel.offsetWidth
    const startHeight = panel.offsetHeight

    const onMouseMove = (event) => {
      const bounds = getPanelBounds()
      const next = { width: panelSize.width, height: panelSize.height }

      if (direction === 'right' || direction === 'corner') {
        next.width = Math.max(
          bounds.minWidth,
          Math.min(bounds.maxWidth, startWidth + (event.clientX - startX))
        )
      }

      if (direction === 'bottom' || direction === 'corner') {
        next.height = Math.max(
          bounds.minHeight,
          Math.min(bounds.maxHeight, startHeight + (event.clientY - startY))
        )
      }

      setPanelSize(next)
    }

    const onMouseUp = () => {
      setResizing(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = direction === 'right'
      ? 'col-resize'
      : direction === 'bottom'
        ? 'row-resize'
        : 'nwse-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [panelSize.height, panelSize.width])

  const handleEscape = useCallback(
    (e) => {
      if (e.key === 'Escape') closeIntro()
    },
    [closeIntro]
  )

  useEffect(() => {
    if (!introOpen) return
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [introOpen, handleEscape])

  // Reset to step 1 each time the overlay opens
  useEffect(() => {
    if (introOpen) {
      setIndex(0)
      setSearch('')
      setSceneCycle(0)
      setCollapsedGroups({ ...DEFAULT_COLLAPSED_GROUPS })
      directionRef.current = 1
    }
  }, [introOpen])

  useEffect(() => {
    if (!introOpen) return
    setSceneCycle(0)
  }, [introOpen, index])

  useEffect(() => {
    if (!introOpen || !step?.loopMs) return
    const timer = window.setTimeout(() => {
      setSceneCycle((cycle) => cycle + 1)
    }, step.loopMs)
    return () => window.clearTimeout(timer)
  }, [introOpen, step?.id, step?.loopMs, sceneCycle])

  const query = search.trim().toLowerCase()
  const filteredGroups = GROUPS.map((group) => {
    const items = STEPS.map((currentStep, originalIndex) => ({
      step: currentStep,
      originalIndex,
    })).filter(({ step: candidate }) => {
      if (candidate.groupId !== group.id) return false
      if (!query) return true
      return (candidate.title + ' ' + (candidate.description || ''))
        .toLowerCase()
        .includes(query)
    })

    return { group, items }
  }).filter(({ items }) => items.length > 0)

  if (!introOpen) return null

  const keyframes = `
    @keyframes intro-slide-fwd {
      from { opacity: 0; transform: translateX(16px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes intro-slide-back {
      from { opacity: 0; transform: translateX(-16px); }
      to   { opacity: 1; transform: translateX(0); }
    }
  `

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 200,
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        padding: 24,
        boxSizing: 'border-box',
      }}
      onClick={closeIntro}
    >
      <style>{keyframes}</style>
      <div
        ref={panelRef}
        className="flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: panelWidth,
          minWidth: panelBounds.minWidth,
          height: panelHeight || undefined,
          maxWidth: panelBounds.maxWidth,
          maxHeight: panelBounds.maxHeight,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderLeft: '2px solid var(--blue)',
          borderRadius: 4,
          boxShadow: resizing ? '0 0 0 1px var(--blue)' : 'none',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="flex items-center" style={{ gap: 10 }}>
            <span
              className="uppercase font-semibold"
              style={{
                fontSize: 11,
                letterSpacing: '0.06em',
                color: 'var(--text-secondary)',
              }}
            >
              {t('intro.header')}
            </span>
            <span
              className="font-light"
              style={{ fontSize: 11, color: 'var(--text-dim)' }}
            >
              {String(index + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
            </span>
          </div>
          <button
            onClick={closeIntro}
            aria-label={t('intro.close')}
            className="flex items-center justify-center"
            style={{
              width: 24,
              height: 24,
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              color: 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'color 150ms ease, background 150ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)'
              e.currentTarget.style.background = 'var(--bg-elevated)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-dim)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div
          className="flex flex-1"
          style={{ minHeight: 0, overflow: 'hidden' }}
        >
          {/* Sidebar — search + tip list */}
          <aside
            className="flex flex-col flex-shrink-0"
            style={{
              width: SIDEBAR_WIDTH,
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-base)',
            }}
          >
            {/* Search */}
            <div
              className="flex items-center px-2 py-2"
              style={{
                gap: 6,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div
                className="flex items-center flex-1"
                style={{
                  gap: 6,
                  padding: '4px 8px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  minWidth: 0,
                }}
              >
                <Search
                  size={12}
                  strokeWidth={1.5}
                  style={{ color: 'var(--text-dim)', flexShrink: 0 }}
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('intro.searchPlaceholder')}
                  className="flex-1 min-w-0"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    padding: 0,
                  }}
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    aria-label={t('intro.clearSearch')}
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: 14,
                      height: 14,
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 2,
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'color 150ms ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--text-primary)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-dim)'
                    }}
                  >
                    <X size={11} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>

            {/* Tip list */}
            <div className="flex flex-col" style={{ overflow: 'auto', flex: 1 }}>
              {filteredGroups.length === 0 ? (
                <div
                  className="px-3 py-6 text-center"
                  style={{ fontSize: 11, color: 'var(--text-dim)' }}
                >
                  {t('intro.noTipsMatch')}
                </div>
              ) : (
                filteredGroups.map(({ group, items }) => {
                  const groupCollapsed = query ? false : collapsedGroups[group.id]
                  const hasActiveItem = items.some(({ originalIndex }) => originalIndex === index)

                  return (
                    <div key={group.id} className="flex flex-col">
                      <button
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={!groupCollapsed}
                        className="flex items-center justify-between text-left"
                        style={{
                          gap: 8,
                          padding: '9px 12px 8px',
                          background: hasActiveItem ? 'var(--bg-elevated)' : 'transparent',
                          border: 'none',
                          borderBottom: '1px solid var(--border-subtle)',
                          color: hasActiveItem ? 'var(--text-primary)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          transition: 'background 150ms ease, color 150ms ease',
                        }}
                        onMouseEnter={(e) => {
                          if (hasActiveItem) return
                          e.currentTarget.style.background = 'var(--bg-elevated)'
                          e.currentTarget.style.color = 'var(--text-primary)'
                        }}
                        onMouseLeave={(e) => {
                          if (hasActiveItem) return
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'var(--text-secondary)'
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {group.title}
                        </span>
                        {groupCollapsed ? (
                          <ChevronRight size={12} strokeWidth={1.6} />
                        ) : (
                          <ChevronDown size={12} strokeWidth={1.6} />
                        )}
                      </button>

                      {!groupCollapsed && items.map(({ step: s, originalIndex: i }) => {
                        const isActive = i === index
                        const isVisited = i < index

                        return (
                          <button
                            key={s.id}
                            onClick={() => goTo(i)}
                            className="flex items-center text-left"
                            style={{
                              gap: 10,
                              padding: '8px 12px',
                              paddingLeft: 20,
                              background: isActive ? 'var(--bg-elevated)' : 'transparent',
                              borderLeft: `2px solid ${isActive ? 'var(--blue)' : 'transparent'}`,
                              border: 'none',
                              borderRight: 'none',
                              borderTop: 'none',
                              borderBottom: '1px solid var(--border-subtle)',
                              cursor: 'pointer',
                              color: isActive
                                ? 'var(--text-primary)'
                                : isVisited
                                  ? 'var(--text-secondary)'
                                  : 'var(--text-dim)',
                              transition:
                                'background 150ms ease, color 150ms ease, border-left-color 150ms ease',
                            }}
                            onMouseEnter={(e) => {
                              if (isActive) return
                              e.currentTarget.style.background = 'var(--bg-elevated)'
                              e.currentTarget.style.color = 'var(--text-primary)'
                            }}
                            onMouseLeave={(e) => {
                              if (isActive) return
                              e.currentTarget.style.background = 'transparent'
                              e.currentTarget.style.color = isVisited
                                ? 'var(--text-secondary)'
                                : 'var(--text-dim)'
                            }}
                          >
                            <span
                              className="flex-shrink-0"
                              style={{
                                fontSize: 10,
                                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                                color: isActive ? 'var(--blue)' : 'inherit',
                                width: 18,
                              }}
                            >
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            <span
                              className="truncate"
                              style={{
                                fontSize: 12,
                                fontWeight: isActive ? 600 : 400,
                              }}
                            >
                              {s.title}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </div>
          </aside>

          {/* Content column */}
          <div
            className="flex flex-col flex-1"
            style={{ minWidth: 0, overflow: 'hidden' }}
          >
            <div
              className="flex flex-col px-6 py-6"
              style={{
                gap: 20,
                overflow: 'auto',
                flex: 1,
              }}
            >
              <div
                key={index}
                className="flex flex-col"
                style={{
                  gap: 20,
                  minWidth: 0,
                  animation: `intro-slide-${directionRef.current > 0 ? 'fwd' : 'back'} 220ms cubic-bezier(0.16, 1, 0.3, 1)`,
                }}
              >
                {/* Scene */}
                <Scene key={`${step.id}-${sceneCycle}`} />

                {/* Text */}
                <div className="flex flex-col" style={{ gap: 8, minWidth: 0 }}>
                  <h2
                    className="font-bold"
                    style={{
                      fontSize: 20,
                      color: 'var(--text-primary)',
                      margin: 0,
                      wordBreak: 'break-word',
                    }}
                  >
                    {step.title}
                  </h2>
                  <p
                    className="font-normal"
                    style={{
                      fontSize: 13,
                      lineHeight: 1.6,
                      color: 'var(--text-secondary)',
                      margin: 0,
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {step.description}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end px-4 py-3"
          style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              onClick={handleBack}
              disabled={isFirst}
              className="flex items-center gap-1 px-3 py-2"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: isFirst ? 'var(--text-dim)' : 'var(--text-secondary)',
                cursor: isFirst ? 'default' : 'pointer',
                fontSize: 12,
                transition: 'color 150ms ease, background 150ms ease, border-color 150ms ease',
              }}
              onMouseEnter={(e) => {
                if (isFirst) return
                e.currentTarget.style.color = 'var(--text-primary)'
                e.currentTarget.style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={(e) => {
                if (isFirst) return
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <ChevronLeft size={14} strokeWidth={1.5} />
              <span>{t('intro.back')}</span>
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-1 px-3 py-2"
              style={{
                background: 'var(--blue)',
                border: '1px solid var(--blue)',
                borderRadius: 4,
                color: 'var(--text-inverse)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                transition: 'opacity 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.85'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1'
              }}
            >
              <span>{isLast ? t('intro.getStarted') : t('intro.next')}</span>
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div
          onMouseDown={handleResizeStart('right')}
          title={t('intro.resizeWidth')}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 18,
            width: 10,
            cursor: 'col-resize',
            zIndex: 2,
          }}
        />
        <div
          onMouseDown={handleResizeStart('bottom')}
          title={t('intro.resizeHeight')}
          style={{
            position: 'absolute',
            left: 0,
            right: 18,
            bottom: 0,
            height: 10,
            cursor: 'row-resize',
            zIndex: 2,
          }}
        />
        <div
          onMouseDown={handleResizeStart('corner')}
          title={t('intro.resizeIntro')}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: 'nwse-resize',
            zIndex: 3,
          }}
        />
      </div>
    </div>
  )
}
