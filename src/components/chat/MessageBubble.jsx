import ReactMarkdown from 'react-markdown'

function getMessageText(message) {
  if (message.type === 'function_call' || message.type === 'function_call_output') {
    return null
  }
  if (message.type === 'message') {
    if (Array.isArray(message.content)) {
      const block = message.content[0]
      if (block?.type === 'output_text') return block.text
      if (block?.type === 'input_text') return block.text
    }
    if (typeof message.content === 'string') return message.content
  }
  return null
}

export function MessageBubble({ message, isUser: forceUser }) {
  const text = getMessageText(message)
  if (!text) return null

  const isUser = forceUser ?? message.role === 'user'

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 flex-shrink-0 mt-1 shadow-sm" />
      )}
      <div
        className={`max-w-[85%] sm:max-w-[75%] md:max-w-md rounded-3xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-white rounded-br-lg shadow-sm'
            : 'bg-white text-foreground border border-border/60 shadow-sm rounded-bl-lg prose prose-sm max-w-none'
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{text}</span>
        ) : (
          <ReactMarkdown>{text}</ReactMarkdown>
        )}
      </div>
    </div>
  )
}
