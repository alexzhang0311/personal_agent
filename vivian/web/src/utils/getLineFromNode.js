// Resolve a range container + offset to a line number (1-based).
// When selecting across multiple table cells, browsers often set the range
// container to <tbody> or <table> with an offset pointing at child rows,
// rather than a node inside a specific <td>.
export default function getLineFromNode(node, offset) {
  if (!node) return null
  let el = node.nodeType === 3 ? node.parentElement : node
  if (!el) return null
  // If container is tbody/table, use offset to pick the row directly
  if (el.tagName === 'TBODY') {
    const row = el.rows[Math.min(offset, el.rows.length - 1)]
    return row ? row.rowIndex + 1 : null
  }
  if (el.tagName === 'TABLE') {
    const tbody = el.tBodies[0]
    if (!tbody) return null
    const row = tbody.rows[Math.min(offset, tbody.rows.length - 1)]
    return row ? row.rowIndex + 1 : null
  }
  // Normal case: walk up from a node inside a <td> to find the <tr>
  while (el && el.tagName !== 'TR') el = el.parentElement
  if (!el) return null
  return el.rowIndex + 1
}
