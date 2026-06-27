export default function ChatLoadingDots() {
  return (
    <div className="flex gap-2 items-center">
      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center shadow-sm flex-shrink-0" />
      <div className="bg-white border border-border/60 shadow-sm rounded-3xl rounded-bl-lg px-4 py-3">
        <div className="flex gap-1.5 items-center h-4">
          {[0, 1, 2].map((idx) => (
            <span
              key={idx}
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
              style={{ animationDelay: `${idx * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
