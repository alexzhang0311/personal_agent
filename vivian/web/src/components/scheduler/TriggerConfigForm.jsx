import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Tabs from '../shared/Tabs'

const inputStyle = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  borderRadius: '2px',
  padding: '6px 8px',
  fontSize: 13,
  width: '100%',
  outline: 'none',
  fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
}

const selectStyle = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%238b949e' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
  paddingRight: 24,
}

const CRON_PRESETS = [
  { key: 'daily9am', expr: '0 9 * * *' },
  { key: 'everyHour', expr: '0 * * * *' },
  { key: 'everyMon9am', expr: '0 9 * * 1' },
  { key: 'every5min', expr: '*/5 * * * *' },
]

const PRESET_LABELS = {
  daily9am: 'presetDaily9am',
  everyHour: 'presetEveryHour',
  everyMon9am: 'presetEveryMon9am',
  every5min: 'presetEvery5min',
}

/**
 * Parse a cron expr "minute hour day month day_of_week" into field object.
 */
export function cronExprToFields(expr) {
  if (!expr) return { minute: '*', hour: '*', day: '*', month: '*', day_of_week: '*' }
  const parts = expr.trim().split(/\s+/)
  return {
    minute: parts[0] || '*',
    hour: parts[1] || '*',
    day: parts[2] || '*',
    month: parts[3] || '*',
    day_of_week: parts[4] || '*',
  }
}

/**
 * Build cron expr from fields.
 */
