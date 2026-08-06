const numericFields = new Set(['duration_ms', 'num_turns'])

function fieldValue(run, field) {
  const value = run?.[field]
  if (value == null || value === '') return null
  if (field === 'started_at') {
    const timestamp = Date.parse(value)
    return Number.isNaN(timestamp) ? null : timestamp
  }
  if (numericFields.has(field)) {
    const numeric = Number(value)
    return Number.isNaN(numeric) ? null : numeric
  }
  return String(value).toLocaleLowerCase()
}

function compareValues(left, right, direction) {
  const leftMissing = left == null
  const rightMissing = right == null
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0
    return leftMissing ? 1 : -1
  }

  let result = 0
  if (typeof left === 'string') result = left.localeCompare(right)
  else result = left - right
  return direction === 'asc' ? result : -result
}

export function sortRunHistory(runs, field = 'started_at', direction = 'desc') {
  return (runs || [])
    .map((run, index) => ({ run, index }))
    .sort((left, right) => {
      const result = compareValues(
        fieldValue(left.run, field),
        fieldValue(right.run, field),
        direction,
      )
      return result || left.index - right.index
    })
    .map(({ run }) => run)
}
