import { GENERATED_TOOL_LABEL, getToolDisplayName } from './generatedTool'

const GROUP_ORDER = [
  'edited',
  'wrote',
  'generated',
  'read',
  'search',
  'bash',
  'webFetch',
  'webSearch',
  'canvas',
  'other',
]

function countPatchLines(patch) {
  let added = 0
  let removed = 0
  if (!patch || !Array.isArray(patch.hunks)) return { added, removed }
  for (const hunk of patch.hunks) {
    const lines = hunk?.lines || []
    for (const line of lines) {
      if (typeof line !== 'string' || line.length === 0) continue
      if (line.startsWith('+++')) continue
      if (line.startsWith('---')) continue
      if (line[0] === '+') added += 1
      else if (line[0] === '-') removed += 1
    }
  }
  return { added, removed }
}

function countContentLines(str) {
  if (typeof str !== 'string' || str.length === 0) return 0
  const normalized = str.endsWith('\n') ? str.slice(0, -1) : str
  if (normalized.length === 0) return 0
  return normalized.split('\n').length
}

function findFileOp(fileOps, block) {
  if (!Array.isArray(fileOps) || !block) return null
  return fileOps.find((op) => (
    op.id === block.fileOpId ||
    op.id === block.id ||
    (block.fileOpId && op.toolUseId === block.fileOpId) ||
    (block.id && op.toolUseId === block.id)
  )) || null
}

function isSuccessfulFileMutation(block, op) {
  const status = op?.status || block?.status
  const isError = status === 'error' || block?.result?.is_error || op?.result?.is_error
  if (isError) return false
  if (status === 'running' || status === 'pending') return false
  return status === 'success' || (!status && !op)
}

function lowercaseFirst(str) {
  if (!str) return str
  return str.charAt(0).toLowerCase() + str.slice(1)
}

export function summarizeRun(run, fileOps, t) {
  const groups = {
    edited: { count: 0 },
    wrote: { count: 0 },
    generated: { count: 0 },
    read: { count: 0 },
    bash: { count: 0 },
    search: { count: 0 },
    webFetch: { count: 0 },
    webSearch: { count: 0 },
    canvas: { count: 0 },
    other: { count: 0 },
  }
  let totalAdded = 0
  let totalRemoved = 0

  for (const block of run) {
    if (!block) continue
    const op = findFileOp(fileOps, block)

    if (block.type === 'file_ref') {
      if (block.name === 'Edit' || block.name === 'Write') {
        if (!isSuccessfulFileMutation(block, op)) continue
        if (block.name === 'Edit') groups.edited.count += 1
        else groups.wrote.count += 1
        const { added, removed } = countPatchLines(op?.structuredPatch)
        if (added > 0 || removed > 0) {
          totalAdded += added
          totalRemoved += removed
        } else if (block.name === 'Write') {
          totalAdded += countContentLines(op?.content || op?.input?.content)
        } else if (op?.input?.old_string != null || op?.input?.new_string != null) {
          totalRemoved += countContentLines(op?.input?.old_string)
          totalAdded += countContentLines(op?.input?.new_string)
        }
      } else if (getToolDisplayName(block.name) === GENERATED_TOOL_LABEL) {
        groups.generated.count += 1
      }
    } else if (block.type === 'tool_use') {
      const name = block.name
      if (name === 'Write' || name === 'Edit') {
        if (!isSuccessfulFileMutation(block, op)) continue
        if (name === 'Edit') groups.edited.count += 1
        else groups.wrote.count += 1
        const input = op?.input || block.input || {}
        const { added, removed } = countPatchLines(op?.structuredPatch)
        if (added > 0 || removed > 0) {
          totalAdded += added
          totalRemoved += removed
        } else if (name === 'Write') {
          totalAdded += countContentLines(op?.content || input.content)
        } else {
          totalRemoved += countContentLines(input.old_string)
          totalAdded += countContentLines(input.new_string)
        }
      } else if (getToolDisplayName(name) === GENERATED_TOOL_LABEL) groups.generated.count += 1
      else if (name === 'Bash') groups.bash.count += 1
      else if (name === 'Read') groups.read.count += 1
      else if (name === 'Grep' || name === 'Glob') groups.search.count += 1
      else if (name === 'WebFetch') groups.webFetch.count += 1
      else if (name === 'WebSearch') groups.webSearch.count += 1
      else groups.other.count += 1
    } else if (block.type === 'canvas_ref') {
      const count = block.count || 1
      groups.canvas.count += count
    }
  }

  const lastFileOpKey = groups.wrote.count > 0
    ? 'wrote'
    : groups.edited.count > 0 ? 'edited' : null
  const hasLineDelta = totalAdded > 0 || totalRemoved > 0

  const tokens = []
  let partIndex = 0
  for (const key of GROUP_ORDER) {
    const group = groups[key]
    if (!group.count) continue

    const phrase = t(`toolCall.summary.${key}`, { count: group.count })
    const display = partIndex === 0 ? phrase : lowercaseFirst(phrase)

    if (partIndex > 0) tokens.push({ text: ', ' })
    tokens.push({ text: display })

    if (key === lastFileOpKey && hasLineDelta) {
      tokens.push({ text: ' ' })
      if (totalAdded > 0) {
        tokens.push({ text: `+${totalAdded}`, color: 'var(--green)' })
      }
      if (totalAdded > 0 && totalRemoved > 0) {
        tokens.push({ text: ' ' })
      }
      if (totalRemoved > 0) {
        tokens.push({ text: `-${totalRemoved}`, color: 'var(--red)' })
      }
    }

    partIndex += 1
  }

  return { tokens }
}
