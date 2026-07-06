import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

export const ACCORDION_EASE = [0.22, 1, 0.36, 1]

export function useAccordionTransition() {
  const shouldReduce = useReducedMotion()
  return shouldReduce
    ? { duration: 0 }
    : {
      height: { duration: 0.3, ease: ACCORDION_EASE },
      opacity: { duration: 0.2, ease: 'easeOut' },
    }
}

export function AnimatedCollapse({
  open,
  children,
  id,
  className,
  style,
  innerClassName,
  innerStyle,
  animateHeight = true,
  keepMounted = false,
  deferContentOnClose = false,
}) {
  const transition = useAccordionTransition()
  const shouldReduce = useReducedMotion()
  const revealTransition = shouldReduce ? { duration: 0 } : { duration: 0.2, ease: [0.4, 0, 0.2, 1] }
  const [hasMounted, setHasMounted] = useState(open)
  const [isDisplayed, setIsDisplayed] = useState(open)
  const [renderContent, setRenderContent] = useState(open)
  const innerRef = useRef(null)
  const [measuredHeight, setMeasuredHeight] = useState(0)

  useLayoutEffect(() => {
    if (open) {
      setHasMounted(true)
      setIsDisplayed(true)
      setRenderContent(true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (animateHeight || open || !deferContentOnClose || !innerRef.current) return
    const node = innerRef.current
    setMeasuredHeight(node.offsetHeight || node.scrollHeight)
    setRenderContent(false)
  }, [animateHeight, deferContentOnClose, open])

  useLayoutEffect(() => {
    if (
      animateHeight
      || !open
      || !renderContent
      || !innerRef.current
      || (!isDisplayed && !(keepMounted && hasMounted))
    ) return undefined

    const node = innerRef.current
    const measure = () => setMeasuredHeight(node.scrollHeight)
    measure()

    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [animateHeight, hasMounted, isDisplayed, keepMounted, open, renderContent])

  if (!animateHeight) {
    const shouldRender = open || isDisplayed || (keepMounted && hasMounted)
    if (!shouldRender) return null
    return (
      <motion.div
        id={id}
        initial={false}
        animate={{ height: open ? measuredHeight : 0 }}
        transition={revealTransition}
        onAnimationComplete={() => {
          if (!open) {
            setIsDisplayed(false)
            if (!keepMounted) setMeasuredHeight(0)
          }
        }}
        className={className}
        aria-hidden={!open}
        style={{
          display: open || isDisplayed ? undefined : 'none',
          pointerEvents: open ? undefined : 'none',
          overflow: 'hidden',
          contain: 'layout paint style',
          willChange: 'height',
          ...style,
        }}
      >
        <div
          ref={innerRef}
          className={innerClassName}
          style={{
            minHeight: 0,
            overflow: 'hidden',
            transform: 'translateZ(0)',
            ...innerStyle,
          }}
        >
          {open || renderContent ? (typeof children === 'function' ? children() : children) : null}
        </div>
      </motion.div>
    )
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="content"
          id={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={transition}
          className={className}
          style={{ overflow: 'hidden', ...style }}
        >
          <div className={innerClassName} style={innerStyle}>
            {typeof children === 'function' ? children() : children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function AnimatedChevron({
  open,
  children,
  className,
  style,
}) {
  const shouldReduce = useReducedMotion()
  const transition = shouldReduce ? { duration: 0 } : { duration: 0.25, ease: ACCORDION_EASE }

  return (
    <motion.span
      animate={{ rotate: open ? 180 : 0 }}
      transition={transition}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      {children || <ChevronDown size={12} strokeWidth={1.5} />}
    </motion.span>
  )
}

function normalizeDefaultOpen(defaultOpen) {
  if (defaultOpen == null) return []
  return Array.isArray(defaultOpen) ? defaultOpen : [defaultOpen]
}

export default function Accordion({
  items,
  defaultOpen = null,
  allowMultiple = false,
  onChange,
}) {
  const rootId = useId()
  const [openIndices, setOpenIndices] = useState(() => normalizeDefaultOpen(defaultOpen))
  const itemList = useMemo(() => items || [], [items])

  const toggle = (index) => {
    setOpenIndices((current) => {
      const isOpen = current.includes(index)
      const next = allowMultiple
        ? isOpen
          ? current.filter((item) => item !== index)
          : [...current, index]
        : isOpen
          ? []
          : [index]
      onChange?.(next)
      return next
    })
  }

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        overflow: 'hidden',
        background: 'var(--bg-surface)',
      }}
    >
      {itemList.map((item, index) => {
        const isOpen = openIndices.includes(index)
        const bodyId = `${rootId}-body-${index}`

        return (
          <div
            key={item.key || index}
            style={{
              borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={bodyId}
              onClick={() => toggle(index)}
              className="flex items-center justify-between gap-3 w-full"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                padding: '10px 12px',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
                transition: 'background 150ms ease',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ minWidth: 0 }}>{item.title}</span>
              <AnimatedChevron open={isOpen} style={{ color: 'var(--text-dim)' }} />
            </button>
            <AnimatedCollapse
              open={isOpen}
              id={bodyId}
              innerStyle={{
                padding: '0 12px 12px 12px',
                color: 'var(--text-secondary)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {item.body}
            </AnimatedCollapse>
          </div>
        )
      })}
    </div>
  )
}

export function AccordionDemo() {
  return (
    <Accordion
      defaultOpen={0}
      items={[
        { title: 'CONFIG', body: <p style={{ margin: 0 }}>Review runtime settings before the next run.</p> },
        {
          title: 'LOGS',
          body: (
            <div style={{ display: 'grid', gap: 8 }}>
              <p style={{ margin: 0 }}>Short messages and long traces both use their natural height.</p>
              <p style={{ margin: 0 }}>The collapse wrapper owns height; this inner div owns padding.</p>
            </div>
          ),
        },
        { title: 'ALERTS', body: <p style={{ margin: 0 }}>No active alerts.</p> },
      ]}
    />
  )
}
