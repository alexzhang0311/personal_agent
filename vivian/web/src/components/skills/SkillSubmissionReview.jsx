import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, File, Folder, Package, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSkillHubStore from '../../stores/skillHubStore'
import useUiStore from '../../stores/uiStore'
import CopyButton from '../shared/CopyButton'
import MarkdownRenderer from '../markdown/MarkdownRenderer'

export default function SkillSubmissionReview() {
  const { t } = useTranslation()
  const closeHub = useSkillHubStore((s) => s.closeHub)
  const setHubView = useSkillHubStore((s) => s.setHubView)
  const fetchPending = useSkillHubStore((s) => s.fetchPendingSubmissions)
  const submissions = useSkillHubStore((s) => s.pendingSubmissions)
  const pendingLoading = useSkillHubStore((s) => s.pendingLoading)
  const selected = useSkillHubStore((s) => s.selectedSubmission)
  const detail = useSkillHubStore((s) => s.submissionDetail)
  const detailLoading = useSkillHubStore((s) => s.submissionLoading)
  const selectSubmission = useSkillHubStore((s) => s.selectSubmission)
  const reviewFile = useSkillHubStore((s) => s.reviewFile)
  const fileContent = useSkillHubStore((s) => s.reviewFileContent)
  const fileLoading = useSkillHubStore((s) => s.reviewFileLoading)
  const selectFile = useSkillHubStore((s) => s.selectReviewFile)
  const approve = useSkillHubStore((s) => s.approveSubmission)
  const reject = useSkillHubStore((s) => s.rejectSubmission)
  const reviewing = useSkillHubStore((s) => s.reviewing)
  const showConfirmDialog = useUiStore((s) => s.showConfirmDialog)
  const [rejectOpen, setRejectOpen] = useState(false)

  useEffect(() => {
    fetchPending().catch((err) => console.error('Failed to load pending skills:', err))
  }, [fetchPending])

  const handleApprove = () => {
    if (!selected) return
    showConfirmDialog({
      title: t('skillHub.approveTitle'),
      message: t('skillHub.approveMessage', {
        name: selected.name,
        type: selected.is_update ? t('skillHub.updateType') : t('skillHub.firstPublishType'),
      }),
      confirmLabel: t('skillHub.approve'),
      onConfirm: () => approve(selected.id).catch((err) => console.error('Approval failed:', err)),
    })
  }

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <Package size={16} strokeWidth={1.5} style={{ color: 'var(--text-secondary)' }} />
        <span className="font-bold" style={{ color: 'var(--text-primary)', fontSize: 16 }}>{t('skillHub.title')}</span>
        <button className="px-2 py-1 uppercase" style={tabStyle(false)} onClick={() => setHubView('catalog')}>
          {t('skillHub.catalog')}
        </button>
        <button className="px-2 py-1 uppercase" style={tabStyle(true)}>
          {t('skillHub.pendingReview')} {submissions.length}
        </button>
        <div className="flex-1" />
        <button style={iconButtonStyle} onClick={closeHub} title={t('confirm.cancel')}>
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: 250, borderRight: '1px solid var(--border)' }}>
          <div className="px-3 py-2 uppercase font-semibold" style={{ color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.06em', borderBottom: '1px solid var(--border-subtle)' }}>
            {t('skillHub.pendingQueue')}
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {pendingLoading ? [1, 2, 3].map((n) => <div key={n} className="skeleton mx-2 my-1" style={{ height: 48 }} />) : null}
            {!pendingLoading && submissions.length === 0 ? (
              <div className="px-3 py-6" style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>{t('skillHub.noPending')}</div>
            ) : null}
            {submissions.map((item) => (
              <button
                key={item.id}
                className="flex flex-col gap-1 w-full px-3 py-2"
                style={{
                  background: selected?.id === item.id ? 'var(--bg-elevated)' : 'transparent',
                  border: 'none',
                  borderLeft: selected?.id === item.id ? '2px solid var(--purple)' : '2px solid transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 150ms ease',
                }}
                onClick={() => selectSubmission(item)}
              >
                <span className="font-semibold truncate" style={{ color: 'var(--text-primary)', fontSize: 13, width: '100%' }}>{item.name}</span>
                <span className="truncate" style={{ color: 'var(--text-dim)', fontSize: 11, width: '100%' }}>
                  {item.submitter} · {item.is_update ? t('skillHub.updateType') : t('skillHub.firstPublishType')}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: 230, borderRight: '1px solid var(--border)' }}>
          <div className="px-3 py-2 truncate" style={{ color: 'var(--text-secondary)', fontSize: 12, borderBottom: '1px solid var(--border-subtle)' }}>
            {selected ? `${selected.submitter} · ${new Date(selected.submitted_at).toLocaleString()}` : t('skillHub.selectSubmission')}
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {detailLoading ? <div className="skeleton mx-2 my-2" style={{ height: 160 }} /> : null}
            {detail?.tree?.map((node) => <ReviewTreeNode key={node.name} node={node} onSelect={selectFile} selectedPath={reviewFile} />)}
          </div>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-3 py-2 truncate" style={{ color: 'var(--text-secondary)', fontSize: 12, borderBottom: '1px solid var(--border-subtle)' }}>
            {reviewFile || t('skillHub.selectFileToReview')}
          </div>
          <div className="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
            {fileLoading ? <div className="skeleton" style={{ height: '100%' }} /> : null}
            {!fileLoading && fileContent?.is_binary ? <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('skills.binaryFile')}</div> : null}
            {!fileLoading && fileContent && !fileContent.is_binary && reviewFile?.toLowerCase().endsWith('.md') ? (
              <MarkdownRenderer content={fileContent.content} />
            ) : null}
            {!fileLoading && fileContent && !fileContent.is_binary && !reviewFile?.toLowerCase().endsWith('.md') ? (
              <div className="copyable-block relative">
                <pre style={{ margin: 0, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{fileContent.content}</pre>
                <CopyButton content={fileContent.content} />
              </div>
            ) : null}
          </div>
          {selected ? (
            <div className="flex justify-end gap-2 px-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <button className="flex items-center gap-1 px-3 py-1" style={actionStyle('var(--red)', reviewing)} disabled={reviewing} onClick={() => setRejectOpen(true)}>
                <X size={14} strokeWidth={1.5} /> {t('skillHub.reject')}
              </button>
              <button className="flex items-center gap-1 px-3 py-1" style={actionStyle('var(--blue)', reviewing)} disabled={reviewing} onClick={handleApprove}>
                <Check size={14} strokeWidth={1.5} /> {t('skillHub.approve')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {rejectOpen && selected ? (
        <RejectDialog
          skillName={selected.name}
          reviewing={reviewing}
          onCancel={() => setRejectOpen(false)}
          onReject={async (reason) => {
            await reject(selected.id, reason)
            setRejectOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

function ReviewTreeNode({ node, parent = '', onSelect, selectedPath }) {
  const [open, setOpen] = useState(true)
  const path = parent ? `${parent}/${node.name}` : node.name
  if (node.type === 'directory') {
    return (
      <div>
        <button className="flex items-center gap-1 w-full px-2 py-1" style={treeButtonStyle(false)} onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
          <Folder size={12} strokeWidth={1.5} /> <span className="truncate">{node.name}</span>
        </button>
        {open ? <div style={{ paddingLeft: 12 }}>{node.children?.map((child) => <ReviewTreeNode key={`${path}/${child.name}`} node={child} parent={path} onSelect={onSelect} selectedPath={selectedPath} />)}</div> : null}
      </div>
    )
  }
  return (
    <button className="flex items-center gap-1 w-full px-2 py-1" style={treeButtonStyle(selectedPath === path)} onClick={() => onSelect(path)}>
      <File size={12} strokeWidth={1.5} /> <span className="truncate">{node.name}</span>
    </button>
  )
}

function RejectDialog({ skillName, reviewing, onCancel, onReject }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const valid = reason.trim().length > 0 && !reviewing
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 1100, background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)' }} onClick={onCancel}>
      <div className="flex flex-col gap-3 p-4" style={{ width: 'min(440px, 90vw)', background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 4 }} onClick={(event) => event.stopPropagation()}>
        <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 14 }}>{t('skillHub.rejectTitle', { name: skillName })}</span>
        <textarea
          autoFocus
          rows={5}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('skillHub.rejectReasonPlaceholder')}
          style={{ resize: 'vertical', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', padding: 8, fontSize: 13, outline: 'none' }}
        />
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1" style={secondaryButtonStyle} onClick={onCancel}>{t('confirm.cancel')}</button>
          <button className="px-3 py-1" style={actionStyle('var(--red)', !valid)} disabled={!valid} onClick={() => onReject(reason.trim()).catch((err) => console.error('Rejection failed:', err))}>{t('skillHub.reject')}</button>
        </div>
      </div>
    </div>
  )
}

const tabStyle = (active) => ({ background: active ? 'var(--bg-elevated)' : 'transparent', border: active ? '1px solid var(--border-strong)' : '1px solid transparent', borderRadius: 4, color: active ? 'var(--text-primary)' : 'var(--text-dim)', cursor: active ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' })
const iconButtonStyle = { width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer' }
const treeButtonStyle = (active) => ({ background: active ? 'var(--bg-elevated)' : 'transparent', border: 'none', borderLeft: active ? '2px solid var(--purple)' : '2px solid transparent', color: active ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, textAlign: 'left', transition: 'background 150ms ease' })
const actionStyle = (color, disabled) => ({ background: color, border: 'none', borderRadius: 4, color: 'var(--text-inverse)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontSize: 13, transition: 'opacity 150ms ease' })
const secondaryButtonStyle = { background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }
