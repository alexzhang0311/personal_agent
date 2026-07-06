import { useState, useCallback, useEffect, useRef } from 'react'

export function useResizable({ initial, min, max, direction = 'right', onResize }) {
  const [dragging, setDragging] = useState(false)
  const cleanupRef = useRef(null)
  const frameRef = useRef(null)

  const onMouseDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    cleanupRef.current?.()
    setDragging(true)

    const isVertical = direction === 'down' || direction === 'up'
    const cursor = isVertical ? 'row-resize' : 'col-resize'
    const startPos = isVertical ? e.clientY : e.clientX
    const startSize = initial
    let lastSize = startSize
    let pendingSize = startSize
    let finished = false

    const overlay = document.createElement('div')
    overlay.setAttribute('data-resize-overlay', 'true')
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      cursor,
      background: 'transparent',
      userSelect: 'none',
      touchAction: 'none',
    })
    document.body.appendChild(overlay)

    const flushResize = () => {
      frameRef.current = null
      if (pendingSize === lastSize) return
      lastSize = pendingSize
      onResize(lastSize)
    }

    const scheduleResize = (newSize) => {
      pendingSize = newSize
      if (frameRef.current != null) return
      frameRef.current = window.requestAnimationFrame(flushResize)
    }

    const onMouseMove = (e) => {
      const currentPos = isVertical ? e.clientY : e.clientX
      let delta = currentPos - startPos
      if (direction === 'left' || direction === 'up') delta = -delta
      const newSize = Math.min(max, Math.max(min, startSize + delta))
      scheduleResize(newSize)
    }

    const onMouseUp = (updateDragging = true) => {
      if (finished) return
      finished = true
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      if (pendingSize !== lastSize) {
        onResize(pendingSize)
      }
      if (updateDragging) setDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onMouseUp)
      overlay.remove()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cleanupRef.current = null
    }

    cleanupRef.current = onMouseUp
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onMouseUp)
  }, [initial, min, max, direction, onResize])

  useEffect(() => () => {
    cleanupRef.current?.(false)
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  return { dragging, onMouseDown }
}
