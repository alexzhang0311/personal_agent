import iconMap from 'material-icon-theme/dist/material-icons.json'

// Material Icon Theme ships full-color SVGs; the strokeWidth/CSS-variable
// rules in CLAUDE.md don't apply to these raster-clean assets.
const ICON_BASE = '/file-icons/'

function resolveIconName(entry) {
  const rawName = typeof entry === 'string' ? entry : (entry?.name || '')
  const lower = rawName.toLowerCase()
  const isDir = typeof entry === 'object' && entry?.type === 'directory'

  if (isDir) {
    return iconMap.folderNames?.[lower] || iconMap.folder || 'folder'
  }

  if (iconMap.fileNames?.[lower]) {
    return iconMap.fileNames[lower]
  }

  const dot = lower.lastIndexOf('.')
  if (dot >= 0) {
    let ext = lower.slice(dot + 1)
    while (ext) {
      const hit =
        iconMap.fileExtensions?.[ext] ||
        iconMap.languageIds?.[ext] ||
        (iconMap.iconDefinitions?.[ext] ? ext : null)
      if (hit) return hit
      const nextDot = ext.indexOf('.')
      if (nextDot < 0) break
      ext = ext.slice(nextDot + 1)
    }
  }

  return iconMap.file || 'file'
}

export function getFileIcon(entry, size = 14) {
  const name = resolveIconName(entry)
  return (
    <img
      src={`${ICON_BASE}${name}.svg`}
      width={size}
      height={size}
      style={{ flexShrink: 0, display: 'block' }}
      alt=""
      draggable={false}
    />
  )
}
