import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useSidebarStore from '../../stores/sidebarStore'
import useSkillsStore from '../../stores/skillsStore'
import SidebarResizer from '../layout/SidebarResizer'
import SkillListSidebar from './SkillListSidebar'
import SkillFileTree from './SkillFileTree'
import SkillFileViewer from './SkillFileViewer'
import SkillHubModal from './SkillHubModal'
import SkillSyncModal from './SkillSyncModal'

export default function SkillsPanel() {
  const { t } = useTranslation()
  const width = useSidebarStore((s) => s.width)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const fetchSkills = useSkillsStore((s) => s.fetchSkills)
  const selectedSkill = useSkillsStore((s) => s.selectedSkill)

  const effectiveWidth = collapsed ? 48 : width

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  return (
    <>
      {/* Sidebar — skill list */}
      <aside
        className="fixed flex flex-col overflow-hidden"
        style={{
          width: effectiveWidth,
          top: 'var(--navbar-height)',
          left: 0,
          bottom: 0,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          transition: 'width 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <SkillListSidebar />
        {!collapsed && <SidebarResizer />}
      </aside>

      {/* Content area */}
      <div
        className="flex"
        style={{
          position: 'fixed',
          top: 'var(--navbar-height)',
          left: effectiveWidth,
          right: 0,
          bottom: 0,
          transition: 'left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden',
        }}
      >
        {selectedSkill ? (
          <>
            <SkillFileTree animKey={selectedSkill.name} />
            <SkillFileViewer animKey={selectedSkill.name} />
          </>
        ) : (
          <div
            className="flex-1 flex items-center justify-center"
            style={{ background: 'var(--bg-base)', color: 'var(--text-dim)', fontSize: 13 }}
          >
            {t('skills.selectToView')}
          </div>
        )}
      </div>

      <SkillHubModal />
      <SkillSyncModal />
    </>
  )
}
