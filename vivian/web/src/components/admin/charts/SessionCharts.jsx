import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { resolveVar, AXIS_STYLE, getGridStyle, ChartTooltip, formatBytesAxis, useThemeKey } from './ChartTheme'
import { useSessionChartData } from '../../../hooks/useChartData'
import { BarChartSkeleton } from './ChartSkeleton'

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

export default function SessionCharts({ stats, loading }) {
  const { t } = useTranslation()
  const themeKey = useThemeKey()
  const { sessionBarData, storageBarData } = useSessionChartData(stats)

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div style={containerStyle}>
          <div style={titleStyle}>{t('admin.chartSessions')}</div>
          <BarChartSkeleton />
        </div>
        <div style={containerStyle}>
          <div style={titleStyle}>{t('admin.chartStorage')}</div>
          <BarChartSkeleton />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Sessions per User */}
      <div style={containerStyle}>
        <div style={titleStyle}>{t('admin.chartSessions')}</div>
        {sessionBarData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(sessionBarData.length * 32 + 20, 120)}>
            <BarChart
              key={`session-${themeKey}`}
              data={sessionBarData}
              layout="vertical"
              margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid {...getGridStyle()} horizontal={false} />
              <XAxis type="number" {...AXIS_STYLE} tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-dim') }} />
              <YAxis
                type="category"
                dataKey="username"
                width={80}
                {...AXIS_STYLE}
                tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-secondary') }}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: resolveVar('--bg-elevated') }} />
              <Bar
                dataKey="sessions"
                name={t('admin.sessions')}
                fill={resolveVar('--blue')}
                radius={[0, 2, 2, 0]}
                animationDuration={600}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-dim)', padding: '20px 0', textAlign: 'center' }}>
            {t('admin.chartNoData')}
          </div>
        )}
      </div>

      {/* Storage per User */}
      <div style={containerStyle}>
        <div style={titleStyle}>{t('admin.chartStorage')}</div>
        {storageBarData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(storageBarData.length * 32 + 20, 120)}>
            <BarChart
              key={`storage-${themeKey}`}
              data={storageBarData}
              layout="vertical"
              margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid {...getGridStyle()} horizontal={false} />
              <XAxis
                type="number"
                {...AXIS_STYLE}
                tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-dim') }}
                tickFormatter={formatBytesAxis}
              />
              <YAxis
                type="category"
                dataKey="username"
                width={80}
                {...AXIS_STYLE}
                tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-secondary') }}
              />
              <Tooltip
                content={<ChartTooltip formatter={(val) => formatBytesAxis(val)} />}
                cursor={{ fill: resolveVar('--bg-elevated') }}
              />
              <Bar
                dataKey="storage"
                name={t('admin.storage')}
                fill={resolveVar('--cyan')}
                radius={[0, 2, 2, 0]}
                animationDuration={600}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-dim)', padding: '20px 0', textAlign: 'center' }}>
            {t('admin.chartNoData')}
          </div>
        )}
      </div>
    </div>
  )
}
