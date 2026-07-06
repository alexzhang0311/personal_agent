import { useState, useMemo, useId } from 'react'
import { ChevronDown, Folder, FolderOpen, FileText, Trash2, Search, BookOpen, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useResizable } from '../../hooks/useResizable'
import useSkillsStore from '../../stores/skillsStore'
import useAuthStore from '../../stores/authStore'
import useUiStore from '../../stores/uiStore'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

/**
 * Recursively filter a tree, keeping nodes whose name matches
 * the query and any directories that contain matching descendants.
 * Returns null if no match in this subtree.
 */
function filterTree(nodes, query) {
  if (!query) return nodes
  const lq = query.toLowerCase()
  const result = []
  for (const node of nodes) {
    if (node.type === 'directory') {
      const filteredChildren = node.children ? filterTree(node.children, query) : []
      // Keep directory if it matches or has matching children
      if (node.name.toLowerCase().includes(lq) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children })
      }
    } else {
      if (node.name.toLowerCase().includes(lq)) {
        result.push(node)
      }
    }
  }
  return result
}

/**
 * Collect all directory paths that contain matching files so we can auto-expand them.
 */
function hasMatchingDescendant(nodes, lq) {
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(lq)) return true
    if (node.type === 'directory' && node.children && hasMatchingDescendant(node.children, lq)) return true
  }
  return false
}

function collectExpandedPaths(nodes, query, parentPath = '') {
  if (!query) return new Set()
  const lq = query.toLowerCase()
  const paths = new Set()
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name
    if (node.type === 'directory' && node.children) {
      // Expand this directory if any descendant matches
      if (hasMatchingDescendant(node.children, lq)) {
        paths.add(path)
      }
      // Also expand if the directory name itself matches
      if (node.name.toLowerCase().includes(lq)) {
        paths.add(path)
      }
      // Recurse to expand nested directories
      const childPaths = collectExpandedPaths(node.children, query, path)
      for (const p of childPaths) paths.add(p)
    }
  }
  return paths
}

