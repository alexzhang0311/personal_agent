import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MousePointer2,
  Bot,
  User,
  Send,
  Play,
  ClipboardList,
  Image,
  Key,
  Cpu,
  Shield,
  Plus,
  Sparkles,
  Pause,
  Zap,
  Radio,
  Settings,
  Settings2,
  Edit3,
  Trash2,
  Clock,
  Upload,
  FileText,
  HelpCircle,
  MessageSquare,
  Package,
  Puzzle,
  Cable,
  ScrollText,
  Download,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Search,
  RotateCcw,
  GitBranch,
  PanelRight,
  ListTodo,
  Loader,
} from 'lucide-react'

const STAGE_HEIGHT = 300

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function useTimeline(build, deps) {
  const ref = useRef([])
  useEffect(() => {
    ref.current = []
    const schedule = (t, fn) => {
      ref.current.push(setTimeout(fn, t))
    }
    build(schedule)
    return () => {
      ref.current.forEach(clearTimeout)
      ref.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps || [])
}

const Stage = forwardRef(function Stage({ children }, ref) {
  return (
    <div
      ref={ref}
      className="relative overflow-hidden"
      style={{
        height: STAGE_HEIGHT,
        background: 'var(--bg-base)',
        border: '1px solid var(--border)',
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  )
})

/**
 * Ref-based cursor. Given a stageRef and a targetsRef map, renders an
 * animated cursor that follows whichever named target you point it at.
 * Re-measures on every render so popups mounting at runtime still capture
 * the cursor correctly, and no hardcoded pixel coordinates are needed.
 */
function useCursorController() {
  const stageRef = useRef(null)
  const cursorRef = useRef(null)
  const targetsRef = useRef({})
  const [target, setTarget] = useState(null)

  const register = (name) => (el) => {
    if (el) targetsRef.current[name] = el
    else delete targetsRef.current[name]
  }

  useLayoutEffect(() => {
    const stage = stageRef.current
    const cursor = cursorRef.current
    if (!stage || !cursor) return
    if (!target) {
      cursor.style.opacity = '0'
      return
    }
    let x, y
    if (target === '__offstage_br') {
      const s = stage.getBoundingClientRect()
      x = s.width + 24
      y = s.height + 24
    } else {
      const el = targetsRef.current[target]
      if (!el) return
      const s = stage.getBoundingClientRect()
      const t = el.getBoundingClientRect()
      x = t.left - s.left + t.width / 2
      y = t.top - s.top + t.height / 2
    }
    cursor.style.left = `${x}px`
    cursor.style.top = `${y}px`
    cursor.style.opacity = '1'
  })

  const cursorNode = (
    <div
      ref={cursorRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        transform: 'translate(-4px, -2px)',
        opacity: 0,
        transition:
          'left 460ms cubic-bezier(0.16, 1, 0.3, 1), top 460ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease',
        color: 'var(--text-primary)',
        zIndex: 12,
      }}
    >
      <MousePointer2 size={16} strokeWidth={1.5} fill="currentColor" />
    </div>
  )

  return { stageRef, register, setTarget, cursorNode }
}

function Cursor({ x, y, visible = true }) {
  return (
    <div
      className="absolute"
      style={{
        left: x,
        top: y,
        pointerEvents: 'none',
        transform: `translate(-2px, -2px) scale(${visible ? 1 : 0.6})`,
        opacity: visible ? 1 : 0,
        transition:
          'left 460ms cubic-bezier(0.16, 1, 0.3, 1), top 460ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease, transform 200ms ease',
        color: 'var(--text-primary)',
        zIndex: 10,
      }}
    >
      <MousePointer2 size={16} strokeWidth={1.5} fill="currentColor" />
    </div>
  )
}

function Typewriter({ text, active, charDelay = 45 }) {
  const [len, setLen] = useState(0)
  useEffect(() => {
    if (!active) {
      setLen(0)
      return
    }
    let i = 0
    let cancelled = false
    let timer
    const tick = () => {
      if (cancelled) return
      i++
      setLen(i)
      if (i < text.length) timer = setTimeout(tick, charDelay)
    }
    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, active, charDelay])
  return (
    <span>
      {text.slice(0, len)}
      <span
        style={{
          display: 'inline-block',
          width: 1,
          height: '1em',
          background: 'var(--blue)',
          marginLeft: 1,
          verticalAlign: 'text-bottom',
          opacity: active && len < text.length ? 1 : 0,
        }}
      />
    </span>
  )
}

function Fade({ show, children, style }) {
  return (
    <div
      style={{
        ...style,
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(8px)',
        transition:
          'opacity 260ms cubic-bezier(0.16, 1, 0.3, 1), transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared bits that mirror real UI                                     */
/* ------------------------------------------------------------------ */

function RoleChip({ color, children }) {
  return (
    <span
      className="uppercase"
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </span>
  )
}

function Avatar({ user }) {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: 28,
        height: 28,
        borderRadius: 4,
        background: user ? 'var(--blue)' : 'var(--bg-elevated)',
        color: user ? 'var(--text-inverse)' : 'var(--purple)',
      }}
    >
      {user ? (
        <User size={14} strokeWidth={1.5} />
      ) : (
        <Bot size={14} strokeWidth={1.5} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Scene 1 — Welcome                                                   */
/* ------------------------------------------------------------------ */

export function WelcomeScene() {
  const { t } = useTranslation()
  const [phase, setPhase] = useState(0)
  useTimeline((at) => {
    at(200, () => setPhase(1))
    at(700, () => setPhase(2))
  })
  return (
    <Stage>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ gap: 16 }}
      >
        <div
          style={{
            transform: phase >= 1 ? 'scale(1)' : 'scale(0.6)',
            opacity: phase >= 1 ? 1 : 0,
            transition:
              'transform 320ms cubic-bezier(0.16, 1, 0.3, 1), opacity 320ms ease',
            color: 'var(--blue)',
          }}
        >
          <Bot size={72} strokeWidth={1.5} />
        </div>
        <div
          style={{
            fontSize: 14,
            color: 'var(--text-primary)',
            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
            minHeight: 20,
          }}
        >
          <Typewriter text={t('intro.scenes.welcome.greeting')} active={phase >= 2} />
        </div>
      </div>
    </Stage>
  )
}

/* ------------------------------------------------------------------ */
/* Scene 2 — Chat (mirrors real ChatPanel: message rows + input)       */
/* ------------------------------------------------------------------ */

export function ChatScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [typing, setTyping] = useState(false)
  const [sendHot, setSendHot] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const [showAsst, setShowAsst] = useState(false)
  const [asstTyping, setAsstTyping] = useState(false)
  const [inputCleared, setInputCleared] = useState(false)

  useTimeline((at) => {
    at(150, () => setTarget('__offstage_br'))
    at(550, () => setTarget('chat-text-caret'))
    at(950, () => setTyping(true))
    at(2250, () => setTarget('chat-send'))
    at(2650, () => setSendHot(true))
    at(2800, () => {
      setShowUser(true)
      setInputCleared(true)
    })
    at(2900, () => setSendHot(false))
    at(3150, () => setShowAsst(true))
    at(3250, () => setAsstTyping(true))
    at(3300, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      {/* Messages area */}
      <div
        className="absolute left-0 right-0 flex flex-col"
        style={{
          top: 0,
          bottom: 82,
          overflow: 'hidden',
        }}
      >
        {/* User message row */}
        <Fade
          show={showUser}
          style={{
            display: 'flex',
            gap: 12,
            padding: '6px 12px',
            background: 'transparent',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Avatar user />
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
            <div className="flex items-center" style={{ gap: 6 }}>
              <RoleChip color="var(--blue)">{t('intro.scenes.common.youRole')}</RoleChip>
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-primary)',
                wordBreak: 'break-word',
              }}
            >
              {t('intro.scenes.chat.userMessage')}
            </div>
          </div>
        </Fade>

        {/* Assistant message row */}
        <Fade
          show={showAsst}
          style={{
            display: 'flex',
            gap: 12,
            padding: '6px 12px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <Avatar />
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
            <div className="flex items-center" style={{ gap: 6 }}>
              <RoleChip color="var(--purple)">{t('intro.scenes.common.vivianRole')}</RoleChip>
              {asstTyping && (
                <span
                  className="flex items-center"
                  style={{
                    gap: 3,
                    padding: '1px 6px',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    fontSize: 9,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      background: 'var(--purple)',
                    }}
                  />
                  {t('intro.scenes.common.thinking')}
                </span>
              )}
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                color: 'var(--text-primary)',
                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 3,
                padding: '6px 8px',
                whiteSpace: 'pre',
                lineHeight: 1.5,
              }}
            >
              <Typewriter
                text={
                  'def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)'
                }
                active={asstTyping}
                charDelay={22}
              />
            </pre>
          </div>
        </Fade>
      </div>

      {/* Input container (matches real ChatInput: textarea + inline toolbar) */}
      <div
        className="absolute left-0 right-0"
        style={{
          bottom: 8,
          left: 10,
          right: 10,
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg-surface)',
          padding: 6,
        }}
      >
        {/* Fake textarea row */}
        <div
          className="relative"
          style={{
            minHeight: 22,
            padding: '2px 4px',
            fontSize: 11,
            color: 'var(--text-primary)',
            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
          }}
        >
          <span
            ref={register('chat-text-caret')}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 4,
              top: '50%',
              width: 1,
              height: 14,
              background: 'var(--blue)',
              opacity: !typing && !inputCleared ? 1 : 0,
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          />
          {inputCleared ? (
            <span style={{ color: 'var(--text-dim)' }}>{t('intro.scenes.common.askAnything')}</span>
          ) : typing ? (
            <Typewriter
              text={t('intro.scenes.chat.userMessage')}
              active={typing}
              charDelay={55}
            />
          ) : (
            <span style={{ color: 'var(--text-dim)', paddingLeft: 3 }}>{t('intro.scenes.common.askAnything')}</span>
          )}
        </div>

        {/* Toolbar row */}
        <div
          className="flex items-center justify-between"
          style={{ marginTop: 4, gap: 6 }}
        >
          {/* Left: permission mode chip */}
          <div className="flex items-center" style={{ gap: 6 }}>
            <div
              className="flex items-center"
              style={{
                gap: 4,
                padding: '2px 6px',
                background: 'transparent',
                borderRadius: 4,
                color: 'var(--green)',
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              <Shield size={11} strokeWidth={1.5} />
              <span>{t('intro.scenes.common.permDefault')}</span>
            </div>
          </div>

          {/* Right: model selector + send */}
          <div className="flex items-center" style={{ gap: 6 }}>
            <div
              className="flex items-center"
              style={{
                gap: 4,
                padding: '2px 6px',
                borderLeft: '2px solid var(--cyan)',
                background: 'var(--bg-elevated)',
                borderRadius: 2,
                fontSize: 10,
                color: 'var(--text-secondary)',
                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
              }}
            >
              <Cpu
                size={11}
                strokeWidth={1.5}
                style={{ color: 'var(--cyan)' }}
              />
              <span>cutom-model-name</span>
            </div>
            <button
              ref={register('chat-send')}
              className="flex items-center justify-center"
              style={{
                width: 26,
                height: 22,
                background: sendHot ? 'var(--blue)' : 'var(--bg-elevated)',
                border: `1px solid ${sendHot ? 'var(--blue)' : 'var(--border)'}`,
                borderRadius: 4,
                color: sendHot ? 'var(--text-inverse)' : 'var(--text-secondary)',
                transition:
                  'background 150ms ease, color 150ms ease, border-color 150ms ease',
              }}
            >
              <Send size={12} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {cursorNode}
    </Stage>
  )
}

/* ------------------------------------------------------------------ */
/* Scene — Quick Actions                                               */
/* ------------------------------------------------------------------ */

function QuickActionCard({ title, preview, hot, cardRef }) {
  return (
    <button
      ref={cardRef}
      className="flex items-start gap-2 px-3 py-2 text-xs min-w-0"
      style={{
        background: hot ? 'var(--bg-surface)' : 'var(--bg-elevated)',
        border: `1px solid ${hot ? 'var(--border)' : 'var(--border-subtle)'}`,
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 400,
        textAlign: 'left',
        transition: 'border-color 150ms ease, background 150ms ease',
      }}
    >
      <Zap
        size={14}
        strokeWidth={1.5}
        style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: 1 }}
      />
      <div className="flex flex-col gap-0 min-w-0">
        <span
          className="truncate"
          style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
        >
          {title}
        </span>
        <span
          className="truncate"
          style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            fontWeight: 300,
          }}
        >
          {preview}
        </span>
      </div>
    </button>
  )
}

function SettingsRow({ icon: Icon, label, active = false }) {
  return (
    <div
      className="flex items-center"
      style={{
        gap: 8,
        padding: '8px 10px',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: `2px solid ${active ? 'var(--blue)' : 'transparent'}`,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
      }}
    >
      <Icon size={13} strokeWidth={1.5} />
      <span className="truncate">{label}</span>
    </div>
  )
}

function QuickActionSettingRow({ title, prompt, active = false }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 4,
        borderLeft: `2px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </span>
          <Zap size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
        </div>
        <p
          className="text-xs truncate"
          style={{ color: 'var(--text-secondary)', margin: '2px 0 0' }}
        >
          {prompt}
        </p>
      </div>
      <div className="flex items-center" style={{ gap: 4 }}>
        <Edit3 size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
        <Trash2 size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
      </div>
    </div>
  )
}

const miniInputStyle = {
  padding: '6px 8px',
  fontSize: 10,
  color: 'var(--text-primary)',
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
}

function SettingsPopoverItem({ itemRef, icon: Icon, label, hot = false }) {
  return (
    <button
      ref={itemRef}
      className="flex items-center gap-2 px-3 py-2 w-full text-xs"
      style={{
        background: hot ? 'var(--bg-surface)' : 'transparent',
        border: 'none',
        color: hot ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 150ms ease, color 150ms ease',
      }}
    >
      <Icon size={13} strokeWidth={1.5} style={{ flexShrink: 0 }} />
      <span>{label}</span>
    </button>
  )
}

export function QuickActionsScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [shellZoomedOut, setShellZoomedOut] = useState(false)
  const [settingsButtonHot, setSettingsButtonHot] = useState(false)
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false)
  const [quickActionsMenuHot, setQuickActionsMenuHot] = useState(false)
  const [showSettingsView, setShowSettingsView] = useState(false)
  const [settingsAddHot, setSettingsAddHot] = useState(false)
  const [settingsSaveHot, setSettingsSaveHot] = useState(false)
  const [settingsFormOpen, setSettingsFormOpen] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [showChatView, setShowChatView] = useState(false)
  const [releaseHot, setReleaseHot] = useState(false)
  const [inputFilled, setInputFilled] = useState(false)
  const [selectedVariable, setSelectedVariable] = useState(null)
  const [showVariableHint, setShowVariableHint] = useState(false)

  useTimeline((at) => {
    at(200, () => setTarget('__offstage_br'))
    at(520, () => setShellZoomedOut(true))
    at(980, () => setTarget('sidebar-settings'))
    at(1280, () => setSettingsButtonHot(true))
    at(1460, () => {
      setSettingsButtonHot(false)
      setSettingsPopoverOpen(true)
    })
    at(1720, () => setTarget('popover-quickactions'))
    at(2040, () => setQuickActionsMenuHot(true))
    at(2240, () => {
      setQuickActionsMenuHot(false)
      setSettingsPopoverOpen(false)
      setShowSettingsView(true)
    })
    at(2520, () => setTarget('quick-add-button'))
    at(2860, () => setSettingsAddHot(true))
    at(3060, () => {
      setSettingsAddHot(false)
      setSettingsFormOpen(true)
    })
    at(3340, () => setTarget('quick-save-button'))
    at(3640, () => setSettingsSaveHot(true))
    at(3840, () => {
      setSettingsSaveHot(false)
      setSettingsFormOpen(false)
      setSettingsSaved(true)
    })
    at(4320, () => setShowChatView(true))
    at(4620, () => setTarget('quick-action-release'))
    at(4920, () => setReleaseHot(true))
    at(5120, () => {
      setReleaseHot(false)
      setInputFilled(true)
      setSelectedVariable('feature')
    })
    at(5420, () => setTarget('quick-var-feature'))
    at(5840, () => setShowVariableHint(true))
    at(6320, () => {
      setSelectedVariable('audience')
      setTarget('quick-var-audience')
    })
    at(7080, () => setShowVariableHint(false))
    at(7420, () => setTarget(null))
  })

  const variableStyle = (name) => ({
    padding: '0 3px',
    borderRadius: 3,
    border: `1px solid ${selectedVariable === name ? 'var(--blue)' : 'var(--border-subtle)'}`,
    background: selectedVariable === name ? 'var(--bg-elevated)' : 'transparent',
    color: selectedVariable === name ? 'var(--text-primary)' : 'var(--text-secondary)',
  })

  return (
    <Stage ref={stageRef}>
      <Fade show={!showChatView} style={{ position: 'absolute', inset: 0 }}>
        <div className="absolute inset-0" style={{ background: 'var(--bg-base)' }}>
          <div
            className="absolute inset-0"
            style={{
              opacity: showSettingsView ? 0 : 1,
              transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: shellZoomedOut ? 'translate(0, 0)' : 'translate(96px, -40px)',
                transition: 'transform 700ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  transformOrigin: 'left bottom',
                  transform: shellZoomedOut ? 'scale(1)' : 'scale(1.68)',
                  transition: 'transform 700ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <div className="absolute inset-0 flex" style={{ background: 'var(--bg-base)' }}>
                  <div
                    className="flex flex-col flex-shrink-0"
                    style={{
                      width: 56,
                      padding: 10,
                      borderRight: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      gap: 10,
                    }}
                  >
                    <button
                      className="flex items-center justify-center"
                      style={{
                        width: 34,
                        height: 34,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <Plus size={16} strokeWidth={1.5} />
                    </button>

                    <div className="flex flex-col" style={{ gap: 8 }}>
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          style={{
                            height: 28,
                            borderRadius: 5,
                            background: i === 1 ? 'var(--bg-elevated)' : 'transparent',
                            border: i === 1 ? '1px solid var(--border)' : '1px solid transparent',
                          }}
                        />
                      ))}
                    </div>

                    <div className="flex-1" />

                    <div className="relative flex flex-col items-start">
                      {!shellZoomedOut && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 42,
                            bottom: 8,
                            padding: '5px 8px',
                            borderRadius: 999,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--blue)',
                            color: 'var(--blue)',
                            fontSize: 10,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
                          }}
                        >
                          {t('intro.scenes.quickActions.settingsLiveHere')}
                        </div>
                      )}

                      {settingsPopoverOpen && (
                        <div
                          className="absolute flex flex-col"
                          style={{
                            left: 42,
                            bottom: 4,
                            width: 164,
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            overflow: 'hidden',
                            boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)',
                          }}
                        >
                          <SettingsPopoverItem icon={Key} label={t('intro.scenes.quickActions.apiKeys')} />
                          <SettingsPopoverItem icon={Cpu} label={t('intro.scenes.quickActions.models')} />
                          <SettingsPopoverItem
                            itemRef={register('popover-quickactions')}
                            icon={Zap}
                            label={t('intro.scenes.quickActions.quickActionsLabel')}
                            hot={quickActionsMenuHot}
                          />
                          <SettingsPopoverItem icon={Settings2} label={t('intro.scenes.quickActions.advanced')} />
                        </div>
                      )}

                      <button
                        ref={register('sidebar-settings')}
                        className="relative flex items-center justify-center"
                        style={{
                          width: 34,
                          height: 34,
                          background: settingsButtonHot ? 'var(--bg-elevated)' : 'transparent',
                          border: '1px solid transparent',
                          borderRadius: 6,
                          color: settingsButtonHot ? 'var(--text-primary)' : 'var(--text-dim)',
                          boxShadow: !shellZoomedOut
                            ? '0 0 0 2px rgba(37, 99, 235, 0.24)'
                            : 'none',
                          transition:
                            'background 150ms ease, color 150ms ease, box-shadow 180ms ease',
                        }}
                      >
                        <Settings size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>

                  <div
                    className="flex-1 flex flex-col"
                    style={{ minWidth: 0, padding: 12, gap: 10 }}
                  >
                    <div className="flex items-center justify-between" style={{ gap: 10 }}>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <div
                          style={{
                            width: 92,
                            height: 10,
                            borderRadius: 999,
                            background: 'var(--bg-elevated)',
                          }}
                        />
                        <div
                          style={{
                            width: 64,
                            height: 10,
                            borderRadius: 999,
                            background: 'var(--bg-elevated)',
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <div
                          style={{
                            width: 90,
                            height: 24,
                            borderRadius: 999,
                            borderLeft: '2px solid var(--cyan)',
                            background: 'var(--bg-elevated)',
                          }}
                        />
                        <div
                          style={{
                            width: 26,
                            height: 24,
                            borderRadius: 4,
                            border: '1px solid var(--border)',
                            background: 'var(--bg-elevated)',
                          }}
                        />
                      </div>
                    </div>

                    <div className="grid flex-1" style={{ gap: 10, gridTemplateColumns: '1.4fr 0.9fr' }}>
                      <div
                        style={{
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: 'var(--bg-surface)',
                          padding: 10,
                        }}
                      >
                        <div style={{ width: '42%', height: 10, borderRadius: 999, background: 'var(--bg-elevated)' }} />
                        <div style={{ marginTop: 10, height: 120, borderRadius: 6, background: 'var(--bg-elevated)' }} />
                        <div style={{ marginTop: 10, width: '68%', height: 10, borderRadius: 999, background: 'var(--bg-elevated)' }} />
                        <div style={{ marginTop: 8, width: '58%', height: 10, borderRadius: 999, background: 'var(--bg-elevated)', opacity: 0.72 }} />
                      </div>

                      <div className="flex flex-col" style={{ gap: 10 }}>
                        <div
                          style={{
                            height: 88,
                            borderRadius: 6,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-surface)',
                          }}
                        />
                        <div
                          style={{
                            height: 88,
                            borderRadius: 6,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-surface)',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="absolute inset-0 flex"
            style={{
              opacity: showSettingsView ? 1 : 0,
              transform: showSettingsView ? 'translateY(0)' : 'translateY(8px)',
              transition:
                'opacity 260ms cubic-bezier(0.16, 1, 0.3, 1), transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div
              className="flex flex-col flex-shrink-0"
              style={{
                width: 118,
                borderRight: '1px solid var(--border)',
                background: 'var(--bg-surface)',
              }}
            >
              <div
                className="uppercase"
                style={{
                  padding: '12px 12px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {t('intro.scenes.quickActions.settingsLabel')}
              </div>
              <SettingsRow icon={Key} label={t('intro.scenes.quickActions.apiKeys')} />
              <SettingsRow icon={Cpu} label={t('intro.scenes.quickActions.models')} />
              <SettingsRow icon={Zap} label={t('intro.scenes.quickActions.quickActionsLabel')} active />
              <SettingsRow icon={Settings2} label={t('intro.scenes.quickActions.advanced')} />
            </div>

            <div
              className="flex-1 flex flex-col"
              style={{ padding: '14px 16px', gap: 10, minWidth: 0 }}
            >
              <div className="flex flex-col" style={{ gap: 4 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  {t('intro.scenes.quickActions.quickActionsLabel')}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {t('intro.scenes.quickActions.createShortcutDesc')}
                </span>
              </div>

              <QuickActionSettingRow
                title={t('intro.scenes.quickActions.bugReport')}
                prompt={t('intro.scenes.quickActions.bugReportPrompt')}
              />

              {settingsSaved && (
                <div
                  style={{
                    opacity: settingsSaved ? 1 : 0,
                    transform: settingsSaved ? 'translateY(0)' : 'translateY(8px)',
                    transition:
                      'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <QuickActionSettingRow
                    title={t('intro.scenes.quickActions.releaseNotes')}
                    prompt={t('intro.scenes.quickActions.releaseNotesPromptFull')}
                    active
                  />
                </div>
              )}

              {settingsFormOpen ? (
                <div
                  className="flex flex-col"
                  style={{
                    gap: 8,
                    marginTop: 'auto',
                    padding: 10,
                    background: 'var(--bg-elevated)',
                    borderRadius: 4,
                    borderLeft: '2px solid var(--blue)',
                  }}
                >
                  <div className="flex flex-col" style={{ gap: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t('intro.scenes.quickActions.nameLabel')}</span>
                    <div style={miniInputStyle}>{t('intro.scenes.quickActions.releaseNotes')}</div>
                  </div>
                  <div className="flex flex-col" style={{ gap: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t('intro.scenes.quickActions.promptLabel')}</span>
                    <div style={{ ...miniInputStyle, minHeight: 50, whiteSpace: 'normal' }}>
                      {t('intro.scenes.quickActions.releaseNotesPromptFull')}
                    </div>
                  </div>
                  <div className="flex items-center justify-end" style={{ gap: 8 }}>
                    <button
                      className="px-3 py-1 text-xs"
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {t('intro.scenes.quickActions.cancel')}
                    </button>
                    <button
                      ref={register('quick-save-button')}
                      className="px-3 py-1 text-xs font-semibold"
                      style={{
                        background: settingsSaveHot ? 'var(--blue)' : 'var(--bg-surface)',
                        border: `1px solid ${settingsSaveHot ? 'var(--blue)' : 'var(--border)'}`,
                        borderRadius: 4,
                        color: settingsSaveHot ? 'var(--text-inverse)' : 'var(--text-secondary)',
                        transition: 'all 150ms ease',
                      }}
                    >
                      {t('intro.scenes.quickActions.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  ref={register('quick-add-button')}
                  className="flex items-center gap-2 px-3 py-2 text-xs"
                  style={{
                    marginTop: 'auto',
                    background: settingsAddHot ? 'var(--bg-elevated)' : 'transparent',
                    border: '1px dashed var(--border)',
                    borderRadius: 4,
                    color: settingsAddHot ? 'var(--text-secondary)' : 'var(--text-dim)',
                    transition: 'all 150ms ease',
                    textAlign: 'left',
                  }}
                >
                  <Plus size={14} strokeWidth={1.5} />
                  <span>{t('intro.scenes.quickActions.addQuickAction')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </Fade>

      <Fade show={showChatView} style={{ position: 'absolute', inset: 0 }}>
        <div className="absolute inset-0" style={{ background: 'var(--bg-base)' }}>
          <div
            className="absolute left-0 right-0"
            style={{
              bottom: 78,
              left: 20,
              right: 20,
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg-surface)',
              padding: 6,
            }}
          >
            <div
              style={{
                minHeight: 28,
                padding: '4px 6px',
                fontSize: 11,
                color: 'var(--text-primary)',
                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                lineHeight: 1.7,
              }}
            >
              {inputFilled ? (
                <span>
                  <span>{t('intro.scenes.quickActions.draftPart1')}</span>
                  <span ref={register('quick-var-feature')} style={variableStyle('feature')}>
                    {'{feature}'}
                  </span>
                  <span>{t('intro.scenes.quickActions.draftPart2')}</span>
                  <span ref={register('quick-var-audience')} style={variableStyle('audience')}>
                    {'{audience}'}
                  </span>
                </span>
              ) : (
                <span style={{ color: 'var(--text-dim)' }}>{t('intro.scenes.common.askAnything')}</span>
              )}
            </div>

            <div
              className="flex items-center justify-between"
              style={{ marginTop: 6, gap: 6 }}
            >
              <div className="flex items-center" style={{ gap: 6 }}>
                <div
                  className="flex items-center"
                  style={{
                    gap: 4,
                    padding: '2px 6px',
                    color: 'var(--green)',
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  <Shield size={11} strokeWidth={1.5} />
                  <span>{t('intro.scenes.common.permDefault')}</span>
                </div>
                {showVariableHint && (
                  <div
                    className="flex items-center"
                    style={{
                      gap: 4,
                      padding: '2px 6px',
                      border: '1px solid var(--blue)',
                      borderRadius: 3,
                      color: 'var(--blue)',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    <span>{t('intro.scenes.quickActions.tabHint')}</span>
                    <span>{t('intro.scenes.quickActions.nextVariable')}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center" style={{ gap: 6 }}>
                <div
                  className="flex items-center"
                  style={{
                    gap: 4,
                    padding: '2px 6px',
                    borderLeft: '2px solid var(--cyan)',
                    background: 'var(--bg-elevated)',
                    borderRadius: 2,
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                  }}
                >
                  <Cpu
                    size={11}
                    strokeWidth={1.5}
                    style={{ color: 'var(--cyan)' }}
                  />
                  <span>cutom-model-name</span>
                </div>
                <button
                  className="flex items-center justify-center"
                  style={{
                    width: 26,
                    height: 22,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Send size={12} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>

          <div
            className="absolute left-0 right-0 grid"
            style={{
              left: 20,
              right: 20,
              bottom: 16,
              gap: 8,
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            }}
          >
            <QuickActionCard
              cardRef={register('quick-action-release')}
              title={t('intro.scenes.quickActions.releaseNotes')}
              preview={t('intro.scenes.quickActions.releaseNotesPreview')}
              hot={releaseHot}
            />
            <QuickActionCard
              title={t('intro.scenes.quickActions.bugReport')}
              preview={t('intro.scenes.quickActions.bugReportPreview')}
            />
            <QuickActionCard
              title={t('intro.scenes.quickActions.codeReview')}
              preview={t('intro.scenes.quickActions.codeReviewPreview')}
            />
          </div>
        </div>
      </Fade>

      {cursorNode}
    </Stage>
  )
}

/* ------------------------------------------------------------------ */
/* Scene — Enhance your input (drag-drop images, +, /skill, models)    */
/* ------------------------------------------------------------------ */

export function PowerFeaturesScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()

  // Drag & drop image
  const [imageDragActive, setImageDragActive] = useState(false)
  const [imageDropOverlay, setImageDropOverlay] = useState(false)
  const [imageThumb, setImageThumb] = useState(false)

  // + menu
  const [plusHot, setPlusHot] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [uploadHot, setUploadHot] = useState(false)
  const [fileChip, setFileChip] = useState(false)

  // Skill picker
  const [slashText, setSlashText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFilter, setPickerFilter] = useState('')
  const [skillRowHot, setSkillRowHot] = useState(false)
  const [skillChip, setSkillChip] = useState(false)

  // Model selector
  const [modelHot, setModelHot] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [modelHover, setModelHover] = useState(null)
  const [currentModel, setCurrentModel] = useState('qwen-xx')
  const hasInputChips = imageThumb || fileChip || skillChip

  useTimeline((at) => {
    // --- Drag & drop image ---
    at(200, () => setTarget('__offstage_br'))
    at(500, () => {
      setImageDragActive(true)
      setTarget('textarea')
    })
    at(900, () => setImageDropOverlay(true))
    at(1250, () => {
      setImageDragActive(false)
      setImageDropOverlay(false)
      setImageThumb(true)
    })

    // --- + / Upload ---
    at(1650, () => setTarget('plus-button'))
    at(2050, () => setPlusHot(true))
    at(2200, () => {
      setPlusOpen(true)
      setPlusHot(false)
    })
    at(2400, () => setTarget('upload-row'))
    at(2700, () => setUploadHot(true))
    at(2850, () => {
      setUploadHot(false)
      setPlusOpen(false)
      setFileChip(true)
    })

    // --- Skill picker ---
    at(3150, () => setTarget('textarea'))
    at(3450, () => {
      setSlashText('/')
      setPickerOpen(true)
    })
    at(3600, () => {
      setSlashText('/cod')
      setPickerFilter('cod')
    })
    at(3800, () => {
      setSlashText('/code')
      setPickerFilter('code')
    })
    at(4000, () => setTarget('skill-row'))
    at(4250, () => setSkillRowHot(true))
    at(4400, () => {
      setSkillRowHot(false)
      setPickerOpen(false)
      setSlashText('')
      setPickerFilter('')
      setSkillChip(true)
    })

    // --- Model selector ---
    at(4700, () => setTarget('model-button'))
    at(5000, () => setModelHot(true))
    at(5150, () => {
      setModelHot(false)
      setModelOpen(true)
    })
    at(5350, () => {
      setModelHover('minimax-xx')
      setTarget('minimax-row')
    })
    at(5650, () => {
      setCurrentModel('minimax-xx')
      setModelOpen(false)
      setModelHover(null)
    })
    at(5950, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      {/* ---- Skill picker popup (above textarea) ---- */}
      {pickerOpen && (
        <div
          className="absolute"
          style={{
            left: 14,
            right: 14,
            bottom: 108,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            padding: '0 0 4px 0',
            zIndex: 8,
            overflow: 'hidden',
          }}
        >
          <div
            className="px-3 py-2"
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {t('intro.scenes.power.skillLabel')}
          </div>
          <div
            className="px-3 py-1 uppercase"
            style={{
              fontSize: 9,
              color: 'var(--text-dim)',
              letterSpacing: '0.06em',
              marginTop: 2,
            }}
          >
            {t('intro.scenes.power.projectLabel')}
          </div>
          <SkillRow
            name="code-reviewer"
            desc={t('intro.scenes.power.codeReviewerDesc')}
            visible={'code-reviewer'.includes(pickerFilter)}
            hot={skillRowHot}
            active
            rowRef={register('skill-row')}
          />
          <SkillRow
            name="refactor-to-async"
            desc={t('intro.scenes.power.refactorDesc')}
            visible={'refactor-to-async'.includes(pickerFilter)}
          />
        </div>
      )}

      {/* ---- Model selector dropdown (above model button) ---- */}
      {modelOpen && (
        <div
          className="absolute"
          style={{
            right: 54,
            bottom: 46,
            width: 220,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            padding: '4px 0',
            zIndex: 8,
          }}
        >
          <div
            className="flex items-center"
            style={{
              gap: 6,
              margin: '4px 6px 6px 6px',
              padding: '4px 8px',
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 3,
            }}
          >
            <Search
              size={11}
              strokeWidth={1.5}
              style={{ color: 'var(--text-dim)' }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {t('intro.scenes.power.searchModels')}
            </span>
          </div>
          <ModelRow id="qwen-xx" current={currentModel === 'qwen-xx'} />
          <ModelRow
            id="minimax-xx"
            current={currentModel === 'minimax-xx'}
            hover={modelHover === 'minimax-xx'}
            rowRef={register('minimax-row')}
          />
          <ModelRow id="glm-xx" />
        </div>
      )}

      {/* ---- + menu dropdown (above + button) ---- */}
      {plusOpen && (
        <div
          className="absolute"
          style={{
            left: 10,
            bottom: 46,
            minWidth: 180,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '2px 0',
            zIndex: 8,
          }}
        >
          <div
            ref={register('upload-row')}
            className="flex items-center"
            style={{
              gap: 8,
              padding: '6px 12px',
              background: uploadHot ? 'var(--bg-surface)' : 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 12,
              transition: 'background 150ms ease',
            }}
          >
            <Upload size={12} strokeWidth={1.5} />
            <span>{t('intro.scenes.power.uploadFile')}</span>
          </div>
          <div
            className="flex items-center"
            style={{
              gap: 8,
              padding: '6px 12px',
              color: 'var(--text-dim)',
              fontSize: 12,
            }}
          >
            <Plus size={12} strokeWidth={1.5} />
            <span>{t('intro.scenes.power.addMcp')}</span>
          </div>
        </div>
      )}

      {/* ---- Input container (bottom) ---- */}
      <div
        className="absolute"
        style={{
          left: 10,
          right: 10,
          bottom: 10,
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg-surface)',
          padding: 6,
          minHeight: hasInputChips ? 92 : 58,
          transition: 'min-height 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Drag overlay */}
        {imageDropOverlay && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background: 'var(--bg-overlay)',
              borderRadius: 4,
              zIndex: 9,
              pointerEvents: 'none',
            }}
          >
            <div
              className="flex items-center"
              style={{
                gap: 8,
                color: 'var(--blue)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
              }}
            >
              <Upload size={14} strokeWidth={1.5} />
              <span>{t('intro.scenes.power.dropImages')}</span>
            </div>
          </div>
        )}

        {imageDragActive && (
          <div
            className="absolute flex items-center justify-center"
            style={{
              left: 184,
              top: -18,
              width: 44,
              height: 44,
              background: 'linear-gradient(135deg, var(--cyan), var(--blue))',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              color: 'var(--text-inverse)',
              boxShadow: '0 10px 18px rgba(0, 0, 0, 0.18)',
              opacity: 0.96,
              transform: imageDropOverlay
                ? 'translate(-26px, 18px) rotate(-2deg) scale(0.96)'
                : 'translate(22px, -4px) rotate(8deg)',
              transition:
                'transform 380ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <Image size={16} strokeWidth={1.5} />
          </div>
        )}

        {/* Image thumbnail strip */}
        {imageThumb && (
          <div className="flex items-center" style={{ gap: 8, marginBottom: 6 }}>
            <div
              className="relative flex-shrink-0"
              style={{ width: 56, height: 56 }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'linear-gradient(135deg, var(--cyan), var(--blue))',
                  color: 'var(--text-inverse)',
                }}
              >
                <Image size={18} strokeWidth={1.5} />
              </div>
              <button
                className="absolute flex items-center justify-center"
                style={{
                  top: -5,
                  right: -5,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  padding: 0,
                }}
              >
                <X size={9} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* Chips row */}
        {(fileChip || skillChip) && (
          <div
            className="flex items-center"
            style={{ gap: 6, marginBottom: 4, flexWrap: 'wrap' }}
          >
            {fileChip && (
              <Chip
                icon={FileText}
                color="var(--text-secondary)"
                borderLeft="var(--cyan)"
              >
                requirements.txt
              </Chip>
            )}
            {skillChip && (
              <Chip
                color="var(--text-secondary)"
                borderLeft="var(--purple)"
                mono
              >
                /code-reviewer
              </Chip>
            )}
          </div>
        )}

        {/* Textarea stub */}
        <div
          ref={register('textarea')}
          style={{
            minHeight: 22,
            padding: '2px 4px',
            fontSize: 11,
            color: 'var(--text-primary)',
            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
          }}
        >
          {slashText ? (
            <span>
              {slashText}
              <span
                style={{
                  display: 'inline-block',
                  width: 1,
                  height: '1em',
                  background: 'var(--blue)',
                  marginLeft: 1,
                  verticalAlign: 'text-bottom',
                }}
              />
            </span>
          ) : (
            <span style={{ color: 'var(--text-dim)' }}>{t('intro.scenes.common.askAnything')}</span>
          )}
        </div>

        {/* Toolbar row */}
        <div
          className="flex items-center justify-between"
          style={{ marginTop: 6, gap: 6 }}
        >
          <div className="flex items-center" style={{ gap: 4 }}>
            {/* + button */}
            <button
              ref={register('plus-button')}
              className="flex items-center justify-center"
              style={{
                width: 24,
                height: 22,
                background: plusHot ? 'var(--bg-elevated)' : 'transparent',
                border: plusHot ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 4,
                color: plusHot || plusOpen ? 'var(--text-primary)' : 'var(--text-dim)',
                transition: 'all 150ms ease',
              }}
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
            {/* Permission chip */}
            <div
              className="flex items-center"
              style={{
                gap: 4,
                padding: '2px 6px',
                color: 'var(--green)',
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              <Shield size={11} strokeWidth={1.5} />
              <span>{t('intro.scenes.common.permDefault')}</span>
            </div>
          </div>

          <div className="flex items-center" style={{ gap: 6 }}>
            {/* Model selector button */}
            <button
              ref={register('model-button')}
              className="flex items-center"
              style={{
                gap: 4,
                padding: '2px 6px',
                borderLeft: '2px solid var(--cyan)',
                background: modelHot
                  ? 'var(--bg-surface)'
                  : 'var(--bg-elevated)',
                border: `1px solid ${modelHot ? 'var(--cyan)' : 'var(--border)'}`,
                borderLeftWidth: 2,
                borderLeftColor: 'var(--cyan)',
                borderRadius: 2,
                fontSize: 10,
                color: 'var(--text-secondary)',
                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                transition: 'all 150ms ease',
              }}
            >
              <Cpu
                size={11}
                strokeWidth={1.5}
                style={{ color: 'var(--cyan)' }}
              />
              <span>{currentModel}</span>
              <ChevronDown
                size={10}
                strokeWidth={1.5}
                style={{ color: 'var(--text-dim)' }}
              />
            </button>
            {/* Send */}
            <button
              className="flex items-center justify-center"
              style={{
                width: 26,
                height: 22,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
              }}
            >
              <Send size={12} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {cursorNode}
    </Stage>
  )
}

function Chip({ icon: Icon, color, borderLeft, children, mono }) {
  return (
    <span
      className="flex items-center"
      style={{
        gap: 4,
        padding: '2px 6px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${borderLeft}`,
        borderRadius: 2,
        fontSize: 10,
        color,
        fontFamily: mono ? '"JetBrains Mono", "Source Han Mono SC", monospace' : undefined,
      }}
    >
      {Icon && <Icon size={10} strokeWidth={1.5} />}
      <span>{children}</span>
      <X
        size={9}
        strokeWidth={1.5}
        style={{ color: 'var(--text-dim)', marginLeft: 2 }}
      />
    </span>
  )
}

