import { useState, useMemo, useEffect, useId, useRef } from 'react'
import { ChevronDown, Bot, Loader, CheckCircle, XCircle, ListTodo } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useChatStore from '../../stores/chatStore'
import useTaskStore from '../../stores/taskStore'
import useFileOpsStore from '../../stores/fileOpsStore'
import TodoItem from '../shared/TodoItem'
import MarkdownRenderer from '../markdown/MarkdownRenderer'
import ToolCallCard from '../chat/ToolCallCard'
import FileToolCard from '../chat/FileToolCard'
import ToolRunSection from '../chat/ToolRunSection'
import { AnimatedChevron, AnimatedCollapse } from '../shared/Accordion'

const statusIconMap = {
  running: { icon: Loader, color: 'var(--purple)', spinning: true },
  success: { icon: CheckCircle, color: 'var(--green)' },
  error: { icon: XCircle, color: 'var(--red)' },
  completed: { icon: CheckCircle, color: 'var(--green)' },
}

function getStatusMeta(status, isError = false) {
  const statusKey = isError ? 'error' : (status || 'running')
  return statusIconMap[statusKey] || statusIconMap.running
}

function isSubagentTool(block) {
  return block?.type === 'tool_use' && (block.name === 'Agent' || block.name === 'Task')
}

function isTodoWriteTool(block) {
  return block?.type === 'tool_use' && block.name === 'TodoWrite'
}

function isFileTool(block) {
  return block?.type === 'tool_use' && ['Read', 'Write', 'Edit'].includes(block.name)
}

function isCollapsibleInspectorToolBlock(block) {
  return block?.type === 'tool_use' && !isSubagentTool(block) && !isTodoWriteTool(block)
}

function isEmptyTextBlock(block) {
  return block?.type === 'text' && !block?.text?.trim()
}

function getInspectorToolRunKey(parentId, run, startIndex) {
  const first = run[0]
  return `${parentId || 'subagent'}-${first?.type || 'tool'}-${first?.id || startIndex}-${startIndex}`
}

function getContentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => block.text)
    .join(' ')
}

function compactText(text, limit = 64) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized
}

function extractTodosFromResult(block) {
  const result = block.result
  const toolUseResult = result?.tool_use_result || result?.toolUseResult
  const items = toolUseResult?.newTodos || toolUseResult?.todos || toolUseResult?.new_todos
  if (Array.isArray(items)) return items

  if (typeof result?.content !== 'string' || !result.content.trim()) return []
  try {
    const parsed = JSON.parse(result.content)
    if (Array.isArray(parsed)) return parsed
    const parsedItems = parsed?.newTodos || parsed?.todos || parsed?.new_todos
    return Array.isArray(parsedItems) ? parsedItems : []
  } catch {
    return []
  }
}

function getTodoItems(block) {
  return Array.isArray(block.input?.todos) ? block.input.todos : extractTodosFromResult(block)
}

function collectTrackedItems(blocks, subagentContent, depth = 0, seen = new Set()) {
  const items = []
  if (!Array.isArray(blocks)) return items

  for (const block of blocks) {
    if (isSubagentTool(block)) {
      const key = `subagent:${block.id}`
      const children = subagentContent[block.id] || []
      if (!seen.has(key)) {
        seen.add(key)
        items.push({
          id: key,
          type: 'subagent',
          depth,
          block,
          children,
        })
      }
      items.push(...collectTrackedItems(children, subagentContent, depth + 1, seen))
      continue
    }

    if (isTodoWriteTool(block)) {
      const key = `todo:${block.id}`
      if (!seen.has(key)) {
        seen.add(key)
        items.push({
          id: key,
          type: 'todo',
          depth,
          block,
          todos: getTodoItems(block),
        })
      }
    }
  }

  return items
}

function collectInspectorRounds(messages, subagentContent) {
  const rounds = []
  let turn = 0
  let latestUserText = ''

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user') {
      latestUserText = getContentText(message.content)
      continue
    }

    if (message.role !== 'assistant') continue
    turn += 1

    const items = collectTrackedItems(message.content, subagentContent)
    if (items.length === 0) continue

    rounds.push({
      id: message.uuid || `round-${index}`,
      number: turn,
      title: compactText(latestUserText) || `Round ${turn}`,
      items,
    })
  }

  return rounds
}

