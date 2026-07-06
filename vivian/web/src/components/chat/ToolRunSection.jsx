import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { summarizeRun } from '../../utils/toolRunSummary'
import { RollingText } from '../shared/Odometer'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

const QUIET_REVEAL_TRANSITION = {
  type: 'tween',
  duration: 0.16,
  ease: [0.4, 0, 0.2, 1],
}

function SummaryTokens({ summary, fallback, height = 12, fontWeight = 500 }) {
  if (!summary?.tokens?.length) {
    return (
      <RollingText
        text={fallback}
        height={height}
        color="currentColor"
        fontWeight={fontWeight}
      />
    )
  }

  return summary.tokens.map((tok, i) => (
    <span key={i} style={tok.color ? { color: tok.color } : undefined}>
      <RollingText
        text={tok.text}
        height={height}
        color="currentColor"
        fontWeight={fontWeight}
      />
    </span>
  ))
}

export function ToolSectionToggle({ collapsed, onToggle, run, fileOps, t, controlsId, compact = false }) {
  const [hovered, setHovered] = useState(false)
  const summary = summarizeRun(run, fileOps, t)
  const hasSummary = summary && summary.tokens.length > 0
  const labelColor = hovered ? 'var(--text-primary)' : 'var(--text-secondary)'
  const fallback = t('toolCall.toolStepsFallback', { count: run.length })
  const tokenHeight = compact ? 11 : 12

  return (
    <button
      type="button"
      className="quiet-toggle overflow-hidden"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 5 : 6,
        width: '100%',
        background: 'transparent',
        border: 'none',
        padding: compact ? '2px 0' : '4px 0',
        cursor: 'pointer',
        color: labelColor,
        fontSize: compact ? 12 : 13,
        textAlign: 'left',
        transition: 'color 150ms ease',
      }}
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={controlsId}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AnimatedChevron open={!collapsed} style={{ color: 'var(--text-dim)' }}>
        <ChevronDown size={12} strokeWidth={1.5} />
      </AnimatedChevron>
      <span
        style={{
          minWidth: 0,
          color: labelColor,
          wordBreak: 'break-word',
          flex: '1 1 auto',
          display: 'block',
          lineHeight: compact ? '18px' : '20px',
        }}
      >
        {collapsed ? (
          hasSummary
            ? <SummaryTokens summary={summary} fallback={fallback} height={tokenHeight} />
            : <SummaryTokens fallback={fallback} height={tokenHeight} />
        ) : (
          <>
            <span>{t('toolCall.hideToolSteps')}</span>
            <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>·</span>
            {hasSummary
              ? <SummaryTokens summary={summary} fallback={fallback} height={tokenHeight} />
              : <SummaryTokens fallback={fallback} height={tokenHeight} />}
          </>
        )}
      </span>
    </button>
  )
}

export default function ToolRunSection({
  collapsed,
  onToggle,
  run,
  fileOps,
  t,
  renderBlock,
  getChildKey,
  compact = false,
}) {
  const bodyId = useId()
  const shouldReduce = useReducedMotion()
  const renderToolTree = () => (
    <div className="tool-tree">
      {run.map((toolBlock, runIndex) => (
        <div
          key={getChildKey ? getChildKey(toolBlock, runIndex) : (toolBlock.id || runIndex)}
          className="tool-tree-child"
        >
          {renderBlock(toolBlock, runIndex)}
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ marginTop: compact ? 2 : 4, marginBottom: compact ? 2 : 4 }}>
      <ToolSectionToggle
        collapsed={collapsed}
        onToggle={onToggle}
        run={run}
        fileOps={fileOps}
        t={t}
        controlsId={bodyId}
        compact={compact}
      />

      {compact ? (
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              id={bodyId}
              initial={shouldReduce ? false : { opacity: 0, y: -3 }}
              animate={shouldReduce ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
              exit={shouldReduce ? { opacity: 0, y: 0 } : { opacity: 0, y: -3 }}
              transition={shouldReduce ? { duration: 0 } : QUIET_REVEAL_TRANSITION}
              style={{ overflow: 'hidden' }}
            >
              {renderToolTree()}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <AnimatedCollapse
          open={!collapsed}
          id={bodyId}
          animateHeight={false}
          keepMounted
          deferContentOnClose
        >
          {renderToolTree}
        </AnimatedCollapse>
      )}
    </div>
  )
}
