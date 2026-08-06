import type { ReactNode } from 'react'
import { motion } from 'motion/react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  hint: string
}

function EmptyState({ icon, title, hint }: EmptyStateProps): React.JSX.Element {
  return (
    <motion.div
      className="empty"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div className="empty-icon">{icon}</div>
      <div>
        <p className="empty-title">{title}</p>
        <p className="empty-hint">{hint}</p>
      </div>
    </motion.div>
  )
}

export default EmptyState
