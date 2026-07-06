import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'

const PRESETS = [
  { key: '24h', hours: 24 },
  { key: '7d', hours: 7 * 24 },
  { key: '30d', hours: 30 * 24 },
  { key: 'all', hours: null },
]

const btnBase = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'all 150ms ease',
  fontSize: 12,
}

const btnActive = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  color: 'var(--text-primary)',
}

const labelStyle = {
  color: 'var(--text-dim)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const pad = (n) => String(n).padStart(2, '0')

function formatDisplay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']

function getMonthDays(year, month) {
  const first = new Date(year, month, 1)
  const startDay = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()

  const cells = []
  for (let i = startDay - 1; i >= 0; i--) {
    cells.push({ day: daysInPrev - i, current: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true })
  }
  const remaining = 42 - cells.length
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, current: false })
  }
  return cells
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/**
 * @param {string|null} minDate - ISO string, dates before this are disabled
 * @param {string|null} maxDate - ISO string, dates after this are disabled
 */
function CalendarPicker({ value, onChange, lang, minDate, maxDate }) {
  const now = new Date()
  const initial = value ? new Date(value) : now
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())
  const [hour, setHour] = useState(value ? new Date(value).getHours() : now.getHours())
  const [minute, setMinute] = useState(value ? new Date(value).getMinutes() : 0)

  const selectedDate = value ? new Date(value) : null
  const todayStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const cells = getMonthDays(viewYear, viewMonth)
  const weekdays = lang === 'zh' ? WEEKDAYS_ZH : WEEKDAYS
  const months = lang === 'zh' ? MONTHS_ZH : MONTHS_EN

  // Effective max: never allow future
  const effectiveMax = maxDate
    ? new Date(Math.min(new Date(maxDate).getTime(), now.getTime()))
    : now

  const isDayDisabled = (day) => {
    const d = new Date(viewYear, viewMonth, day, 23, 59, 59)
    if (d > effectiveMax) return true
    if (minDate) {
      const dStart = new Date(viewYear, viewMonth, day, 0, 0, 0)
      if (dStart < new Date(new Date(minDate).toDateString())) return true
    }
    return false
  }

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11) }
    else setViewMonth(viewMonth - 1)
  }
  const nextMonth = () => {
    // Don't allow navigating past current month
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear
    if (new Date(nextY, nextM, 1) > now) return
    setViewYear(nextY)
    setViewMonth(nextM)
  }

  const selectDay = (day) => {
    if (isDayDisabled(day)) return
    // Clamp time if selecting today and time would be in the future
    let h = hour, m = minute
    const candidate = new Date(viewYear, viewMonth, day, h, m)
    if (candidate > now) {
      h = now.getHours()
      m = now.getMinutes()
      setHour(h)
      setMinute(m)
    }
    // Clamp to minDate time if selecting minDate day
    if (minDate) {
      const minD = new Date(minDate)
      const candidateClamped = new Date(viewYear, viewMonth, day, h, m)
      if (candidateClamped < minD) {
        h = minD.getHours()
        m = minD.getMinutes()
        setHour(h)
        setMinute(m)
      }
    }
    const d = new Date(viewYear, viewMonth, day, h, m)
    onChange(d.toISOString())
  }

  const updateTime = (h, m) => {
    setHour(h)
    setMinute(m)
    if (selectedDate) {
      let d = new Date(viewYear, viewMonth, selectedDate.getDate(), h, m)
      // Clamp to now
      if (d > now) d = now
      // Clamp to minDate
      if (minDate && d < new Date(minDate)) d = new Date(minDate)
      onChange(d.toISOString())
    }
  }

  const isNextMonthDisabled = () => {
    const nextM = viewMonth === 11 ? 0 : viewMonth + 1
    const nextY = viewMonth === 11 ? viewYear + 1 : viewYear
    return new Date(nextY, nextM, 1) > now
  }

  const navBtnStyle = {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: 4,
    transition: 'color 150ms ease',
  }

  return (
    <div
      className="flex flex-col"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        padding: 12,
        width: 260,
      }}
    >
      {/* Month/Year nav */}
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <button
          style={navBtnStyle}
          onClick={prevMonth}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
          {months[viewMonth]} {viewYear}
        </span>
        <button
          style={{
            ...navBtnStyle,
            opacity: isNextMonthDisabled() ? 0.3 : 1,
            cursor: isNextMonthDisabled() ? 'not-allowed' : 'pointer',
          }}
          onClick={nextMonth}
          disabled={isNextMonthDisabled()}
          onMouseEnter={(e) => { if (!isNextMonthDisabled()) e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
        {weekdays.map((d) => (
          <div
            key={d}
            className="flex items-center justify-center"
            style={{ height: 28, fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 0 }}>
        {cells.map((cell, i) => {
          const isToday = cell.current && `${viewYear}-${viewMonth}-${cell.day}` === todayStr
          const isSelected = cell.current && selectedDate &&
            selectedDate.getFullYear() === viewYear &&
            selectedDate.getMonth() === viewMonth &&
            selectedDate.getDate() === cell.day
          const disabled = cell.current && isDayDisabled(cell.day)

          return (
            <button
              key={i}
              disabled={!cell.current || disabled}
              className="flex items-center justify-center"
              style={{
                height: 28,
                width: '100%',
                fontSize: 12,
                border: 'none',
                borderRadius: 4,
                cursor: (!cell.current || disabled) ? 'default' : 'pointer',
                background: isSelected ? 'var(--blue)' : 'transparent',
                color: isSelected
                  ? 'var(--text-inverse)'
                  : disabled
                    ? 'var(--border-strong)'
                    : cell.current
                      ? (isToday ? 'var(--blue)' : 'var(--text-primary)')
                      : 'var(--text-dim)',
                fontWeight: isToday || isSelected ? 600 : 400,
                opacity: disabled ? 0.4 : 1,
                transition: 'background 150ms ease',
              }}
              onClick={() => cell.current && !disabled && selectDay(cell.day)}
              onMouseEnter={(e) => {
                if (cell.current && !isSelected && !disabled) e.currentTarget.style.background = 'var(--bg-surface)'
              }}
              onMouseLeave={(e) => {
                if (cell.current && !isSelected && !disabled) e.currentTarget.style.background = 'transparent'
              }}
            >
              {cell.day}
            </button>
          )
        })}
      </div>

      {/* Time picker */}
      <div
        className="flex items-center justify-center gap-2"
        style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}
      >
        <span style={{ color: 'var(--text-dim)', fontSize: 11, fontWeight: 600 }}>TIME</span>
        <input
          type="number"
          min={0}
          max={23}
          value={pad(hour)}
          onChange={(e) => updateTime(Math.min(23, Math.max(0, +e.target.value || 0)), minute)}
          style={{
            width: 36,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            textAlign: 'center',
            padding: '2px 4px',
            outline: 'none',
          }}
        />
        <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>:</span>
        <input
          type="number"
          min={0}
          max={59}
          value={pad(minute)}
          onChange={(e) => updateTime(hour, Math.min(59, Math.max(0, +e.target.value || 0)))}
          style={{
            width: 36,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            textAlign: 'center',
            padding: '2px 4px',
            outline: 'none',
          }}
        />
      </div>
    </div>
  )
}

function DatePickerField({ label, value, onChange, lang, minDate, maxDate, error }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span style={labelStyle}>{label}</span>
        <button
          className="flex items-center gap-2 px-2 py-1"
          style={{
            background: 'var(--bg-surface)',
            border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`,
            borderRadius: 4,
            color: value ? 'var(--text-primary)' : 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace",
            minWidth: 155,
            transition: 'border-color 150ms ease',
            justifyContent: 'space-between',
          }}
          onClick={() => setOpen(!open)}
        >
          <span>{value ? formatDisplay(value) : 'YYYY-MM-DD HH:mm'}</span>
          {value ? (
            <X
              size={12}
              strokeWidth={1.5}
              style={{ flexShrink: 0, color: 'var(--text-dim)' }}
              onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false) }}
            />
          ) : (
            <Calendar size={12} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--text-dim)' }} />
          )}
        </button>
      </div>
      {error && (
        <span style={{ color: 'var(--red)', fontSize: 11, marginLeft: 40 }}>{error}</span>
      )}

      {open && (
        <div
          className="absolute"
          style={{ top: error ? 'calc(100% + 2px)' : 'calc(100% + 4px)', left: 0, zIndex: 50 }}
        >
          <CalendarPicker
            value={value}
            onChange={(v) => { onChange(v); setOpen(false) }}
            lang={lang}
            minDate={minDate}
            maxDate={maxDate}
          />
        </div>
      )}
    </div>
  )
}

export default function DateRangePicker({ startTime, endTime, onChange }) {
  const { t, i18n } = useTranslation()
  const [activePreset, setActivePreset] = useState(startTime ? null : 'all')

  // Validation
  const startError = (() => {
    if (!startTime || !endTime) return null
    if (new Date(startTime) >= new Date(endTime)) return t('userData.errorStartAfterEnd')
    return null
  })()

  const endError = (() => {
    if (!endTime) return null
    if (new Date(endTime) > new Date()) return t('userData.errorFutureDate')
    if (startTime && new Date(endTime) <= new Date(startTime)) return t('userData.errorEndBeforeStart')
    return null
  })()

  const handlePreset = (preset) => {
    setActivePreset(preset.key)
    if (preset.hours === null) {
      onChange(null, null)
    } else {
      const start = new Date(Date.now() - preset.hours * 60 * 60 * 1000).toISOString()
      onChange(start, null)
    }
  }

  const handleStartChange = (v) => {
    setActivePreset(null)
    // If new start would be after end, clear end
    if (v && endTime && new Date(v) >= new Date(endTime)) {
      onChange(v, null)
    } else {
      onChange(v, endTime)
    }
  }

  const handleEndChange = (v) => {
    setActivePreset(null)
    onChange(startTime, v)
  }

  return (
    <div className="flex items-start gap-3 flex-wrap">
      {/* Preset buttons */}
      <div className="flex items-center gap-2" style={{ paddingTop: 2 }}>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className="px-3 py-1"
            style={{ ...btnBase, ...(activePreset === p.key ? btnActive : {}) }}
            onClick={() => handlePreset(p)}
          >
            {t(`userData.timeRange${p.key.charAt(0).toUpperCase() + p.key.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* Calendar pickers */}
      <DatePickerField
        label={t('userData.startTime')}
        value={startTime}
        onChange={handleStartChange}
        lang={i18n.language}
        maxDate={endTime}
        error={startError}
      />
      <DatePickerField
        label={t('userData.endTime')}
        value={endTime}
        onChange={handleEndChange}
        lang={i18n.language}
        minDate={startTime}
        error={endError}
      />
    </div>
  )
}