export function fieldsToCronExpr(fields) {
  const m = fields.minute || '*'
  const h = fields.hour || '*'
  const d = fields.day || '*'
  const mo = fields.month || '*'
  const dow = fields.day_of_week || '*'
  return `${m} ${h} ${d} ${mo} ${dow}`
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function describeCron(expr, t) {
  if (!expr) return ''
  const fields = cronExprToFields(expr)
  const { minute: m, hour: h, day, month, day_of_week: dow } = fields

  const pad = (v) => String(v).padStart(2, '0')

  // daily at HH:MM
  if (day === '*' && month === '*' && dow === '*' && !h.includes('*') && !h.includes('/') && !m.includes('/')) {
    return `${t('scheduler.runsDescription')}: ${t('scheduler.cronDescDaily', { h: pad(h), m: pad(m) })}`
  }

  // every hour at minute M
  if (h === '*' && day === '*' && month === '*' && dow === '*' && !m.includes('*')) {
    return `${t('scheduler.runsDescription')}: ${t('scheduler.cronDescHourly', { m })}`
  }

  // weekday at HH:MM
  if (day === '*' && month === '*' && dow !== '*' && !h.includes('*') && !m.includes('/')) {
    const dowName = DOW_NAMES[Number(dow)] || dow
    return `${t('scheduler.runsDescription')}: ${t('scheduler.cronDescWeekday', { dow: dowName, h: pad(h), m: pad(m) })}`
  }

  return `${t('scheduler.runsDescription')}: ${expr}`
}

function describeInterval(trigger, t) {
  const total =
    (trigger?.weeks || 0) * 7 * 24 * 60 +
    (trigger?.days || 0) * 24 * 60 +
    (trigger?.hours || 0) * 60 +
    (trigger?.minutes || 0) +
    (trigger?.seconds || 0) / 60

  if (total === 0) return ''

  // Pick the most natural unit
  if (trigger?.weeks && !trigger?.days && !trigger?.hours && !trigger?.minutes && !trigger?.seconds) {
    return `${t('scheduler.runsDescription')}: ${t('scheduler.intervalDesc', { value: trigger.weeks, unit: t('scheduler.weeks').toLowerCase() })}`
  }
  if (trigger?.days && !trigger?.weeks && !trigger?.hours && !trigger?.minutes && !trigger?.seconds) {
    return `${t('scheduler.runsDescription')}: ${t('scheduler.intervalDesc', { value: trigger.days, unit: t('scheduler.days').toLowerCase() })}`
  }
  if (trigger?.hours && !trigger?.weeks && !trigger?.days && !trigger?.minutes && !trigger?.seconds) {
    return `${t('scheduler.runsDescription')}: ${t('scheduler.intervalDesc', { value: trigger.hours, unit: t('scheduler.hours').toLowerCase() })}`
  }
  if (trigger?.minutes && !trigger?.weeks && !trigger?.days && !trigger?.hours && !trigger?.seconds) {
    return `${t('scheduler.runsDescription')}: ${t('scheduler.intervalDesc', { value: trigger.minutes, unit: t('scheduler.minutes').toLowerCase() })}`
  }
  if (trigger?.seconds && !trigger?.weeks && !trigger?.days && !trigger?.hours && !trigger?.minutes) {
    return `${t('scheduler.runsDescription')}: ${t('scheduler.intervalDesc', { value: trigger.seconds, unit: t('scheduler.seconds').toLowerCase() })}`
  }

  // Mixed: show components
  const parts = []
  if (trigger?.weeks) parts.push(`${trigger.weeks}w`)
  if (trigger?.days) parts.push(`${trigger.days}d`)
  if (trigger?.hours) parts.push(`${trigger.hours}h`)
  if (trigger?.minutes) parts.push(`${trigger.minutes}m`)
  if (trigger?.seconds) parts.push(`${trigger.seconds}s`)
  return `${t('scheduler.runsDescription')}: every ${parts.join(' ')}`
}

/**
 * Convert a simple { value, unit } into full interval trigger fields.
 */
function simpleToInterval(value, unit) {
  const base = { type: 'interval', weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }
  base[unit] = value
  return base
}

/**
 * Extract a simple { value, unit } from interval trigger if it only uses one field.
 */
function intervalToSimple(trigger) {
  const fields = ['minutes', 'hours', 'days', 'weeks', 'seconds']
  let activeField = null
  let activeValue = 0
  let multipleActive = false

  for (const f of fields) {
    if ((trigger?.[f] || 0) > 0) {
      if (activeField) { multipleActive = true; break }
      activeField = f
      activeValue = trigger[f]
    }
  }

  if (multipleActive || !activeField) {
    return { value: trigger?.hours || trigger?.minutes || 1, unit: trigger?.hours ? 'hours' : 'minutes' }
  }
  return { value: activeValue, unit: activeField }
}


export default function TriggerConfigForm({ trigger, onChange }) {
  const { t } = useTranslation()
  const type = trigger?.type || 'cron'

  // Track whether cron is in custom mode (fields visible)
  const currentExpr = trigger?.expr || '0 9 * * *'
  const isPreset = CRON_PRESETS.some((p) => p.expr === currentExpr)
  const [showCustomCron, setShowCustomCron] = useState(!isPreset)

  const handleTypeChange = (newType) => {
    if (newType === 'cron') {
      onChange({ type: 'cron', expr: '0 9 * * *' })
      setShowCustomCron(false)
    } else {
      onChange({ type: 'interval', hours: 0, minutes: 30, seconds: 0, days: 0, weeks: 0 })
    }
  }

  const handlePresetClick = (expr) => {
    onChange({ type: 'cron', expr })
    setShowCustomCron(false)
  }

  const handleCustomClick = () => {
    setShowCustomCron(true)
  }

  // Cron fields
  const cronFields = type === 'cron' ? cronExprToFields(trigger?.expr) : {}
  const handleCronField = (field, value) => {
    const updated = { ...cronFields, [field]: value || '*' }
    onChange({ type: 'cron', expr: fieldsToCronExpr(updated) })
  }

  // Interval simple mode
  const simple = type === 'interval' ? intervalToSimple(trigger) : { value: 30, unit: 'minutes' }
  const handleIntervalValue = (v) => {
    onChange(simpleToInterval(parseInt(v) || 0, simple.unit))
  }
  const handleIntervalUnit = (u) => {
    onChange(simpleToInterval(simple.value, u))
  }

  const presetBtnStyle = (active) => ({
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-dim)',
    border: `1px solid ${active ? 'var(--blue)' : 'var(--border-subtle)'}`,
    borderRadius: '2px',
    transition: 'color 150ms ease, border-color 150ms ease',
  })

  return (
    <div className="flex flex-col gap-3">
      {/* Type selector tabs */}
      <Tabs
        tabs={[
          { id: 'cron', label: `${t('scheduler.fixedTime')} (Cron)` },
          { id: 'interval', label: `${t('scheduler.repeatEvery')} (Interval)` },
        ]}
        activeKey={type}
        onChange={(_, tab) => handleTypeChange(tab.id)}
        variant="frame"
        className="flex items-center gap-2"
        indicatorStyle={{ border: '1px solid var(--border)', borderRadius: '2px' }}
        buttonClassName="px-3 py-1 text-xs uppercase"
        buttonStyle={{
          border: '1px solid var(--border)',
          borderRadius: '2px',
          letterSpacing: '0.06em',
        }}
        getButtonStyle={({ active }) => ({
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        })}
      />

      {type === 'cron' ? (
        <div className="flex flex-col gap-3">
          {/* Presets row */}
          <div className="flex items-center gap-1 flex-wrap">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.key}
                style={presetBtnStyle(!showCustomCron && currentExpr === p.expr)}
                onClick={() => handlePresetClick(p.expr)}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => {
                  const active = !showCustomCron && currentExpr === p.expr
                  e.currentTarget.style.color = active ? 'var(--text-primary)' : 'var(--text-dim)'
                }}
              >
                {t(`scheduler.${PRESET_LABELS[p.key]}`)}
              </button>
            ))}
            <button
              style={presetBtnStyle(showCustomCron)}
              onClick={handleCustomClick}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = showCustomCron ? 'var(--text-primary)' : 'var(--text-dim)'
              }}
            >
              {t('scheduler.custom')}
            </button>
          </div>

          {/* Custom cron fields (only when Custom is selected) */}
          {showCustomCron && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {[
                { key: 'minute', label: t('scheduler.minute') },
                { key: 'hour', label: t('scheduler.hour') },
                { key: 'day_of_week', label: t('scheduler.dayOfWeek') },
                { key: 'day', label: t('scheduler.day') },
                { key: 'month', label: t('scheduler.month') },
              ].map(({ key, label }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs font-light" style={{ color: 'var(--text-secondary)' }}>
                    {label}
                  </label>
                  <input
                    style={inputStyle}
                    value={cronFields[key] === '*' ? '' : cronFields[key]}
                    onChange={(e) => handleCronField(key, e.target.value)}
                    placeholder="*"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Human-readable summary */}
          <span className="text-xs" style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
            {describeCron(currentExpr, t)}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Simple: number + unit dropdown */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              style={{ ...inputStyle, width: 80, flexShrink: 0 }}
              value={simple.value}
              onChange={(e) => handleIntervalValue(e.target.value)}
            />
            <select
              style={{ ...selectStyle, width: 140, flexShrink: 0 }}
              value={simple.unit}
              onChange={(e) => handleIntervalUnit(e.target.value)}
            >
              <option value="seconds">{t('scheduler.seconds')}</option>
              <option value="minutes">{t('scheduler.minutes')}</option>
              <option value="hours">{t('scheduler.hours')}</option>
              <option value="days">{t('scheduler.days')}</option>
              <option value="weeks">{t('scheduler.weeks')}</option>
            </select>
          </div>

          {/* Human-readable summary */}
          <span className="text-xs" style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
            {describeInterval(trigger, t)}
          </span>
        </div>
      )}
    </div>
  )
}
