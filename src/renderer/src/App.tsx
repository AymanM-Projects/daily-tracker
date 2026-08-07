import { useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { DataProvider } from './state/DataContext'
import TitleBar from './components/TitleBar'
import TabBar, { type TabId } from './components/TabBar'
import DayPrompts from './components/DayPrompts'
import SchedulePane from './panes/SchedulePane'
import ChecklistPane from './panes/ChecklistPane'
import ActivitiesPane from './panes/ActivitiesPane'
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
    case 'journal':
      return <JournalPane />
    case 'settings':
      return <SettingsPane />
  }
}

function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>('schedule')

  return (
    <MotionConfig reducedMotion="user">
      <DataProvider>
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
      </DataProvider>
    </MotionConfig>
  )
}

export default App
