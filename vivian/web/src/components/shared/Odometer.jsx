import { useEffect, useMemo, useState } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'

const DEFAULT_PLACES = [10000, 1000, 100, 10, 1]
const DEFAULT_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

function normalizeValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

function buildPlaces(value, minDigits = 1) {
  const safeValue = normalizeValue(value)
  const digits = Math.max(String(safeValue).length, minDigits)
  return Array.from({ length: digits }, (_, index) => 10 ** (digits - index - 1))
}

function NumberGlyph({ mv, number, height }) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10
    const offset = (10 + number - placeValue) % 10
    let memo = offset * height
    if (offset > 5) memo -= 10 * height
    return memo
  })

  return (
    <motion.span
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        y,
      }}
    >
      {number}
    </motion.span>
  )
}

function Digit({ value, place, height, width }) {
  const target = Math.floor(normalizeValue(value) / place)
  const mv = useSpring(target, { mass: 0.8, stiffness: 75, damping: 15 })

  useEffect(() => {
    mv.set(target)
  }, [mv, target])

  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        overflow: 'hidden',
        height,
        width,
        flexShrink: 0,
      }}
    >
      {Array.from({ length: 10 }, (_, number) => (
        <NumberGlyph key={number} mv={mv} number={number} height={height} />
      ))}
    </span>
  )
}

export function RollingInteger({
  value,
  minDigits = 1,
  height = 12,
  width,
  color = 'currentColor',
  fontFamily = DEFAULT_FONT_FAMILY,
  fontSize = height,
  fontWeight = 600,
  verticalAlign = 'middle',
}) {
  const places = useMemo(() => buildPlaces(value, minDigits), [value, minDigits])
  return (
    <Odometer
      value={value}
      places={places}
      height={height}
      width={width}
      color={color}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontWeight={fontWeight}
      verticalAlign={verticalAlign}
    />
  )
}

export function RollingText({
  text,
  height = 12,
  color = 'currentColor',
  fontFamily = DEFAULT_FONT_FAMILY,
  fontSize = height,
  fontWeight = 600,
  verticalAlign = 'middle',
}) {
  const parts = String(text ?? '').split(/(\d+)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null
        if (/^\d+$/.test(part)) {
          return (
            <RollingInteger
              key={`number-${index}`}
              value={Number(part)}
              height={height}
              color={color}
              fontFamily={fontFamily}
              fontSize={fontSize}
              fontWeight={fontWeight}
              verticalAlign={verticalAlign}
            />
          )
        }
        return <span key={`text-${index}`} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>
      })}
    </>
  )
}

export default function Odometer({
  value,
  places = DEFAULT_PLACES,
  height = 64,
  width,
  color = 'currentColor',
  fontFamily = DEFAULT_FONT_FAMILY,
  fontSize,
  fontWeight = 600,
  verticalAlign = 'middle',
}) {
  const safeValue = normalizeValue(value)
  const digitWidth = width ?? height * 0.62
  const resolvedFontSize = fontSize ?? height * 0.85

  return (
    <span
      aria-label={String(safeValue)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height,
        color,
        fontFamily,
        fontSize: resolvedFontSize,
        fontWeight,
        lineHeight: `${height}px`,
        fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden',
        verticalAlign,
      }}
    >
      {places.map((place) => (
        <Digit
          key={place}
          value={safeValue}
          place={place}
          height={height}
          width={digitWidth}
        />
      ))}
    </span>
  )
}

export function OdometerDemo() {
  const [value, setValue] = useState(0)
  const [auto, setAuto] = useState(false)

  useEffect(() => {
    if (!auto) return undefined
    const id = setInterval(() => {
      setValue((current) => (current + Math.floor(Math.random() * 1400) + 1) % 100000)
    }, 600)
    return () => clearInterval(id)
  }, [auto])

  const buttonStyle = {
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '6px 10px',
    transition: 'background 150ms ease, border-color 150ms ease',
  }

  return (
    <div style={{ display: 'grid', gap: 12, color: 'var(--text-primary)' }}>
      <Odometer value={value} color="var(--orange)" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={buttonStyle} onClick={() => setValue(Math.floor(Math.random() * 100000))}>
          Random
        </button>
        <button type="button" style={buttonStyle} onClick={() => setValue((current) => (current + 1) % 100000)}>
          +1
        </button>
        <button type="button" style={buttonStyle} onClick={() => setValue((current) => (current + 1000) % 100000)}>
          +1000
        </button>
        <button type="button" style={buttonStyle} onClick={() => setAuto((current) => !current)}>
          Auto {auto ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  )
}
