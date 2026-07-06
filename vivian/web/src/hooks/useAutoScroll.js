import { useRef, useEffect, useState, useCallback } from 'react'

export function useAutoScroll(deps = []) {
  const containerRef = useRef(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const checkAtBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const threshold = 60
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setIsAtBottom(true)
  }, [])

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom()
    }
  }, deps)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', checkAtBottom, { passive: true })
    return () => el.removeEventListener('scroll', checkAtBottom)
  }, [checkAtBottom])

  return { containerRef, isAtBottom, scrollToBottom }
}
