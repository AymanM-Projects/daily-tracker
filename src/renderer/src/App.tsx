import { useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { DataProvider } from './state/DataContext'
import TitleBar from './components/TitleBar'
import TabBar, { type TabId } from './components/TabBar'
import DayPrompts from './components/DayPrompts'
import { useTheme } from './hooks/useTheme'
import { useAutopilot } from './hooks/useAutopilot'
import { useData } from './state/DataContext'
import SchedulePane from './panes/SchedulePane'
import ChecklistPane from './panes/ChecklistPane'
import ActivitiesPane from './panes/ActivitiesPane'
import ProjectsPane from './panes/ProjectsPane'
import JournalPane from './panes/JournalPane'
import SettingsPane from './panes/SettingsPane'

function renderPane(tab: TabId): React.JSX.Element {
  switch (tab) {
    case 'schedule':
      return <SchedulePane />
    case 'checklist':
      return <ChecklistPane />
    case 'activities':
      return <ActivitiesPane />
    case 'projects':
      return <ProjectsPane />
    case 'journal':
      return <JournalPane />
    case 'settings':
      return <SettingsPane />
  }
}

/**
 * Inside the provider, since both of these read Settings.
 *
 * Autopilot lives here rather than in a pane so it keeps running across tab
 * switches — panes unmount, and a day that only advances while you are looking
 * at the schedule would be worse than none at all.
 */
function Themed({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { settings } = useData()
  useTheme(settings.theme)
  useAutopilot()
  return <>{children}</>
}

function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>('schedule')

  return (
    <MotionConfig reducedMotion="user">
      <DataProvider>
        <Themed>
          <div className="app">
            <TitleBar />
            <main className="app-main">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  className="pane-wrap"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                >
                  {renderPane(tab)}
                </motion.div>
              </AnimatePresence>
            </main>
            <TabBar active={tab} onChange={setTab} />
            {/* outside the pane AnimatePresence on purpose: panes unmount on tab
              switch, and a prompt must survive that */}
            <DayPrompts />
          </div>
        </Themed>
      </DataProvider>
    </MotionConfig>
  )
}

export default App
