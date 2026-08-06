import { motion } from 'motion/react'
import { CalendarIcon, CheckSquareIcon, ListIcon, BookIcon, SettingsIcon } from './icons'

export type TabId = 'schedule' | 'checklist' | 'activities' | 'journal' | 'settings'

interface TabDef {
  id: TabId
  label: string
  icon: (props: { size?: number }) => React.JSX.Element
}

const TABS: TabDef[] = [
  { id: 'schedule', label: 'Schedule', icon: CalendarIcon },
  { id: 'checklist', label: 'Checklist', icon: CheckSquareIcon },
  { id: 'activities', label: 'Activities', icon: ListIcon },
  { id: 'journal', label: 'Journal', icon: BookIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

interface TabBarProps {
  active: TabId
  onChange: (tab: TabId) => void
}

function TabBar({ active, onChange }: TabBarProps): React.JSX.Element {
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = tab.id === active
        return (
          <motion.button
            key={tab.id}
            className={isActive ? 'tab active' : 'tab'}
            onClick={() => onChange(tab.id)}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            aria-current={isActive ? 'page' : undefined}
          >
            {isActive && (
              <motion.span
                className="tab-pill"
                layoutId="tab-pill"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            )}
            <Icon size={16} />
            <span>{tab.label}</span>
          </motion.button>
        )
      })}
    </nav>
  )
}

export default TabBar
