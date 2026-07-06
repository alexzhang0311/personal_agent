function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function getNodeText(parent, selector) {
  return parent.querySelector(selector)?.textContent || ''
}

function optionalLine(tag, value) {
  if (value == null || value === '') return null
  return `  <${tag}>${escapeXml(value)}</${tag}>`
}

export function buildSelectedFileXml(reference) {
  if (!reference) return ''

  return [
    '<selected-file>',
    `  <kind>${escapeXml(reference.kind || 'plain-text')}</kind>`,
    `  <file-path>${escapeXml(reference.filePath || '')}</file-path>`,
    optionalLine('file-name', reference.fileName),
    optionalLine('locator', reference.locator),
    optionalLine('start-line', reference.startLine),
    optionalLine('end-line', reference.endLine),
    optionalLine('language', reference.language),
    optionalLine('slide-number', reference.slideNumber),
    optionalLine('box-index', reference.boxIndex),
    optionalLine('box-label', reference.boxLabel),
    optionalLine('box-bounds', reference.boxBounds),
    `  <content-format>${escapeXml(reference.contentFormat || 'text')}</content-format>`,
    `  <content>${escapeXml(reference.content || '')}</content>`,
    '</selected-file>',
  ].filter(Boolean).join('\n')
}

export function parseSelectedFile(text) {
  if (!text) return null

  const blockRegex = /<selected-file>\s*[\s\S]*?<\/selected-file>/
  const blockMatch = text.match(blockRegex)
  if (!blockMatch) return null
  if (typeof DOMParser === 'undefined') return null

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(`<root>${blockMatch[0]}</root>`, 'application/xml')
    if (doc.querySelector('parsererror')) return null

    const selectedNode = doc.querySelector('selected-file')
    if (!selectedNode) return null

    const cleanText = text.replace(blockRegex, '').trim()
    const toNumber = (value) => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }

    return {
      kind: getNodeText(selectedNode, 'kind') || 'plain-text',
      filePath: getNodeText(selectedNode, 'file-path'),
      fileName: getNodeText(selectedNode, 'file-name'),
      locator: getNodeText(selectedNode, 'locator'),
      startLine: toNumber(getNodeText(selectedNode, 'start-line')),
      endLine: toNumber(getNodeText(selectedNode, 'end-line')),
      language: getNodeText(selectedNode, 'language'),
      slideNumber: toNumber(getNodeText(selectedNode, 'slide-number')),
      boxIndex: getNodeText(selectedNode, 'box-index'),
      boxLabel: getNodeText(selectedNode, 'box-label'),
      boxBounds: getNodeText(selectedNode, 'box-bounds'),
      contentFormat: getNodeText(selectedNode, 'content-format') || 'text',
      content: getNodeText(selectedNode, 'content'),
      cleanText,
    }
  } catch {
    return null
  }
}
