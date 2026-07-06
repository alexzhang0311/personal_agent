import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import useUserDataStore from '../../stores/userDataStore'
import AuditCharts from '../admin/charts/AuditCharts'
import { resolveVar, AXIS_STYLE, getGridStyle, ChartTooltip, useThemeKey } from '../admin/charts/ChartTheme'
import { BarChartSkeleton, AreaChartSkeleton } from '../admin/charts/ChartSkeleton'
import { useSkillUsageChartData, useSessionActivityChartData } from '../../hooks/useChartData'
import DateRangePicker from '../shared/DateRangePicker'

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

export default function UserAnalytics() {
  const { t } = useTranslation()
  const themeKey = useThemeKey()
  const analytics = useUserDataStore((s) => s.analytics)
  const analyticsLoading = useUserDataStore((s) => s.analyticsLoading)
  const analyticsStartTime = useUserDataStore((s) => s.analyticsStartTime)
  const analyticsEndTime = useUserDataStore((s) => s.analyticsEndTime)
  const fetchAnalytics = useUserDataStore((s) => s.fetchAnalytics)
  const setAnalyticsTimeRange = useUserDataStore((s) => s.setAnalyticsTimeRange)

  useEffect(() => { fetchAnalytics() }, [analyticsStartTime, analyticsEndTime])

  const skillData = useSkillUsageChartData(analytics?.skill_usage)
  const sessionData = useSessionActivityChartData(analytics?.session_activity)

  const handleTimeChange = (start, end) => {
    setAnalyticsTimeRange(start, end)
  }

  return (
    <div className="flex flex-col flex-1" style={{ padding: '32px 56px 0 56px', minHeight: 0, overflow: 'hidden' }}>
      <div className="flex items-center gap-3 flex-shrink-0" style={{ margin: '0 0 16px 0' }}>
        <h2 className="font-semibold text-lg" style={{ color: 'var(--text-primary)', margin: 0 }}>
          {t('userData.analytics')}
        </h2>
        <button
          style={{
            background: 'transparent',
            border: 'none',
            cursor: analyticsLoading ? 'not-allowed' : 'pointer',
            color: 'var(--text-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 4,
            borderRadius: 4,
            transition: 'color 150ms ease',
          }}
          disabled={analyticsLoading}
          onClick={() => fetchAnalytics()}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          title={t('scheduler.reload')}
        >
          <RefreshCw size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Time range picker */}
      <div className="flex-shrink-0 pb-4">
        <DateRangePicker
          startTime={analyticsStartTime}
          endTime={analyticsEndTime}
          onChange={handleTimeChange}
        />
      </div>

      {/* Charts */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-5" style={{ minHeight: 0, paddingBottom: 32 }}>
        {/* Activity Timeline — AuditCharts renders its own container */}
        {analyticsLoading ? (
          <div className="flex-shrink-0" style={containerStyle}>
            <div style={titleStyle}>{t('userData.activityTimeline')}</div>
            <AreaChartSkeleton height={280} />
          </div>
        ) : (
          <div className="flex-shrink-0">
            <AuditCharts entries={analytics?.timeline || []} loading={false} />
          </div>
        )}

        {/* Two-column: Skills + Sessions */}
        <div className="flex gap-5 flex-shrink-0" style={{ minHeight: 0 }}>
          {/* Top Skills */}
          <div className="flex-1" style={{ ...containerStyle, minWidth: 0 }}>
            <div style={titleStyle}>{t('userData.topSkills')}</div>
            {analyticsLoading ? (
              <BarChartSkeleton barCount={5} height={200} />
            ) : skillData.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-dim)', padding: '40px 0', textAlign: 'center' }}>
                {t('admin.chartNoData')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(skillData.length * 32 + 20, 120)}>
                <BarChart
                  key={`skill-${themeKey}`}
                  data={skillData}
                  layout="vertical"
                  margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
                >
                  <CartesianGrid {...getGridStyle()} horizontal={false} />
                  <XAxis
                    type="number"
                    {...AXIS_STYLE}
                    tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-dim') }}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="skill"
                    width={140}
                    {...AXIS_STYLE}
                    tick={({ x, y, payload }) => (
                      <text x={0} y={y} dy={4} fill={resolveVar('--text-secondary')} fontSize={AXIS_STYLE.tick?.fontSize || 11} textAnchor="start">
                        {payload.value}
                      </text>
                    )}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: resolveVar('--bg-elevated') }} />
                  <Bar
                    dataKey="count"
                    name={t('userData.topSkills')}
                    fill={resolveVar('--purple')}
                    radius={[0, 2, 2, 0]}
                    animationDuration={600}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Session Activity */}
          <div className="flex-1" style={{ ...containerStyle, minWidth: 0 }}>
            <div style={titleStyle}>{t('userData.sessionActivity')}</div>
            {analyticsLoading ? (
              <BarChartSkeleton barCount={5} height={200} />
            ) : sessionData.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-dim)', padding: '40px 0', textAlign: 'center' }}>
                {t('admin.chartNoData')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  key={`session-activity-${themeKey}`}
                  data={sessionData}
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
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: resolveVar('--bg-elevated') }} />
                  <Bar
                    dataKey="count"
                    name={t('userData.sessionActivity')}
                    fill={resolveVar('--blue')}
                    radius={[2, 2, 0, 0]}
                    animationDuration={600}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
