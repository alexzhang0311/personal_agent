import { useState, useEffect, useId, useRef } from 'react'
import { Circle, Loader, CheckCircle, XCircle, MinusCircle, ChevronDown, StopCircle, Terminal } from 'lucide-react'
import CopyButton from './CopyButton'
import { useSSE } from '../../hooks/useSSE'
import { AnimatedChevron, AnimatedCollapse } from './Accordion'

const statusConfig = {
  pending: { icon: Circle, color: 'var(--text-dim)' },
  running: { icon: Loader, color: 'var(--purple)', spinning: true },
  success: { icon: CheckCircle, color: 'var(--green)' },
  completed: { icon: CheckCircle, color: 'var(--green)' },
  error: { icon: XCircle, color: 'var(--red)' },
  skipped: { icon: MinusCircle, color: 'var(--text-dim)' },
}

const shellStatusLabels = {
  running: { text: 'RUNNING', color: 'var(--green)' },
  completed: { text: 'COMPLETED', color: 'var(--green)' },
  failed: { text: 'FAILED', color: 'var(--red)' },
  killed: { text: 'KILLED', color: 'var(--red)' },
}

function formatDuration(task) {
  if (!task.startTime) return ''
  const end = task.endTime || Date.now()
  const ms = end - task.startTime
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Compact tool-execution row, used inside Canvas inspectors (TodoInspector,
 * SubagentInspector). Lifted verbatim from the old canvas/TaskNode.jsx so
 * both inspectors render tool detail identically.
 *
 * Accepts a "task" shape from taskStore, or any { name, input, status,
 * startTime, endTime, result, toolUseResult } object.
 */
export default function DetailToolNode({ task, indent = 8 }) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const status = task.status || 'pending'
  const [, setTick] = useState(0)
  const outputRef = useRef(null)
  const { sendMessage } = useSSE()

  useEffect(() => {
    if (status !== 'running' || !task.startTime) return
    const id = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [status, task.startTime])

  useEffect(() => {
    if (outputRef.current && task.liveOutput) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [task.liveOutput])

  const config = statusConfig[status] || statusConfig.pending
  const StatusIcon = config.icon

  const displayName = task.description || task.name || 'Task'
  const taskId = task.task_id
  const isBackgroundBash = !!task.shellId
  const isDelegation = task.name === 'delegate_to_openclaw' || task.name === 'mcp__vivian_openclaw__delegate_to_openclaw'
  const shellLabel = shellStatusLabels[task.shellStatus] || null

  const inputJson = task.input ? JSON.stringify(task.input, null, 2) : null
  const rawOutput = task.result?.content || task.summary || null
  const turOutput = task.toolUseResult ? JSON.stringify(task.toolUseResult, null, 2) : null
  const outputContent = rawOutput || turOutput || null

  const handleStopShell = (e) => {
    e.stopPropagation()
    if (task.shellId) {
      sendMessage(`Please kill the background bash shell with shell_id: ${task.shellId}`)
    }
  }

  return (
    <div>
      <button
        className="flex items-center gap-1 w-full text-xs"
        style={{
          background: 'transparent',
          border: 'none',
          borderLeft: isDelegation
            ? '2px solid var(--purple)'
            : isBackgroundBash && task.shellStatus === 'running'
              ? '2px solid var(--green)'
              : '2px solid transparent',
          paddingLeft: indent,
          paddingRight: 12,
          paddingTop: 3,
          paddingBottom: 3,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 150ms ease',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </AnimatedChevron>
        <StatusIcon
          size={12}
          strokeWidth={1.5}
          style={{ color: config.color, flexShrink: 0 }}
          className={config.spinning ? 'icon-running' : ''}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-1 min-w-0">
            <span className="truncate" style={{ color: 'var(--text-primary)' }}>
              {displayName}
            </span>
            {isBackgroundBash && shellLabel && (
              <span
                className="flex-shrink-0 uppercase"
                style={{
                  color: shellLabel.color,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                }}
              >
                {shellLabel.text}
              </span>
            )}
          </div>
          {taskId && (
            <span
              className="truncate font-light"
              style={{ color: 'var(--text-dim)', fontSize: 10, fontFamily: 'var(--font-code)' }}
            >
              {taskId}
            </span>
          )}
        </div>
        <span
          className="flex-shrink-0 font-light"
          style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatDuration(task)}
        </span>
      </button>

      <AnimatedCollapse
        open={expanded}
        id={bodyId}
        className="mx-2 mb-1"
        style={{ background: 'var(--bg-elevated)', borderRadius: 2, fontSize: 11 }}
      >
        <div>
          {task.name && (
            <div
              className="flex items-center gap-1 px-2 py-1"
              style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
            >
              <span style={{ color: 'var(--text-dim)' }}>Tool:</span>
              <span>{task.name}</span>
              {isBackgroundBash && task.shellId && (
                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-code)', fontSize: 10 }}>
                  shell:{task.shellId}
                </span>
              )}
            </div>
          )}

          {inputJson && (
            <div style={{ borderBottom: (outputContent || isBackgroundBash) ? '1px solid var(--border-subtle)' : 'none' }}>
              <div className="copyable relative" style={{ padding: '4px 8px' }}>
                <div className="flex items-center gap-1 mb-1" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
                  INPUT
                </div>
                <pre
                  className="overflow-x-auto"
                  style={{
                    color: 'var(--text-secondary)',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'var(--font-code)',
                    fontSize: 11,
                  }}
                >{inputJson}</pre>
                <CopyButton content={inputJson} />
              </div>
            </div>
          )}

          {isBackgroundBash && (
            <div style={{ borderBottom: outputContent ? '1px solid var(--border-subtle)' : 'none' }}>
              <div style={{ padding: '4px 8px' }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
                    <Terminal size={10} strokeWidth={1.5} />
                    LIVE OUTPUT
                  </div>
                  {task.shellStatus === 'running' && (
                    <button
                      onClick={handleStopShell}
                      className="flex items-center gap-1 px-1"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--red)',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        transition: 'opacity 150ms ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                    >
                      <StopCircle size={10} strokeWidth={1.5} />
                      STOP
                    </button>
                  )}
                </div>
                <div
                  ref={outputRef}
                  className="copyable relative overflow-y-auto"
                  style={{ maxHeight: 200, background: 'var(--bg-base)', borderRadius: 2, padding: '4px 6px' }}
                >
                  <pre
                    style={{
                      color: 'var(--text-secondary)',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'var(--font-code)',
                      fontSize: 11,
                      minHeight: 20,
                    }}
                  >{task.liveOutput || (task.shellStatus === 'running' ? 'Waiting for output...' : 'No output')}</pre>
                  {task.liveOutput && <CopyButton content={task.liveOutput} />}
                </div>
              </div>
            </div>
          )}

          {outputContent && (
            <div className="copyable relative" style={{ padding: '4px 8px' }}>
              <div className="flex items-center gap-1 mb-1" style={{ color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
                OUTPUT
              </div>
              <pre
                className="overflow-x-auto"
                style={{
                  color: 'var(--text-secondary)',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'var(--font-code)',
                  fontSize: 11,
                }}
              >{typeof outputContent === 'string' ? outputContent : JSON.stringify(outputContent, null, 2)}</pre>
              <CopyButton content={typeof outputContent === 'string' ? outputContent : JSON.stringify(outputContent, null, 2)} />
            </div>
          )}
        </div>
      </AnimatedCollapse>
    </div>
  )
}
