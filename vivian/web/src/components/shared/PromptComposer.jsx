import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, FileText, Upload, Loader, AlertTriangle, Maximize2, Ban, ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import { uploadFile, deleteUploadedFile, listUploadedFiles } from '../../api/files'
import { listDirectory } from '../../api/userFiles'
import { processImage } from '../../utils/imageCompression'
import SkillPicker, { getFilteredSkills } from '../chat/SkillPicker'
import FilePicker, { getFilteredFiles } from '../chat/FilePicker'

const MAX_FILE_SIZE = 3 * 1024 * 1024 // 3MB
const MAX_FILES = 5
const ALLOWED_EXTENSIONS = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.pdf', '.zip',
  '.txt', '.csv', '.json', '.xml', '.md', '.log',
  '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.py', '.js', '.ts', '.jsx', '.tsx',
  '.html', '.css', '.sh', '.sql',
  '.r', '.lua', '.swift', '.kt', '.scala',
  '.go', '.rs', '.java', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp',
  '.env', '.dockerfile',
])

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const EXPAND_BUTTON_GUTTER = 40

function isImageFile(name) {
  return IMAGE_EXTENSIONS.has(getFileExtension(name))
}

function getFileExtension(name) {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function normalizePath(path) {
  if (!path) return ''
  if (path === '/') return '/'
  return path.replace(/\/+$/, '')
}

function joinPath(base, name) {
  if (!base || base === '/') return `/${name}`
  return `${normalizePath(base)}/${name}`
}

// Measure caret pixel coordinates inside a <textarea> via a hidden mirror
// element that copies the textarea's typographic styles. Coordinates returned
// are relative to the textarea's border box top-left.
const CARET_MIRROR_PROPS = [
  'boxSizing',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
  'fontSizeAdjust', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'textDecoration',
  'letterSpacing', 'wordSpacing', 'tabSize',
]

function getCaretCoordinates(el, position) {
  if (!el) return { top: 0, left: 0, height: 0 }
  const style = window.getComputedStyle(el)
  const div = document.createElement('div')
  div.style.position = 'absolute'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordWrap = 'break-word'
  div.style.top = '0'
  div.style.left = '-9999px'
  div.style.width = `${el.offsetWidth}px`
  div.style.height = 'auto'
  CARET_MIRROR_PROPS.forEach((prop) => {
    if (style[prop]) div.style[prop] = style[prop]
  })
  document.body.appendChild(div)

  div.textContent = el.value.substring(0, position)
  const span = document.createElement('span')
  span.textContent = el.value.substring(position) || '.'
  div.appendChild(span)

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
  const coords = {
    top: span.offsetTop,
    left: span.offsetLeft,
    height: lineHeight,
  }
  document.body.removeChild(div)
  return coords
}

/**
 * PromptComposer — reusable rich prompt input with file/image attachments,
 * skill picker (/), file picker (@), drag-and-drop, and keyboard nav.
 *
 * Props:
 *   value          — controlled text value
 *   onChange        — text change handler
 *   attachments    — [{id, name, size, status, isImage, ...}]
 *   onAttachmentsChange — setter for attachment array
 *   skill          — {name, level} | null
 *   onSkillChange  — skill change handler
 *   placeholder    — textarea placeholder
 *   minHeight      — textarea min-height (default 84)
 *   onKeyDown      — optional additional keydown handler (called after internal handling)
 *   textareaRef    — optional external ref for the textarea
 *   toolbarRight   — optional ReactNode rendered in the right side of the toolbar
 *   toolbarLeft    — optional ReactNode rendered after the + button in toolbar left
 *   beforeTextarea — optional ReactNode rendered before the textarea (e.g. quote badge)
 *   afterImages    — optional ReactNode rendered after image thumbnails (e.g. vision hints)
 *   plusMenuExtra   — optional ReactNode rendered inside the + dropdown after "Upload file"
 *   currentDirectory — directory whose files are available through @ references
 *   disabled       — disable the textarea
 */
export default function PromptComposer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  skill,
  onSkillChange,
  placeholder,
  minHeight = 84,
  onKeyDown: externalKeyDown,
  textareaRef: externalTextareaRef,
  toolbarRight,
  toolbarLeft,
  plusMenuExtra,
  beforeTextarea,
  afterImages,
  currentDirectory,
  disabled,
  onRegisterWarn,
}) {
  const { t } = useTranslation()
  const internalTextareaRef = useRef(null)
  const textareaRef = externalTextareaRef || internalTextareaRef
  const fileInputRef = useRef(null)
  const containerRef = useRef(null)
  const modalTextareaRef = useRef(null)

  // Expanded modal for long-form text entry
  const [expanded, setExpanded] = useState(false)
  // Caret-anchored picker position inside the expanded modal
  const [expandedPickerRect, setExpandedPickerRect] = useState({ top: 0, left: 0 })

  // Skill picker state
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const [activeSkillIndex, setActiveSkillIndex] = useState(0)
  const availableSkills = useChatStore((s) => s.availableSkills)
  const skillsLoaded = useChatStore((s) => s.skillsLoaded)
  const fetchAvailableSkills = useChatStore((s) => s.fetchAvailableSkills)

  // File picker state
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [filePickerQuery, setFilePickerQuery] = useState('')
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [availableFiles, setAvailableFiles] = useState([])
  const [filesLoaded, setFilesLoaded] = useState(false)

  // Dropdown & drag state. The compact toolbar and the expand-modal footer each
  // have their own + button, so they need separate open-state flags — sharing one
  // flag plus two anchor positions causes the dropdown to appear in both places.
  const [showCompactPlusMenu, setShowCompactPlusMenu] = useState(false)
  const [showModalPlusMenu, setShowModalPlusMenu] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // File upload warning notifications
  const [fileWarnings, setFileWarnings] = useState([])
  const addFileWarning = useCallback((message) => {
    const id = `warn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setFileWarnings((prev) => [...prev.slice(-2), { id, message, fading: false }])
    setTimeout(() => {
      setFileWarnings((prev) => prev.map((w) => w.id === id ? { ...w, fading: true } : w))
      setTimeout(() => {
        setFileWarnings((prev) => prev.filter((w) => w.id !== id))
      }, 150)
    }, 3000)
  }, [])

  // Let the host (e.g. ChatInput) surface warnings in the composer's own
  // notification slot — used for "failed attachments were kept" on send.
  useEffect(() => {
    if (onRegisterWarn) onRegisterWarn(addFileWarning)
  }, [onRegisterWarn, addFileWarning])

  const filteredSkills = useMemo(
    () => getFilteredSkills(availableSkills, skillQuery),
    [availableSkills, skillQuery]
  )

  const filteredFiles = useMemo(
    () => getFilteredFiles(availableFiles, filePickerQuery),
    [availableFiles, filePickerQuery]
  )

  // Reset active index when filtered list changes
  useEffect(() => { setActiveSkillIndex(0) }, [filteredSkills.length])
  useEffect(() => { setActiveFileIndex(0) }, [filteredFiles.length])

  // Recompute caret-anchored picker position whenever the modal is open and
  // a picker is visible. Runs on any input change so the popup tracks the caret.
  useEffect(() => {
    if (!expanded) return
    if (!showSkillPicker && !showFilePicker) return
    const ta = modalTextareaRef.current
    if (!ta) return
    const modal = ta.closest('.prompt-expand-modal')
    if (!modal) return

    const caret = getCaretCoordinates(ta, ta.selectionStart ?? 0)
    const taBox = ta.getBoundingClientRect()
    const modalBox = modal.getBoundingClientRect()
    const taOffsetLeft = taBox.left - modalBox.left
    const taOffsetTop = taBox.top - modalBox.top

    const GAP = 4
    const PICKER_WIDTH = 560
    const PICKER_MAX_HEIGHT = 280
    const EDGE = 16
    const FOOTER_RESERVE = 48

    let left = taOffsetLeft + caret.left - ta.scrollLeft
    let top = taOffsetTop + caret.top - ta.scrollTop + caret.height + GAP

    const modalWidth = modal.clientWidth
    const modalHeight = modal.clientHeight

    if (left + PICKER_WIDTH > modalWidth - EDGE) {
      left = Math.max(EDGE, modalWidth - PICKER_WIDTH - EDGE)
    }
    if (left < EDGE) left = EDGE

    // Flip above the caret if there isn't room below.
    if (top + PICKER_MAX_HEIGHT > modalHeight - FOOTER_RESERVE) {
      const aboveTop = taOffsetTop + caret.top - ta.scrollTop - GAP - PICKER_MAX_HEIGHT
      top = Math.max(EDGE, aboveTop)
    }

    setExpandedPickerRect({ top, left })
  }, [expanded, showSkillPicker, showFilePicker, value, skillQuery, filePickerQuery])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }
  }, [value, textareaRef])

  // Focus management for the expanded modal.
  // When opening, focus the modal textarea and place cursor at end of the text.
  // When closing, restore focus to the compact textarea.
  const expandedInitializedRef = useRef(false)
  useEffect(() => {
    if (!expandedInitializedRef.current) {
      expandedInitializedRef.current = true
      return
    }
    if (expanded) {
      requestAnimationFrame(() => {
        const el = modalTextareaRef.current
        if (el) {
          el.focus()
          const len = el.value?.length ?? 0
          el.setSelectionRange(len, len)
        }
      })
    } else {
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }
  }, [expanded, textareaRef])

  const handleModalKeyDown = (e) => {
    // File picker nav/select/escape — mirrors the compact path so `@` works the same way.
    if (showFilePicker) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveFileIndex((i) => (i + 1) % Math.max(filteredFiles.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveFileIndex((i) => (i - 1 + filteredFiles.length) % Math.max(filteredFiles.length, 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredFiles.length > 0) {
          e.preventDefault()
          handleFileSelect(filteredFiles[activeFileIndex])
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowFilePicker(false)
        return
      }
    }
    // Skill picker nav/select/escape — mirrors the compact path so `/` works the same way.
    if (showSkillPicker) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSkillIndex((i) => (i + 1) % Math.max(filteredSkills.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSkillIndex((i) => (i - 1 + filteredSkills.length) % Math.max(filteredSkills.length, 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredSkills.length > 0) {
          e.preventDefault()
          handleSkillSelect(filteredSkills[activeSkillIndex]?.name)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSkillPicker(false)
        return
      }
    }
    // ESC with no picker open → close the modal itself
    if (e.key === 'Escape') {
      e.preventDefault()
      setExpanded(false)
      return
    }
    // Ctrl/Cmd+Enter → send from inside the modal
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      setExpanded(false)
      if (externalKeyDown) {
        externalKeyDown({
          key: 'Enter',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          preventDefault: () => {},
          stopPropagation: () => {},
          target: modalTextareaRef.current,
        })
      }
      return
    }
    // Backspace on empty input → dismiss last skill / attachment (same as compact)
    if (e.key === 'Backspace' && !value) {
      if (skill) {
        e.preventDefault()
        handleDismissSkill()
        return
      }
      if (attachments.length > 0) {
        e.preventDefault()
        const last = attachments[attachments.length - 1]
        handleRemoveAttachment(last)
        return
      }
    }
    // Plain Enter in modal = newline (NOT send). Do nothing — let the browser insert the newline.
    // We intentionally do NOT forward to externalKeyDown here, because ChatInput's handler
    // treats plain Enter as send, which would conflict with the "large text input" intent.
  }

  // Close plus menus on click outside. Each menu gets its own handler so they
  // can't accidentally close one another.
  useEffect(() => {
    if (!showCompactPlusMenu) return
    const handler = () => setShowCompactPlusMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showCompactPlusMenu])

  useEffect(() => {
    if (!showModalPlusMenu) return
    const handler = () => setShowModalPlusMenu(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showModalPlusMenu])

  // Reset the modal + menu when the modal closes so it isn't stuck open on re-entry.
  useEffect(() => {
    if (!expanded) setShowModalPlusMenu(false)
  }, [expanded])

  // Helper to update a single attachment
  const updateAttachment = useCallback((id, data) => {
    onAttachmentsChange((prev) => prev.map((a) => a.id === id ? { ...a, ...data } : a))
  }, [onAttachmentsChange])

  // Helper to add an attachment
  const addAttachment = useCallback((att) => {
    onAttachmentsChange((prev) => [...prev, att])
  }, [onAttachmentsChange])

  // File upload handler
  const handleFiles = useCallback(async (files) => {
    // Snapshot the (possibly live) FileList — clearing the input or starting a
    // new selection mid-await would otherwise drop files 2..N.
    files = Array.from(files)
    const currentCount = attachments.length
    for (let i = 0; i < files.length; i++) {
      if (currentCount + i >= MAX_FILES) {
        addFileWarning(t('chat.maxFilesReached'))
        break
      }
      const file = files[i]

      // Image files: process client-side as base64
      if (isImageFile(file.name) || file.type.startsWith('image/')) {
        if (file.size > MAX_FILE_SIZE * 2) {
          addFileWarning(`${t('chat.imageTooLarge')}: "${file.name}"`)
          continue
        }
        const id = `img-${Date.now()}-${i}`
        const previewUrl = URL.createObjectURL(file)
        addAttachment({ id, name: file.name, size: file.size, status: 'processing', isImage: true, mediaType: file.type, previewUrl })
        try {
          const { base64, mediaType, finalSize } = await processImage(file, MAX_FILE_SIZE)
          updateAttachment(id, { status: 'done', base64Data: base64, mediaType, size: finalSize })
        } catch (err) {
          updateAttachment(id, { status: 'error', error: String(err?.message || err) })
        }
        continue
      }

      // Regular files: upload to server
      const ext = getFileExtension(file.name)
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        addFileWarning(`${t('chat.unsupportedType')}: "${file.name}"`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        addFileWarning(`${t('chat.fileTooLarge')}: "${file.name}"`)
        continue
      }
      const id = `att-${Date.now()}-${i}`
      addAttachment({ id, name: file.name, size: file.size, status: 'uploading', path: null })
      try {
        const result = await uploadFile(file)
        updateAttachment(id, { status: 'done', path: result.path, serverName: result.filesystem_name, originalName: result.upload_name, uuid: result.uuid })
      } catch (err) {
        updateAttachment(id, { status: 'error', error: String(err?.message || err) })
      }
    }
  }, [attachments.length, addAttachment, updateAttachment, addFileWarning, t])

  const handleRemoveAttachment = useCallback(async (att) => {
    onAttachmentsChange((prev) => prev.filter((a) => a.id !== att.id))
    if (att.status === 'done') {
      const deleteId = att.uuid || att.serverName
      if (deleteId) {
        try { await deleteUploadedFile(deleteId) } catch { /* ignore */ }
      }
    }
  }, [onAttachmentsChange])

  // Bulk-clear all attachments at once. We snapshot first because the setter
  // wipes state immediately, then best-effort delete server-side files for
  // `done` non-image entries. `uploading`/`processing` items have no server
  // handle yet — the 24h TTL collects them.
  const handleClearAll = useCallback(async () => {
    const snapshot = attachments
    onAttachmentsChange(() => [])
    await Promise.all(snapshot.map(async (att) => {
      if (att.isImage || att.status !== 'done') return
      const deleteId = att.uuid || att.serverName
      if (!deleteId) return
      try { await deleteUploadedFile(deleteId) } catch { /* ignore */ }
    }))
  }, [attachments, onAttachmentsChange])

  // Drag & drop handlers. A depth counter tracks nested dragenter/dragleave
  // pairs — child elements firing dragleave would otherwise flicker the overlay.
  const dragDepthRef = useRef(0)
  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setIsDragging(true)
  }, [])
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])
  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }, [])
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDragging(false)
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  // Clipboard paste handler for images
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      handleFiles(imageFiles)
    }
  }, [handleFiles])

  const fetchFiles = useCallback(async () => {
    setFilesLoaded(false)
    try {
      const [uploadedResult, currentDirResult] = await Promise.allSettled([
        listUploadedFiles(),
        currentDirectory ? listDirectory(currentDirectory) : Promise.resolve(null),
      ])

      const uploadedFiles = uploadedResult.status === 'fulfilled'
        ? (uploadedResult.value.files || []).map((file) => ({ ...file, source: 'uploaded' }))
        : []

      const currentDirFiles = currentDirResult.status === 'fulfilled' && currentDirResult.value
        ? (currentDirResult.value.entries || [])
          .filter((entry) => entry.type === 'file')
          .map((entry) => {
            const directory = currentDirResult.value.path || currentDirectory
            const path = joinPath(directory, entry.name)
            return {
              source: 'current',
              uuid: `current:${path}`,
              name: entry.name,
              original_name: entry.name,
              size: entry.size,
              modified: entry.modified,
              path,
              directory,
            }
          })
        : []

      setAvailableFiles([...uploadedFiles, ...currentDirFiles])
    } catch {
      setAvailableFiles([])
    } finally {
      setFilesLoaded(true)
    }
  }, [currentDirectory])

  useEffect(() => {
    setAvailableFiles([])
    setFilesLoaded(false)
  }, [currentDirectory])

  const handleInputChange = (e) => {
    const val = e.target.value
    onChange(val)

    // Don't trigger slash picker when a skill chip is already selected
    if (skill) return

    // Slash command detection: only at position 0
    if (val.startsWith('/')) {
      const firstSpace = val.indexOf(' ')
      if (firstSpace === -1) {
        const query = val.slice(1)
        setSkillQuery(query)
        if (!showSkillPicker) {
          setShowSkillPicker(true)
          if (!skillsLoaded) fetchAvailableSkills()
        }
      } else {
        setShowSkillPicker(false)
      }
      setShowFilePicker(false)
      return
    } else {
      setShowSkillPicker(false)
    }

    // File reference detection: @ anywhere in input
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = val.slice(0, cursorPos)
    const lastHash = textBeforeCursor.lastIndexOf('@')
    if (lastHash >= 0) {
      const afterHash = textBeforeCursor.slice(lastHash + 1)
      if (!afterHash.includes(' ')) {
        setFilePickerQuery(afterHash)
        if (!showFilePicker) {
          setShowFilePicker(true)
          if (!filesLoaded) fetchFiles()
        }
        return
      }
    }
    setShowFilePicker(false)
  }

  // Focus the active textarea — modal when expanded, compact otherwise.
  const focusActiveTextarea = () => {
    const el = expanded ? modalTextareaRef.current : textareaRef.current
    el?.focus()
  }

  const handleSkillSelect = (skillName) => {
    const s = availableSkills.find((sk) => sk.name === skillName)
    onSkillChange(s ? { name: s.name, level: s.level } : { name: skillName, level: 'project' })
    onChange('')
    setShowSkillPicker(false)
    setSkillQuery('')
    setTimeout(() => focusActiveTextarea(), 0)
  }

  const handleFileSelect = (file) => {
    const el = expanded ? modalTextareaRef.current : textareaRef.current
    const cursorPos = el?.selectionStart || value.length
    const textBeforeCursor = value.slice(0, cursorPos)
    const lastHash = textBeforeCursor.lastIndexOf('@')
    const textAfterQuery = value.slice(cursorPos)
    const newText = value.slice(0, lastHash) + textAfterQuery
    onChange(newText.trim() ? newText : '')
    setShowFilePicker(false)
    setFilePickerQuery('')

    const id = `att-${Date.now()}-ref`
    addAttachment({
      id,
      name: file.original_name || file.name,
      size: file.size,
      status: 'done',
      path: file.path,
      serverName: file.source === 'uploaded' ? file.stored_name : undefined,
      originalName: file.original_name || file.name,
      uuid: file.source === 'uploaded' ? file.uuid : undefined,
    })

    setTimeout(() => el?.focus(), 0)
  }

  const handleDismissSkill = () => {
    onSkillChange(null)
    onChange('')
    setTimeout(() => focusActiveTextarea(), 0)
  }

  const handleKeyDown = (e) => {
    if (showFilePicker) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveFileIndex((i) => (i + 1) % Math.max(filteredFiles.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveFileIndex((i) => (i - 1 + filteredFiles.length) % Math.max(filteredFiles.length, 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredFiles.length > 0) {
          e.preventDefault()
          handleFileSelect(filteredFiles[activeFileIndex])
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowFilePicker(false)
        return
      }
    }
    if (showSkillPicker) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSkillIndex((i) => (i + 1) % Math.max(filteredSkills.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSkillIndex((i) => (i - 1 + filteredSkills.length) % Math.max(filteredSkills.length, 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredSkills.length > 0) {
          e.preventDefault()
          handleSkillSelect(filteredSkills[activeSkillIndex]?.name)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSkillPicker(false)
        return
      }
    }
    // Backspace on empty input: skill chip → last attachment
    if (e.key === 'Backspace' && !value) {
      if (skill) {
        e.preventDefault()
        handleDismissSkill()
        return
      }
      if (attachments.length > 0) {
        e.preventDefault()
        const last = attachments[attachments.length - 1]
        handleRemoveAttachment(last)
        return
      }
    }
    // Forward to external handler
    if (externalKeyDown) externalKeyDown(e)
  }

  const imageAtts = attachments.filter((a) => a.isImage)
  const fileAtts = attachments.filter((a) => !a.isImage)

  // Inline "clear N" pill shown when the user has at least 2 attachments — one-by-one
  // dismiss is fine for a single chip but tedious near the 5-file cap.
  const clearAllPill = attachments.length >= 2 ? (
    <button
      type="button"
      className="inline-flex items-center gap-1 uppercase"
      style={{
        background: 'var(--bg-surface)',
        borderLeft: '2px solid var(--text-dim)',
        borderRadius: 2,
        padding: '4px 8px',
        fontSize: 11,
        letterSpacing: '0.06em',
        color: 'var(--text-dim)',
        fontWeight: 600,
        cursor: 'pointer',
        border: 'none',
        transition: 'color 150ms ease',
      }}
      onClick={handleClearAll}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
    >
      <Ban size={12} strokeWidth={1.5} />
      {t('chat.clearAll', { count: attachments.length })}
    </button>
  ) : null

  // Render function so both the compact toolbar and the modal footer can show
  // the same dropdown. `close` lets each call site close only its own popover.
  const renderPlusDropdown = (close) => (
    <div
      className="absolute"
      style={{
        bottom: '100%', left: 0, marginBottom: 4,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 4, minWidth: 200, zIndex: 20,
      }}
    >
      <button
        className="flex items-center gap-2 px-3 py-2 w-full text-sm"
        style={{
          background: 'transparent', border: 'none',
          color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left',
          fontFamily: "'Noto Sans', sans-serif", fontSize: 13, transition: 'background 150ms ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        onClick={(e) => {
          e.stopPropagation()
          close()
          fileInputRef.current?.click()
        }}
      >
        <Upload size={14} strokeWidth={1.5} />
        {t('chat.uploadFile')}
      </button>
      {plusMenuExtra}
    </div>
  )

  return (
    <>
      {/* File upload warnings */}
      {fileWarnings.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {fileWarnings.map((w) => (
            <div
              key={w.id}
              className="flex items-center gap-2 px-3 py-2"
              style={{
                background: 'var(--bg-elevated)',
                borderLeft: '2px solid var(--yellow)',
                borderRadius: 2,
                fontSize: 13,
                color: 'var(--text-secondary)',
                opacity: w.fading ? 0 : 1,
                transition: 'opacity 150ms ease',
              }}
            >
              <AlertTriangle size={14} strokeWidth={1.5} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
              {w.message}
            </div>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        className="flex flex-col rounded relative"
        style={{
          background: 'var(--bg-elevated)',
          border: isDragging ? '1px solid var(--blue)' : '1px solid var(--border)',
          transition: 'border-color 150ms ease',
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Expand-to-modal button (top-right corner) */}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title={t('chat.expandInput', 'Expand input')}
          className="absolute flex items-center justify-center"
          style={{
            top: 6,
            right: 6,
            width: 24,
            height: 24,
            background: 'transparent',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            zIndex: 5,
            transition: 'color 150ms ease, background 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.background = 'var(--bg-surface)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-dim)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Maximize2 size={13} strokeWidth={1.5} />
        </button>

        {/* Drag overlay */}
        {isDragging && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              background: 'var(--bg-overlay)',
              borderRadius: 4,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            <div className="flex items-center gap-2" style={{ color: 'var(--blue)', fontSize: 13, fontWeight: 600 }}>
              <Upload size={16} strokeWidth={1.5} />
              {t('chat.dragDropHint')}
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          accept={Array.from(ALLOWED_EXTENSIONS).join(',')}
          onChange={(e) => {
            const picked = Array.from(e.target.files || [])
            e.target.value = ''
            if (picked.length) handleFiles(picked)
          }}
        />

        {/* Skill/file picker dropdowns — only render in the compact container when
            the modal is closed. When expanded, the pickers render inside the modal. */}
        {!expanded && showSkillPicker && (
          <SkillPicker
            skills={availableSkills}
            query={skillQuery}
            onSelect={handleSkillSelect}
            onClose={() => setShowSkillPicker(false)}
            activeIndex={activeSkillIndex}
            loading={!skillsLoaded}
          />
        )}
        {!expanded && showFilePicker && (
          <FilePicker
            files={availableFiles}
            query={filePickerQuery}
            onSelect={handleFileSelect}
            onClose={() => setShowFilePicker(false)}
            activeIndex={activeFileIndex}
            loading={!filesLoaded}
          />
        )}

        {/* Selected skill chip */}
        {skill && (
          <div
            className="flex items-center gap-2 px-3 pt-3 pb-0"
            style={{ paddingRight: EXPAND_BUTTON_GUTTER }}
          >
            <div
              className="flex items-center gap-2 px-2 py-1"
              style={{
                background: 'var(--bg-surface)',
                borderLeft: '2px solid var(--purple)',
                borderRadius: 2,
              }}
            >
              <ScrollText size={12} strokeWidth={1.5} style={{ color: 'var(--purple)', flexShrink: 0 }} />
              <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 13, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                skill:
              </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 13, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace" }}>
                {skill.name}
              </span>
              <span className="uppercase flex-shrink-0" style={{ color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.06em', fontWeight: 600 }}>
                {skill.level === 'project' ? t('skillPicker.project') : t('skillPicker.global')}
              </span>
              <button
                className="flex items-center justify-center"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, marginLeft: 2, transition: 'color 150ms ease' }}
                onClick={handleDismissSkill}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}

        {/* Slot: beforeTextarea (e.g. quote badge) */}
        {beforeTextarea && (
          <div style={{ paddingRight: EXPAND_BUTTON_GUTTER }}>
            {beforeTextarea}
          </div>
        )}

        {/* Image thumbnail strip */}
        {imageAtts.length > 0 && (
          <div
            className="flex items-center gap-2 px-3 pt-2 pb-0"
            style={{ overflowX: 'auto', paddingRight: EXPAND_BUTTON_GUTTER }}
          >
            {imageAtts.map((att) => (
              <div key={att.id} className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                {att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }}
                  />
                ) : (
                  <div style={{ width: 64, height: 64, borderRadius: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
                )}
                <button
                  onClick={() => handleRemoveAttachment(att)}
                  className="absolute flex items-center justify-center"
                  style={{
                    top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    cursor: 'pointer', color: 'var(--text-dim)', padding: 0,
                  }}
                >
                  <X size={10} strokeWidth={1.5} />
                </button>
                {att.status === 'processing' && (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--bg-overlay)', borderRadius: 4 }}>
                    <div className="skeleton" style={{ width: '80%', height: 4, borderRadius: 2 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Image-only standalone Clear row — when no file chips host the pill,
            but we still want bulk clear for ≥2 attachments. */}
        {attachments.length >= 2 && fileAtts.length === 0 && (
          <div
            className="flex items-center justify-end px-3 pt-2 pb-0"
            style={{ paddingRight: EXPAND_BUTTON_GUTTER }}
          >
            {clearAllPill}
          </div>
        )}

        {/* Slot: afterImages (e.g. vision model hints) */}
        {afterImages}

        {/* File attachment chips */}
        {fileAtts.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1 px-3 pt-2 pb-0"
            style={{ paddingRight: EXPAND_BUTTON_GUTTER }}
          >
            {fileAtts.map((att) => {
              const borderColor = att.status === 'done' ? 'var(--cyan)' : att.status === 'uploading' ? 'var(--yellow)' : 'var(--red)'
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-1 px-2 py-1"
                  style={{ background: 'var(--bg-surface)', borderLeft: `2px solid ${borderColor}`, borderRadius: 2, maxWidth: 200 }}
                >
                  {att.status === 'uploading' ? (
                    <Loader size={12} strokeWidth={1.5} style={{ color: 'var(--yellow)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <FileText size={12} strokeWidth={1.5} style={{ color: borderColor, flexShrink: 0 }} />
                  )}
                  <span
                    className="truncate"
                    style={{ color: 'var(--text-secondary)', fontSize: 12, fontFamily: "'JetBrains Mono', 'Source Han Mono SC', monospace", maxWidth: 130 }}
                    title={att.status === 'error'
                      ? `${att.name} — ${att.error || t('chat.uploadFailed')}`
                      : att.name}
                  >
                    {att.name}
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 11, flexShrink: 0 }}>
                    {formatSize(att.size)}
                  </span>
                  <button
                    className="flex items-center justify-center"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 0, marginLeft: 2, transition: 'color 150ms ease' }}
                    onClick={() => handleRemoveAttachment(att)}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </div>
              )
            })}
            {clearAllPill}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="flex-1 px-3 pb-2 text-sm chat-textarea"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            resize: 'none',
            outline: 'none',
            fontFamily: "'Noto Sans', sans-serif",
            fontSize: 14,
            lineHeight: 1.5,
            minHeight: (skill || attachments.length > 0) ? 52 : minHeight,
            maxHeight: 200,
            paddingTop: (skill || attachments.length > 0) ? 8 : 12,
          }}
          placeholder={skill ? t('skillPicker.instructionPlaceholder') : (placeholder || t('chat.placeholder'))}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => { if (containerRef.current) containerRef.current.style.borderColor = 'var(--border-strong)' }}
          onBlur={() => { if (containerRef.current && !isDragging) containerRef.current.style.borderColor = 'var(--border)' }}
          rows={1}
          disabled={disabled}
        />

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          {/* Left: + button + optional extra */}
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                className="flex items-center justify-center"
                style={{
                  width: 28, height: 28,
                  background: 'transparent', border: 'none', borderRadius: '4px',
                  cursor: 'pointer', color: 'var(--text-dim)', transition: 'color 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowCompactPlusMenu(!showCompactPlusMenu)
                }}
                title={t('chat.attach')}
              >
                <Plus size={16} strokeWidth={1.5} />
              </button>

              {/* Dropdown menu */}
              {showCompactPlusMenu && renderPlusDropdown(() => setShowCompactPlusMenu(false))}
            </div>
            {toolbarLeft}
          </div>

          {/* Right: optional extra */}
          <div className="flex items-center gap-1">
            {toolbarRight}
          </div>
        </div>
      </div>

      {/* Expanded modal — large textarea overlay for long-form text entry */}
      {expanded && createPortal(
        <div
          className="prompt-expand-backdrop"
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg-overlay)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            className="prompt-expand-modal flex flex-col relative"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '70vw',
              maxWidth: 1100,
              height: '70vh',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
            }}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              title={t('chat.collapseInput', 'Close (ESC)')}
              className="absolute flex items-center justify-center"
              style={{
                top: 8,
                right: 8,
                width: 28,
                height: 28,
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                color: 'var(--text-dim)',
                zIndex: 2,
                transition: 'color 150ms ease, background 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)'
                e.currentTarget.style.background = 'var(--bg-surface)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-dim)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <X size={16} strokeWidth={1.5} />
            </button>

            {/* Large textarea */}
            <textarea
              ref={modalTextareaRef}
              value={value}
              onChange={handleInputChange}
              onKeyDown={handleModalKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder || t('chat.placeholder')}
              className="flex-1 chat-textarea"
              disabled={disabled}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                resize: 'none',
                outline: 'none',
                fontFamily: "'Noto Sans', sans-serif",
                fontSize: 14,
                lineHeight: 1.6,
                padding: '44px 20px 12px 20px',
                width: '100%',
                minHeight: 0,
              }}
            />

            {/* Skill/file picker — caret-anchored inside the modal body so the
                popup appears directly under the text cursor, not pinned to the footer. */}
            {expanded && (showSkillPicker || showFilePicker) && (
              <div
                style={{
                  position: 'absolute',
                  top: expandedPickerRect.top,
                  left: expandedPickerRect.left,
                  width: 560,
                  zIndex: 5,
                }}
              >
                {showSkillPicker && (
                  <SkillPicker
                    skills={availableSkills}
                    query={skillQuery}
                    onSelect={handleSkillSelect}
                    onClose={() => setShowSkillPicker(false)}
                    activeIndex={activeSkillIndex}
                    loading={!skillsLoaded}
                    positionStyle={{ position: 'static' }}
                  />
                )}
                {showFilePicker && (
                  <FilePicker
                    files={availableFiles}
                    query={filePickerQuery}
                    onSelect={handleFileSelect}
                    onClose={() => setShowFilePicker(false)}
                    activeIndex={activeFileIndex}
                    loading={!filesLoaded}
                    positionStyle={{ position: 'static' }}
                  />
                )}
              </div>
            )}

            {/* Footer toolbar — left: + (upload), right: keyboard hint */}
            <div
              className="text-xs flex items-center justify-between"
              style={{
                padding: '6px 12px',
                color: 'var(--text-dim)',
                borderTop: '1px solid var(--border-subtle)',
                fontFamily: "'Noto Sans', sans-serif",
                letterSpacing: '0.02em',
              }}
            >
              <div className="relative">
                <button
                  type="button"
                  className="flex items-center justify-center"
                  style={{
                    width: 28, height: 28,
                    background: 'transparent', border: 'none', borderRadius: '4px',
                    cursor: 'pointer', color: 'var(--text-dim)', transition: 'color 150ms ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowModalPlusMenu((v) => !v)
                  }}
                  title={t('chat.attach')}
                >
                  <Plus size={16} strokeWidth={1.5} />
                </button>
                {showModalPlusMenu && renderPlusDropdown(() => setShowModalPlusMenu(false))}
              </div>
              <span>{t('chat.modalFooterHint')}</span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
