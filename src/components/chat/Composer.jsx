import { useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import AudioChat from './AudioChat.jsx'

export function Composer({ prompt, setPrompt, onSubmit, isLoading, audioChatProps }) {
  const textareaRef = useRef(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [prompt])

  return (
    <div className="relative flex items-end gap-3 bg-muted/50 rounded-2xl px-4 py-3 min-h-[52px]">
      <textarea
        ref={textareaRef}
        value={prompt}
        rows={1}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Type a message..."
        className="flex-1 outline-none text-sm bg-transparent resize-none overflow-hidden max-h-32 py-1"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (prompt.trim() && !isLoading) onSubmit()
          }
        }}
      />
      <div className="flex items-center gap-2 flex-shrink-0 pb-0.5">
        {audioChatProps && <AudioChat {...audioChatProps} />}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!prompt.trim() || isLoading}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
            prompt.trim() && !isLoading
              ? 'bg-primary text-white shadow-sm hover:bg-teal-700'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
