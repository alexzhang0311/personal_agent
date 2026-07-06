import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import useAuthStore from '../../stores/authStore'
import Tabs from '../shared/Tabs'
import {
  resolveVar, AXIS_STYLE, getGridStyle, ChartTooltip, useThemeKey,
} from '../admin/charts/ChartTheme'

function formatNumber(n) {
  if (n === null || n === undefined) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 2 : 1).replace(/\.?0+$/, '') + 'K'
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '') + 'M'
  return (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B'
}

function rangeKey(range) {
  if (range === '30d') return 'last_30d'
  if (range === '7d') return 'last_7d'
  return 'all'
}

function StatTile({ label, value }) {
  return (
    <div
      className="flex flex-col min-w-0"
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 2,
        padding: '4px 8px',
        gap: 2,
      }}
    >
      <span
        className="truncate"
        style={{
          color: 'var(--text-dim)',
          fontSize: 9,
          fontWeight: 400,
          lineHeight: 1.25,
        }}
      >
        {label}
      </span>
      <span
        className="truncate"
        style={{
          color: 'var(--text-primary)',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
          letterSpacing: '-0.01em',
          lineHeight: 1.2,
        }}
        title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function Heatmap({ data }) {
  const { t, i18n } = useTranslation()
  const cells = data || []
  const counts = cells.map((c) => c.count).filter((n) => n > 0).sort((a, b) => a - b)
  const q1 = counts[Math.floor(counts.length * 0.25)] || 0
  const q2 = counts[Math.floor(counts.length * 0.5)] || 0
  const q3 = counts[Math.floor(counts.length * 0.75)] || 0
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  function bucket(count) {
    if (count <= 0) return 0
    if (count <= q1) return 1
    if (count <= q2) return 2
    if (count <= q3) return 3
    return 4
  }

  const alphas = [null, 0.52, 0.68, 0.84, 1.0]

  const weeks = useMemo(() => {
    if (cells.length === 0) return []
    const firstDate = new Date(cells[0].date + 'T00:00:00')
    const firstDow = (firstDate.getDay() + 6) % 7
    const padStart = firstDow
    const padded = Array(padStart).fill(null).concat(cells)
    const out = []
    for (let i = 0; i < padded.length; i += 7) {
      out.push(padded.slice(i, i + 7))
    }
    return out
  }, [cells])

  const monthLabels = useMemo(() => {
    const seen = new Set()
    return weeks.map((week) => {
      const firstDay = week.find(Boolean)
      if (!firstDay) return ''
      const monthKey = firstDay.date.slice(0, 7)
      if (seen.has(monthKey)) return ''
      seen.add(monthKey)
      return new Date(firstDay.date + 'T00:00:00').toLocaleString(
        i18n.resolvedLanguage || i18n.language || undefined,
        { month: 'short' },
      )
    })
  }, [i18n.language, i18n.resolvedLanguage, weeks])

  const COL_GAP = 2
  const ROW_GAP = 2
  const LABEL_WIDTH = 18
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh')

  const cellBg = (b) => {
    if (b === 0) return 'var(--bg-elevated)'
    return `color-mix(in srgb, var(--blue) ${alphas[b] * 100}%, var(--bg-surface))`
  }

  const formatDayLabel = (dayKey) => {
    const label = t(`chat.usage.heatmap.day.${dayKey}`)
    if (isZh) return label.replace(/^周/, '').slice(-1)
    return label.slice(0, 2)
  }

  if (weeks.length === 0) return null

  return (
    <div className="min-w-0" style={{ paddingTop: 2 }}>
      <div
        className="grid min-w-0"
        style={{
          gridTemplateColumns: `${LABEL_WIDTH}px repeat(${weeks.length}, minmax(0, 1fr))`,
          columnGap: COL_GAP,
          alignItems: 'end',
          marginBottom: 6,
        }}
      >
        <div />
        {monthLabels.map((label, wi) => (
          <div
            key={wi}
            style={{
              fontSize: 9,
              color: 'var(--text-dim)',
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
              lineHeight: 1,
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'visible',
              textAlign: 'center',
            }}
          >
            {label}
          </div>
        ))}
      </div>
      <div
        className="grid min-w-0"
        style={{
          gridTemplateColumns: `${LABEL_WIDTH}px repeat(${weeks.length}, minmax(0, 1fr))`,
          columnGap: COL_GAP,
          rowGap: ROW_GAP,
          alignItems: 'stretch',
        }}
      >
        {DAY_KEYS.map((dayKey, rowIndex) => (
          <Fragment key={dayKey}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: 4,
                color: 'var(--text-dim)',
                fontSize: 8,
                lineHeight: 1,
                fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
                whiteSpace: 'nowrap',
              }}
            >
              {formatDayLabel(dayKey)}
            </div>
            {weeks.map((week, wi) => {
              const cell = week[rowIndex]
              if (!cell) {
                return <div key={`${dayKey}-${wi}-empty`} style={{ width: '100%', aspectRatio: '1 / 1' }} />
              }
              const b = bucket(cell.count)
              return (
                <div
                  key={`${dayKey}-${wi}-${cell.date}`}
                  title={t('chat.usage.heatmap.tooltip', { date: cell.date, count: cell.count })}
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    background: cellBg(b),
                    borderRadius: 2,
                    border: b === 0 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function ModelsView({ modelUsage, dailyModelTokens, range, themeKey }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const filteredDaily = useMemo(() => {
    if (!dailyModelTokens || dailyModelTokens.length === 0) return []
    if (range === 'all') return dailyModelTokens
    const days = range === '7d' ? 7 : 30
    return dailyModelTokens.slice(-days)
  }, [dailyModelTokens, range])

  const chartData = useMemo(() => {
    return filteredDaily.map((d) => ({ date: d.date, ...d.by_model }))
  }, [filteredDaily])

  const modelNames = useMemo(() => (modelUsage || []).map((m) => m.model), [modelUsage])

  const blueAlphas = [1.0, 0.8, 0.6, 0.45, 0.3, 0.22, 0.16]
  const getColor = (index) => {
    const alpha = blueAlphas[index] !== undefined ? blueAlphas[index] : 0.14
    return `color-mix(in srgb, var(--blue) ${alpha * 100}%, transparent)`
  }

  const hasData = modelUsage && modelUsage.length > 0 && filteredDaily.length > 0

  if (!hasData) {
    return (
      <div
        className="text-xs"
        style={{ color: 'var(--text-dim)', padding: '24px 0', textAlign: 'center' }}
      >
        {t('chat.usage.models.noData')}
      </div>
    )
  }

  const visible = expanded ? modelUsage : modelUsage.slice(0, 5)
  const hiddenCount = modelUsage.length - 5

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            key={`models-${themeKey}-${range}`}
            data={chartData}
            margin={{ top: 0, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid {...getGridStyle()} />
            <XAxis
              dataKey="date"
              {...AXIS_STYLE}
              tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-dim'), fontSize: 9 }}
            />
            <YAxis
              {...AXIS_STYLE}
              tick={{ ...AXIS_STYLE.tick, fill: resolveVar('--text-dim'), fontSize: 9 }}
              allowDecimals={false}
              tickFormatter={(v) => formatNumber(v)}
            />
            <Tooltip content={<ChartTooltip formatter={(v) => formatNumber(v)} />} cursor={{ fill: resolveVar('--bg-elevated') }} />
            {modelNames.map((model, i) => (
              <Bar
                key={model}
                dataKey={model}
                stackId="tokens"
                name={model}
                fill={getColor(i)}
                animationDuration={400}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col" style={{ gap: 6 }}>
        {visible.map((m, i) => (
          <div key={m.model} className="flex items-center gap-2 min-w-0" style={{ fontSize: 11 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 2,
                background: getColor(i),
                flexShrink: 0,
              }}
            />
            <span className="truncate" style={{ color: 'var(--text-primary)', flex: 1 }} title={m.model}>
              {m.model}
            </span>
            <span style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 10, flexShrink: 0 }}>
              {t('chat.usage.models.inOut', {
                input: formatNumber(m.input_tokens),
                output: formatNumber(m.output_tokens),
              })}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", fontSize: 10, width: 42, textAlign: 'right', flexShrink: 0 }}>
              {m.percentage.toFixed(1)}%
            </span>
          </div>
        ))}
        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 10,
              cursor: 'pointer',
              textAlign: 'left',
              padding: '2px 0',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            {expanded
              ? t('chat.usage.models.showLess')
              : t('chat.usage.models.showMore', { count: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  )
}

export default function UsageStatsOverview() {
  const { t } = useTranslation()
  const themeKey = useThemeKey()
  const user = useAuthStore((s) => s.user)
  const [activeTab, setActiveTab] = useState('overview')
  const [range, setRange] = useState('7d')

  if (!user) return null

  const stats = user.stats || {}
  const counts = stats[rangeKey(range)] || {
    sessions: 0, messages: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, active_days: 0,
  }

  const currentStreak = user.current_streak || 0
  const longestStreak = user.longest_streak || 0
  const peakHour = user.peak_hour
  const favoriteModel = user.favorite_model
  const tagline = user.tagline

  const streakLabel = (n) => t('chat.usage.streakDays', { count: n })
  const peakLabel = peakHour === null || peakHour === undefined
    ? t('chat.usage.none')
    : `${peakHour}${t('chat.usage.hourSuffix')}`
  const favoriteLabel = favoriteModel || t('chat.usage.none')

  const RANGES = [
    { value: '7d', label: t('chat.usage.range.7d') },
    { value: '30d', label: t('chat.usage.range.30d') },
    { value: 'all', label: t('chat.usage.range.all') },
  ]

  const TABS = [
    { value: 'overview', label: t('chat.usage.tab.overview') },
    { value: 'models', label: t('chat.usage.tab.models') },
  ]

  const tiles = [
    { label: t('chat.usage.card.sessions'), value: formatNumber(counts.sessions) },
    { label: t('chat.usage.card.messages'), value: formatNumber(counts.messages) },
    { label: t('chat.usage.card.tokens'), value: formatNumber(counts.total_tokens) },
    { label: t('chat.usage.card.activeDays'), value: formatNumber(counts.active_days) },
    { label: t('chat.usage.card.currentStreak'), value: streakLabel(currentStreak) },
    { label: t('chat.usage.card.longestStreak'), value: streakLabel(longestStreak) },
    { label: t('chat.usage.card.peakHour'), value: peakLabel },
    { label: t('chat.usage.card.favoriteModel'), value: favoriteLabel },
  ]

  return (
    <div className="flex flex-col min-w-0" style={{ gap: 12 }}>
      {/* Title OUTSIDE card */}
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles size={16} strokeWidth={1.5} style={{ color: 'var(--orange)', flexShrink: 0 }} />
        <span
          className="truncate"
          style={{
            color: 'var(--text-primary)',
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '-0.01em',
          }}
        >
          {t('chat.usage.title', { name: user.username })}
        </span>
      </div>

      {/* Single card */}
      <div
        className="flex flex-col min-w-0"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 4,
          padding: 12,
          gap: 10,
        }}
      >
        {/* Tabs + range row */}
        <div className="flex items-center justify-between gap-2">
          <Tabs
            tabs={TABS.map((tab) => ({ id: tab.value, label: tab.label }))}
            activeKey={activeTab}
            onChange={(_, tab) => setActiveTab(tab.id)}
            variant="frame"
            className="flex items-center gap-1"
            indicatorStyle={{ border: 'none', borderRadius: 2 }}
            buttonStyle={{ padding: '3px 10px', borderRadius: 2, fontSize: 11 }}
            getButtonStyle={({ active }) => ({
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: active ? 600 : 400,
            })}
          />

          <Tabs
            tabs={RANGES.map((r) => ({ id: r.value, label: r.label }))}
            activeKey={range}
            onChange={(_, tab) => setRange(tab.id)}
            variant="frame"
            className="flex items-center gap-1"
            indicatorStyle={{ border: 'none', borderRadius: 2 }}
            buttonStyle={{
              padding: '3px 8px',
              borderRadius: 2,
              fontSize: 10,
              fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            }}
            getButtonStyle={({ active }) => ({
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: active ? 600 : 400,
            })}
          />
        </div>

        {activeTab === 'overview' ? (
          <>
            {/* Stat tiles: 4×2, no borders, subtle bg */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 4,
              }}
            >
              {tiles.map((tile, i) => (
                <StatTile key={i} label={tile.label} value={tile.value} />
              ))}
            </div>

            {/* Heatmap (no inner container) */}
            <Heatmap data={user.heatmap || []} />

            {/* Tagline */}
            {tagline && (
              <div
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 10,
                  fontWeight: 300,
                  fontStyle: 'italic',
                  lineHeight: 1.4,
                }}
              >
                {tagline}
              </div>
            )}
          </>
        ) : (
          <ModelsView
            modelUsage={user.model_usage || []}
            dailyModelTokens={user.daily_model_tokens || []}
            range={range}
            themeKey={themeKey}
          />
        )}
      </div>
    </div>
  )
}
