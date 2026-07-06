import { useRef, useEffect, useState } from 'react'

export default function MarqueeText({ children, style = {} }) {
  const containerRef = useRef(null)
  const textRef = useRef(null)
  const [overflows, setOverflows] = useState(false)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return
    const isOverflow = text.scrollWidth > container.clientWidth
    setOverflows(isOverflow)
    if (isOverflow) {
      setShift(-(text.scrollWidth - container.clientWidth))
    }
  }, [children])

  return (
    <div
      ref={containerRef}
      className={`marquee-text ${overflows ? 'overflow' : ''}`}
      style={{ ...style, '--shift': `${shift}px` }}
    >
      <span ref={textRef}>{children}</span>
    </div>
  )
}
