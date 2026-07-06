// Static metadata for all 13 Claude Agent SDK hook events
// Single source of truth for sidebar, graph, and detail panel

export const HOOK_DEFINITIONS = [
  {
    id: 'Setup',
    phase: 'session',
    canBlock: false,
    matcherTarget: null,
    descriptionKey: 'hooks.descSetup',
    usageKey: 'hooks.usageSetup',
  },
  {
    id: 'SessionStart',
    phase: 'session',
    canBlock: false,
    matcherTarget: 'source (startup|resume|clear|compact)',
    descriptionKey: 'hooks.descSessionStart',
    usageKey: 'hooks.usageSessionStart',
  },
  {
    id: 'SessionEnd',
    phase: 'session',
    canBlock: false,
    matcherTarget: 'reason (clear|logout|...)',
    descriptionKey: 'hooks.descSessionEnd',
    usageKey: 'hooks.usageSessionEnd',
  },
  {
    id: 'UserPromptSubmit',
    phase: 'tool',
    canBlock: true,
    matcherTarget: null,
    descriptionKey: 'hooks.descUserPromptSubmit',
    usageKey: 'hooks.usageUserPromptSubmit',
  },
  {
    id: 'PreToolUse',
    phase: 'tool',
    canBlock: true,
    matcherTarget: 'tool name (Bash, Edit|Write, mcp__*)',
    descriptionKey: 'hooks.descPreToolUse',
    usageKey: 'hooks.usagePreToolUse',
  },
  {
    id: 'PermissionRequest',
    phase: 'tool',
    canBlock: true,
    matcherTarget: 'tool name',
    descriptionKey: 'hooks.descPermissionRequest',
    usageKey: 'hooks.usagePermissionRequest',
  },
  {
    id: 'PostToolUse',
    phase: 'tool',
    canBlock: false,
    matcherTarget: 'tool name',
    descriptionKey: 'hooks.descPostToolUse',
    usageKey: 'hooks.usagePostToolUse',
  },
  {
    id: 'PostToolUseFailure',
    phase: 'tool',
    canBlock: false,
    matcherTarget: 'tool name',
    descriptionKey: 'hooks.descPostToolUseFailure',
    usageKey: 'hooks.usagePostToolUseFailure',
  },
  {
    id: 'SubagentStart',
    phase: 'agent',
    canBlock: false,
    matcherTarget: 'agent type',
    descriptionKey: 'hooks.descSubagentStart',
    usageKey: 'hooks.usageSubagentStart',
  },
  {
    id: 'SubagentStop',
    phase: 'agent',
    canBlock: false,
    matcherTarget: 'agent type',
    descriptionKey: 'hooks.descSubagentStop',
    usageKey: 'hooks.usageSubagentStop',
  },
  {
    id: 'Stop',
    phase: 'agent',
    canBlock: true,
    matcherTarget: null,
    descriptionKey: 'hooks.descStop',
    usageKey: 'hooks.usageStop',
  },
  {
    id: 'Notification',
    phase: 'misc',
    canBlock: false,
    matcherTarget: 'notification type',
    descriptionKey: 'hooks.descNotification',
    usageKey: 'hooks.usageNotification',
  },
  {
    id: 'PreCompact',
    phase: 'misc',
    canBlock: false,
    matcherTarget: 'trigger (manual|auto)',
    descriptionKey: 'hooks.descPreCompact',
    usageKey: 'hooks.usagePreCompact',
  },
]

export const PHASE_COLORS = {
  session: 'var(--green)',
  tool: 'var(--blue)',
  agent: 'var(--purple)',
  misc: 'var(--yellow)',
}

export const HOOK_GROUPS = [
  { id: 'session', labelKey: 'hooks.groupSession', descKey: 'hooks.descGroupSession', hookIds: ['Setup', 'SessionStart', 'SessionEnd'] },
  { id: 'tool', labelKey: 'hooks.groupTool', descKey: 'hooks.descGroupTool', hookIds: ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'] },
  { id: 'agent', labelKey: 'hooks.groupAgent', descKey: 'hooks.descGroupAgent', hookIds: ['SubagentStart', 'SubagentStop', 'Stop'] },
  { id: 'misc', labelKey: 'hooks.groupMisc', descKey: 'hooks.descGroupMisc', hookIds: ['Notification', 'PreCompact'] },
]

// Node positions in SVG viewBox (0 0 960 520) - x,y = top-left corner
export const GRAPH_LAYOUT = {
  // Top row - Session flow
  Setup:              { x: 30,  y: 30,  w: 100, h: 36 },
  SessionStart:       { x: 175, y: 30,  w: 145, h: 36 },
  UserPromptSubmit:   { x: 365, y: 30,  w: 180, h: 36 },

  // Middle left - Tool pipeline (center x=230)
  PreToolUse:         { x: 140, y: 155, w: 180, h: 36 },
  PermissionRequest:  { x: 140, y: 210, w: 180, h: 36 },
  PostToolUse:        { x: 140, y: 320, w: 180, h: 36 },
  PostToolUseFailure: { x: 140, y: 375, w: 180, h: 36 },

  // Middle right - Agent pipeline (center x=685)
  SubagentStart:      { x: 600, y: 155, w: 170, h: 36 },
  SubagentStop:       { x: 600, y: 265, w: 170, h: 36 },

  // Bottom row - Completion
  Notification:       { x: 75,  y: 455, w: 150, h: 36 },
  Stop:               { x: 340, y: 455, w: 110, h: 36 },
  PreCompact:         { x: 560, y: 455, w: 145, h: 36 },
  SessionEnd:         { x: 790, y: 455, w: 140, h: 36 },
}

// Non-hook decorator nodes (dashed border, not clickable)
export const DECORATOR_NODES = [
  { id: '_claudeProcesses', label: 'Agent Process', x: 610, y: 30,  w: 170, h: 36 },
  { id: '_toolExecutes',    label: 'Tool Executes',    x: 140, y: 265, w: 180, h: 36 },
  { id: '_subagentWorks',   label: 'Subagent Works',   x: 600, y: 210, w: 170, h: 36 },
]

// Edges for lifecycle connections
export const GRAPH_EDGES = [
  // Top row - session flow
  { from: 'Setup', to: 'SessionStart' },
  { from: 'SessionStart', to: 'UserPromptSubmit' },
  { from: 'UserPromptSubmit', to: '_claudeProcesses' },

  // Branch down to pipelines
  { from: '_claudeProcesses', to: 'PreToolUse' },
  { from: '_claudeProcesses', to: 'SubagentStart' },

  // Tool pipeline
  { from: 'PreToolUse', to: 'PermissionRequest' },
  { from: 'PermissionRequest', to: '_toolExecutes' },
  { from: '_toolExecutes', to: 'PostToolUse' },
  { from: 'PostToolUse', to: 'PostToolUseFailure' },

  // Agent pipeline
  { from: 'SubagentStart', to: '_subagentWorks' },
  { from: '_subagentWorks', to: 'SubagentStop' },

  // Bottom convergence
  { from: 'PostToolUseFailure', to: 'Notification', dashed: true },
  { from: 'PostToolUseFailure', to: 'Stop' },
  { from: 'SubagentStop', to: 'Stop' },
  { from: 'Stop', to: 'PreCompact' },
  { from: 'PreCompact', to: 'SessionEnd' },
]
