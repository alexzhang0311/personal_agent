export async function copyTextToClipboard(text) {
  const value = String(text ?? '')

  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch (error) {
      console.warn('[clipboard] navigator.clipboard.writeText failed, falling back to execCommand', error)
    }
  }

  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'

  const activeElement = document.activeElement
  const selection = window.getSelection()
  const savedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : []

  const container = document.body || document.documentElement
  container.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch (error) {
    console.warn('[clipboard] document.execCommand("copy") failed', error)
    copied = false
  } finally {
    container.removeChild(textarea)
    if (selection) {
      selection.removeAllRanges()
      savedRanges.forEach((range) => selection.addRange(range))
    }
    if (activeElement && typeof activeElement.focus === 'function') {
      activeElement.focus()
    }
  }

  return copied
}