export default function SkillFileTree({ animKey }) {
  const { t } = useTranslation()
  const skillDetail = useSkillsStore((s) => s.skillDetail)
  const detailLoading = useSkillsStore((s) => s.detailLoading)
  const selectedSkill = useSkillsStore((s) => s.selectedSkill)
  const selectedFile = useSkillsStore((s) => s.selectedFile)
  const selectFile = useSkillsStore((s) => s.selectFile)
  const deleteSkill = useSkillsStore((s) => s.deleteSkill)
  const downloadSkill = useSkillsStore((s) => s.downloadSkill)
  const fileTreeWidth = useSkillsStore((s) => s.fileTreeWidth)
  const setFileTreeWidth = useSkillsStore((s) => s.setFileTreeWidth)
  const authUser = useAuthStore((s) => s.user)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)

  const [fileSearchQuery, setFileSearchQuery] = useState('')

  const { dragging, onMouseDown } = useResizable({
    initial: fileTreeWidth,
    min: 180,
    max: 480,
    direction: 'right',
    onResize: setFileTreeWidth,
  })

  const canDelete = selectedSkill?.level === 'project' || authUser?.role === 'admin'

  const handleDelete = () => {
    if (!selectedSkill) return
    showConfirmDialog({
      title: t('skills.deleteTitle'),
      message: t('skills.deleteMessage', { name: selectedSkill.name }),
      confirmLabel: t('sidebar.delete'),
      danger: true,
      requireText: selectedSkill.name,
      onConfirm: () => deleteSkill(selectedSkill.level, selectedSkill.name),
    })
  }

  const filteredTree = useMemo(() => {
    if (!skillDetail?.tree) return null
    if (!fileSearchQuery) return skillDetail.tree
    return filterTree(skillDetail.tree, fileSearchQuery)
  }, [skillDetail?.tree, fileSearchQuery])

  const forceExpandedPaths = useMemo(() => {
    if (!skillDetail?.tree || !fileSearchQuery) return new Set()
    return collectExpandedPaths(skillDetail.tree, fileSearchQuery)
  }, [skillDetail?.tree, fileSearchQuery])

  return (
    <div
      key={animKey}
      className="flex flex-col flex-shrink-0 overflow-hidden skill-drawer-left relative"
      style={{
        width: fileTreeWidth,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span
          className="font-semibold truncate flex-1"
          style={{ color: 'var(--text-primary)', fontSize: 14 }}
        >
          {skillDetail?.name || selectedSkill?.name}
        </span>
        <div className="flex items-center gap-3">
          <button
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', padding: 4,
              transition: 'color 150ms ease',
            }}
            onClick={() => selectedSkill && downloadSkill(selectedSkill.level, selectedSkill.name)}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--blue)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
            title={t('skills.download')}
          >
            <Download size={16} strokeWidth={1.5} />
          </button>
          {canDelete && (
            <button
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', padding: 4,
                transition: 'color 150ms ease',
              }}
              onClick={handleDelete}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
              title={t('skills.delete')}
            >
              <Trash2 size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* File search */}
      <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          className="flex items-center gap-1 px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
          }}
        >
          <Search size={12} strokeWidth={1.5} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            className="flex-1"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)', minWidth: 0, fontSize: 12,
            }}
            placeholder={t('skills.searchFiles')}
            value={fileSearchQuery}
            onChange={(e) => setFileSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {detailLoading ? (
          <div className="flex flex-col gap-1 px-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton" style={{ height: 24, borderRadius: 2 }} />
            ))}
          </div>
        ) : filteredTree ? (
          filteredTree.length > 0 ? (
            <>
              {/* Static root label with skill name */}
              <div
                className="flex items-center gap-1 py-1 pr-2"
                style={{
                  paddingLeft: 8,
                  color: 'var(--text-primary)',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <BookOpen size={12} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--blue)' }} />
                <span className="truncate">{skillDetail?.name || selectedSkill?.name}</span>
              </div>
              {filteredTree.map((node) => (
                <TreeNode
                  key={node.name}
                  node={node}
                  depth={1}
                  selectedFile={selectedFile}
                  onSelect={selectFile}
                  parentPath=""
                  forceExpandedPaths={forceExpandedPaths}
                />
              ))}
            </>
          ) : (
            <div className="px-3 py-4" style={{ color: 'var(--text-dim)', textAlign: 'center', fontSize: 12 }}>
              {t('skills.noSkills')}
            </div>
          )
        ) : null}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 4,
          cursor: 'col-resize',
          background: dragging ? 'var(--blue)' : 'transparent',
          transition: 'background 100ms ease',
          zIndex: 10,
        }}
        onMouseEnter={(e) => {
          if (!dragging) e.currentTarget.style.background = 'var(--blue)'
        }}
        onMouseLeave={(e) => {
          if (!dragging) e.currentTarget.style.background = 'transparent'
        }}
      />
    </div>
  )
}

function TreeNode({ node, depth, selectedFile, onSelect, parentPath, forceExpandedPaths }) {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name
  const bodyId = useId()
  const isForceExpanded = forceExpandedPaths.has(path)
  const [manualExpanded, setManualExpanded] = useState(node.name === 'SKILL.md' || depth === 0)
  const expanded = isForceExpanded || manualExpanded
  const isActive = selectedFile === path

  if (node.type === 'directory') {
    return (
      <>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex items-center gap-1 py-1 pr-2"
          style={{
            paddingLeft: 8 + depth * 16,
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontSize: 14,
            transition: 'background 150ms ease',
            background: 'transparent',
            border: 'none',
            width: '100%',
            textAlign: 'left',
          }}
          onClick={() => setManualExpanded(!expanded)}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <AnimatedChevron open={expanded}>
            <ChevronDown size={12} strokeWidth={1.5} />
          </AnimatedChevron>
          {expanded
            ? <FolderOpen size={12} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--yellow)' }} />
            : <Folder size={12} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--yellow)' }} />}
          <span className="truncate">{node.name}</span>
        </button>
        <AnimatedCollapse open={expanded} id={bodyId} animateHeight={false}>
          {() => node.children?.map((child) => (
            <TreeNode
              key={child.name}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
              parentPath={path}
              forceExpandedPaths={forceExpandedPaths}
            />
          ))}
        </AnimatedCollapse>
      </>
    )
  }

  return (
    <div
      className="flex items-center gap-1 py-1 pr-2"
      style={{
        paddingLeft: 8 + depth * 16 + 14,
        cursor: 'pointer',
        background: isActive ? 'var(--bg-elevated)' : 'transparent',
        color: isActive ? 'var(--blue)' : 'var(--text-secondary)',
        fontSize: 14,
        transition: 'background 150ms ease, color 150ms ease',
      }}
      onClick={() => onSelect(path)}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      <FileText size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />
      <span className="truncate">{node.name}</span>
    </div>
  )
}
