import {
  GENERATED_TOOL_LABEL,
  getGeneratedInputPaths,
  isGeneratedToolName,
} from './generatedTool'

export const FILE_SOURCE_CURRENT = 'current'
export const FILE_SOURCE_PAST = 'past'
export const FILE_SOURCE_UPLOAD = 'upload'

export const FILE_SOURCE_LABELS = {
  [FILE_SOURCE_CURRENT]: 'Current Agent session',
  [FILE_SOURCE_PAST]: 'Past',
  [FILE_SOURCE_UPLOAD]: 'Upload File',
}

export const FILE_TOOL_NAMES = new Set(['Read', 'Write', 'Edit'])

export function fileNameFromPath(filePath) {
  if (!filePath) return '(untitled)'
  const parts = String(filePath).split('/').filter(Boolean)
  return parts[parts.length - 1] || filePath
}

export function browserSourceLabel(source) {
  return FILE_SOURCE_LABELS[source] || source || ''
}

export function fileTabFromToolUse(block, browserSource = FILE_SOURCE_CURRENT) {
  if (!block || !FILE_TOOL_NAMES.has(block.name)) return null
  const filePath = block.input?.file_path || block.input?.path || ''
  if (!filePath) return null
  return {
    filePath,
    name: fileNameFromPath(filePath),
    source: browserSourceLabel(browserSource),
    browserSource,
    sourceTool: block.name,
    toolUseId: block.id || null,
  }
}

export function fileTabsFromGeneratedFiles(files, browserSource = FILE_SOURCE_CURRENT, toolUseId = null) {
  if (!Array.isArray(files)) return []
  return files
    .map((file) => {
      const filePath = file?.path || file?.filePath || ''
      if (!filePath) return null
      return {
        filePath,
        name: file.name || fileNameFromPath(filePath),
        mimeType: file.mime_type || file.mimeType || null,
        size: typeof file.size === 'number' ? file.size : null,
        extension: file.extension || null,
        source: browserSourceLabel(browserSource),
        browserSource,
        sourceTool: GENERATED_TOOL_LABEL,
        toolUseId,
      }
    })
    .filter(Boolean)
}

export function isBrowserLoadableFile(file) {
  const filePath = file?.filePath || file?.path || ''
  const mimeType = String(file?.mimeType || file?.mime_type || '').toLowerCase()
  const extension = String(file?.extension || '').toLowerCase()
  const lowerPath = String(filePath).split(/[?#]/)[0].toLowerCase()
  return (
    mimeType === 'text/html' ||
    extension === '.html' ||
    extension === '.htm' ||
    lowerPath.endsWith('.html') ||
    lowerPath.endsWith('.htm')
  )
}

function addSessionFile(filesByPath, file) {
  if (!file || !isBrowserLoadableFile(file)) return
  const filePath = file.filePath || file.path || ''
  if (!filePath) return
  const existing = filesByPath.get(filePath) || {}
  const merged = { ...existing }
  for (const [key, value] of Object.entries({ ...file, id: filePath, filePath })) {
    if (value !== null && value !== undefined && value !== '') merged[key] = value
  }
  filesByPath.delete(filePath)
  filesByPath.set(filePath, merged)
}

function generatedFilesFromBlock(block, browserSource) {
  const resultFiles = Array.isArray(block?.result?.tool_use_result?.files)
    ? block.result.tool_use_result.files
    : Array.isArray(block?.result?.files) ? block.result.files : []
  if (resultFiles.length > 0) {
    return fileTabsFromGeneratedFiles(resultFiles, browserSource, block.id)
  }
  return fileTabsFromGeneratedFiles(
    getGeneratedInputPaths(block?.input).map((filePath) => ({ path: filePath })),
    browserSource,
    block?.id || null,
  )
}

function addSessionBlockFiles(filesByPath, block, browserSource) {
  if (!block || typeof block !== 'object') return

  if (block.type === 'tool_use') {
    if (FILE_TOOL_NAMES.has(block.name)) {
      addSessionFile(filesByPath, fileTabFromToolUse(block, browserSource))
    } else if (isGeneratedToolName(block.name)) {
      generatedFilesFromBlock(block, browserSource)
        .forEach((file) => addSessionFile(filesByPath, file))
    }
    return
  }

  if (block.type !== 'file_ref') return
  const filePath = block.filePath || block.path || ''
  addSessionFile(filesByPath, {
    filePath,
    name: fileNameFromPath(filePath),
    mimeType: block.mimeType || block.mime_type || null,
    extension: block.extension || null,
    size: typeof block.size === 'number' ? block.size : null,
    source: block.name || browserSourceLabel(browserSource),
    browserSource,
    sourceTool: block.name || null,
    toolUseId: block.fileOpId || block.toolUseId || block.id || null,
  })
}

export function collectBrowserFilesFromSession(messages = [], subagentContent = {}, browserSource = FILE_SOURCE_CURRENT) {
  const filesByPath = new Map()

  for (const msg of messages || []) {
    const blocks = Array.isArray(msg?.content) ? msg.content : []
    for (const block of blocks) {
      addSessionBlockFiles(filesByPath, block, browserSource)
    }
  }

  for (const blocks of Object.values(subagentContent || {})) {
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      addSessionBlockFiles(filesByPath, block, browserSource)
    }
  }

  return Array.from(filesByPath.values())
}
