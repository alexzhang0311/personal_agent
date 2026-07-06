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

export function buildSelectedXlsxXml(reference) {
  if (!reference) return ''

  return [
    '<selected-xlsx>',
    `  <file-path>${escapeXml(reference.filePath || '')}</file-path>`,
    `  <sheet-index>${escapeXml(reference.sheetIndex ?? 0)}</sheet-index>`,
    `  <sheet-name>${escapeXml(reference.sheetName || '')}</sheet-name>`,
    `  <range>${escapeXml(reference.range || '')}</range>`,
    '  <content-format>tsv</content-format>',
    `  <content>${escapeXml(reference.contentTsv || '')}</content>`,
    '</selected-xlsx>',
  ].join('\n')
}

export function parseSelectedXlsx(text) {
  if (!text) return null

  const blockRegex = /<selected-xlsx>\s*[\s\S]*?<\/selected-xlsx>/
  const blockMatch = text.match(blockRegex)
  if (!blockMatch) return null
  if (typeof DOMParser === 'undefined') return null

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(`<root>${blockMatch[0]}</root>`, 'application/xml')
    if (doc.querySelector('parsererror')) return null

    const selectedNode = doc.querySelector('selected-xlsx')
    if (!selectedNode) return null

    const cleanText = text.replace(blockRegex, '').trim()
    const rawSheetIndex = getNodeText(selectedNode, 'sheet-index')
    const parsedSheetIndex = Number(rawSheetIndex)

    return {
      filePath: getNodeText(selectedNode, 'file-path'),
      sheetIndex: Number.isFinite(parsedSheetIndex) ? parsedSheetIndex : 0,
      sheetName: getNodeText(selectedNode, 'sheet-name'),
      range: getNodeText(selectedNode, 'range'),
      contentFormat: getNodeText(selectedNode, 'content-format') || 'tsv',
      contentTsv: getNodeText(selectedNode, 'content'),
      cleanText,
    }
  } catch {
    return null
  }
}
