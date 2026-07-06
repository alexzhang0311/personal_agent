import { UsersRound, Bug, FileText, FlaskConical, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSubagentsStore from '../../stores/subagentsStore'

const TEMPLATES = [
  {
    id: 'codeReviewer',
    icon: Eye,
    template: {
      name: 'code-reviewer',
      description: 'Reviews code changes for bugs, style issues, and design concerns. Use proactively after writing or modifying code.',
      prompt:
        'You are a senior code reviewer. Review the recently modified code with fresh eyes.\n\n' +
        'Focus on:\n' +
        '- Correctness: bugs, edge cases, off-by-one errors\n' +
        '- Style: naming, readability, consistency with the codebase\n' +
        '- Design: appropriate abstraction level, no premature optimization\n' +
        '- Tests: missing coverage for new behavior\n\n' +
        'Be direct. Cite file paths and line numbers. Suggest concrete fixes.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      model: '',
    },
  },
  {
    id: 'debugger',
    icon: Bug,
    template: {
      name: 'debugger',
      description: 'Investigates failing tests, crashes, and unexpected behavior. Reproduces, isolates, and proposes a fix.',
      prompt:
        'You are a methodical debugger. Reproduce the issue, narrow it down, and propose a minimal fix.\n\n' +
        '1. Read the failure output carefully.\n' +
        '2. Reproduce the issue locally if possible.\n' +
        '3. Form a hypothesis. Test it.\n' +
        '4. When confident in the root cause, propose the smallest fix that addresses it.\n' +
        '5. Cite file paths and line numbers in your final answer.',
      tools: ['Read', 'Edit', 'Grep', 'Glob', 'Bash'],
      model: '',
    },
  },
  {
    id: 'docWriter',
    icon: FileText,
    template: {
      name: 'doc-writer',
      description: 'Writes and updates technical documentation. Use for README updates, API docs, and inline JSDoc/docstrings.',
      prompt:
        'You write clear, concise technical documentation.\n\n' +
        'When writing docs:\n' +
        '- Match the project\'s existing tone and structure.\n' +
        '- Lead with the practical: what does this do, when do I use it, how do I call it.\n' +
        '- Keep examples short and runnable.\n' +
        '- Don\'t pad with marketing language.',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
      model: '',
    },
  },
  {
    id: 'testRunner',
    icon: FlaskConical,
    template: {
      name: 'test-runner',
      description: 'Runs and triages test suites. Use proactively when tests fail or after changes that need verification.',
      prompt:
        'You run tests, triage failures, and report a clear summary.\n\n' +
        'Workflow:\n' +
        '1. Identify the right test command from package.json / pyproject.toml / similar.\n' +
        '2. Run the suite.\n' +
        '3. For each failing test, classify: real regression vs flaky vs already-known.\n' +
        '4. Report: a count, the regressions with file:line, and any test that needs author attention.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      model: '',
    },
  },
]

export default function SubAgentEmptyState() {
  const { t } = useTranslation()
  const startNewAgent = useSubagentsStore((s) => s.startNewAgent)
  const startFromTemplate = useSubagentsStore((s) => s.startFromTemplate)

  return (
    <div
      className="flex-1 flex items-center justify-center"
      style={{ background: 'var(--bg-base)', overflowY: 'auto' }}
    >
      <div className="flex flex-col items-center gap-6 p-6" style={{ maxWidth: 720 }}>
        <div className="flex flex-col items-center gap-2" style={{ color: 'var(--text-dim)' }}>
          <UsersRound size={36} strokeWidth={1.5} />
          <div style={{ fontSize: 18, color: 'var(--text-primary)', fontWeight: 700 }}>
            {t('subagents.empty.title')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 480 }}>
            {t('subagents.empty.subtitle')}
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
          {TEMPLATES.map(({ id, icon: Icon, template }) => (
            <button
              key={id}
              onClick={() => startFromTemplate(template)}
              className="flex flex-col items-start gap-2 p-4"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 150ms ease, background 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--blue)'
                e.currentTarget.style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.background = 'var(--bg-surface)'
              }}
            >
              <div className="flex items-center gap-2" style={{ color: 'var(--blue)' }}>
                <Icon size={14} strokeWidth={1.5} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {template.name}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t(`subagents.empty.template.${id}`)}
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={startNewAgent}
          className="px-3"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
            height: 30,
            transition: 'border-color 150ms ease, color 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--blue)'
            e.currentTarget.style.color = 'var(--blue)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
        >
          {t('subagents.empty.startBlank')}
        </button>
      </div>
    </div>
  )
}
