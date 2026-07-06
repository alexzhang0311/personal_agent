/**
 * Shared chart theme utilities for recharts.
 * SVG doesn't reliably support CSS var() — resolve at render time.
 */

import { useEffect, useState } from 'react'

export function resolveVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export const CHART_COLORS = {
  sessions: () => resolveVar('--blue'),
  storage:  () => resolveVar('--cyan'),
  login:    () => resolveVar('--green'),
  user:     () => resolveVar('--yellow'),
  session:  () => resolveVar('--blue'),
  skill:    () => resolveVar('--purple'),
  tool:     () => resolveVar('--cyan'),
}

export const AXIS_STYLE = {
  tick: { fontSize: 11, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" },
  axisLine: false,
  tickLine: false,
}

export function getGridStyle() {
  return { stroke: resolveVar('--border-subtle'), strokeDasharray: '3 3' }
}

export function formatBytesAxis(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

export function useThemeKey() {
  const [key, setKey] = useState(0)
  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          setKey((k) => k + 1)
          break
        }
      }
    })
    observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return key
}

export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: resolveVar('--bg-elevated'),
        border: '1px solid ' + resolveVar('--border'),
        borderRadius: 4,
        padding: '8px 12px',
        fontSize: 12,
      }}
    >
      <div
        style={{
          color: resolveVar('--text-secondary'),
          marginBottom: 4,
          fontFamily: "'Noto Sans', sans-serif",
          fontSize: 11,
        }}
      >
        {label}
      </div>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2" style={{ marginTop: 2 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: entry.color,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: resolveVar('--text-secondary'),
              fontFamily: "'Noto Sans', sans-serif",
              fontSize: 11,
            }}
          >
            {entry.name}:
          </span>
          <span
            style={{
              color: resolveVar('--text-primary'),
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              fontSize: 11,
            }}
          >
            {formatter ? formatter(entry.value, entry.name) : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}
