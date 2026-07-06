import { useCallback, useEffect, useRef, useState } from 'react'

const CURSOR_BY_EDGE = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

// 8-direction box resize with the same overlay + RAF flush pattern as useResizable.
// initial: { x, y, width, height }
// edge: one of n / s / e / w / ne / nw / se / sw
// min: { width, height }
// onResize({ x, y, width, height }) — called with the new clamped rect.
export function useEdgeResizable({ initial, edge, min, onResize, bounds }) {
  const [dragging, setDragging] = useState(false)
  const cleanupRef = useRef(null)
  const frameRef = useRef(null)
  const initialRef = useRef(initial)
  initialRef.current = initial

  const onMouseDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    cleanupRef.current?.()
    setDragging(true)

    const startClientX = e.clientX
    const startClientY = e.clientY
    const startRect = { ...(initialRef.current || { x: 0, y: 0, width: 0, height: 0 }) }
    const minW = (min && min.width) || 0
    const minH = (min && min.height) || 0
    const cursor = CURSOR_BY_EDGE[edge] || 'auto'

    let lastRect = startRect
    let pendingRect = startRect
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

    const flush = () => {
      frameRef.current = null
      if (
        pendingRect.x === lastRect.x &&
        pendingRect.y === lastRect.y &&
        pendingRect.width === lastRect.width &&
        pendingRect.height === lastRect.height
      ) return
      lastRect = pendingRect
      onResize(lastRect)
    }

    const schedule = (next) => {
      pendingRect = next
      if (frameRef.current != null) return
      frameRef.current = window.requestAnimationFrame(flush)
    }

    const onMouseMove = (evt) => {
      const dx = evt.clientX - startClientX
      const dy = evt.clientY - startClientY
      let { x, y, width, height } = startRect

      const right = startRect.x + startRect.width
      const bottom = startRect.y + startRect.height

      if (edge.includes('e')) {
        width = Math.max(minW, startRect.width + dx)
      }
      if (edge.includes('s')) {
        height = Math.max(minH, startRect.height + dy)
      }
      if (edge.includes('w')) {
        const newWidth = Math.max(minW, startRect.width - dx)
        x = right - newWidth
        width = newWidth
      }
      if (edge.includes('n')) {
        const newHeight = Math.max(minH, startRect.height - dy)
        y = bottom - newHeight
        height = newHeight
      }

      // Outer bounds clamp (viewport box) — keep within { minX, minY, maxX, maxY }.
      const b = bounds ? bounds() : null
      if (b) {
        if (x < (b.minX ?? -Infinity)) {
          const shrink = (b.minX ?? 0) - x
          x = b.minX ?? 0
          width = Math.max(minW, width - shrink)
        }
        if (y < (b.minY ?? -Infinity)) {
          const shrink = (b.minY ?? 0) - y
          y = b.minY ?? 0
          height = Math.max(minH, height - shrink)
        }
        if (b.maxX != null && x + width > b.maxX) {
          width = Math.max(minW, b.maxX - x)
        }
        if (b.maxY != null && y + height > b.maxY) {
          height = Math.max(minH, b.maxY - y)
        }
      }

      schedule({ x, y, width, height })
    }

    const onMouseUp = (updateDragging = true) => {
      if (finished) return
      finished = true
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      if (
        pendingRect.x !== lastRect.x ||
        pendingRect.y !== lastRect.y ||
        pendingRect.width !== lastRect.width ||
        pendingRect.height !== lastRect.height
      ) {
        onResize(pendingRect)
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
  }, [edge, min, onResize, bounds])

  useEffect(() => () => {
    cleanupRef.current?.(false)
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  return { dragging, onMouseDown, cursor: CURSOR_BY_EDGE[edge] || 'auto' }
}

export { CURSOR_BY_EDGE }
