import { useState } from 'react'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { useAudio } from '../../hooks/useAudio.js'
import { useWebsocket } from '../../hooks/useWebsocket.js'
import { ChatHistory } from './ChatHistory.jsx'
import { Composer } from './Composer.jsx'
import { AudioPlayback } from './AudioPlayback.jsx'

const LANG_OPTIONS = [
  { id: 'en', label: 'EN' },
  { id: 'zh', label: '中文' },
  { id: 'ms', label: 'BM' },
  { id: 'ta', label: 'தமிழ்' },
]

export default function ChatWindow({
  mode = 'intake',
  profile = null,
  title = 'AI Nutrition Assistant',
  subtitle,
  suggestions = [],
  onComplete,
  onBack,
  onViewFood,
  showNavPadding = false,
}) {
  const [prompt, setPrompt] = useState('')
  const [lang, setLang] = useState('en')
  const [completing, setCompleting] = useState(false)

  const {
    isReady: audioReady,
    playAudio,
    startRecording,
    stopRecording,
    stopPlaying,
    frequencies,
    playbackFrequencies,
  } = useAudio()

  const handleSessionComplete = (completedProfile) => {
    if (completing) return
    setCompleting(true)
    setTimeout(() => onComplete?.(completedProfile), 1500)
  }

  const {
    isReady: wsReady,
    sendTextMessage,
    sendAudioMessage,
    history,
    isLoading,
    agentName,
    connectionError,
    retryCount,
    updateLang,
  } = useWebsocket({
    mode,
    profile,
    lang,
    onNewAudio: playAudio,
    onSessionComplete: handleSessionComplete,
  })

  function handleSubmit() {
    const text = prompt.trim()
    if (!text || isLoading) return
    setPrompt('')
    sendTextMessage(text)
  }

  function handleLangChange(newLang) {
    setLang(newLang)
    updateLang(newLang)
  }

  const defaultSubtitle = wsReady
    ? (agentName ? `${agentName} · Online` : 'Online')
    : 'Connecting...'

  return (
    <div className={`h-[100dvh] md:h-screen flex flex-col bg-background ${showNavPadding ? 'pb-[4.5rem] md:pb-0' : ''}`}>
      <div className="w-full max-w-4xl mx-auto flex flex-col flex-1 min-h-0">
        <div className="px-5 sm:px-8 pt-10 sm:pt-12 md:pt-8 pb-4 bg-white border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="w-9 h-9 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:bg-muted/50 flex-shrink-0"
                aria-label="Go back"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center shadow-sm flex-shrink-0">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-sm sm:text-base text-foreground truncate">{title}</div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                {playbackFrequencies.some((f) => f > 0) ? (
                  <AudioPlayback playbackFrequencies={playbackFrequencies} className="gap-[2px]" height={12} />
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {subtitle ?? defaultSubtitle}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleLangChange(opt.id)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    lang === opt.id
                      ? 'bg-primary text-white'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {connectionError && (
          <div className="mx-5 sm:mx-8 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-800">
            {connectionError}
            {retryCount > 0 && !connectionError.includes('Retrying') && (
              <p className="text-xs mt-2 text-amber-700">Retrying… ({retryCount}/{8})</p>
            )}
            <p className="text-xs mt-2 text-amber-700">
              Run <code className="bg-amber-100 px-1 rounded">npm run dev</code> to start both Vite and the voice server.
            </p>
          </div>
        )}

        {!connectionError && !wsReady && retryCount > 0 && (
          <div className="mx-5 sm:mx-8 mt-4 p-3 bg-muted/50 border border-border rounded-2xl text-xs text-muted-foreground text-center">
            Connecting to voice server… ({retryCount}/{8})
          </div>
        )}

        {completing && (
          <div className="mx-5 sm:mx-8 mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-800">
            Assessment complete! Opening your personalised Food Guide...
          </div>
        )}

        <ChatHistory
          messages={history}
          isLoading={isLoading}
          suggestions={suggestions}
          onSuggestionClick={(s) => sendTextMessage(s)}
          welcomeMessage={
            mode === 'intake' && history.length === 0
              ? "Hi! I'm your MakanWell health assistant. I'll ask you a few questions about your health and eating habits so I can recommend the best hawker food for you. You can type or tap the microphone to speak — in any language you prefer."
              : mode === 'advisor' && history.length === 0
                ? "Hi! Ask me anything about hawker food and your health. I know your profile and can suggest safe dishes, or you can view your full Food Guide below."
                : null
          }
        />

        {mode === 'advisor' && onViewFood && (
          <div className="px-5 sm:px-8 pb-2 flex-shrink-0">
            <button
              type="button"
              onClick={onViewFood}
              className="w-full py-3 rounded-2xl bg-teal-50 border border-teal-200 text-primary font-semibold text-sm hover:bg-teal-100 transition-all"
            >
              View Food Guide
            </button>
          </div>
        )}

        <div className="px-5 sm:px-8 py-4 bg-white border-t border-border flex-shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
          <Composer
            prompt={prompt}
            setPrompt={setPrompt}
            onSubmit={handleSubmit}
            isLoading={isLoading || completing}
            audioChatProps={{
              isReady: wsReady && audioReady && !completing,
              startRecording: async () => { await stopPlaying(); await startRecording() },
              stopRecording,
              sendAudioMessage,
              frequencies,
            }}
          />
          <p className="text-center text-[10px] text-muted-foreground mt-2">
            AI responses are for general reference only. Consult a healthcare professional.
          </p>
        </div>
      </div>
    </div>
  )
}
