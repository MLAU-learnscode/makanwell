import { motion } from 'motion/react'

export function AudioPlayback({ playbackFrequencies, itemClassName = 'bg-teal-400', className = '', height = 36 }) {
  return (
    <div className={`flex items-center justify-center gap-[2px] ${className}`}>
      {playbackFrequencies.map((frequency, index) => (
        <motion.div
          key={index}
          className={`w-[4px] sm:w-[6px] rounded ${itemClassName}`}
          initial={{ height: 0 }}
          animate={{ height: `${frequency * height}px` }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}
