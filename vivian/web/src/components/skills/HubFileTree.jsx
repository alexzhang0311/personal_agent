import { useState, useMemo, useId } from 'react'
import { ChevronDown, Folder, FolderOpen, FileText, Search, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useResizable } from '../../hooks/useResizable'
import useSkillHubStore from '../../stores/skillHubStore'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

function filterTree(nodes, query) {
  if (!query) return nodes
  const lq = query.toLowerCase()
  const result = []
  for (const node of nodes) {
    if (node.type === 'directory') {
      const filteredChildren = node.children ? filterTree(node.children, query) : []
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
      if (hasMatchingDescendant(node.children, lq)) paths.add(path)
      if (node.name.toLowerCase().includes(lq)) paths.add(path)
      const childPaths = collectExpandedPaths(node.children, query, path)
      for (const p of childPaths) paths.add(p)
    }
  }
  return paths
}

export default function HubFileTree() {
  const { t } = useTranslation()
  const skillDetail = useSkillHubStore((s) => s.skillDetail)
  const detailLoading = useSkillHubStore((s) => s.detailLoading)
  const selectedSkill = useSkillHubStore((s) => s.selectedSkill)
  const selectedFile = useSkillHubStore((s) => s.selectedFile)
  const selectFile = useSkillHubStore((s) => s.selectFile)
  const fileTreeWidth = useSkillHubStore((s) => s.fileTreeWidth)
  const setFileTreeWidth = useSkillHubStore((s) => s.setFileTreeWidth)

  const [fileSearchQuery, setFileSearchQuery] = useState('')

  const { dragging, onMouseDown } = useResizable({
    initial: fileTreeWidth,
    min: 160,
    max: 400,
    direction: 'right',
    onResize: setFileTreeWidth,
  })

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
      className="flex flex-col flex-shrink-0 overflow-hidden relative"
      style={{
        width: fileTreeWidth,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
      }}
    >
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
