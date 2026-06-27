import { useCallback, useEffect, useRef, useState } from 'react'
import { Leaf, PhoneOff, Phone } from 'lucide-react'
import { RealtimeClient } from '@openai/realtime-api-beta'
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js'
import {
  formatCallDuration,
  getVoiceCallBlocker,
  unlockAudioOnUserGesture,
} from '../lib/voiceApi.js'
import {
  REALTIME_RELAY_URL,
  REALTIME_MODEL,
  buildRealtimeInstructions,
  SAVE_ANSWER_TOOL,
  COMPLETE_ASSESSMENT_TOOL,
  applySaveAnswer,
  countSavedQuestions,
  allQuestionsAnswered,
  REALTIME_QUESTIONS,
} from '../lib/realtimeQuestionnaire.js'
import {
  REALTIME_TURN_DETECTION,
  forceEndUserTurn,
  LocalSilenceWatchdog,
} from '../lib/realtimeTurnHelper.js'

const UI_PHASE = {
  incoming: 'incoming',
  blocked: 'blocked',
  connecting: 'connecting',
  onCall: 'on_call',
  ended: 'ended',
  error: 'error',
}

const CONV = {
  idle: 'idle',
  assistantSpeaking: 'assistant_speaking',
  listening: 'listening',
  processing: 'processing',
}

function statusForConv(state) {
  switch (state) {
    case CONV.assistantSpeaking:
      return 'Assistant speaking — interrupt anytime'
    case CONV.listening:
      return 'Listening…'
    case CONV.processing:
      return 'Processing…'
    default:
      return 'On call'
  }
}

function waitForFirstResponse(client, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)

    const handler = ({ source, event }) => {
      if (source !== 'server') return
      if (event.type === 'response.done') {
        cleanup()
        resolve(true)
      }
      if (event.type === 'error') {
        cleanup()
        resolve(false)
      }
    }

    const cleanup = () => {
      clearTimeout(timer)
      client.off('realtime.event', handler)
    }

    client.on('realtime.event', handler)
  })
}

