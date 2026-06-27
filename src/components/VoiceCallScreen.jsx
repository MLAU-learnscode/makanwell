import { useCallback, useEffect, useRef, useState } from 'react'
import { Leaf, PhoneOff, Mic, Phone, Volume2 } from 'lucide-react'
import {
  VOICE_QUESTIONS,
  INTRO,
  OUTRO,
  buildSpokenQuestion,
  buildRetryPrompt,
  buildConfirmPrompt,
  transcribeAudio,
  parseVoiceAnswer,
  speakAloud,
  applyParsedAnswer,
  labelForAnswer,
  isYes,
  isNo,
  AudioRecorder,
  formatCallDuration,
  getVoiceCallBlocker,
  requestMicPermission,
  unlockAudioOnUserGesture,
} from '../lib/voiceApi.js'

export default function VoiceCallScreen({ onComplete, onEnd }) {
  const initialBlocker = getVoiceCallBlocker()
  const [phase, setPhase] = useState(initialBlocker ? 'blocked' : 'incoming')
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [statusLine, setStatusLine] = useState(initialBlocker ? 'Unavailable' : 'Incoming call…')
  const [caption, setCaption] = useState('')
  const [errorMsg, setErrorMsg] = useState(initialBlocker || '')
  const [duration, setDuration] = useState(0)
  const [timerOn, setTimerOn] = useState(false)
  const [needsTapToSpeak, setNeedsTapToSpeak] = useState(false)
  const [pendingSpeech, setPendingSpeech] = useState('')

  const recorderRef = useRef(new AudioRecorder())
  const userEndedRef = useRef(false)
  const answersRef = useRef({})
  const stepRef = useRef(0)
  const pendingRef = useRef(null)
  const startedRef = useRef(false)
  const pendingSpeechRef = useRef('')

  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  useEffect(() => {
    stepRef.current = stepIndex
  }, [stepIndex])

  useEffect(() => {
    if (!timerOn) return undefined
    const t = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(t)
  }, [timerOn])

  const ended = useCallback(() => userEndedRef.current, [])

  const speak = useCallback(async (text) => {
    if (ended()) return
    setPhase('speaking')
    setStatusLine('Speaking…')
    setCaption(text)
    setNeedsTapToSpeak(false)
    pendingSpeechRef.current = text
    try {
      await speakAloud(text)
    } catch (err) {
      if (ended()) return
      setNeedsTapToSpeak(true)
      setPendingSpeech(text)
      setStatusLine('Tap speaker to hear, then speak')
    }
  }, [ended])

  const listen = useCallback(async () => {
    if (ended()) return
    setPhase('listening')
    setStatusLine('Listening — tap when done')
    setErrorMsg('')
    try {
      await recorderRef.current.start()
    } catch (err) {
      setPhase('error')
      setErrorMsg(err.message || 'Could not access microphone')
      setStatusLine('Microphone error')
    }
  }, [ended])

  const retryListen = useCallback(async (message) => {
    if (ended()) return
    await speak(buildRetryPrompt(message))
    if (ended()) return
    await listen()
  }, [speak, listen, ended])

  const stopAndTranscribe = useCallback(async () => {
    setPhase('processing')
    setStatusLine('Processing…')
    const { blob, durationMs } = await recorderRef.current.stop()
    if (!blob || durationMs < 400) {
      return { transcript: null, error: 'No speech detected. Please speak louder and try again.' }
    }
    const transcript = await transcribeAudio(blob)
    if (!transcript) {
      return { transcript: null, error: 'I did not hear anything. Please try again.' }
    }
    return { transcript, error: null }
  }, [])

  const runQuestion = useCallback(async (index, currentAnswers) => {
    if (ended()) return
    const q = VOICE_QUESTIONS[index]
    if (!q) return

    setStepIndex(index)
    const spoken = buildSpokenQuestion(q, currentAnswers)
    await speak(spoken)
    if (ended()) return
    await listen()
  }, [speak, listen, ended])

  const finishCall = useCallback(async (finalAnswers) => {
    if (ended()) return
    setStatusLine('Finishing call…')
    await speak(OUTRO)
    setPhase('ended')
    setStatusLine('Call ended')
    onComplete(finalAnswers)
  }, [speak, onComplete, ended])

  const advance = useCallback(async (index, currentAnswers) => {
    if (index >= VOICE_QUESTIONS.length) {
      await finishCall(currentAnswers)
      return
    }
    await runQuestion(index, currentAnswers)
  }, [runQuestion, finishCall])

  const handleAnswer = useCallback(async (index, currentAnswers, transcript) => {
    const q = VOICE_QUESTIONS[index]
    const pending = pendingRef.current

    if (pending) {
      if (isYes(transcript)) {
        const merged = applyParsedAnswer(q, pending.parsed, currentAnswers)
        setAnswers(merged)
        pendingRef.current = null
        answersRef.current = merged
        await advance(index + 1, merged)
        return
      }
      if (isNo(transcript)) {
        pendingRef.current = null
        await runQuestion(index, currentAnswers)
        return
      }
      await speak('Please say yes or no.')
      await listen()
      return
    }

    const parsed = await parseVoiceAnswer(q, transcript, currentAnswers)
    if (!parsed.success) {
      await speak(buildRetryPrompt(parsed.error))
      await listen()
      return
    }

    const label = labelForAnswer(q, parsed)
    pendingRef.current = { parsed, label }
    await speak(buildConfirmPrompt(label))
    await listen()
  }, [speak, listen, advance, runQuestion])

  const processRecording = useCallback(async () => {
    try {
      const { transcript, error } = await stopAndTranscribe()
      if (error || !transcript) {
        await retryListen(error || 'Please try again.')
        return
      }
      await handleAnswer(stepRef.current, answersRef.current, transcript)
    } catch (err) {
      await retryListen(err.message || 'Something went wrong. Please try again.')
    }
  }, [stopAndTranscribe, retryListen, handleAnswer])

  const startCall = useCallback(async () => {
    if (startedRef.current || ended()) return
    startedRef.current = true

    try {
      setPhase('connecting')
      setStatusLine('Starting call…')
      setTimerOn(true)

      // Speak FIRST — do not wait for mic permission (user hears AI immediately).
      await speak(INTRO)
      if (ended()) return

      setStatusLine('Allow microphone when asked…')
      await requestMicPermission()
      if (ended()) return

      await advance(0, {})
    } catch (err) {
      if (ended()) return
      setPhase('error')
      setErrorMsg(err.message || 'Could not start call')
      setStatusLine('Error')
      startedRef.current = false
    }
  }, [speak, advance, ended])

  useEffect(() => () => {
    recorderRef.current.cleanup()
  }, [])

  function handleAnswerCall() {
    unlockAudioOnUserGesture()
    void startCall()
  }

  function handleDeclineCall() {
    userEndedRef.current = true
    onEnd()
  }

  function handleEndCall() {
    userEndedRef.current = true
    recorderRef.current.cleanup()
    onEnd()
  }

  function handleDoneSpeaking() {
    if (phase === 'listening') processRecording()
  }

  function handleTapToSpeak() {
    unlockAudioOnUserGesture()
    const text = pendingSpeech || pendingSpeechRef.current
    if (!text) return
    setNeedsTapToSpeak(false)
    void (async () => {
      try {
        await speakAloud(text)
        if (!userEndedRef.current && startedRef.current) {
          await listen()
        }
      } catch {
        setNeedsTapToSpeak(true)
        setStatusLine('Tap speaker to hear, then speak')
      }
    })()
  }

  function handleTryAgain() {
    unlockAudioOnUserGesture()
    setErrorMsg('')
    if (!startedRef.current) {
      void startCall()
      return
    }
    void listen()
  }

  const q = VOICE_QUESTIONS[stepIndex]
  const progress = q ? `Question ${q.n} of ${VOICE_QUESTIONS.length}` : 'Complete'

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white flex flex-col">
      <div className="pt-14 pb-4 text-center">
        <p className="text-sm text-white/60 font-medium tracking-wide">{statusLine}</p>
        <p className="text-3xl font-light tabular-nums mt-1">{formatCallDuration(duration)}</p>
        <p className="text-xs text-white/40 mt-2">{progress}</p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div
          className={`w-32 h-32 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shadow-2xl mb-6 ${
            phase === 'incoming' ? 'animate-pulse ring-4 ring-white/30 ring-offset-4 ring-offset-slate-950' : ''
          } ${
            phase === 'listening' ? 'ring-4 ring-green-400 ring-offset-4 ring-offset-slate-950 animate-pulse' : ''
          } ${phase === 'speaking' ? 'ring-4 ring-teal-300/50 ring-offset-4 ring-offset-slate-950' : ''}`}
        >
          <Leaf size={48} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">HawkerHealth</h1>
        <p className="text-white/70 text-sm mt-1">Health Check Call</p>

        {caption && (
          <p className="text-center text-white/90 text-sm sm:text-base leading-relaxed mt-8 max-w-md px-2">
            {caption}
          </p>
        )}

        {phase === 'speaking' && !needsTapToSpeak && (
          <p className="text-teal-300 text-xs mt-3 font-medium">🔊 Assistant is speaking</p>
        )}

        {needsTapToSpeak && (
          <button
            type="button"
            onClick={handleTapToSpeak}
            className="mt-6 flex items-center gap-2 px-5 py-3 rounded-full bg-white/15 hover:bg-white/25 text-sm font-semibold"
          >
            <Volume2 size={18} /> Tap to hear assistant
          </button>
        )}

        {phase === 'error' && (
          <p className="text-red-400 text-sm mt-4 text-center max-w-xs">{errorMsg}</p>
        )}

        {phase === 'blocked' && (
          <p className="text-amber-300 text-sm mt-4 text-center max-w-sm leading-relaxed">{errorMsg}</p>
        )}
      </div>

      <div className="pb-12 px-8 flex flex-col items-center gap-6">
        {phase === 'incoming' && (
          <div className="flex items-center gap-12">
            <button type="button" onClick={handleDeclineCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-lg"
              aria-label="Decline call">
              <PhoneOff size={28} className="text-white" />
            </button>
            <button type="button" onClick={handleAnswerCall}
              className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-400 active:scale-95 transition-all flex items-center justify-center shadow-lg shadow-green-500/40 animate-pulse"
              aria-label="Answer call">
              <Phone size={36} className="text-white" />
            </button>
          </div>
        )}

        {phase === 'incoming' && (
          <p className="text-xs text-white/50">Tap the green button to answer</p>
        )}

        {phase === 'listening' && (
          <button type="button" onClick={handleDoneSpeaking}
            className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-400 active:scale-95 transition-all flex items-center justify-center shadow-lg shadow-green-500/40"
            aria-label="Done speaking">
            <Mic size={32} className="text-white" />
          </button>
        )}

        {phase === 'listening' && (
          <p className="text-xs text-white/50">Tap the green button when you finish speaking</p>
        )}

        {phase === 'processing' && (
          <div className="flex gap-2 items-center text-white/60 text-sm h-20">
            <span className="w-2 h-2 rounded-full bg-white/60 animate-bounce" />
            <span className="w-2 h-2 rounded-full bg-white/60 animate-bounce [animation-delay:0.15s]" />
            <span className="w-2 h-2 rounded-full bg-white/60 animate-bounce [animation-delay:0.3s]" />
          </div>
        )}

        {(phase === 'connecting' || phase === 'speaking') && !needsTapToSpeak && (
          <div className="h-20" />
        )}

        {phase === 'error' && (
          <>
            <button
              type="button"
              onClick={handleTryAgain}
              className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-400 active:scale-95 transition-all flex items-center justify-center shadow-lg shadow-green-500/40"
              aria-label="Try again"
            >
              <Mic size={32} className="text-white" />
            </button>
            <p className="text-xs text-white/50">Tap to try again</p>
          </>
        )}

        {phase !== 'incoming' && phase !== 'blocked' && (
          <>
            <button type="button" onClick={handleEndCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-lg"
              aria-label="End call">
              <PhoneOff size={28} className="text-white" />
            </button>
            <p className="text-xs text-white/40">End call</p>
          </>
        )}

        {phase === 'blocked' && (
          <button type="button" onClick={handleEndCall}
            className="mt-2 px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-sm font-semibold">
            Go back
          </button>
        )}
      </div>
    </div>
  )
}
