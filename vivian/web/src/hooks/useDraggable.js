import { useCallback, useEffect, useRef, useState } from 'react'

// Mirrors useResizable's overlay + RAF-flush pattern but for 2D drags.
// onDrag receives the latest { x, y } (clamped to `bounds()`), called via RAF.
export function useDraggable({ initial, onDrag, bounds }) {
  const [dragging, setDragging] = useState(false)
  const cleanupRef = useRef(null)
  const frameRef = useRef(null)
  const initialRef = useRef(initial)
  initialRef.current = initial

  const onMouseDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return
    cleanupRef.current?.()

    const startClientX = e.clientX
    const startClientY = e.clientY
    const start = initialRef.current || { x: 0, y: 0 }
    const startX = start.x
    const startY = start.y
    const DRAG_THRESHOLD = 3

    let dragActive = false
    let overlay = null
    let lastPos = { x: startX, y: startY }
    let pendingPos = lastPos
    let finished = false

    const beginDrag = () => {
      if (dragActive) return
      dragActive = true
      setDragging(true)
      overlay = document.createElement('div')
      overlay.setAttribute('data-drag-overlay', 'true')
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        cursor: 'grabbing',
        background: 'transparent',
        userSelect: 'none',
        touchAction: 'none',
      })
      document.body.appendChild(overlay)
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    const flush = () => {
      frameRef.current = null
      if (pendingPos.x === lastPos.x && pendingPos.y === lastPos.y) return
      lastPos = pendingPos
      onDrag(lastPos)
    }

    const schedule = (next) => {
      pendingPos = next
      if (frameRef.current != null) return
      frameRef.current = window.requestAnimationFrame(flush)
    }

    const clampTo = (pos) => {
      const b = bounds ? bounds() : null
      if (!b) return pos
      return {
        x: Math.max(b.minX ?? -Infinity, Math.min(b.maxX ?? Infinity, pos.x)),
        y: Math.max(b.minY ?? -Infinity, Math.min(b.maxY ?? Infinity, pos.y)),
      }
    }

    const onMouseMove = (evt) => {
      const dx = evt.clientX - startClientX
      const dy = evt.clientY - startClientY
      if (!dragActive) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        beginDrag()
      }
      schedule(clampTo({ x: startX + dx, y: startY + dy }))
    }

    const onMouseUp = (updateDragging = true) => {
      if (finished) return
      finished = true
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      if (dragActive && (pendingPos.x !== lastPos.x || pendingPos.y !== lastPos.y)) {
        onDrag(pendingPos)
      }
      if (dragActive && updateDragging) setDragging(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onMouseUp)
      if (overlay) {
        overlay.remove()
        overlay = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      cleanupRef.current = null
    }

    cleanupRef.current = onMouseUp
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onMouseUp)
  }, [onDrag, bounds])

  useEffect(() => () => {
    cleanupRef.current?.(false)
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  return { dragging, onMouseDown }
}
