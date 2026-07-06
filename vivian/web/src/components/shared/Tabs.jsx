import { useId, useMemo, useState } from 'react'
import { LayoutGroup, motion } from 'framer-motion'

export const SLIDING_TAB_TRANSITION = {
  type: 'tween',
  duration: 0.25,
  ease: [0.4, 0, 0.2, 1],
}

function normalizeTab(tab, index) {
  if (typeof tab === 'string') {
    return { id: tab, label: tab, value: index }
  }
  return {
    id: tab.id ?? tab.key ?? tab.value ?? String(index),
    label: tab.label ?? tab.name ?? tab.id ?? String(index),
    value: tab.value ?? tab.id ?? index,
    disabled: Boolean(tab.disabled),
    ...tab,
  }
}

export function SlidingTabGroup({ children, id }) {
  const generatedId = useId()
  return <LayoutGroup id={id || generatedId}>{children}</LayoutGroup>
}

export function SlidingTabIndicator({
  variant = 'underline',
  layoutId = 'tab-indicator',
  style,
}) {
  const baseStyle = variant === 'frame'
    ? {
      position: 'absolute',
      inset: 0,
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: 0,
    }
    : variant === 'left-border'
      ? {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: 2,
        background: 'var(--blue)',
        pointerEvents: 'none',
        zIndex: 0,
      }
      : {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        background: 'var(--blue)',
        pointerEvents: 'none',
        zIndex: 0,
      }

  return (
    <motion.div
      layoutId={layoutId}
      transition={SLIDING_TAB_TRANSITION}
      style={{ ...baseStyle, ...style }}
    />
  )
}

export default function Tabs({
  tabs,
  defaultActive = 0,
  activeIndex,
  activeKey,
  onChange,
  variant = 'underline',
  className,
  style,
  buttonClassName,
  buttonStyle,
  indicatorStyle,
  getButtonStyle,
  renderLabel,
  layoutId = 'tab-indicator',
}) {
  const normalizedTabs = useMemo(
    () => (tabs || []).map((tab, index) => normalizeTab(tab, index)),
    [tabs]
  )
  const [localActive, setLocalActive] = useState(defaultActive)
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const groupId = useId()

  const resolvedActiveIndex = activeIndex != null
    ? activeIndex
    : activeKey != null
      ? Math.max(0, normalizedTabs.findIndex((tab) => tab.id === activeKey || tab.key === activeKey || tab.value === activeKey))
      : localActive

  const handleSelect = (tab, index) => {
    if (tab.disabled) return
    if (activeIndex == null && activeKey == null) setLocalActive(index)
    onChange?.(index, tab)
  }

  return (
    <SlidingTabGroup id={groupId}>
      <div className={className} style={style}>
        {normalizedTabs.map((tab, index) => {
          const active = index === resolvedActiveIndex
          const hovered = hoveredIndex === index
          const disabled = tab.disabled
          const resolvedButtonStyle = {
            position: 'relative',
            border: 'none',
            background: 'transparent',
            cursor: disabled ? 'default' : 'pointer',
            color: active ? 'var(--text-primary)' : disabled ? 'var(--text-dim)' : 'var(--text-secondary)',
            transition: 'color 150ms ease, background 150ms ease, border-color 150ms ease',
            ...buttonStyle,
            ...getButtonStyle?.({ tab, index, active, hovered, disabled }),
          }

          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              className={buttonClassName}
              style={resolvedButtonStyle}
              onClick={() => handleSelect(tab, index)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
            >
              {active && (
                <SlidingTabIndicator
                  variant={variant}
                  layoutId={layoutId}
                  style={indicatorStyle}
                />
              )}
              <span style={{ position: 'relative', zIndex: 1 }}>
                {renderLabel ? renderLabel(tab, index, active) : tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </SlidingTabGroup>
  )
}

export function TabsDemo() {
  const labels = ['OVERVIEW', 'LOGS', 'METRICS', 'CONFIG', 'ALERTS']
  const [active, setActive] = useState(0)

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Tabs
        tabs={labels}
        activeIndex={active}
        onChange={(index) => setActive(index)}
        className="flex items-center gap-4"
        buttonClassName="text-xs font-semibold uppercase"
        buttonStyle={{ padding: '8px 0', letterSpacing: '0.06em' }}
      />
      <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        {labels[active]}
      </div>
    </div>
  )
}