function SkillRow({ name, desc, visible, hot, active, rowRef }) {
  if (!visible) return null
  return (
    <div
      ref={rowRef}
      className="flex items-center"
      style={{
        gap: 8,
        padding: '6px 12px',
        background: hot
          ? 'var(--bg-elevated)'
          : active
            ? 'var(--bg-elevated)'
            : 'transparent',
        borderLeft: `2px solid ${hot || active ? 'var(--blue)' : 'transparent'}`,
        transition: 'all 150ms ease',
      }}
    >
      <ChevronRight
        size={11}
        strokeWidth={1.5}
        style={{ color: hot || active ? 'var(--blue)' : 'var(--text-dim)' }}
      />
      <div className="flex flex-col flex-1" style={{ gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-primary)',
            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
          {desc}
        </span>
      </div>
    </div>
  )
}

function ModelRow({ id, current, hover, rowRef }) {
  return (
    <div
      ref={rowRef}
      className="flex items-center"
      style={{
        gap: 8,
        padding: '5px 10px',
        background: hover ? 'var(--bg-surface)' : 'transparent',
        color: current ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 11,
        fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
        transition: 'background 150ms ease',
      }}
    >
      <div style={{ width: 11, display: 'flex', alignItems: 'center' }}>
        {current && (
          <Check size={11} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
        )}
      </div>
      <span>{id}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Scene — Plugins / Skills / MCP                                      */
/* ------------------------------------------------------------------ */

function MiniSectionLabel({ children }) {
  return (
    <span
      className="uppercase"
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        color: 'var(--text-dim)',
      }}
    >
      {children}
    </span>
  )
}

function MiniFilterChip({ children, active = false, color = 'var(--text-primary)' }) {
  return (
    <span
      className="px-2 py-1 uppercase"
      style={{
        background: active ? 'var(--bg-elevated)' : 'transparent',
        border: active ? `1px solid ${color}` : '1px solid transparent',
        borderRadius: 4,
        color: active ? color : 'var(--text-dim)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </span>
  )
}

function TinyToggle({ enabled, hot = false, toggleRef }) {
  return (
    <button
      ref={toggleRef}
      className="flex-shrink-0"
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 4,
        border: `1px solid ${enabled || hot ? 'var(--blue)' : 'var(--border-strong)'}`,
        background: enabled ? 'var(--blue)' : 'var(--bg-elevated)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: enabled ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: 2,
          background: enabled ? 'var(--text-inverse)' : hot ? 'var(--text-primary)' : 'var(--text-dim)',
          transition: 'left 150ms ease, background 150ms ease',
        }}
      />
    </button>
  )
}

function TinyField({
  label,
  value,
  placeholder = '',
  showValue = false,
  typing = false,
  mono = false,
  fieldRef,
  width = '100%',
}) {
  return (
    <div className="flex flex-col" style={{ gap: 4, width }}>
      <MiniSectionLabel>{label}</MiniSectionLabel>
      <div
        ref={fieldRef}
        style={{
          minHeight: 30,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: showValue ? 'var(--text-primary)' : 'var(--text-dim)',
          fontSize: 11,
          fontFamily: mono ? '"JetBrains Mono", "Source Han Mono SC", monospace' : undefined,
          overflow: 'hidden',
        }}
      >
        {showValue ? (
          typing ? (
            <Typewriter text={value} active={typing} charDelay={22} />
          ) : (
            <span>{value}</span>
          )
        ) : (
          <span>{placeholder}</span>
        )}
      </div>
    </div>
  )
}

function MiniSidebarItem({
  label,
  desc,
  active = false,
  hot = false,
  rowRef,
  icon: Icon,
  trailing,
}) {
  return (
    <div
      ref={rowRef}
      className="flex items-center"
      style={{
        gap: 8,
        padding: '6px 10px',
        background: hot || active ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: `2px solid ${hot || active ? 'var(--blue)' : 'transparent'}`,
        transition: 'background 150ms ease, border-left-color 150ms ease',
      }}
    >
      {Icon && (
        <Icon
          size={12}
          strokeWidth={1.5}
          style={{ color: active ? 'var(--blue)' : 'var(--text-dim)', flexShrink: 0 }}
        />
      )}
      <div className="flex flex-col flex-1" style={{ gap: 1, minWidth: 0 }}>
        <span
          className="truncate"
          style={{
            fontSize: 11,
            color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: active ? 600 : 400,
          }}
        >
          {label}
        </span>
        {desc && (
          <span className="truncate" style={{ fontSize: 9, color: 'var(--text-dim)' }}>
            {desc}
          </span>
        )}
      </div>
      {trailing}
    </div>
  )
}

export function PluginSetupScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [settingsHot, setSettingsHot] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [cameraPhase, setCameraPhase] = useState('entry')
  const [pluginsHot, setPluginsHot] = useState(false)
  const [pluginsActive, setPluginsActive] = useState(false)
  const [pluginOn, setPluginOn] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(false)
  const [urlTyping, setUrlTyping] = useState(false)
  const [toolTyping, setToolTyping] = useState(false)
  const [headerTyping, setHeaderTyping] = useState(false)
  const [saveHot, setSaveHot] = useState(false)
  const [saved, setSaved] = useState(false)

  const cameraTransform = ({
    entry: 'translate3d(116px, 58px, 0) scale(1.28)',
    overlay: 'translate3d(0, 0, 0) scale(0.97)',
    config: 'translate3d(-42px, -10px, 0) scale(1.05)',
  })[cameraPhase] || 'translate3d(0, 0, 0) scale(0.97)'

  useTimeline((at) => {
    at(180, () => setTarget('__offstage_br'))
    at(520, () => setTarget('plugin-settings-trigger'))
    at(820, () => setSettingsHot(true))
    at(980, () => {
      setSettingsHot(false)
      setOverlayOpen(true)
      setCameraPhase('overlay')
    })
    at(1320, () => setTarget('plugin-tab'))
    at(1640, () => setPluginsHot(true))
    at(1820, () => {
      setPluginsHot(false)
      setPluginsActive(true)
    })
    at(2140, () => setTarget('plugin-toggle'))
    at(2460, () => {
      setPluginOn(true)
      setConfigExpanded(true)
      setCameraPhase('config')
    })
    at(2820, () => setTarget('plugin-url'))
    at(3080, () => setUrlTyping(true))
    at(3560, () => setTarget('plugin-tool'))
    at(3820, () => setToolTyping(true))
    at(4300, () => setTarget('plugin-header-key'))
    at(4560, () => setHeaderTyping(true))
    at(5100, () => setTarget('plugin-save'))
    at(5400, () => setSaveHot(true))
    at(5580, () => {
      setSaveHot(false)
      setSaved(true)
    })
    at(5960, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      <div
        className="absolute inset-0"
        style={{
          transformOrigin: 'center center',
          transform: cameraTransform,
          transition: 'transform 520ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          className="absolute"
          style={{
            left: 0,
            top: 0,
            bottom: 0,
            width: 48,
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="flex flex-col items-center" style={{ gap: 10, paddingTop: 14 }}>
            <Sparkles size={14} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />
            <Puzzle size={14} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
            <Cable size={14} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
          </div>
          <button
            ref={register('plugin-settings-trigger')}
            className="absolute flex items-center"
            style={{
              left: 6,
              right: 6,
              bottom: 8,
              gap: 4,
              padding: '6px 8px',
              background: settingsHot ? 'var(--bg-elevated)' : 'transparent',
              border: `1px solid ${settingsHot ? 'var(--border-strong)' : 'transparent'}`,
              borderRadius: 4,
              color: settingsHot ? 'var(--text-primary)' : 'var(--text-dim)',
              fontSize: 10,
            }}
          >
            <Settings size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div
          className="absolute flex items-center"
          style={{
            left: 48,
            right: 0,
            top: 0,
            height: 28,
            padding: '0 12px',
            gap: 10,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-primary)', fontWeight: 600 }}>
            Vivian
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t('tabs.skills')}</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t('tabs.mcp')}</span>
        </div>

        <div
          className="absolute"
          style={{
            left: 66,
            right: 20,
            top: 48,
            height: 54,
            borderRadius: 6,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
        />
        <div
          className="absolute"
          style={{
            left: 66,
            width: 180,
            top: 118,
            bottom: 18,
            borderRadius: 6,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
        />
        <div
          className="absolute"
          style={{
            left: 260,
            right: 20,
            top: 118,
            bottom: 18,
            borderRadius: 6,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
        />

        <Fade
          show={overlayOpen}
          style={{
            position: 'absolute',
            left: 92,
            right: 24,
            top: 22,
            bottom: 18,
          }}
        >
          <div
            className="flex"
            style={{
              height: '100%',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              boxShadow: '0 14px 36px rgba(15, 23, 42, 0.18)',
              overflow: 'hidden',
            }}
          >
            <div
              className="flex flex-col"
              style={{
                width: 156,
                borderRight: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  padding: '12px 12px 10px',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {t('sidebar.settings')}
              </h3>
              <div
                style={{
                  height: 1,
                  background: 'var(--border-subtle)',
                  marginLeft: 12,
                  marginRight: 12,
                  marginBottom: 6,
                }}
              />
              {[
                { key: 'api', label: t('settings.apiKey'), icon: Key },
                { key: 'models', label: t('settings.llmProvider'), icon: Cpu },
                { key: 'quickactions', label: t('settings.quickActions'), icon: Zap },
                { key: 'channels', label: t('settings.channels'), icon: Radio },
                { key: 'advanced', label: t('settings.advanced'), icon: Settings2 },
                { key: 'runtime', label: t('settings.runtime'), icon: ScrollText },
                { key: 'plugins', label: t('settings.plugins'), icon: Puzzle },
              ].map((tab) => (
                <MiniSidebarItem
                  key={tab.key}
                  rowRef={tab.key === 'plugins' ? register('plugin-tab') : undefined}
                  icon={tab.icon}
                  label={tab.label}
                  active={tab.key === 'plugins' && pluginsActive}
                  hot={tab.key === 'plugins' && pluginsHot}
                />
              ))}
            </div>

            <div className="flex-1 flex flex-col" style={{ padding: 14, gap: 10 }}>
              <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }}>
                {t('settings.plugins')}
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                {t('settings.pluginsDesc')}
              </p>

              <div
                className="flex flex-col"
                style={{
                  gap: 10,
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg-surface)',
                }}
              >
                <div className="flex items-start justify-between" style={{ gap: 12 }}>
                  <div className="flex flex-col flex-1" style={{ gap: 3, minWidth: 0 }}>
                    <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                      {t('intro.scenes.pluginSetup.pluginName')}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.5 }}>
                      {t('intro.scenes.pluginSetup.pluginDescription')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        color: pluginOn ? 'var(--green)' : 'var(--text-dim)',
                      }}
                    >
                      {pluginOn ? t('settings.pluginOn') : t('settings.pluginOff')}
                    </span>
                    <TinyToggle enabled={pluginOn} hot={!pluginOn && configExpanded} toggleRef={register('plugin-toggle')} />
                  </div>
                </div>

                {configExpanded && (
                  <>
                    <div className="flex items-center gap-2">
                      <ChevronDown size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
                      <MiniSectionLabel>{t('settings.pluginConfig')}</MiniSectionLabel>
                      {saved && (
                        <span
                          className="px-2 py-0 uppercase"
                          style={{
                            marginLeft: 'auto',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: 'var(--green)',
                            border: '1px solid var(--green)',
                            borderRadius: 2,
                            lineHeight: '16px',
                          }}
                        >
                          {t('intro.scenes.pluginSetup.saved')}
                        </span>
                      )}
                    </div>

                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <TinyField label={t('settings.pluginProviderType')} value="MCP" showValue />
                      <TinyField label={t('settings.pluginTimeout')} value="10" showValue mono />
                      <TinyField
                        label={t('settings.pluginMcpUrl')}
                        value={t('intro.scenes.pluginSetup.urlValue')}
                        placeholder="https://..."
                        showValue={urlTyping}
                        typing={urlTyping}
                        mono
                        fieldRef={register('plugin-url')}
                      />
                      <TinyField
                        label={t('settings.pluginToolName')}
                        value={t('intro.scenes.pluginSetup.toolValue')}
                        placeholder="search_docs"
                        showValue={toolTyping}
                        typing={toolTyping}
                        mono
                        fieldRef={register('plugin-tool')}
                      />
                    </div>

                    <div className="flex flex-col" style={{ gap: 4 }}>
                      <MiniSectionLabel>{t('settings.pluginHeaders')}</MiniSectionLabel>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <div ref={register('plugin-header-key')} style={{ flex: 1 }}>
                          <div
                            style={{
                              minHeight: 30,
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 10px',
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              color: headerTyping ? 'var(--text-primary)' : 'var(--text-dim)',
                              fontSize: 11,
                              fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                            }}
                          >
                            {headerTyping ? (
                              <Typewriter text={t('intro.scenes.pluginSetup.headerKey')} active={headerTyping} charDelay={24} />
                            ) : (
                              <span>{t('settings.pluginHeaderKey')}</span>
                            )}
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              minHeight: 30,
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0 10px',
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              color: headerTyping ? 'var(--text-primary)' : 'var(--text-dim)',
                              fontSize: 11,
                              fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                            }}
                          >
                            {headerTyping ? (
                              <Typewriter text={t('intro.scenes.pluginSetup.headerValue')} active={headerTyping} charDelay={24} />
                            ) : (
                              <span>{t('settings.pluginHeaderValue')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button
                        ref={register('plugin-save')}
                        className="px-4 py-2"
                        style={{
                          background: saveHot ? 'var(--green)' : 'var(--blue)',
                          color: 'var(--text-inverse)',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {t('settings.save')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </Fade>
      </div>

      {cursorNode}
    </Stage>
  )
}

export function SkillSetupScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [hubOpen, setHubOpen] = useState(false)
  const [hubDetail, setHubDetail] = useState(false)
  const [installHot, setInstallHot] = useState(false)
  const [skillLoaded, setSkillLoaded] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [selectionVisible, setSelectionVisible] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const [sendHot, setSendHot] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState(false)

  const cameraTransform = popupOpen
    ? 'translate3d(-34px, -18px, 0) scale(1.08)'
    : hubOpen
      ? 'translate3d(0, -8px, 0) scale(1.02)'
      : handoffOpen
        ? 'translate3d(-12px, -8px, 0) scale(0.98)'
        : 'translate3d(0, 0, 0) scale(0.97)'

  useTimeline((at) => {
    at(180, () => setTarget('__offstage_br'))
    at(520, () => setTarget('skill-hub-button'))
    at(920, () => setHubOpen(true))
    at(1280, () => setTarget('skill-hub-card'))
    at(1620, () => setHubDetail(true))
    at(1920, () => setTarget('skill-install'))
    at(2220, () => setInstallHot(true))
    at(2420, () => {
      setInstallHot(false)
      setHubOpen(false)
      setHubDetail(false)
      setSkillLoaded(true)
    })
    at(2820, () => setTarget('skill-source-toggle'))
    at(3140, () => {
      setSourceMode(true)
      setSelectionVisible(true)
    })
    at(3480, () => setTarget('skill-optimize-pill'))
    at(3780, () => setPopupOpen(true))
    at(4140, () => setTarget('skill-optimize-send'))
    at(4460, () => setSendHot(true))
    at(4680, () => {
      setSendHot(false)
      setPopupOpen(false)
      setHandoffOpen(true)
    })
    at(5440, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      <div
        className="absolute inset-0"
        style={{
          transformOrigin: 'center center',
          transform: cameraTransform,
          transition: 'transform 520ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          className="absolute left-0 right-0 flex items-center"
          style={{
            top: 0,
            height: 28,
            padding: '0 12px',
            gap: 10,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Vivian</span>
          <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 600 }}>{t('tabs.skills')}</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t('tabs.mcp')}</span>
        </div>

        <aside
          className="absolute flex flex-col"
          style={{
            left: 0,
            top: 28,
            bottom: 0,
            width: 194,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <MiniSectionLabel>{t('tabs.skills')}</MiniSectionLabel>
          </div>

          <div className="px-3 py-2">
            <div
              className="flex items-center"
              style={{
                gap: 6,
                padding: '4px 8px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            >
              <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('skills.search')}</span>
            </div>
          </div>

          <div className="px-3 pb-2 flex items-center" style={{ gap: 6 }}>
            <button
              className="flex items-center gap-1 px-2 py-1"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                fontSize: 11,
              }}
            >
              <Upload size={12} strokeWidth={1.5} />
              <span>{t('skills.upload')}</span>
            </button>
            <button
              ref={register('skill-hub-button')}
              className="flex items-center gap-1 px-2 py-1"
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                fontSize: 11,
              }}
            >
              <Package size={12} strokeWidth={1.5} />
              <span>{t('skillHub.title')}</span>
            </button>
          </div>

          <div className="px-3 pb-2 flex items-center" style={{ gap: 4 }}>
            <MiniFilterChip active>{t('sidebar.all')}</MiniFilterChip>
            <MiniFilterChip>{t('skills.project')}</MiniFilterChip>
            <MiniFilterChip>{t('skills.global')}</MiniFilterChip>
          </div>

          <div className="px-3 pb-1">
            <MiniSectionLabel>{t('skills.project')}</MiniSectionLabel>
          </div>
          {skillLoaded ? (
            <MiniSidebarItem
              label={t('intro.scenes.skillSetup.skillName')}
              desc={t('intro.scenes.skillSetup.fileName')}
              active
              icon={Puzzle}
            />
          ) : (
            <div className="px-3 py-3" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {t('skills.noSkills')}
            </div>
          )}

          <div className="px-3 pt-2 pb-1">
            <MiniSectionLabel>{t('skills.global')}</MiniSectionLabel>
          </div>
          <MiniSidebarItem
            label={t('intro.scenes.skillSetup.helperSkill')}
            desc={t('skills.source')}
            icon={Sparkles}
            trailing={<Check size={11} strokeWidth={1.5} style={{ color: 'var(--green)' }} />}
          />
        </aside>

        <div
          className="absolute flex"
          style={{
            left: 194,
            right: 0,
            top: 28,
            bottom: 0,
          }}
        >
          {skillLoaded ? (
            <>
              <div
                className="flex flex-col"
                style={{
                  width: 132,
                  borderRight: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                }}
              >
                <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <MiniSectionLabel>{t('skills.searchFiles')}</MiniSectionLabel>
                </div>
                <div className="px-2 py-2 flex flex-col" style={{ gap: 4 }}>
                  <MiniSidebarItem label="docs" icon={FileText} />
                  <MiniSidebarItem label={t('intro.scenes.skillSetup.fileName')} active icon={FileText} />
                </div>
              </div>

              <div className="flex-1 flex flex-col" style={{ minWidth: 0, position: 'relative' }}>
                <div
                  className="flex items-center justify-between px-3 py-2"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <span
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                    }}
                  >
                    skills/{t('intro.scenes.skillSetup.skillName')}/{t('intro.scenes.skillSetup.fileName')}
                  </span>
                  <div className="flex items-center" style={{ border: '1px solid var(--border)', borderRadius: 4 }}>
                    <button
                      className="px-2 py-1 text-xs"
                      style={{
                        background: !sourceMode ? 'var(--bg-elevated)' : 'transparent',
                        border: 'none',
                        color: !sourceMode ? 'var(--text-primary)' : 'var(--text-dim)',
                      }}
                    >
                      {t('skills.preview')}
                    </button>
                    <button
                      ref={register('skill-source-toggle')}
                      className="px-2 py-1 text-xs"
                      style={{
                        background: sourceMode ? 'var(--bg-elevated)' : 'transparent',
                        border: 'none',
                        color: sourceMode ? 'var(--text-primary)' : 'var(--text-dim)',
                      }}
                    >
                      {t('skills.source')}
                    </button>
                  </div>
                </div>

                <div className="flex-1" style={{ position: 'relative', padding: 12, overflow: 'hidden' }}>
                  {!sourceMode ? (
                    <div
                      style={{
                        padding: 12,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
                        {t('intro.scenes.skillSetup.sourceLine1')}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
                        {t('intro.scenes.skillSetup.sourceLine2')}
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      {[
                        t('intro.scenes.skillSetup.sourceLine1'),
                        t('intro.scenes.skillSetup.sourceLine2'),
                        t('intro.scenes.skillSetup.sourceLine3'),
                        t('intro.scenes.skillSetup.sourceLine4'),
                      ].map((line, idx) => {
                        const lineNo = idx + 1
                        const selected = selectionVisible && lineNo >= 2 && lineNo <= 3
                        return (
                          <div
                            key={lineNo}
                            className="flex"
                            style={{
                              background: selected ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                              borderTop: lineNo === 1 ? 'none' : '1px solid var(--border-subtle)',
                            }}
                          >
                            <div
                              style={{
                                width: 34,
                                padding: '5px 8px',
                                textAlign: 'right',
                                color: 'var(--text-dim)',
                                fontSize: 10,
                                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                                borderRight: '1px solid var(--border-subtle)',
                              }}
                            >
                              {lineNo}
                            </div>
                            <div
                              style={{
                                flex: 1,
                                padding: '5px 10px',
                                color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontSize: 11,
                                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                              }}
                            >
                              {line}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {selectionVisible && sourceMode && (
                    <button
                      ref={register('skill-optimize-pill')}
                      className="flex items-center gap-1"
                      style={{
                        position: 'absolute',
                        right: 18,
                        top: 110,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        padding: '4px 10px',
                        color: 'var(--text-secondary)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      <Sparkles size={12} strokeWidth={1.5} />
                      {t('optimize.helpToOptimize')}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {t('skills.selectFile')}
            </div>
          )}
        </div>

        <Fade
          show={hubOpen}
          style={{
            position: 'absolute',
            left: 164,
            top: 42,
            width: 420,
          }}
        >
          <div
            className="flex flex-col"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              boxShadow: '0 14px 36px rgba(15, 23, 42, 0.18)',
              overflow: 'hidden',
            }}
          >
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <Package size={14} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
              <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
                {t('skillHub.title')}
              </span>
            </div>

            {!hubDetail ? (
              <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div
                  ref={register('skill-hub-card')}
                  style={{
                    padding: 10,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={12} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />
                    <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
                      {t('intro.scenes.skillSetup.hubSkillName')}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 10, lineHeight: 1.5, marginTop: 6 }}>
                    {t('intro.scenes.skillSetup.hubSkillDesc')}
                  </div>
                </div>
                <div
                  style={{
                    padding: 10,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 4,
                    opacity: 0.65,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      {t('intro.scenes.skillSetup.helperSkill')}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col" style={{ padding: 14, gap: 10 }}>
                <div className="flex items-center justify-between" style={{ gap: 12 }}>
                  <div className="flex flex-col" style={{ gap: 4 }}>
                    <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                      {t('intro.scenes.skillSetup.hubSkillName')}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                      {t('intro.scenes.skillSetup.hubSkillDesc')}
                    </span>
                  </div>
                  <button
                    ref={register('skill-install')}
                    className="flex items-center gap-1 px-3 py-1"
                    style={{
                      background: installHot ? 'var(--green)' : 'var(--blue)',
                      border: 'none',
                      borderRadius: 4,
                      color: 'var(--text-inverse)',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <Download size={12} strokeWidth={1.5} />
                    {t('skillHub.install')}
                  </button>
                </div>

                <div
                  style={{
                    padding: 10,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 4,
                  }}
                >
                  <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginBottom: 6 }}>
                    skills/{t('intro.scenes.skillSetup.skillName')}/{t('intro.scenes.skillSetup.fileName')}
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.5 }}>
                    {t('intro.scenes.skillSetup.sourceLine2')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Fade>

        <Fade
          show={popupOpen}
          style={{
            position: 'absolute',
            right: 24,
            top: 70,
            width: 270,
          }}
        >
          <div
            className="flex flex-col"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              boxShadow: '0 14px 36px rgba(15, 23, 42, 0.18)',
              overflow: 'hidden',
            }}
          >
            <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>
                {t('optimize.title')}
              </span>
            </div>
            <div className="px-3 py-2" style={{ color: 'var(--text-dim)', fontSize: 10, fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace' }}>
              {t('intro.scenes.skillSetup.popupPath')}
            </div>
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  padding: 10,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {t('intro.scenes.skillSetup.sourceLine2')}
              </div>
              <div
                style={{
                  minHeight: 56,
                  padding: 10,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-primary)',
                  fontSize: 11,
                }}
              >
                {t('intro.scenes.skillSetup.commentText')}
              </div>
              <div className="flex justify-end">
                <button
                  ref={register('skill-optimize-send')}
                  className="flex items-center gap-1 px-3 py-1"
                  style={{
                    background: sendHot ? 'var(--green)' : 'var(--blue)',
                    border: 'none',
                    borderRadius: 4,
                    color: 'var(--text-inverse)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t('optimize.send')}
                  <Send size={12} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
        </Fade>

        <Fade
          show={handoffOpen}
          style={{
            position: 'absolute',
            right: 18,
            bottom: 18,
            width: 260,
          }}
        >
          <div
            className="flex flex-col"
            style={{
              gap: 8,
              padding: 12,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderLeft: '2px solid var(--cyan)',
              borderRadius: 4,
            }}
          >
            <div className="flex items-center justify-between" style={{ gap: 8 }}>
              <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>
                {t('intro.scenes.skillSetup.handoffTitle')}
              </span>
              <span
                className="px-2 py-0 uppercase"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  color: 'var(--cyan)',
                  border: '1px solid var(--cyan)',
                  borderRadius: 2,
                  lineHeight: '16px',
                }}
              >
                {t('intro.scenes.permission.planLabel')}
              </span>
            </div>
            <div style={{ color: 'var(--text-primary)', fontSize: 11, fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace' }}>
              {t('intro.scenes.skillSetup.handoffPrompt')}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 10, lineHeight: 1.5 }}>
              {t('intro.scenes.skillSetup.handoffDetail')}
            </div>
          </div>
        </Fade>
      </div>

      {cursorNode}
    </Stage>
  )
}

export function McpSetupScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [cameraPhase, setCameraPhase] = useState('sidebar')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [nameTyping, setNameTyping] = useState(false)
  const [urlTyping, setUrlTyping] = useState(false)
  const [headerTyping, setHeaderTyping] = useState(false)
  const [testHot, setTestHot] = useState(false)
  const [testPassed, setTestPassed] = useState(false)
  const [saveHot, setSaveHot] = useState(false)
  const [serverSaved, setServerSaved] = useState(false)
  const [activeTab, setActiveTab] = useState('tools')
  const [toolSelected, setToolSelected] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugArgTyping, setDebugArgTyping] = useState(false)
  const [debugRunHot, setDebugRunHot] = useState(false)
  const [debugResultVisible, setDebugResultVisible] = useState(false)
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [serverChecked, setServerChecked] = useState(false)

  const cameraTransform = ({
    sidebar: 'translate3d(24px, 4px, 0) scale(1.02)',
    dialog: 'translate3d(0, -4px, 0) scale(0.98)',
    detail: 'translate3d(-14px, -6px, 0) scale(1.01)',
    debug: 'translate3d(-46px, -6px, 0) scale(1.08)',
    chat: 'translate3d(-10px, -12px, 0) scale(1.03)',
  })[cameraPhase] || 'translate3d(0, 0, 0) scale(0.97)'

  useTimeline((at) => {
    at(180, () => setTarget('__offstage_br'))
    at(520, () => setTarget('mcp-add-button'))
    at(820, () => setCameraPhase('dialog'))
    at(900, () => setDialogOpen(true))
    at(1220, () => setTarget('mcp-name'))
    at(1480, () => setNameTyping(true))
    at(1860, () => setTarget('mcp-url'))
    at(2140, () => {
      setUrlTyping(true)
      setHeaderTyping(true)
    })
    at(2640, () => setTarget('mcp-test'))
    at(2920, () => setTestHot(true))
    at(3120, () => {
      setTestHot(false)
      setTestPassed(true)
    })
    at(3520, () => setTarget('mcp-save'))
    at(3820, () => setSaveHot(true))
    at(4000, () => {
      setSaveHot(false)
      setDialogOpen(false)
      setServerSaved(true)
      setActiveTab('tools')
      setToolSelected(false)
      setDebugOpen(false)
      setDebugResultVisible(false)
      setCameraPhase('detail')
    })
    at(4300, () => setTarget('mcp-tool-row'))
    at(4580, () => {
      setToolSelected(true)
      setDebugOpen(true)
      setCameraPhase('debug')
    })
    at(4900, () => setTarget('mcp-debug-arg'))
    at(5160, () => setDebugArgTyping(true))
    at(5480, () => setTarget('mcp-debug-run'))
    at(5760, () => setDebugRunHot(true))
    at(5940, () => {
      setDebugRunHot(false)
      setDebugResultVisible(true)
    })
    at(6280, () => {
      setDebugOpen(false)
      setCameraPhase('detail')
    })
    at(6460, () => setTarget('mcp-resource-tab'))
    at(6720, () => setActiveTab('resources'))
    at(7080, () => setCameraPhase('chat'))
    at(7180, () => setTarget('mcp-chat-plus'))
    at(7480, () => setChatMenuOpen(true))
    at(7740, () => setTarget('mcp-chat-server'))
    at(8020, () => setServerChecked(true))
    at(8340, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      <div
        className="absolute inset-0"
        style={{
          transformOrigin: 'center center',
          transform: cameraTransform,
          transition: 'transform 520ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          className="absolute left-0 right-0 flex items-center"
          style={{
            top: 0,
            height: 28,
            padding: '0 12px',
            gap: 10,
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Vivian</span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t('tabs.skills')}</span>
          <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 600 }}>{t('tabs.mcp')}</span>
        </div>

        <aside
          className="absolute flex flex-col"
          style={{
            left: 0,
            top: 28,
            bottom: 0,
            width: 188,
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}
        >
          <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <MiniSectionLabel>{t('tabs.mcp')}</MiniSectionLabel>
          </div>
          <div className="px-3 py-2 flex items-center" style={{ gap: 6 }}>
            <div
              className="flex items-center flex-1"
              style={{
                gap: 6,
                padding: '4px 8px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            >
              <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('mcp.search')}</span>
            </div>
            <button
              ref={register('mcp-add-button')}
              className="flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              <Plus size={12} strokeWidth={1.5} />
            </button>
          </div>
          <div className="px-3 pb-2 flex items-center" style={{ gap: 4 }}>
            <MiniFilterChip>{t('sidebar.all')}</MiniFilterChip>
            <MiniFilterChip active>{t('mcp.project')}</MiniFilterChip>
            <MiniFilterChip>{t('mcp.global')}</MiniFilterChip>
          </div>
          <div className="px-3 pb-1">
            <MiniSectionLabel>{t('mcp.project')}</MiniSectionLabel>
          </div>
          {serverSaved ? (
            <MiniSidebarItem
              label={t('intro.scenes.mcpSetup.serverName')}
              active
              icon={Cable}
              trailing={(
                <span
                  className="uppercase px-1"
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: 'var(--cyan)',
                    border: '1px solid var(--cyan)',
                    borderRadius: 2,
                    lineHeight: '14px',
                  }}
                >
                  http
                </span>
              )}
            />
          ) : (
            <div className="px-3 py-3" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              {t('mcp.noServers')}
            </div>
          )}
        </aside>

        <div
          className="absolute flex"
          style={{
            left: 188,
            right: 0,
            top: 28,
            bottom: 0,
          }}
        >
          {serverSaved ? (
            <>
              <div
                className="flex flex-col"
                style={{
                  width: 158,
                  borderRight: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                }}
              >
                <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>
                    {t('intro.scenes.mcpSetup.serverName')}
                  </span>
                </div>
                <div className="px-3 py-3 flex flex-col" style={{ gap: 8 }}>
                  <MiniSectionLabel>{t('mcp.type')}</MiniSectionLabel>
                  <span style={{ color: 'var(--text-primary)', fontSize: 11 }}>HTTP</span>
                  <MiniSectionLabel>{t('mcp.url')}</MiniSectionLabel>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 10, fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace' }}>
                    https://docs.internal/mcp
                  </span>
                  <MiniSectionLabel>{t('mcp.timeout')}</MiniSectionLabel>
                  <span style={{ color: 'var(--text-primary)', fontSize: 11 }}>30s</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col" style={{ minWidth: 0, position: 'relative' }}>
                <div className="flex items-center gap-1 px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {[
                    { id: 'tools', label: t('mcp.tools') },
                    { id: 'prompts', label: t('mcp.prompts') },
                    { id: 'resources', label: t('mcp.resources'), ref: register('mcp-resource-tab') },
                  ].map((tab) => {
                    const active = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        ref={tab.ref}
                        className="px-2 py-1 uppercase"
                        style={{
                          background: active ? 'var(--bg-elevated)' : 'transparent',
                          border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                          borderRadius: 4,
                          color: active ? 'var(--text-primary)' : 'var(--text-dim)',
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: '0.06em',
                        }}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>

                <div className="flex-1 p-3" style={{ overflow: 'hidden' }}>
                  {activeTab === 'tools' ? (
                    <div
                      ref={register('mcp-tool-row')}
                      style={{
                        padding: 10,
                        background: toolSelected ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                        borderLeft: `2px solid ${toolSelected ? 'var(--blue)' : 'var(--cyan)'}`,
                        borderRadius: '0 4px 4px 0',
                      }}
                    >
                      <div style={{ color: 'var(--text-primary)', fontSize: 11, fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace' }}>
                        {t('intro.scenes.mcpSetup.toolName')}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 4 }}>
                        {t('intro.scenes.mcpSetup.toolDesc')}
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: 10,
                        background: 'var(--bg-surface)',
                        borderLeft: '2px solid var(--green)',
                        borderRadius: '0 4px 4px 0',
                      }}
                    >
                      <div style={{ color: 'var(--text-primary)', fontSize: 11 }}>
                        {t('intro.scenes.mcpSetup.resourceName')}
                      </div>
                      <div style={{ color: 'var(--text-dim)', fontSize: 10, fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace', marginTop: 3 }}>
                        docs://frontend/button
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 4 }}>
                        {t('intro.scenes.mcpSetup.resourceDesc')}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Fade
                show={debugOpen}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 210,
                }}
              >
                <div
                  className="flex flex-col h-full"
                  style={{
                    background: 'var(--bg-surface)',
                    borderLeft: '1px solid var(--border)',
                    boxShadow: '-10px 0 24px rgba(15, 23, 42, 0.08)',
                  }}
                >
                  <div
                    className="flex items-center justify-between px-3 py-2"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                      <span
                        className="truncate"
                        style={{
                          color: 'var(--text-primary)',
                          fontSize: 11,
                          fontWeight: 600,
                          fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                          minWidth: 0,
                        }}
                      >
                        {t('intro.scenes.mcpSetup.toolName')}
                      </span>
                      <span
                        className="uppercase px-1"
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          color: 'var(--cyan)',
                          border: '1px solid var(--cyan)',
                          borderRadius: 2,
                          lineHeight: '14px',
                        }}
                      >
                        {t('mcp.toolBadge')}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col" style={{ padding: 10, gap: 10, minHeight: 0 }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 10, lineHeight: 1.5 }}>
                      {t('intro.scenes.mcpSetup.toolDesc')}
                    </div>

                    <div className="flex flex-col" style={{ gap: 4 }}>
                      <MiniSectionLabel>{t('mcp.inputSchema')}</MiniSectionLabel>
                      <div
                        style={{
                          padding: '8px 10px',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          color: 'var(--text-secondary)',
                          fontSize: 10,
                          fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                        }}
                      >
                        {'{ query: string }'}
                      </div>
                    </div>

                    <div className="flex flex-col" style={{ gap: 6 }}>
                      <MiniSectionLabel>{t('mcp.testTool')}</MiniSectionLabel>
                      <div className="flex flex-col" style={{ gap: 4 }}>
                        <span
                          style={{
                            color: 'var(--text-secondary)',
                            fontSize: 11,
                            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                          }}
                        >
                          query
                        </span>
                        <div
                          ref={register('mcp-debug-arg')}
                          style={{
                            minHeight: 32,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 10px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            color: debugArgTyping ? 'var(--text-primary)' : 'var(--text-dim)',
                            fontSize: 11,
                            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                          }}
                        >
                          {debugArgTyping ? (
                            <Typewriter text={t('intro.scenes.mcpSetup.debugArgValue')} active={debugArgTyping} charDelay={22} />
                          ) : (
                            <span>{t('mcp.arguments')}</span>
                          )}
                        </div>
                      </div>

                      <button
                        ref={register('mcp-debug-run')}
                        className="flex items-center gap-1 px-3 py-1 self-start"
                        style={{
                          background: debugRunHot ? 'var(--green)' : 'var(--bg-elevated)',
                          border: `1px solid ${debugRunHot ? 'var(--green)' : 'var(--border)'}`,
                          borderRadius: 4,
                          color: debugRunHot ? 'var(--text-inverse)' : 'var(--text-secondary)',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <Play size={11} strokeWidth={1.5} />
                        {t('mcp.runTest')}
                      </button>
                    </div>

                    {debugResultVisible && (
                      <div
                        className="flex flex-col"
                        style={{
                          background: 'var(--bg-elevated)',
                          borderLeft: '2px solid var(--green)',
                          borderRadius: '0 4px 4px 0',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2"
                          style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        >
                          <Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />
                          <span style={{ color: 'var(--green)', fontSize: 11, fontWeight: 700 }}>
                            {t('mcp.toolSuccess')}
                          </span>
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            padding: '10px 12px',
                            color: 'var(--text-secondary)',
                            fontSize: 10,
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                          }}
                        >
                          {t('intro.scenes.mcpSetup.debugResult')}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </Fade>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
              {t('mcp.selectServer')}
            </div>
          )}
        </div>

        <Fade
          show={dialogOpen}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.14)',
          }}
        >
          <div
            className="flex flex-col"
            style={{
              width: 360,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              boxShadow: '0 14px 36px rgba(15, 23, 42, 0.18)',
              overflow: 'hidden',
            }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 700 }}>
                {t('mcp.addServer')}
              </span>
            </div>
            <div className="px-4 py-3 flex flex-col" style={{ gap: 10 }}>
              <TinyField
                label={t('mcp.name')}
                value={t('intro.scenes.mcpSetup.serverName')}
                placeholder="project-docs"
                showValue={nameTyping}
                typing={nameTyping}
                mono
                fieldRef={register('mcp-name')}
              />
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <TinyField label={t('mcp.type')} value="HTTP" showValue />
                <TinyField label={t('mcp.timeout')} value="30" showValue mono />
              </div>
              <TinyField
                label={t('mcp.url')}
                value="https://docs.internal/mcp"
                placeholder="http://localhost:3000/mcp"
                showValue={urlTyping}
                typing={urlTyping}
                mono
                fieldRef={register('mcp-url')}
              />
              <div className="flex flex-col" style={{ gap: 4 }}>
                <MiniSectionLabel>{t('mcp.headers')}</MiniSectionLabel>
                <div className="flex items-center" style={{ gap: 8 }}>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 30,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 10px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: headerTyping ? 'var(--text-primary)' : 'var(--text-dim)',
                      fontSize: 11,
                      fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                    }}
                  >
                    {headerTyping ? <Typewriter text="Authorization" active={headerTyping} charDelay={20} /> : <span>{t('mcp.headerKey')}</span>}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 30,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 10px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      color: headerTyping ? 'var(--text-primary)' : 'var(--text-dim)',
                      fontSize: 11,
                      fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                    }}
                  >
                    {headerTyping ? <Typewriter text="Bearer ***" active={headerTyping} charDelay={20} /> : <span>{t('mcp.headerValue')}</span>}
                  </div>
                </div>
              </div>

              {testPassed && (
                <div
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg-elevated)',
                    borderLeft: '2px solid var(--green)',
                    borderRadius: '0 4px 4px 0',
                    color: 'var(--green)',
                    fontSize: 11,
                  }}
                >
                  {t('intro.scenes.mcpSetup.testSummary')}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {!testPassed ? (
                <button
                  ref={register('mcp-test')}
                  className="px-3 py-1"
                  style={{
                    background: testHot ? 'var(--bg-surface)' : 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {t('mcp.test')}
                </button>
              ) : (
                <button
                  ref={register('mcp-save')}
                  className="px-3 py-1"
                  style={{
                    background: saveHot ? 'var(--green)' : 'var(--blue)',
                    border: 'none',
                    borderRadius: 4,
                    color: 'var(--text-inverse)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t('mcp.addServerButton')}
                </button>
              )}
            </div>
          </div>
        </Fade>

        {serverSaved && (
          <div
            className="absolute"
            style={{
              left: 224,
              right: 16,
              bottom: 12,
              height: 52,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 8,
            }}
          >
            <div className="flex items-center justify-between" style={{ gap: 8, height: '100%' }}>
              <div className="flex items-center" style={{ gap: 6 }}>
                <button
                  ref={register('mcp-chat-plus')}
                  className="flex items-center justify-center"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 4,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} strokeWidth={1.5} />
                </button>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  {t('intro.scenes.common.askAnything')}
                </span>
              </div>
              <div className="flex items-center" style={{ gap: 6 }}>
                <div
                  className="flex items-center"
                  style={{
                    gap: 4,
                    padding: '2px 6px',
                    color: 'var(--green)',
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  <Shield size={11} strokeWidth={1.5} />
                  <span>{t('intro.scenes.common.permDefault')}</span>
                </div>
                <button
                  className="flex items-center justify-center"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 4,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Send size={13} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <Fade
              show={chatMenuOpen}
              style={{
                position: 'absolute',
                left: 8,
                bottom: 56,
              }}
            >
              <div className="flex" style={{ gap: 4, alignItems: 'flex-end' }}>
                <div
                  style={{
                    width: 120,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    className="flex items-center gap-2 px-3 py-2"
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <Cable size={12} strokeWidth={1.5} style={{ color: 'var(--cyan)' }} />
                    <span>MCP</span>
                    <ChevronRight size={11} strokeWidth={1.5} style={{ marginLeft: 'auto', color: 'var(--text-dim)' }} />
                  </div>
                </div>

                <div
                  style={{
                    width: 186,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div className="flex items-center gap-1 px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <MiniFilterChip active color="var(--green)">{t('mcp.policyAuto')}</MiniFilterChip>
                    <span style={{ marginLeft: 'auto', color: 'var(--cyan)', fontSize: 9, fontWeight: 700 }}>
                      1/1
                    </span>
                  </div>
                  <button
                    ref={register('mcp-chat-server')}
                    className="flex items-center gap-2 w-full px-3 py-2"
                    style={{
                      background: serverChecked ? 'var(--bg-surface)' : 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontSize: 11,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 2,
                        border: `1px solid ${serverChecked ? 'var(--cyan)' : 'var(--border)'}`,
                        background: serverChecked ? 'var(--cyan)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {serverChecked && <span style={{ color: 'var(--text-inverse)', fontSize: 9 }}>&#10003;</span>}
                    </span>
                    <span className="flex-1 truncate">{t('intro.scenes.mcpSetup.serverName')}</span>
                    <span
                      className="uppercase"
                      style={{
                        fontSize: 9,
                        color: 'var(--cyan)',
                        letterSpacing: '0.06em',
                      }}
                    >
                      http
                    </span>
                  </button>
                  <div className="px-3 pb-2" style={{ color: 'var(--text-dim)', fontSize: 9 }}>
                    {t('intro.scenes.mcpSetup.chatHint')}
                  </div>
                </div>
              </div>
            </Fade>
          </div>
        )}
      </div>

      {cursorNode}
    </Stage>
  )
}

/* ------------------------------------------------------------------ */
/* Scene — Permission mode                                             */
/* ------------------------------------------------------------------ */

function PermissionModeOption({
  optionRef,
  label,
  desc,
  color,
  active = false,
  hot = false,
}) {
  return (
    <button
      ref={optionRef}
      className="flex flex-col items-start w-full"
      style={{
        gap: 2,
        padding: '6px 10px',
        background: hot || active ? 'var(--bg-surface)' : 'transparent',
        border: 'none',
        borderLeft: `2px solid ${active ? color : hot ? 'var(--border-strong)' : 'transparent'}`,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 150ms ease, border-left-color 150ms ease',
      }}
    >
      <span
        style={{
          color: active ? color : 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: active ? 700 : 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: 'var(--text-dim)',
          fontSize: 9,
          lineHeight: 1.35,
        }}
      >
        {desc}
      </span>
    </button>
  )
}

export function PermissionModeScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [chipHot, setChipHot] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuHover, setMenuHover] = useState(null)
  const [selectedMode, setSelectedMode] = useState('default')
  const [sendHot, setSendHot] = useState(false)
  const [planRequested, setPlanRequested] = useState(false)

  const MODES = [
    {
      id: 'bypassPermissions',
      label: t('intro.scenes.permission.bypassLabel'),
      desc: t('intro.scenes.permission.bypassDesc'),
      color: 'var(--yellow)',
    },
    {
      id: 'default',
      label: t('intro.scenes.permission.defaultLabel'),
      desc: t('intro.scenes.permission.defaultDesc'),
      color: 'var(--green)',
    },
    {
      id: 'acceptEdits',
      label: t('intro.scenes.permission.acceptEditsLabel'),
      desc: t('intro.scenes.permission.acceptEditsDesc'),
      color: 'var(--purple)',
    },
    {
      id: 'plan',
      label: t('intro.scenes.permission.planLabel'),
      desc: t('intro.scenes.permission.planDesc'),
      color: 'var(--cyan)',
    },
  ]

  const currentMode = MODES.find((mode) => mode.id === selectedMode) || MODES[1]

  useTimeline((at) => {
    at(180, () => setTarget('__offstage_br'))
    at(620, () => setTarget('permission-mode-chip'))
    at(980, () => setChipHot(true))
    at(1160, () => {
      setChipHot(false)
      setMenuOpen(true)
    })
    at(1460, () => setTarget('permission-mode-plan'))
    at(1780, () => setMenuHover('plan'))
    at(2020, () => {
      setMenuHover(null)
      setSelectedMode('plan')
      setMenuOpen(false)
    })
    at(2380, () => setTarget('permission-mode-send'))
    at(2720, () => setSendHot(true))
    at(2920, () => {
      setSendHot(false)
      setPlanRequested(true)
    })
    at(3340, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      <div
        className="absolute left-0 right-0 flex flex-col"
        style={{
          top: 10,
          bottom: 82,
          left: 12,
          right: 12,
          gap: 10,
        }}
      >
        <div
          className="flex items-start"
          style={{
            gap: 10,
            padding: '8px 10px',
            borderRadius: 4,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Avatar />
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
            <div className="flex items-center" style={{ gap: 6 }}>
              <RoleChip color="var(--purple)">{t('intro.scenes.common.vivianRole')}</RoleChip>
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
              }}
            >
              {t('intro.scenes.permission.tipPre')}<strong>{t('intro.scenes.permission.tipPlanWord')}</strong>{t('intro.scenes.permission.tipPost')}
            </div>
          </div>
        </div>

        <Fade show={planRequested} style={{ position: 'relative' }}>
          <div
            className="flex items-center"
            style={{
              gap: 8,
              padding: '8px 10px',
              borderRadius: 4,
              borderLeft: '2px solid var(--cyan)',
              background: 'var(--bg-surface)',
            }}
          >
            <ClipboardList
              size={14}
              strokeWidth={1.5}
              style={{ color: 'var(--cyan)' }}
            />
            <div className="flex flex-col" style={{ gap: 1 }}>
              <span
                className="uppercase"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  color: 'var(--cyan)',
                }}
              >
                {t('intro.scenes.permission.planReview')}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                {t('intro.scenes.permission.planReviewDesc')}
              </span>
            </div>
          </div>
        </Fade>

        <div
          className="flex-1"
          style={{
            borderRadius: 4,
            border: '1px dashed var(--border)',
            background: 'linear-gradient(180deg, var(--bg-base), var(--bg-surface))',
          }}
        />
      </div>

      <div
        className="absolute left-0 right-0"
        style={{
          bottom: 8,
          left: 10,
          right: 10,
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg-surface)',
          padding: 6,
        }}
      >
        <div
          style={{
            minHeight: 24,
            padding: '3px 4px',
            fontSize: 11,
            color: 'var(--text-primary)',
            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
            lineHeight: 1.6,
          }}
        >
          {t('intro.scenes.permission.userPrompt')}
        </div>

        <div
          className="flex items-center justify-between"
          style={{ marginTop: 4, gap: 6 }}
        >
          <div className="relative">
            <button
              ref={register('permission-mode-chip')}
              className="flex items-center gap-1 px-2"
              style={{
                height: 24,
                background: chipHot || menuOpen ? 'var(--bg-elevated)' : 'transparent',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                color: currentMode.color,
                fontSize: 10,
                fontWeight: 700,
                transition: 'background 150ms ease, color 150ms ease',
              }}
            >
              <Shield size={11} strokeWidth={1.8} />
              <span>{currentMode.label}</span>
            </button>

            {menuOpen && (
              <div
                className="absolute"
                style={{
                  left: 0,
                  bottom: '100%',
                  marginBottom: 4,
                  width: 210,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)',
                  zIndex: 4,
                }}
              >
                {MODES.map((mode) => (
                  <PermissionModeOption
                    key={mode.id}
                    optionRef={mode.id === 'plan' ? register('permission-mode-plan') : undefined}
                    label={mode.label}
                    desc={mode.desc}
                    color={mode.color}
                    active={selectedMode === mode.id}
                    hot={menuHover === mode.id}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center" style={{ gap: 6 }}>
            <div
              className="flex items-center"
              style={{
                gap: 4,
                padding: '2px 6px',
                borderLeft: '2px solid var(--cyan)',
                background: 'var(--bg-elevated)',
                borderRadius: 2,
                fontSize: 10,
                color: 'var(--text-secondary)',
                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
              }}
            >
              <Cpu
                size={11}
                strokeWidth={1.5}
                style={{ color: 'var(--cyan)' }}
              />
              <span>cutom-model-name</span>
            </div>
            <button
              ref={register('permission-mode-send')}
              className="flex items-center justify-center"
              style={{
                width: 26,
                height: 22,
                background: sendHot ? 'var(--blue)' : 'var(--bg-elevated)',
                border: `1px solid ${sendHot ? 'var(--blue)' : 'var(--border)'}`,
                borderRadius: 4,
                color: sendHot ? 'var(--text-inverse)' : 'var(--text-secondary)',
                transition:
                  'background 150ms ease, color 150ms ease, border-color 150ms ease',
              }}
            >
              <Send size={12} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {cursorNode}
    </Stage>
  )
}

/* ------------------------------------------------------------------ */
/* Scene — Interactive feedback                                        */
/* ------------------------------------------------------------------ */

function AskUserOption({
  optionRef,
  label,
  desc,
  selected = false,
  hot = false,
  multi = false,
}) {
  return (
    <button
      ref={optionRef}
      className="flex items-start gap-3 w-full text-left"
      style={{
        background: hot ? 'var(--bg-elevated)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '5px 8px',
        borderRadius: 2,
        transition: 'background 150ms ease',
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 16,
          height: 16,
          marginTop: 1,
          borderRadius: multi ? 2 : '50%',
          border: selected
            ? '2px solid var(--blue)'
            : '2px solid var(--border-strong)',
          background: selected ? 'var(--blue)' : 'transparent',
        }}
      >
        {selected && (
          <Check
            size={10}
            strokeWidth={3}
            style={{ color: 'var(--text-inverse)' }}
          />
        )}
      </div>
      <div className="min-w-0">
        <div
          style={{
            color: 'var(--text-primary)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 9,
            lineHeight: 1.4,
            marginTop: 1,
          }}
        >
          {desc}
        </div>
      </div>
    </button>
  )
}

export function FeedbackScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [showAssistantMessage, setShowAssistantMessage] = useState(false)
  const [showQuestionCard, setShowQuestionCard] = useState(false)
  const [hotOption, setHotOption] = useState(null)
  const [selectedOptions, setSelectedOptions] = useState([])
  const [customOpen, setCustomOpen] = useState(false)
  const [customToggleHot, setCustomToggleHot] = useState(false)
  const [feedbackTyping, setFeedbackTyping] = useState(false)
  const [confirmHot, setConfirmHot] = useState(false)
  const [showUserPrompt, setShowUserPrompt] = useState(false)

  const customText = t('intro.scenes.feedback.customText')
  const answerText = t('intro.scenes.feedback.answerText')

  const cameraTransform = showUserPrompt
    ? 'translate3d(0, -18px, 0) scale(0.95)'
    : showQuestionCard
      ? 'translate3d(0, -56px, 0) scale(0.92)'
      : showAssistantMessage
        ? 'translate3d(0, 8px, 0) scale(1.01)'
        : 'translate3d(0, 0, 0) scale(1)'

  useTimeline((at) => {
    at(180, () => setTarget('__offstage_br'))
    at(260, () => setShowAssistantMessage(true))
    at(620, () => setShowQuestionCard(true))
    at(860, () => setTarget('ask-user-option-0'))
    at(900, () => setHotOption(0))
    at(980, () => {
      setHotOption(null)
      setSelectedOptions([0])
    })
    at(1320, () => setTarget('ask-user-option-2'))
    at(1620, () => setHotOption(2))
    at(1720, () => {
      setHotOption(null)
      setSelectedOptions([0, 2])
    })
    at(2080, () => setTarget('ask-user-custom-toggle'))
    at(2380, () => setCustomToggleHot(true))
    at(2520, () => {
      setCustomToggleHot(false)
      setCustomOpen(true)
    })
    at(2840, () => setTarget('ask-user-custom-input'))
    at(3140, () => setFeedbackTyping(true))
    at(5200, () => setTarget('ask-user-confirm'))
    at(5540, () => setConfirmHot(true))
    at(5760, () => {
      setConfirmHot(false)
      setShowQuestionCard(false)
      setShowUserPrompt(true)
    })
    at(6280, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      <div
        className="absolute inset-0"
        style={{
          transformOrigin: 'top center',
          transform: cameraTransform,
          transition: 'transform 520ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <Fade
          show={showAssistantMessage}
          style={{ position: 'absolute', top: 18, left: 18, right: 18 }}
        >
          <div
            className="flex items-start"
            style={{
              gap: 10,
              padding: '8px 10px',
              borderRadius: 4,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Avatar />
            <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 4 }}>
              <div className="flex items-center" style={{ gap: 6 }}>
                <RoleChip color="var(--purple)">{t('intro.scenes.common.vivianRole')}</RoleChip>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.55,
                }}
              >
                {t('intro.scenes.feedback.clarificationMsg')}
              </div>
            </div>
          </div>
        </Fade>

        <Fade
          show={showUserPrompt}
          style={{ position: 'absolute', top: 92, left: 18, right: 18 }}
        >
          <div className="flex items-start justify-end" style={{ gap: 10 }}>
            <div
              className="flex flex-col"
              style={{
                maxWidth: 430,
                gap: 6,
                padding: 10,
                border: '1px solid var(--border)',
                borderLeft: '2px solid var(--blue)',
                borderRadius: 4,
                background: 'var(--bg-surface)',
              }}
            >
              <div className="flex items-center justify-end" style={{ gap: 6 }}>
                <RoleChip color="var(--blue)">{t('intro.scenes.feedback.youRole')}</RoleChip>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {answerText}
              </div>
            </div>

            <Avatar user />
          </div>
        </Fade>

        <Fade
          show={showQuestionCard}
          style={{ position: 'absolute', top: 74, left: 18, right: 18 }}
        >
          <div
            className="flex flex-col"
            style={{
              width: '100%',
              maxWidth: 560,
              gap: 6,
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg-surface)',
              margin: '0 auto',
              boxShadow: '0 14px 30px rgba(15, 23, 42, 0.10)',
            }}
          >
            <div className="flex items-center gap-2">
              <HelpCircle
                size={16}
                strokeWidth={1.5}
                style={{ color: 'var(--blue)', flexShrink: 0 }}
              />
              <span
                style={{
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {t('intro.scenes.feedback.needsFeedback')}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0 text-xs uppercase"
                style={{
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                  borderRadius: 2,
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  fontSize: 11,
                }}
              >
                {t('intro.scenes.feedback.goalsLabel')}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                {t('intro.scenes.feedback.multiSelect')}
              </span>
            </div>

            <div style={{ color: 'var(--text-primary)', fontSize: 11 }}>
              {t('intro.scenes.feedback.goalsQuestion')}
            </div>

            <div className="flex flex-col" style={{ gap: 4 }}>
              <AskUserOption
                optionRef={register('ask-user-option-0')}
                label={t('intro.scenes.feedback.option1Title')}
                desc={t('intro.scenes.feedback.option1Desc')}
                selected={selectedOptions.includes(0)}
                hot={hotOption === 0}
                multi
              />
              <AskUserOption
                label={t('intro.scenes.feedback.option2Title')}
                desc={t('intro.scenes.feedback.option2Desc')}
                selected={selectedOptions.includes(1)}
                hot={hotOption === 1}
                multi
              />
              <AskUserOption
                optionRef={register('ask-user-option-2')}
                label={t('intro.scenes.feedback.option3Title')}
                desc={t('intro.scenes.feedback.option3Desc')}
                selected={selectedOptions.includes(2)}
                hot={hotOption === 2}
                multi
              />
            </div>

            {!customOpen ? (
              <button
                ref={register('ask-user-custom-toggle')}
                className="flex items-center gap-1 text-xs"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: customToggleHot ? 'var(--text-primary)' : 'var(--blue)',
                  padding: '4px 0',
                  transition: 'color 150ms ease',
                  alignSelf: 'flex-start',
                }}
              >
                <Plus size={12} strokeWidth={1.5} />
                {t('intro.scenes.feedback.typeCustom')}
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  className="flex items-center justify-between"
                  style={{ gap: 8 }}
                >
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                    {t('intro.scenes.feedback.customAnswer')}
                  </span>
                  <div className="flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
                    <X size={12} strokeWidth={1.5} />
                    <span style={{ fontSize: 10 }}>{t('intro.scenes.feedback.cancel')}</span>
                  </div>
                </div>
                <div
                  ref={register('ask-user-custom-input')}
                  style={{
                    minHeight: 48,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    fontFamily: "'Noto Sans', sans-serif",
                    padding: '8px 10px',
                    lineHeight: 1.5,
                  }}
                >
                  {feedbackTyping ? (
                    <Typewriter text={customText} active={feedbackTyping} charDelay={26} />
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>{t('intro.scenes.feedback.typePlaceholder')}</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end" style={{ marginTop: 4 }}>
              <button
                ref={register('ask-user-confirm')}
                className="flex items-center gap-1 px-3 py-1 text-xs font-semibold"
                style={{
                  background: confirmHot ? 'var(--blue)' : 'var(--bg-elevated)',
                  color: confirmHot ? 'var(--text-inverse)' : 'var(--text-dim)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'background 150ms ease, color 150ms ease',
                }}
              >
                <ChevronRight size={14} strokeWidth={1.5} />
                {t('intro.scenes.feedback.sendAnswer')}
              </button>
            </div>

            <div
              className="flex items-center"
              style={{
                marginTop: 2,
                marginLeft: -12,
                marginRight: -12,
                marginBottom: -12,
                padding: '6px 12px',
                borderTop: '1px solid var(--border)',
              }}
            >
              <button
                className="flex items-center gap-1 text-xs"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-dim)',
                  padding: '2px 0',
                }}
              >
                <MessageSquare size={14} strokeWidth={1.5} />
                <span>{t('intro.scenes.feedback.skip')}</span>
              </button>
            </div>
          </div>
        </Fade>
      </div>

      {cursorNode}
    </Stage>
  )
}

function IntroSceneCard({ children, style }) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 10,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function IntroTraceRow({
  icon: Icon,
  label,
  desc,
  color = 'var(--cyan)',
  dim = false,
  rowRef,
  trailing,
}) {
  return (
    <div
      ref={rowRef}
      className="flex items-start"
      style={{
        gap: 8,
        padding: '8px 10px',
        border: '1px solid var(--border-subtle)',
        borderLeft: `2px solid ${color}`,
        borderRadius: 4,
        background: 'var(--bg-base)',
        opacity: dim ? 0.56 : 1,
        transition: 'opacity 180ms ease, background 180ms ease',
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          background: 'var(--bg-elevated)',
          color,
        }}
      >
        <Icon size={13} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div
          style={{
            color: 'var(--text-primary)',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {label}
        </div>
        {desc && (
          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: 10,
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            {desc}
          </div>
        )}
      </div>
      {trailing && (
        <div className="flex-shrink-0">
          {trailing}
        </div>
      )}
    </div>
  )
}

function IntroActionButton({
  icon: Icon,
  label,
  color = 'var(--blue)',
  active = false,
  buttonRef,
}) {
  return (
    <button
      ref={buttonRef}
      className="flex items-center gap-1 px-2 py-1"
      style={{
        background: active ? 'var(--bg-surface)' : 'transparent',
        border: active ? `1px solid ${color}` : '1px solid var(--border)',
        borderRadius: 4,
        color: active ? color : 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        transition: 'border-color 180ms ease, color 180ms ease, background 180ms ease',
      }}
    >
      <Icon size={11} strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  )
}

function IntroChoiceRow({
  label,
  desc,
  selected = false,
  hot = false,
  optionRef,
}) {
  return (
    <button
      ref={optionRef}
      className="flex items-start gap-3 w-full text-left"
      style={{
        background: hot ? 'var(--bg-elevated)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '6px 8px',
        borderRadius: 4,
        transition: 'background 180ms ease',
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 16,
          height: 16,
          marginTop: 1,
          borderRadius: '50%',
          border: selected
            ? '2px solid var(--blue)'
            : '2px solid var(--border-strong)',
          background: selected ? 'var(--blue)' : 'transparent',
          transition: 'all 180ms ease',
        }}
      >
        {selected && (
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--text-inverse)',
            }}
          />
        )}
      </div>
      <div className="min-w-0">
        <div
          style={{
            color: 'var(--text-primary)',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 10,
            lineHeight: 1.5,
            marginTop: 1,
          }}
        >
          {desc}
        </div>
      </div>
    </button>
  )
}

function IntroCanvasTab({ label, active = false }) {
  return (
    <span
      className="uppercase"
      style={{
        padding: '0 0 6px',
        borderBottom: active ? '2px solid var(--blue)' : '2px solid transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-dim)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        transition: 'border-color 180ms ease, color 180ms ease',
      }}
    >
      {label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Scene — Execution-oriented chat walkthroughs                        */
/* ------------------------------------------------------------------ */

export function StructuredExecutionScene() {
  const { t } = useTranslation()
  const [showUser, setShowUser] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
  const [showRead, setShowRead] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const [showSubagent, setShowSubagent] = useState(false)
  const [showTodo, setShowTodo] = useState(false)
  const [showFinal, setShowFinal] = useState(false)

  useTimeline((at) => {
    at(180, () => setShowUser(true))
    at(1400, () => setShowAssistant(true))
    at(2800, () => setShowThinking(true))
    at(4300, () => setShowRead(true))
    at(5800, () => setShowPlan(true))
    at(7300, () => setShowSubagent(true))
    at(8800, () => setShowTodo(true))
    at(10300, () => setShowFinal(true))
  })

  return (
    <Stage>
      <Fade
        show={showUser}
        style={{ position: 'absolute', top: 18, left: 18, right: 18 }}
      >
        <div className="flex items-start justify-end" style={{ gap: 10 }}>
          <div
            style={{
              maxWidth: 420,
              padding: 10,
              border: '1px solid var(--border)',
              borderLeft: '2px solid var(--blue)',
              borderRadius: 4,
              background: 'var(--bg-surface)',
            }}
          >
            <div className="flex items-center justify-end" style={{ gap: 6 }}>
              <RoleChip color="var(--blue)">{t('intro.scenes.common.youRole')}</RoleChip>
            </div>
            <div
              style={{
                color: 'var(--text-primary)',
                fontSize: 11,
                lineHeight: 1.5,
                marginTop: 4,
              }}
            >
              {t('intro.scenes.structuredExecution.userPrompt')}
            </div>
          </div>
          <Avatar user />
        </div>
      </Fade>

      <Fade
        show={showAssistant}
        style={{ position: 'absolute', top: 82, left: 18, right: 18 }}
      >
        <IntroSceneCard style={{ display: 'flex', gap: 10, padding: 12 }}>
          <Avatar />
          <div className="flex-1 min-w-0">
            <div className="flex items-center" style={{ gap: 6 }}>
              <RoleChip color="var(--purple)">{t('intro.scenes.common.vivianRole')}</RoleChip>
              <span
                className="uppercase"
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  color: 'var(--cyan)',
                  border: '1px solid var(--cyan)',
                  borderRadius: 3,
                  padding: '0 5px',
                  lineHeight: '16px',
                }}
              >
                TRACE
              </span>
            </div>

            <div
              style={{
                color: 'var(--text-primary)',
                fontSize: 11,
                lineHeight: 1.55,
                marginTop: 6,
                minHeight: 34,
              }}
            >
              <Typewriter
                text={t('intro.scenes.structuredExecution.assistantLead')}
                active={showAssistant}
                charDelay={30}
              />
            </div>

            <div className="flex flex-col" style={{ gap: 8, marginTop: 10 }}>
              <Fade show={showThinking}>
                <div
                  className="flex items-center gap-1 px-2 rounded-sm"
                  style={{
                    width: 'fit-content',
                    fontSize: 10,
                    color: 'var(--purple)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    height: 22,
                  }}
                >
                  <Loader size={10} strokeWidth={1.5} className="icon-running" />
                  <span>{t('intro.scenes.structuredExecution.thinkingLine')}</span>
                </div>
              </Fade>

              <Fade show={showRead}>
                <IntroTraceRow
                  icon={FileText}
                  label={t('intro.scenes.structuredExecution.readLabel')}
                  desc={t('intro.scenes.structuredExecution.readDesc')}
                  color="var(--cyan)"
                  trailing={<Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />}
                />
              </Fade>

              <Fade show={showPlan}>
                <IntroTraceRow
                  icon={MessageSquare}
                  label={t('intro.scenes.structuredExecution.planLabel')}
                  desc={t('intro.scenes.structuredExecution.planDesc')}
                  color="var(--purple)"
                  trailing={<Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />}
                />
              </Fade>

              <Fade show={showSubagent}>
                <div
                  style={{
                    padding: 10,
                    border: '1px solid var(--border-subtle)',
                    borderLeft: '2px solid var(--purple)',
                    borderRadius: 4,
                    background: 'var(--bg-base)',
                  }}
                >
                  <div className="flex items-start" style={{ gap: 8 }}>
                    <div
                      className="flex items-center justify-center flex-shrink-0"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        background: 'var(--bg-elevated)',
                        color: 'var(--purple)',
                      }}
                    >
                      <Bot size={13} strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ color: 'var(--text-primary)', fontSize: 11, fontWeight: 600 }}>
                        {t('intro.scenes.structuredExecution.subagentLabel')}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 10, lineHeight: 1.5, marginTop: 2 }}>
                        {t('intro.scenes.structuredExecution.subagentDesc')}
                      </div>
                      <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '1px dashed var(--border-strong)' }}>
                        <IntroTraceRow
                          icon={Check}
                          label={t('intro.scenes.structuredExecution.subagentToolLabel')}
                          desc={t('intro.scenes.structuredExecution.subagentToolDesc')}
                          color="var(--green)"
                          trailing={<Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Fade>

              <Fade show={showTodo}>
                <IntroTraceRow
                  icon={ClipboardList}
                  label={t('intro.scenes.structuredExecution.todoLabel')}
                  desc={t('intro.scenes.structuredExecution.todoDesc')}
                  color="var(--yellow)"
                  trailing={<Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />}
                />
              </Fade>
            </div>
          </div>
        </IntroSceneCard>
      </Fade>

      <Fade
        show={showFinal}
        style={{ position: 'absolute', bottom: 18, left: 18, right: 18 }}
      >
        <div
          className="flex items-center gap-2"
          style={{
            padding: '8px 10px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderLeft: '2px solid var(--green)',
            borderRadius: 4,
          }}
        >
          <Check size={14} strokeWidth={1.5} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.5 }}>
            {t('intro.scenes.structuredExecution.finalNote')}
          </span>
        </div>
      </Fade>
    </Stage>
  )
}

export function InteractiveRunningScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [showUser, setShowUser] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [showWrongPath, setShowWrongPath] = useState(false)
  const [showQuestion, setShowQuestion] = useState(false)
  const [optionHot, setOptionHot] = useState(false)
  const [selectedOption, setSelectedOption] = useState(false)
  const [confirmHot, setConfirmHot] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const [showCorrected, setShowCorrected] = useState(false)
  const [showContinue, setShowContinue] = useState(false)

  useTimeline((at) => {
    at(180, () => setShowUser(true))
    at(1200, () => setShowRun(true))
    at(2800, () => setShowWrongPath(true))
    at(4300, () => setShowQuestion(true))
    at(5000, () => setTarget('interactive-option'))
    at(5500, () => setOptionHot(true))
    at(5700, () => {
      setOptionHot(false)
      setSelectedOption(true)
    })
    at(6500, () => setTarget('interactive-confirm'))
    at(7000, () => setConfirmHot(true))
    at(7220, () => {
      setConfirmHot(false)
      setShowReply(true)
    })
    at(8100, () => setShowCorrected(true))
    at(9600, () => setShowContinue(true))
    at(10800, () => setTarget(null))
  })

  return (
    <Stage ref={stageRef}>
      <Fade
        show={showUser}
        style={{ position: 'absolute', top: 18, left: 18, right: 18 }}
      >
        <div className="flex items-start justify-end" style={{ gap: 10 }}>
          <div
            style={{
              maxWidth: 430,
              padding: 10,
              border: '1px solid var(--border)',
              borderLeft: '2px solid var(--blue)',
              borderRadius: 4,
              background: 'var(--bg-surface)',
            }}
          >
            <div className="flex items-center justify-end" style={{ gap: 6 }}>
              <RoleChip color="var(--blue)">{t('intro.scenes.common.youRole')}</RoleChip>
            </div>
            <div style={{ color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
              {t('intro.scenes.interactiveRunning.userPrompt')}
            </div>
          </div>
          <Avatar user />
        </div>
      </Fade>

      <Fade
        show={showRun}
        style={{ position: 'absolute', top: 82, left: 18, right: 18 }}
      >
        <IntroSceneCard style={{ display: 'flex', gap: 10, padding: 12 }}>
          <Avatar />
          <div className="flex-1 min-w-0">
            <div className="flex items-center" style={{ gap: 6 }}>
              <RoleChip color="var(--purple)">{t('intro.scenes.common.vivianRole')}</RoleChip>
              <span
                className="flex items-center gap-1"
                style={{
                  padding: '1px 6px',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 9,
                  color: 'var(--purple)',
                }}
              >
                <Loader size={10} strokeWidth={1.5} className="icon-running" />
                {t('intro.scenes.interactiveRunning.runningLabel')}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <IntroTraceRow
                icon={MessageSquare}
                label={t('intro.scenes.interactiveRunning.runningStepLabel')}
                desc={t('intro.scenes.interactiveRunning.runningStepDesc')}
                color="var(--purple)"
              />

              <Fade show={showWrongPath}>
                <IntroTraceRow
                  icon={X}
                  label={t('intro.scenes.interactiveRunning.wrongLabel')}
                  desc={t('intro.scenes.interactiveRunning.wrongDesc')}
                  color="var(--yellow)"
                  dim={showCorrected}
                />
              </Fade>

              <Fade show={showCorrected}>
                <IntroTraceRow
                  icon={Check}
                  label={t('intro.scenes.interactiveRunning.correctedLabel')}
                  desc={t('intro.scenes.interactiveRunning.correctedDesc')}
                  color="var(--green)"
                />
              </Fade>

              <Fade show={showContinue}>
                <IntroTraceRow
                  icon={Play}
                  label={t('intro.scenes.interactiveRunning.continueLabel')}
                  desc={t('intro.scenes.interactiveRunning.continueDesc')}
                  color="var(--cyan)"
                  trailing={<Check size={12} strokeWidth={1.5} style={{ color: 'var(--green)' }} />}
                />
              </Fade>
            </div>
          </div>
        </IntroSceneCard>
      </Fade>

      <Fade
        show={showQuestion}
        style={{ position: 'absolute', top: 150, left: 44, right: 44 }}
      >
        <IntroSceneCard
          style={{
            maxWidth: 480,
            margin: '0 auto',
            boxShadow: '0 14px 30px rgba(15, 23, 42, 0.10)',
          }}
        >
          <div className="flex items-center gap-2">
            <HelpCircle size={15} strokeWidth={1.5} style={{ color: 'var(--blue)' }} />
            <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>
              {t('intro.scenes.interactiveRunning.questionTitle')}
            </span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.55, marginTop: 8 }}>
            <Typewriter
              text={t('intro.scenes.interactiveRunning.questionText')}
              active={showQuestion}
              charDelay={30}
            />
          </div>
          <div className="flex flex-col" style={{ gap: 4, marginTop: 10 }}>
            <IntroChoiceRow
              label={t('intro.scenes.interactiveRunning.option1Label')}
              desc={t('intro.scenes.interactiveRunning.option1Desc')}
            />
            <IntroChoiceRow
              optionRef={register('interactive-option')}
              label={t('intro.scenes.interactiveRunning.option2Label')}
              desc={t('intro.scenes.interactiveRunning.option2Desc')}
              selected={selectedOption}
              hot={optionHot}
            />
          </div>
          <div className="flex justify-end" style={{ marginTop: 10 }}>
            <button
              ref={register('interactive-confirm')}
              className="flex items-center gap-1 px-3 py-1"
              style={{
                background: confirmHot ? 'var(--blue)' : 'var(--bg-elevated)',
                border: 'none',
                borderRadius: 4,
                color: confirmHot ? 'var(--text-inverse)' : 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                transition: 'background 180ms ease, color 180ms ease',
              }}
            >
              <ChevronRight size={12} strokeWidth={1.5} />
              {t('intro.scenes.interactiveRunning.confirmLabel')}
            </button>
          </div>
        </IntroSceneCard>
      </Fade>

      <Fade
        show={showReply}
        style={{ position: 'absolute', top: 256, right: 34 }}
      >
        <div
          className="flex items-center gap-2"
          style={{
            padding: '6px 8px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderLeft: '2px solid var(--blue)',
            borderRadius: 4,
            maxWidth: 280,
          }}
        >
          <User size={12} strokeWidth={1.5} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 10, lineHeight: 1.45 }}>
            {t('intro.scenes.interactiveRunning.answerSummary')}
          </span>
        </div>
      </Fade>

      {cursorNode}
    </Stage>
  )
}

export function RewindBranchScene() {
  const { t } = useTranslation()
  const { stageRef, register, setTarget, cursorNode } = useCursorController()
  const [checkpointOn, setCheckpointOn] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const [rewindHot, setRewindHot] = useState(false)
  const [branchHot, setBranchHot] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [confirmHot, setConfirmHot] = useState(false)
  const [showBanner, setShowBanner] = useState(false)

  useTimeline((at) => {
    at(220, () => setCheckpointOn(true))
    at(1200, () => setShowUser(true))
    at(2800, () => setShowAssistant(true))
    at(4400, () => setShowActions(true))
    at(5200, () => setTarget('rewind-action'))
    at(5700, () => setRewindHot(true))
    at(5900, () => {
      setRewindHot(false)
      setShowDialog(true)
    })
    at(7200, () => setTarget('rewind-confirm'))
    at(7700, () => setConfirmHot(true))
    at(7920, () => {
      setConfirmHot(false)
      setShowDialog(false)
      setShowBanner(true)
    })
    at(9400, () => setTarget('branch-action'))
    at(10000, () => setBranchHot(true))
    at(10600, () => {
      setBranchHot(false)
      setTarget(null)
    })
  })

  return (
    <Stage ref={stageRef}>
      <div
        className="absolute left-0 right-0 flex items-center justify-between"
        style={{
          top: 0,
          height: 40,
          padding: '0 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
        }}
      >
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          chat / auth-refactor
        </span>
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{
            background: checkpointOn ? 'var(--bg-elevated)' : 'transparent',
            border: '1px solid var(--border-subtle)',
            borderLeft: checkpointOn ? '2px solid var(--blue)' : '2px solid transparent',
            borderRadius: 4,
            color: checkpointOn ? 'var(--blue)' : 'var(--text-dim)',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          <Clock size={11} strokeWidth={1.5} />
          <span>{t('intro.scenes.rewindBranch.checkpointLabel')}</span>
        </div>
      </div>

      <Fade
        show={showBanner}
        style={{ position: 'absolute', top: 40, left: 0, right: 0 }}
      >
        <div
          className="flex items-center gap-2 px-4"
          style={{
            height: 34,
            background: 'var(--bg-surface)',
            borderLeft: '2px solid var(--purple)',
            borderBottom: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            fontSize: 11,
          }}
        >
          <RotateCcw size={13} strokeWidth={1.5} style={{ color: 'var(--purple)' }} />
          <span>{t('intro.scenes.rewindBranch.bannerText')}</span>
        </div>
      </Fade>

      <Fade
        show={showUser}
        style={{ position: 'absolute', top: showBanner ? 88 : 56, left: 18, right: 18 }}
      >
        <div className="flex items-start justify-end" style={{ gap: 10 }}>
          <div
            style={{
              maxWidth: 430,
              padding: 10,
              border: '1px solid var(--border)',
              borderLeft: '2px solid var(--blue)',
              borderRadius: 4,
              background: 'var(--bg-surface)',
            }}
          >
            <div className="flex items-center justify-end" style={{ gap: 6 }}>
              <RoleChip color="var(--blue)">{t('intro.scenes.common.youRole')}</RoleChip>
            </div>
            <div style={{ color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
              {t('intro.scenes.rewindBranch.userPrompt')}
            </div>
          </div>
          <Avatar user />
        </div>
      </Fade>

      <Fade
        show={showAssistant}
        style={{ position: 'absolute', top: showBanner ? 154 : 122, left: 18, right: 18 }}
      >
        <IntroSceneCard style={{ display: 'flex', gap: 10, padding: 12 }}>
          <Avatar />
          <div className="flex-1 min-w-0">
            <div className="flex items-center" style={{ gap: 6 }}>
              <RoleChip color="var(--purple)">{t('intro.scenes.common.vivianRole')}</RoleChip>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <IntroTraceRow
                icon={Edit3}
                label={t('intro.scenes.rewindBranch.fileLabel')}
                desc={t('intro.scenes.rewindBranch.fileDesc')}
                color={showBanner ? 'var(--purple)' : 'var(--orange)'}
                dim={showBanner}
                trailing={showBanner ? (
                  <span
                    className="uppercase"
                    style={{
                      color: 'var(--text-dim)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 3,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      padding: '0 5px',
                      lineHeight: '16px',
                    }}
                  >
                    REV
                  </span>
                ) : (
                  <Clock size={12} strokeWidth={1.5} style={{ color: 'var(--orange)' }} />
                )}
              />

              <Fade show={showActions}>
                <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                  <IntroActionButton
                    icon={RotateCcw}
                    label={t('intro.scenes.rewindBranch.rewindLabel')}
                    color="var(--purple)"
                    active={rewindHot}
                    buttonRef={register('rewind-action')}
                  />
                  <IntroActionButton
                    icon={GitBranch}
                    label={t('intro.scenes.rewindBranch.branchLabel')}
                    color="var(--cyan)"
                    active={branchHot}
                    buttonRef={register('branch-action')}
                  />
                  <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                    {t('intro.scenes.rewindBranch.branchHint')}
                  </span>
                </div>
              </Fade>
            </div>
          </div>
        </IntroSceneCard>
      </Fade>

      <Fade
        show={showDialog}
        style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div
          style={{
            width: 360,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: 14,
            boxShadow: '0 16px 32px rgba(15, 23, 42, 0.12)',
          }}
        >
          <div className="flex items-center gap-2">
            <RotateCcw size={15} strokeWidth={1.5} style={{ color: 'var(--purple)' }} />
            <span style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>
              {t('intro.scenes.rewindBranch.confirmTitle')}
            </span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 11, lineHeight: 1.55, marginTop: 8 }}>
            {t('intro.scenes.rewindBranch.confirmBody')}
          </div>
          <div className="flex justify-end" style={{ marginTop: 12 }}>
            <button
              ref={register('rewind-confirm')}
              className="flex items-center gap-1 px-3 py-1"
              style={{
                background: confirmHot ? 'var(--purple)' : 'var(--bg-elevated)',
                border: 'none',
                borderRadius: 4,
                color: confirmHot ? 'var(--text-inverse)' : 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                transition: 'background 180ms ease, color 180ms ease',
              }}
            >
              <RotateCcw size={12} strokeWidth={1.5} />
              <span>{t('intro.scenes.rewindBranch.rewindLabel')}</span>
            </button>
          </div>
        </div>
      </Fade>

      {cursorNode}
    </Stage>
  )
}

export function CanvasLinkageScene() {
  const { t } = useTranslation()
  const [showUser, setShowUser] = useState(false)
  const [showAssistant, setShowAssistant] = useState(false)
  const [canvasVisible, setCanvasVisible] = useState(false)
  const [activeTab, setActiveTab] = useState('tasks')
  const [showTodos, setShowTodos] = useState(false)
  const [showFileOp, setShowFileOp] = useState(false)
  const [showPlan, setShowPlan] = useState(false)

  useTimeline((at) => {
    at(180, () => setShowUser(true))
    at(1500, () => setShowAssistant(true))
    at(2800, () => {
      setCanvasVisible(true)
      setActiveTab('tasks')
    })
    at(3800, () => setShowTodos(true))
    at(5600, () => {
      setShowFileOp(true)
      setActiveTab('files')
    })
    at(7800, () => {
      setShowPlan(true)
      setActiveTab('plan')
    })
  })

  return (
    <Stage>
      <div
        className="absolute inset-0 flex"
        style={{ gap: 0 }}
      >
        <div
          style={{
            flex: canvasVisible ? '0 0 62%' : '1 1 auto',
            borderRight: canvasVisible ? '1px solid var(--border-subtle)' : 'none',
            transition: 'flex-basis 420ms cubic-bezier(0.16, 1, 0.3, 1)',
            padding: 18,
          }}
        >
          <Fade show={showUser}>
            <div className="flex items-start justify-end" style={{ gap: 10 }}>
              <div
                style={{
                  maxWidth: 360,
                  padding: 10,
                  border: '1px solid var(--border)',
                  borderLeft: '2px solid var(--blue)',
                  borderRadius: 4,
                  background: 'var(--bg-surface)',
                }}
              >
                <div className="flex items-center justify-end" style={{ gap: 6 }}>
                  <RoleChip color="var(--blue)">{t('intro.scenes.common.youRole')}</RoleChip>
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
                  {t('intro.scenes.canvasLinkage.userPrompt')}
                </div>
              </div>
              <Avatar user />
            </div>
          </Fade>

          <Fade show={showAssistant} style={{ marginTop: 16 }}>
            <IntroSceneCard style={{ display: 'flex', gap: 10, padding: 12 }}>
              <Avatar />
              <div className="flex-1 min-w-0">
                <div className="flex items-center" style={{ gap: 6 }}>
                  <RoleChip color="var(--purple)">{t('intro.scenes.common.vivianRole')}</RoleChip>
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.55, marginTop: 6, minHeight: 34 }}>
                  <Typewriter
                    text={t('intro.scenes.canvasLinkage.assistantLead')}
                    active={showAssistant}
                    charDelay={30}
                  />
                </div>

                <div className="flex flex-col" style={{ gap: 8, marginTop: 10 }}>
                  <Fade show={showTodos}>
                    <IntroTraceRow
                      icon={ClipboardList}
                      label={t('intro.scenes.canvasLinkage.todoLabel')}
                      desc={t('intro.scenes.canvasLinkage.todoDesc')}
                      color="var(--yellow)"
                    />
                  </Fade>
                  <Fade show={showFileOp}>
                    <IntroTraceRow
                      icon={Edit3}
                      label={t('intro.scenes.canvasLinkage.fileLabel')}
                      desc={t('intro.scenes.canvasLinkage.fileDesc')}
                      color="var(--orange)"
                    />
                  </Fade>
                  <Fade show={showPlan}>
                    <IntroTraceRow
                      icon={ScrollText}
                      label={t('intro.scenes.canvasLinkage.planLabel')}
                      desc={t('intro.scenes.canvasLinkage.planDesc')}
                      color="var(--cyan)"
                    />
                  </Fade>
                </div>
              </div>
            </IntroSceneCard>
          </Fade>
        </div>

        <div
          style={{
            width: canvasVisible ? '38%' : 0,
            overflow: 'hidden',
            transition: 'width 420ms cubic-bezier(0.16, 1, 0.3, 1)',
            background: 'var(--bg-surface)',
          }}
        >
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
              className="flex items-center justify-between"
              style={{
                height: 40,
                padding: '0 12px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="flex items-center gap-4">
                <PanelRight size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)' }} />
                <IntroCanvasTab label={t('intro.scenes.canvasLinkage.inspectorTab')} active={activeTab === 'tasks'} />
                <IntroCanvasTab label={t('intro.scenes.canvasLinkage.filesTab')} active={activeTab === 'files'} />
                <IntroCanvasTab label={t('intro.scenes.canvasLinkage.planTab')} active={activeTab === 'plan'} />
              </div>
            </div>

            <div className="flex-1" style={{ padding: 12 }}>
              {activeTab === 'tasks' && (
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <div className="flex items-center gap-1" style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
                    <ListTodo size={11} strokeWidth={1.5} />
                    <span>{t('intro.scenes.canvasLinkage.todoPanelTitle')}</span>
                  </div>
                  {showTodos && (
                    <>
                      <IntroTraceRow icon={Check} label={t('intro.scenes.canvasLinkage.todo1')} color="var(--green)" />
                      <IntroTraceRow icon={Clock} label={t('intro.scenes.canvasLinkage.todo2')} color="var(--yellow)" />
                    </>
                  )}
                </div>
              )}

              {activeTab === 'files' && (
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <div style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
                    {t('intro.scenes.canvasLinkage.filesPanelTitle')}
                  </div>
                  {showFileOp && (
                    <IntroTraceRow
                      icon={FileText}
                      label={t('intro.scenes.canvasLinkage.filePanelLabel')}
                      desc={t('intro.scenes.canvasLinkage.filePanelDesc')}
                      color="var(--orange)"
                    />
                  )}
                </div>
              )}

              {activeTab === 'plan' && (
                <div className="flex flex-col" style={{ gap: 8 }}>
                  <div style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
                    {t('intro.scenes.canvasLinkage.planPanelTitle')}
                  </div>
                  {showPlan && (
                    <div
                      style={{
                        background: 'var(--bg-base)',
                        border: '1px solid var(--border-subtle)',
                        borderLeft: '2px solid var(--cyan)',
                        borderRadius: 4,
                        padding: '8px 10px',
                        color: 'var(--text-secondary)',
                        fontSize: 10,
                        lineHeight: 1.6,
                        fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {t('intro.scenes.canvasLinkage.planPanelBody')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Stage>
  )
}

/* ------------------------------------------------------------------ */
/* Scene — Scheduler                                                   */
/* ------------------------------------------------------------------ */

export function SchedulerScene() {
  const { t } = useTranslation()
  const [cursor, setCursor] = useState({ x: 560, y: 260, v: false })
  const [triggerHot, setTriggerHot] = useState(false)
  const [newRowIn, setNewRowIn] = useState(false)
  const [runningPulse, setRunningPulse] = useState(false)

  useTimeline((at) => {
    at(200, () => setCursor({ x: 560, y: 260, v: true }))
    at(600, () => setNewRowIn(true))
    at(1300, () => setCursor({ x: 500, y: 60, v: true }))
    at(1700, () => setTriggerHot(true))
    at(1900, () => setRunningPulse(true))
    at(2050, () => setTriggerHot(false))
    at(2300, () => setCursor({ x: 500, y: 60, v: false }))
  })

  const Row = ({ name, cron, status, nextRun, actionsHot }) => {
    const color =
      status === 'active'
        ? 'var(--green)'
        : status === 'paused'
          ? 'var(--yellow)'
          : 'var(--border)'
    return (
      <div
        className="flex items-center"
        style={{
          gap: 10,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          borderLeft: `2px solid ${color}`,
        }}
      >
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <span
              className="truncate"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              {name}
            </span>
            <span
              className="uppercase flex-shrink-0"
              style={{
                fontSize: 9,
                fontWeight: 700,
                color,
                letterSpacing: '0.06em',
              }}
            >
              {status}
            </span>
          </div>
          <div className="flex items-center" style={{ gap: 10 }}>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-dim)',
                fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
              }}
            >
              {t('intro.scenes.scheduler.cronPrefix')}{cron}
            </span>
            <span
              className="font-light"
              style={{ fontSize: 10, color: 'var(--text-dim)' }}
            >
              {t('intro.scenes.scheduler.nextRunPrefix')}{nextRun}
            </span>
          </div>
        </div>
        <div className="flex items-center flex-shrink-0" style={{ gap: 4 }}>
          <IconChip icon={Pause} />
          <IconChip icon={Zap} color="var(--yellow)" hot={actionsHot} />
          <IconChip icon={Edit3} />
          <IconChip icon={Trash2} color="var(--red)" />
        </div>
      </div>
    )
  }

  return (
    <Stage>
      {/* Header */}
      <div
        className="absolute left-0 right-0 flex items-center justify-between px-3"
        style={{
          top: 0,
          height: 32,
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-base)',
        }}
      >
        <div className="flex items-center" style={{ gap: 6 }}>
          <Clock
            size={12}
            strokeWidth={1.5}
            style={{ color: 'var(--yellow)' }}
          />
          <span
            className="uppercase"
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: 'var(--text-dim)',
            }}
          >
            {t('intro.scenes.scheduler.title')}
          </span>
        </div>
        <span
          className="uppercase"
          style={{
            fontSize: 10,
            color: runningPulse ? 'var(--purple)' : 'var(--text-dim)',
            letterSpacing: '0.06em',
            transition: 'color 200ms ease',
          }}
        >
          {runningPulse ? t('intro.scenes.scheduler.runningLabel') : t('intro.scenes.scheduler.idle')}
        </span>
      </div>

      {/* Job rows */}
      <div
        className="absolute left-0 right-0 flex flex-col"
        style={{ top: 32, bottom: 0 }}
      >
        <div
          style={{
            opacity: newRowIn ? 1 : 0,
            transform: newRowIn ? 'translateY(0)' : 'translateY(-8px)',
            transition:
              'opacity 260ms cubic-bezier(0.16, 1, 0.3, 1), transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Row
            name={t('intro.scenes.scheduler.dailyBriefing')}
            cron="0 9 * * *"
            status={t('intro.scenes.scheduler.statusActive')}
            nextRun={t('intro.scenes.scheduler.nextIn4h')}
            actionsHot={triggerHot}
          />
        </div>
        <Row
          name={t('intro.scenes.scheduler.nightlyCleanup')}
          cron="0 2 * * *"
          status={t('intro.scenes.scheduler.statusActive')}
          nextRun={t('intro.scenes.scheduler.nextIn11h')}
        />
        <Row
          name={t('intro.scenes.scheduler.weeklyReport')}
          cron="0 9 * * 1"
          status={t('intro.scenes.scheduler.statusPaused')}
          nextRun="—"
        />
      </div>

      <Cursor x={cursor.x} y={cursor.y} visible={cursor.v} />
    </Stage>
  )
}

function IconChip({ icon: Icon, color, hot }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: 18,
        height: 18,
        background: hot ? 'var(--bg-elevated)' : 'transparent',
        border: hot ? `1px solid ${color || 'var(--border)'}` : '1px solid transparent',
        borderRadius: 3,
        color: hot ? color || 'var(--text-primary)' : 'var(--text-dim)',
        transition: 'all 150ms ease',
      }}
    >
      <Icon size={11} strokeWidth={1.5} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Scene 5 — Ready                                                     */
/* ------------------------------------------------------------------ */

export function ReadyScene() {
  const { t } = useTranslation()
  const [phase, setPhase] = useState(0)
  useTimeline((at) => {
    at(200, () => setPhase(1))
    at(700, () => setPhase(2))
  })
  return (
    <Stage>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ gap: 16 }}
      >
        <div
          style={{
            transform:
              phase >= 1
                ? 'scale(1) rotate(0deg)'
                : 'scale(0.5) rotate(-20deg)',
            opacity: phase >= 1 ? 1 : 0,
            transition:
              'transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 420ms ease',
            color: 'var(--green)',
          }}
        >
          <Sparkles size={64} strokeWidth={1.5} />
        </div>
        <div
          style={{
            fontSize: 14,
            color: 'var(--text-primary)',
            fontFamily: '"JetBrains Mono", "Source Han Mono SC", monospace',
            minHeight: 20,
          }}
        >
          <Typewriter text={t('intro.scenes.ready.allSet')} active={phase >= 2} />
        </div>
      </div>
    </Stage>
  )
}
