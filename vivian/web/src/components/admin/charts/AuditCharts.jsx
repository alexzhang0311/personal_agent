import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { resolveVar, AXIS_STYLE, getGridStyle, ChartTooltip, useThemeKey } from './ChartTheme'
import { useAuditChartData } from '../../../hooks/useChartData'
import { AreaChartSkeleton } from './ChartSkeleton'

const containerStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: 16,
}

const titleStyle = {
  textTransform: 'uppercase',
  color: 'var(--text-dim)',
  letterSpacing: '0.06em',
  fontSize: 11,
  fontWeight: 600,
  marginBottom: 12,
}

const CATEGORIES = [
  { key: 'login',   colorVar: '--green' },
  { key: 'user',    colorVar: '--yellow' },
  { key: 'session', colorVar: '--blue' },
  { key: 'tool',    colorVar: '--cyan' },
  { key: 'skill',   colorVar: '--purple' },
]

export default function AuditCharts({ entries, loading }) {
  const { t } = useTranslation()
  const themeKey = useThemeKey()
  const [hiddenCategories, setHiddenCategories] = useState(new Set())

  const { timelineData } = useAuditChartData(entries)

  const handleLegendClick = (e) => {
    const key = e.dataKey
    setHiddenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const renderLegend = (props) => {
    const { payload } = props
    if (!payload) return null
    return (
      <div className="flex items-center gap-3 justify-center flex-wrap" style={{ fontSize: 11, fontFamily: "'Noto Sans', sans-serif" }}>
        {payload.map((entry) => {
          const isHidden = hiddenCategories.has(entry.dataKey)
          return (
            <div
              key={entry.dataKey}
              className="flex items-center gap-1"
              style={{
                cursor: 'pointer',
                opacity: isHidden ? 0.35 : 1,
                transition: 'opacity 150ms ease',
                userSelect: 'none',
              }}
              onClick={() => handleLegendClick({ dataKey: entry.dataKey })}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: entry.color,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: resolveVar('--text-secondary') }}>{entry.value}</span>
            </div>
          )
        })}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={titleStyle}>{t('admin.chartTimeline')}</div>
        <AreaChartSkeleton height={360} />
      </div>
    )
  }

  if (timelineData.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={titleStyle}>{t('admin.chartTimeline')}</div>
        <div className="text-xs" style={{ color: 'var(--text-dim)', padding: '40px 0', textAlign: 'center' }}>
          {t('admin.chartNoData')}
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{t('admin.chartTimeline')}</div>
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart
          key={`timeline-${themeKey}-${[...hiddenCategories].join(',')}`}
          data={timelineData}
          margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid {...getGridStyle()} />
          <XAxis
            dataKey="date"
            {...AXIS_STYLE}
            tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-dim') }}
          />
          <YAxis
            {...AXIS_STYLE}
            tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-dim') }}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend content={renderLegend} />
          {CATEGORIES.map((cat) => (
            <Area
              key={cat.key}
              type="monotone"
              dataKey={cat.key}
              name={t(`admin.filter${cat.key.charAt(0).toUpperCase() + cat.key.slice(1)}`)}
              stackId="1"
              stroke={resolveVar(cat.colorVar)}
              fill={resolveVar(cat.colorVar)}
              fillOpacity={hiddenCategories.has(cat.key) ? 0 : 0.15}
              strokeWidth={hiddenCategories.has(cat.key) ? 0 : 1.5}
              hide={hiddenCategories.has(cat.key)}
              animationDuration={600}
              animationEasing="ease-out"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
