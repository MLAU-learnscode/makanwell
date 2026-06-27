import { useEffect, useMemo, useRef } from 'react'
import ChatLoadingDots from './ChatLoadingDots.jsx'
import { MessageBubble } from './MessageBubble.jsx'

export function ChatHistory({ messages, isLoading, suggestions, onSuggestionClick, welcomeMessage }) {
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      if (m.type === 'function_call_output') return false
      if (m.type === 'function_call') return false
      return true
    })
  }, [messages])

  const showSuggestions = suggestions?.length && visibleMessages.length === 0 && !isLoading
  const showWelcome = welcomeMessage && visibleMessages.length === 0 && !isLoading

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 py-3 space-y-3">
      {showWelcome && (
        <div className="flex gap-2 justify-start">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 flex-shrink-0 mt-1 shadow-sm" />
          <div className="max-w-[85%] sm:max-w-[75%] md:max-w-md rounded-3xl rounded-bl-lg px-4 py-3 text-sm leading-relaxed bg-white text-foreground border border-border/60 shadow-sm">
            {welcomeMessage}
          </div>
        </div>
      )}
      {visibleMessages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
      {isLoading && <ChatLoadingDots />}
      {showSuggestions && (
        <div>
          <p className="text-xs text-muted-foreground mb-3 text-center font-medium">Suggested questions</p>
          <div className="space-y-2 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSuggestionClick(s)}
                className="w-full text-left bg-white border border-border/60 rounded-2xl px-4 py-3 text-sm font-medium hover:border-primary hover:bg-teal-50/40 transition-all shadow-sm"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