function getSubagentType(block) {
  return block.input?.subagent_type || (block.name === 'Task' ? 'Agent' : block.name || 'Agent')
}

function getSubagentDescription(block) {
  return block.input?.description || ''
}

function RoundSummary({ items }) {
  const agentCount = items.filter((item) => item.type === 'subagent').length
  const todoCount = items.filter((item) => item.type === 'todo').length
  const parts = []
  if (agentCount > 0) parts.push(`${agentCount} agent${agentCount === 1 ? '' : 's'}`)
  if (todoCount > 0) parts.push(`${todoCount} todo${todoCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function IconSlot({ children, width = 12 }) {
  return (
    <span
      className="flex-shrink-0 inline-flex items-center justify-center"
      style={{ width, height: 12 }}
    >
      {children}
    </span>
  )
}

function SubagentRow({ item, expanded, active, onClick, rowRef }) {
  const { t } = useTranslation()
  const fileOps = useFileOpsStore((s) => s.fileOps)
  const { block, children, depth } = item
  const bodyId = useId()
  const [collapsedToolSections, setCollapsedToolSections] = useState({})
  const status = block.status || 'running'
  const isError = status === 'error' || block.result?.is_error
  const { icon: StatusIcon, color, spinning } = getStatusMeta(status, isError)
  const toolUseCount = children.filter((child) => child.type === 'tool_use').length
  const indent = 12 + depth * 14
  const childIndent = 24 + depth * 14
  const agentType = getSubagentType(block)
  const description = getSubagentDescription(block)
  const prompt = block.input?.prompt

  const renderedChildren = []
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (isCollapsibleInspectorToolBlock(child)) {
      const runStartIndex = index
      const run = [child]
      while (index + 1 < children.length) {
        const nextChild = children[index + 1]
        if (isCollapsibleInspectorToolBlock(nextChild)) {
          index += 1
          run.push(children[index])
          continue
        }
        if (isEmptyTextBlock(nextChild)) {
          index += 1
          continue
        }
        break
      }

      const sectionKey = getInspectorToolRunKey(block.id, run, runStartIndex)
      const isCollapsed = collapsedToolSections[sectionKey] ?? true
      renderedChildren.push(
        <div
          key={`tool-run-${sectionKey}`}
          style={{
            paddingLeft: childIndent,
            paddingRight: 12,
            paddingTop: 2,
            paddingBottom: 2,
            minWidth: 0,
          }}
        >
          <ToolRunSection
            collapsed={isCollapsed}
            onToggle={() => setCollapsedToolSections((prev) => ({
              ...prev,
              [sectionKey]: !(prev[sectionKey] ?? true),
            }))}
            run={run}
            fileOps={fileOps}
            t={t}
            compact
            renderBlock={(toolBlock, runIndex) => (
              <SubagentMessageBlock
                block={toolBlock}
                indent={0}
                wrapTool={false}
              />
            )}
            getChildKey={(toolBlock, runIndex) => `inspector-tool-child-${toolBlock.id || runStartIndex + runIndex}`}
          />
        </div>
      )
      continue
    }

    if (isEmptyTextBlock(child)) continue
    renderedChildren.push(
      <SubagentMessageBlock
        key={child.id || `${child.type}-${index}`}
        block={child}
        indent={childIndent}
      />
    )
  }

  return (
    <div>
      <button
        ref={rowRef}
        type="button"
        data-inspector-subagent-id={block.id}
        className="quiet-toggle flex items-center gap-1 w-full text-xs"
        style={{
          background: active ? 'var(--bg-elevated)' : 'transparent',
          border: 'none',
          borderLeft: `2px solid ${active ? 'var(--purple)' : color}`,
          paddingLeft: indent,
          paddingRight: 12,
          paddingTop: 3,
          paddingBottom: 3,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 150ms ease, border-left-color 150ms ease',
          color: 'var(--text-primary)',
        }}
        onClick={onClick}
        onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = 'transparent' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <IconSlot width={10}>
          <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={10} strokeWidth={1.5} />
          </AnimatedChevron>
        </IconSlot>
        <IconSlot>
          <StatusIcon
            size={12}
            strokeWidth={1.5}
            style={{ color }}
            className={spinning ? 'icon-running' : ''}
          />
        </IconSlot>
        <IconSlot>
          <Bot size={12} strokeWidth={1.5} style={{ color: 'var(--purple)' }} />
        </IconSlot>
        <span className="truncate min-w-0 flex-1">
          <span className="font-semibold">AGENT</span>
          <span>: {agentType}</span>
          {description && (
            <span style={{ color: 'var(--text-dim)' }}> · {description}</span>
          )}
        </span>
        <span className="flex-shrink-0 font-light" style={{ color: 'var(--text-dim)' }}>
          {toolUseCount} tool{toolUseCount === 1 ? '' : 's'}
        </span>
      </button>

      <AnimatedCollapse open={expanded} id={bodyId} animateHeight={false}>
        {() => (
        <>
        {prompt && (
          <div
            className="flex gap-1 text-xs"
            style={{
              paddingLeft: 24 + depth * 14,
              paddingRight: 12,
              paddingTop: 2,
              paddingBottom: 4,
              color: 'var(--text-secondary)',
              minWidth: 0,
            }}
          >
            <span
              className="flex-shrink-0 uppercase font-semibold"
              style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.06em' }}
            >
              TASK
            </span>
            <span style={{ color: 'var(--text-dim)' }}>·</span>
            <span className="min-w-0" style={{ wordBreak: 'break-word' }}>
              {prompt}
            </span>
          </div>
        )}

        {renderedChildren}
        </>
        )}
      </AnimatedCollapse>
    </div>
  )
}

function SubagentMessageBlock({ block, indent, wrapTool = true }) {
  if (block.type === 'tool_use') {
    const card = isFileTool(block)
      ? <FileToolCard kind={block.name} block={block} compact />
      : <ToolCallCard block={block} compact />

    if (!wrapTool) return card

    return (
      <div
        style={{
          paddingLeft: indent,
          paddingRight: 12,
          paddingTop: 2,
          paddingBottom: 2,
          minWidth: 0,
        }}
      >
        {card}
      </div>
    )
  }

  if (block.type === 'text' && block.text?.trim()) {
    return (
      <div
        className="text-xs canvas-inspector-message"
        style={{
          paddingLeft: indent,
          paddingRight: 12,
          paddingTop: 1,
          paddingBottom: 1,
          color: 'var(--text-secondary)',
          minWidth: 0,
        }}
      >
        <MarkdownRenderer content={block.text} />
      </div>
    )
  }

  if (block.type === 'thinking' && block.thinking?.trim()) {
    return (
      <div
        className="text-xs"
        style={{
          marginLeft: indent,
          marginRight: 12,
          marginTop: 3,
          marginBottom: 3,
          padding: '4px 6px',
          color: 'var(--text-dim)',
          background: 'var(--bg-elevated)',
          borderLeft: '2px solid var(--purple)',
          borderRadius: 2,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {block.thinking}
      </div>
    )
  }

  return null
}

function TodoWriteRow({ item, expanded, activeTaskId, activeTodoId, onToggle, onTodoClick, rowRef }) {
  const { block, todos, depth } = item
  const bodyId = useId()
  const status = block.status || 'running'
  const isError = status === 'error' || block.result?.is_error
  const { icon: StatusIcon, color, spinning } = getStatusMeta(status, isError)
  const total = todos.length
  const done = todos.filter((todo) => todo.status === 'completed').length
  const active = activeTaskId === block.id
  const indent = 12 + depth * 14

  return (
    <div>
      <button
        ref={rowRef}
        type="button"
        data-inspector-todo-id={block.id}
        className="quiet-toggle flex items-center gap-1 w-full text-xs"
        style={{
          background: active ? 'var(--bg-elevated)' : 'transparent',
          border: 'none',
          borderLeft: `2px solid ${active ? 'var(--purple)' : color}`,
          paddingLeft: indent,
          paddingRight: 12,
          paddingTop: 3,
          paddingBottom: 3,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background 150ms ease, border-left-color 150ms ease',
          color: 'var(--text-primary)',
        }}
        onClick={onToggle}
        onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = 'transparent' }}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <IconSlot width={10}>
          <AnimatedChevron open={expanded} style={{ color: 'var(--text-dim)' }}>
            <ChevronDown size={10} strokeWidth={1.5} />
          </AnimatedChevron>
        </IconSlot>
        <IconSlot>
          <StatusIcon
            size={12}
            strokeWidth={1.5}
            style={{ color }}
            className={spinning ? 'icon-running' : ''}
          />
        </IconSlot>
        <IconSlot>
          <ListTodo size={12} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
        </IconSlot>
        <span className="truncate min-w-0 flex-1">TODO</span>
        {total > 0 && (
          <span className="flex-shrink-0 font-light" style={{ color: 'var(--text-dim)' }}>
            {done}/{total}
          </span>
        )}
      </button>

      <AnimatedCollapse open={expanded} id={bodyId} animateHeight={false}>
        {() => todos.map((todo, index) => {
          const todoKey = `${block.id}:${todo.id != null ? todo.id : index}`
          return (
            <TodoItem
              key={todoKey}
              todo={todo}
              indent={24 + depth * 14}
              active={activeTodoId === todoKey}
              onClick={() => onTodoClick(todoKey, block.id)}
            />
          )
        })}
      </AnimatedCollapse>
    </div>
  )
}

/**
 * Canvas execution inspector. Groups assistant-side execution artifacts by
 * conversation turn, then mirrors subagents and TodoWrite calls inside the
 * turn where they happened.
 */
export default function SubagentInspector() {
  const messages = useChatStore((s) => s.messages)
  const subagentContent = useChatStore((s) => s.subagentContent)
  const activeTaskId = useTaskStore((s) => s.activeTaskId)
  const activeTodoId = useTaskStore((s) => s.activeTodoId)
  const activeSubagentId = useTaskStore((s) => s.activeSubagentId)
  const inspectorFocusTarget = useTaskStore((s) => s.inspectorFocusTarget)
  const inspectorFocusRevision = useTaskStore((s) => s.inspectorFocusRevision)
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId)
  const setActiveTodoId = useTaskStore((s) => s.setActiveTodoId)
  const setActiveSubagentId = useTaskStore((s) => s.setActiveSubagentId)
  const rowRefs = useRef({})
  const handledInspectorFocusRevisionRef = useRef(0)
  const [pendingScrollTargetId, setPendingScrollTargetId] = useState(null)

  const rounds = useMemo(
    () => collectInspectorRounds(messages, subagentContent),
    [messages, subagentContent]
  )

  const [expandedRounds, setExpandedRounds] = useState({})
  const [expandedItems, setExpandedItems] = useState({})

  useEffect(() => {
    if (!inspectorFocusTarget?.id || inspectorFocusRevision === 0) return
    if (handledInspectorFocusRevisionRef.current === inspectorFocusRevision) return

    const targetRound = rounds.find((round) =>
      round.items.some((item) =>
        item.type === inspectorFocusTarget.type && item.block.id === inspectorFocusTarget.id
      )
    )
    const targetItem = targetRound?.items.find((item) =>
      item.type === inspectorFocusTarget.type && item.block.id === inspectorFocusTarget.id
    )
    if (!targetRound || !targetItem) return

    handledInspectorFocusRevisionRef.current = inspectorFocusRevision
    setExpandedRounds((prev) => ({ ...prev, [targetRound.id]: true }))
    setExpandedItems((prev) => ({ ...prev, [targetItem.id]: true }))
    setPendingScrollTargetId(targetItem.block.id)
  }, [inspectorFocusTarget, inspectorFocusRevision, rounds])

  useEffect(() => {
    if (!pendingScrollTargetId) return undefined

    let frameId = null
    let attempts = 0
    const tryScroll = () => {
      const node = rowRefs.current[pendingScrollTargetId]
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setPendingScrollTargetId(null)
        return
      }
      attempts += 1
      if (attempts < 8) {
        frameId = window.requestAnimationFrame(tryScroll)
      }
    }

    frameId = window.requestAnimationFrame(tryScroll)
    return () => {
      if (frameId != null) window.cancelAnimationFrame(frameId)
    }
  }, [pendingScrollTargetId, expandedRounds, expandedItems, rounds])

  if (rounds.length === 0) return null

  const activeCount = rounds
    .flatMap((round) => round.items)
    .filter((item) => (item.block.status || 'running') === 'running').length

  return (
    <div className="py-1">
      <div
        className="flex items-center gap-1 w-full px-3 py-1"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textAlign: 'left',
        }}
      >
        <span className="flex-1">INSPECTOR</span>
        <span className="font-light" style={{ letterSpacing: 0 }}>
          {activeCount > 0 ? `${activeCount} active · ` : ''}{rounds.length} rounds
        </span>
      </div>

      {rounds.map((round) => {
        const roundExpanded = expandedRounds[round.id] ?? true
        const roundBodyId = `inspector-round-${round.id}`
        return (
          <div
            key={round.id}
            style={{
              borderBottom: '1px solid var(--border-subtle)',
              paddingBottom: 4,
              marginBottom: 2,
            }}
          >
            <button
              type="button"
              className="quiet-toggle flex items-center gap-1 w-full text-xs"
              style={{
                background: 'transparent',
                border: 'none',
                borderLeft: '2px solid var(--border)',
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 4,
                paddingBottom: 4,
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 150ms ease, border-left-color 150ms ease',
                color: 'var(--text-primary)',
              }}
              onClick={() => setExpandedRounds((prev) => ({ ...prev, [round.id]: !roundExpanded }))}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
              aria-expanded={roundExpanded}
              aria-controls={roundBodyId}
            >
              <AnimatedChevron open={roundExpanded} style={{ color: 'var(--text-dim)' }}>
                <ChevronDown size={10} strokeWidth={1.5} />
              </AnimatedChevron>
              <span
                className="flex-shrink-0 uppercase font-semibold"
                style={{ color: 'var(--text-secondary)', fontSize: 10, letterSpacing: '0.06em' }}
              >
                ROUND {round.number}
              </span>
              <span className="truncate min-w-0 flex-1" style={{ color: 'var(--text-secondary)' }}>
                {round.title}
              </span>
              <span className="flex-shrink-0 font-light" style={{ color: 'var(--text-dim)' }}>
                <RoundSummary items={round.items} />
              </span>
            </button>

            <AnimatedCollapse open={roundExpanded} id={roundBodyId} animateHeight={false}>
              {() => round.items.map((item) => {
                const itemExpanded = expandedItems[item.id] ?? item.type === 'todo'
                if (item.type === 'todo') {
                  return (
                    <TodoWriteRow
                      key={item.id}
                      item={item}
                      expanded={itemExpanded}
                      activeTaskId={activeTaskId}
                      activeTodoId={activeTodoId}
                      rowRef={(node) => {
                        if (node) rowRefs.current[item.block.id] = node
                        else delete rowRefs.current[item.block.id]
                      }}
                      onToggle={() => {
                        setExpandedItems((prev) => ({ ...prev, [item.id]: !itemExpanded }))
                        setActiveTodoId(null)
                        setActiveTaskId(item.block.id)
                      }}
                      onTodoClick={(todoKey, toolUseId) => {
                        setActiveTaskId(toolUseId)
                        setActiveTodoId(todoKey)
                      }}
                    />
                  )
                }

                return (
                  <SubagentRow
                    key={item.id}
                    item={item}
                    expanded={itemExpanded}
                    active={activeSubagentId === item.block.id}
                    rowRef={(node) => {
                      if (node) rowRefs.current[item.block.id] = node
                      else delete rowRefs.current[item.block.id]
                    }}
                    onClick={() => {
                      setExpandedRounds((prev) => ({ ...prev, [round.id]: true }))
                      setExpandedItems((prev) => ({ ...prev, [item.id]: !itemExpanded }))
                      setActiveSubagentId(item.block.id)
                    }}
                  />
                )
              })}
            </AnimatedCollapse>
          </div>
        )
      })}
    </div>
  )
}