export default function VoiceCallScreen({ onComplete, onEnd }) {
  const initialBlocker = getVoiceCallBlocker()
  const [uiPhase, setUiPhase] = useState(initialBlocker ? UI_PHASE.blocked : UI_PHASE.incoming)
  const [convState, setConvState] = useState(CONV.idle)
  const [savedCount, setSavedCount] = useState(0)
  const [statusLine, setStatusLine] = useState(initialBlocker ? 'Unavailable' : 'Incoming call…')
  const [caption, setCaption] = useState('')
  const [errorMsg, setErrorMsg] = useState(initialBlocker || '')
  const [duration, setDuration] = useState(0)
  const [timerOn, setTimerOn] = useState(false)
  const [micLevel, setMicLevel] = useState(0)

  const wavRecorderRef = useRef(null)
  const wavStreamPlayerRef = useRef(null)
  const clientRef = useRef(null)
  const answersRef = useRef({})
  const finishingRef = useRef(false)
  const finishCallRef = useRef(null)
  /** Mic streams to API only after the AI greeting — prevents VAD cancelling the first reply */
  const micLiveRef = useRef(false)
  const silenceWatchdogRef = useRef(null)

  useEffect(() => {
    if (!timerOn) return undefined
    const t = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(t)
  }, [timerOn])

  const disconnect = useCallback(async () => {
    micLiveRef.current = false
    if (silenceWatchdogRef.current) silenceWatchdogRef.current.enabled = false
    const client = clientRef.current
    const wavRecorder = wavRecorderRef.current
    const wavStreamPlayer = wavStreamPlayerRef.current
    try {
      client?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      await wavRecorder?.end()
    } catch {
      /* ignore */
    }
    try {
      await wavStreamPlayer?.interrupt()
    } catch {
      /* ignore */
    }
  }, [])

  const finishCall = useCallback(async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    await disconnect()
    setUiPhase(UI_PHASE.ended)
    setStatusLine('Call ended')
    onComplete({ ...answersRef.current })
  }, [disconnect, onComplete])

  useEffect(() => {
    finishCallRef.current = finishCall
  }, [finishCall])

  useEffect(() => {
    wavRecorderRef.current = new WavRecorder({ sampleRate: 24000 })
    wavStreamPlayerRef.current = new WavStreamPlayer({ sampleRate: 24000 })
    clientRef.current = new RealtimeClient({ url: REALTIME_RELAY_URL })

    const client = clientRef.current
    const wavStreamPlayer = wavStreamPlayerRef.current

    client.sessionConfig.model = REALTIME_MODEL
    client.updateSession({
      instructions: buildRealtimeInstructions(),
      voice: 'shimmer',
      modalities: ['text', 'audio'],
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: REALTIME_TURN_DETECTION,
    })

    silenceWatchdogRef.current = new LocalSilenceWatchdog({
      onSpeechStart: () => {
        if (!micLiveRef.current) return
        setConvState(CONV.listening)
        setStatusLine(statusForConv(CONV.listening))
      },
      onEndTurn: () => {
        if (!micLiveRef.current) return
        if (forceEndUserTurn(client)) {
          setConvState(CONV.processing)
          setStatusLine('Processing…')
        }
      },
    })

    client.addTool(SAVE_ANSWER_TOOL, async (payload) => {
      const result = applySaveAnswer(answersRef.current, payload)
      if (!result.ok) return { success: false, error: result.error }
      answersRef.current = result.answers
      const saved = countSavedQuestions(result.answers)
      setSavedCount(saved)
      if (allQuestionsAnswered(result.answers)) {
        setTimeout(() => finishCallRef.current?.(), 2500)
      }
      return { success: true, saved, total: REALTIME_QUESTIONS.length }
    })

    client.addTool(COMPLETE_ASSESSMENT_TOOL, async () => {
      setTimeout(() => finishCallRef.current?.(), 2000)
      return { success: true }
    })

    client.on('conversation.interrupted', async () => {
      if (!micLiveRef.current) return
      const trackSampleOffset = await wavStreamPlayer.interrupt()
      if (trackSampleOffset?.trackId) {
        await client.cancelResponse(trackSampleOffset.trackId, trackSampleOffset.offset)
      }
    })

    client.on('conversation.updated', ({ item, delta }) => {
      if (item.role === 'assistant') {
        const text = item.formatted?.transcript || item.formatted?.text
        if (text) setCaption(text)
      }
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id)
        setConvState(CONV.assistantSpeaking)
        setStatusLine(statusForConv(CONV.assistantSpeaking))
      }
    })

    client.on('realtime.event', ({ source, event }) => {
      if (source !== 'server') return
      if (event.type === 'input_audio_buffer.speech_started' && micLiveRef.current) {
        setConvState(CONV.listening)
        setStatusLine(statusForConv(CONV.listening))
      }
      if (event.type === 'input_audio_buffer.speech_stopped' && micLiveRef.current) {
        silenceWatchdogRef.current?.onServerSpeechStopped()
        setConvState(CONV.processing)
        setStatusLine(statusForConv(CONV.processing))
      }
      if (event.type === 'response.created') {
        silenceWatchdogRef.current?.reset()
        setConvState(CONV.assistantSpeaking)
        setStatusLine(statusForConv(CONV.assistantSpeaking))
      }
    })

    client.on('error', (event) => {
      console.error('[realtime]', event)
      setErrorMsg(event?.message || 'Voice connection error')
      setUiPhase(UI_PHASE.error)
    })

    return () => {
      client.reset()
    }
  }, [])

  useEffect(() => {
    if (uiPhase !== UI_PHASE.onCall) return undefined
    let raf
    const tick = () => {
      const wr = wavRecorderRef.current
      if (wr?.recording) {
        const { values } = wr.getFrequencies('voice')
        let sum = 0
        for (let i = 0; i < values.length; i++) sum += values[i]
        const avg = values.length ? sum / values.length : 0
        setMicLevel(Math.min(100, Math.round(avg * 120)))
        if (micLiveRef.current) {
          silenceWatchdogRef.current?.tick(Math.min(100, Math.round(avg * 120)))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [uiPhase])

  const startMicStreaming = useCallback(async () => {
    const client = clientRef.current
    const wavRecorder = wavRecorderRef.current
    if (!client || !wavRecorder || micLiveRef.current) return

    micLiveRef.current = true
    silenceWatchdogRef.current?.reset()
    silenceWatchdogRef.current?.beginCalibration()
    silenceWatchdogRef.current.enabled = true
    await wavRecorder.record((data) => {
      if (micLiveRef.current) client.appendInputAudio(data.mono)
    })
  }, [])

  const startCall = useCallback(async () => {
    const client = clientRef.current
    const wavRecorder = wavRecorderRef.current
    const wavStreamPlayer = wavStreamPlayerRef.current
    if (!client || !wavRecorder || !wavStreamPlayer) return

    try {
      setUiPhase(UI_PHASE.connecting)
      setStatusLine('Connecting…')
      setTimerOn(true)
      answersRef.current = {}
      setSavedCount(0)
      finishingRef.current = false
      micLiveRef.current = false

      unlockAudioOnUserGesture()
      await wavRecorder.begin()
      await wavStreamPlayer.connect()
      await client.connect()

      setUiPhase(UI_PHASE.onCall)
      setConvState(CONV.assistantSpeaking)
      setStatusLine('Assistant speaking…')

      client.sendUserMessageContent([
        {
          type: 'input_text',
          text:
            'The caller just picked up. Greet them warmly as HawkerHealth, say this is a quick health check by phone, then ask question 1.',
        },
      ])

      await waitForFirstResponse(client)
      await startMicStreaming()

      setConvState(CONV.listening)
      setStatusLine(statusForConv(CONV.listening))
    } catch (err) {
      console.error('[voice call]', err)
      setUiPhase(UI_PHASE.error)
      setErrorMsg(
        err.message?.includes('WebSocket') || err.message?.includes('connect')
          ? 'Cannot reach voice relay. Run: npm run dev (starts API + relay + web)'
          : err.message || 'Could not start call',
      )
      setStatusLine('Error')
      await disconnect()
    }
  }, [disconnect, startMicStreaming])

  useEffect(
    () => () => {
      void disconnect()
    },
    [disconnect],
  )

  function handleAnswerCall() {
    unlockAudioOnUserGesture()
    void startCall()
  }

  function handleDeclineCall() {
    void disconnect()
    onEnd()
  }

  function handleEndCall() {
    finishingRef.current = true
    void disconnect()
    onEnd()
  }

  function handleTryAgain() {
    unlockAudioOnUserGesture()
    finishingRef.current = false
    micLiveRef.current = false
    setErrorMsg('')
    void startCall()
  }

  const progress = `Question ${Math.min(savedCount + 1, REALTIME_QUESTIONS.length)} of ${REALTIME_QUESTIONS.length}`

  const avatarRing =
    uiPhase === UI_PHASE.incoming
      ? 'animate-pulse ring-4 ring-white/30 ring-offset-4 ring-offset-slate-950'
      : convState === CONV.listening
        ? 'ring-4 ring-green-400 ring-offset-4 ring-offset-slate-950 animate-pulse'
        : convState === CONV.assistantSpeaking
          ? 'ring-4 ring-teal-300/50 ring-offset-4 ring-offset-slate-950'
          : convState === CONV.processing
            ? 'ring-4 ring-white/20 ring-offset-4 ring-offset-slate-950'
            : ''

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-b from-slate-900 via-slate-950 to-black text-white flex flex-col">
      <div className="pt-14 pb-4 text-center">
        <p className="text-sm text-white/60 font-medium tracking-wide">{statusLine}</p>
        <p className="text-3xl font-light tabular-nums mt-1">{formatCallDuration(duration)}</p>
        <p className="text-xs text-white/40 mt-2">{progress}</p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div
          className={`w-32 h-32 rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center shadow-2xl mb-6 ${avatarRing}`}
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

        {uiPhase === UI_PHASE.onCall && convState === CONV.assistantSpeaking && (
          <p className="text-teal-300 text-xs mt-3 font-medium">Speak anytime to interrupt</p>
        )}

        {uiPhase === UI_PHASE.onCall && convState === CONV.listening && (
          <p className="text-green-300 text-xs mt-3 font-medium">
            Speak clearly, then pause — background noise is ignored
          </p>
        )}

        {uiPhase === UI_PHASE.onCall && (
          <div className="mt-4 flex flex-col items-center">
            <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  convState === CONV.listening ? 'bg-green-400' : 'bg-teal-400'
                }`}
                style={{ width: `${Math.min(100, micLevel)}%` }}
              />
            </div>
          </div>
        )}

        {uiPhase === UI_PHASE.error && (
          <p className="text-red-400 text-sm mt-4 text-center max-w-xs">{errorMsg}</p>
        )}

        {uiPhase === UI_PHASE.blocked && (
          <p className="text-amber-300 text-sm mt-4 text-center max-w-sm leading-relaxed">{errorMsg}</p>
        )}
      </div>

      <div className="pb-12 px-8 flex flex-col items-center gap-6">
        {uiPhase === UI_PHASE.incoming && (
          <>
            <div className="flex items-center gap-12">
              <button
                type="button"
                onClick={handleDeclineCall}
                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-lg"
                aria-label="Decline call"
              >
                <PhoneOff size={28} className="text-white" />
              </button>
              <button
                type="button"
                onClick={handleAnswerCall}
                className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-400 active:scale-95 transition-all flex items-center justify-center shadow-lg shadow-green-500/40 animate-pulse"
                aria-label="Answer call"
              >
                <Phone size={36} className="text-white" />
              </button>
            </div>
            <p className="text-xs text-white/50">Tap the green button to answer</p>
          </>
        )}

        {uiPhase === UI_PHASE.onCall && (
          <p className="text-xs text-white/50 text-center max-w-xs">
            Just talk — no buttons needed. Say &ldquo;goodbye&rdquo; or tap red to end.
          </p>
        )}

        {uiPhase === UI_PHASE.error && (
          <button
            type="button"
            onClick={handleTryAgain}
            className="px-6 py-3 rounded-full bg-green-500 hover:bg-green-400 text-sm font-semibold"
          >
            Try again
          </button>
        )}

        {uiPhase !== UI_PHASE.incoming && uiPhase !== UI_PHASE.blocked && (
          <>
            <button
              type="button"
              onClick={handleEndCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center shadow-lg"
              aria-label="End call"
            >
              <PhoneOff size={28} className="text-white" />
            </button>
            <p className="text-xs text-white/40">End call</p>
          </>
        )}

        {uiPhase === UI_PHASE.blocked && (
          <button
            type="button"
            onClick={handleEndCall}
            className="mt-2 px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-sm font-semibold"
          >
            Go back
          </button>
        )}
      </div>
    </div>
  )
}
