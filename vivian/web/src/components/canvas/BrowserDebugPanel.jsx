import { useCallback, useEffect, useState } from 'react'
import useBrowserDebugStore from '../../stores/browserDebugStore'
import { useResizable } from '../../hooks/useResizable'
import { FILE_SOURCE_UPLOAD } from '../../utils/fileArtifacts'
import BrowserSourceBar from './BrowserSourceBar'
import BrowserViewport from './BrowserViewport'
import InspectorDetail from './InspectorDetail'
import BrowserDebugModal from './BrowserDebugModal'
import safeStorage from '../../utils/safeStorage'

const STORAGE_KEY_INSPECTOR_HEIGHT = 'browser-inspector-height'
const DEFAULT_INSPECTOR_HEIGHT = 220
const MIN_INSPECTOR_HEIGHT = 120
const MAX_INSPECTOR_RATIO = 0.65

function getMaxInspectorHeight() {
  return Math.max(MIN_INSPECTOR_HEIGHT, Math.floor(window.innerHeight * MAX_INSPECTOR_RATIO))
}

function clampInspectorHeight(value) {
  const numeric = Number(value) || DEFAULT_INSPECTOR_HEIGHT
  return Math.min(getMaxInspectorHeight(), Math.max(MIN_INSPECTOR_HEIGHT, numeric))
}

function readStoredInspectorHeight() {
  return clampInspectorHeight(safeStorage.getItem(STORAGE_KEY_INSPECTOR_HEIGHT))
}

let inspectorHeightSaveTimer = null
function persistInspectorHeight(height) {
  if (inspectorHeightSaveTimer) clearTimeout(inspectorHeightSaveTimer)
  inspectorHeightSaveTimer = setTimeout(() => {
    safeStorage.setItem(STORAGE_KEY_INSPECTOR_HEIGHT, String(height))
    inspectorHeightSaveTimer = null
  }, 200)
}

export default function BrowserDebugPanel() {
  const modalOpen = useBrowserDebugStore((s) => s.modalOpen)
  const setHtmlSource = useBrowserDebugStore((s) => s.setHtmlSource)
  const [dragOver, setDragOver] = useState(false)
  const [inspectorHeight, setInspectorHeightState] = useState(readStoredInspectorHeight)

  const setInspectorHeight = useCallback((height) => {
    const next = clampInspectorHeight(height)
    setInspectorHeightState(next)
    persistInspectorHeight(next)
  }, [])

  const { dragging: resizingInspector, onMouseDown: onInspectorResizeDown } = useResizable({
    initial: inspectorHeight,
    min: MIN_INSPECTOR_HEIGHT,
    max: getMaxInspectorHeight(),
    direction: 'up',
    onResize: setInspectorHeight,
  })

  useEffect(() => {
    const onResize = () => {
      setInspectorHeightState((current) => clampInspectorHeight(current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onDrop = useCallback(async (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setHtmlSource({ html: text, label: file.name || 'dropped.html', origin: FILE_SOURCE_UPLOAD })
    } catch (err) { /* ignore */ }
  }, [setHtmlSource])

  return (
    <div
      className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <BrowserSourceBar />
      <BrowserViewport />
      <div
        onMouseDown={onInspectorResizeDown}
        style={{
          height: 4,
          cursor: 'row-resize',
          background: resizingInspector ? 'var(--blue)' : 'transparent',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          transition: 'background 100ms ease',
          zIndex: 10,
        }}
        onMouseEnter={(e) => { if (!resizingInspector) e.currentTarget.style.background = 'var(--blue)' }}
        onMouseLeave={(e) => { if (!resizingInspector) e.currentTarget.style.background = 'transparent' }}
      />
      <InspectorDetail height={inspectorHeight} topBorder={false} />
      {dragOver && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: 'var(--bg-overlay)',
            border: '2px dashed var(--blue)',
            color: 'var(--text-primary)',
            fontSize: 12,
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          Drop HTML file
        </div>
      )}
      {modalOpen && <BrowserDebugModal />}
    </div>
  )
}
