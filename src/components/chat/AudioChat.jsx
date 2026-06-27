import { useState } from 'react'
import { ArrowUp, Mic } from 'lucide-react'
import { AudioPlayback } from './AudioPlayback.jsx'

export default function AudioChat({
  isReady,
  startRecording,
  stopRecording,
  sendAudioMessage,
  frequencies,
}) {
  const [isRecording, setIsRecording] = useState(false)

  async function toggleRecording() {
    if (isRecording) {
      const audio = await stopRecording()
      if (audio.length > 0) sendAudioMessage(audio)
      setIsRecording(false)
    } else {
      await startRecording()
      setIsRecording(true)
    }
  }

  if (isRecording) {
    return (
      <div className="absolute inset-0 z-10 flex items-center gap-3 bg-red-50 border-2 border-red-200 rounded-2xl px-4">
        <AudioPlayback
          playbackFrequencies={frequencies}
          itemClassName="bg-red-400"
          className="gap-[3px] flex-1"
          height={28}
        />
        <button
          type="button"
          onClick={toggleRecording}
          className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center shadow-sm flex-shrink-0"
          aria-label="Send voice message"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={toggleRecording}
      disabled={!isReady}
      className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-white transition-all disabled:opacity-40"
      aria-label="Start recording"
      title="Hold to speak"
    >
      <Mic size={16} />
    </button>
  )
}
