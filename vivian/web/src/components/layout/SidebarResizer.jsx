import { useResizable } from '../../hooks/useResizable'
import useSidebarStore from '../../stores/sidebarStore'

export default function SidebarResizer() {
  const width = useSidebarStore((s) => s.width)
  const setWidth = useSidebarStore((s) => s.setWidth)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)

  const { dragging, onMouseDown } = useResizable({
    initial: width,
    min: 180,
    max: 480,
    direction: 'right',
    onResize: setWidth,
  })

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={toggleCollapsed}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 4,
        cursor: 'col-resize',
        background: dragging ? 'var(--blue)' : 'transparent',
        transition: 'background 100ms ease',
        zIndex: 10,
      }}
      onMouseEnter={(e) => {
        if (!dragging) e.currentTarget.style.background = 'var(--blue)'
      }}
      onMouseLeave={(e) => {
        if (!dragging) e.currentTarget.style.background = 'transparent'
      }}
    />
  )
}
