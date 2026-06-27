import { useCallback, useEffect, useRef, useState } from 'react'
import { Leaf, PhoneOff, Phone } from 'lucide-react'
import {
  VOICE_QUESTIONS,
  INTRO,
  OUTRO,
  buildSpokenQuestion,
  buildRetryPrompt,
  buildAckPrompt,
  parseVoiceAnswer,
  applyParsedAnswer,
  labelForAnswer,
  formatCallDuration,
  getVoiceCallBlocker,
  unlockAudioOnUserGesture,
} from '../lib/voiceApi.js'
import {
  ConversationCallSession,
  CONVERSATION_STATE,
  wantsToEndCall,
} from '../lib/conversationCall.js'

const UI_PHASE = {
  incoming: 'incoming',
  blocked: 'blocked',
  onCall: 'on_call',
  ended: 'ended',
  error: 'error',
}

function stateToStatus(state) {
  switch (state) {
    case CONVERSATION_STATE.CONNECTING:
      return 'Connecting…'
    case CONVERSATION_STATE.ASSISTANT_SPEAKING:
      return 'Assistant speaking — interrupt anytime'
    case CONVERSATION_STATE.LISTENING:
      return 'Listening…'
    case CONVERSATION_STATE.PROCESSING:
      return 'Processing…'
    default:
      return 'On call'
  }
}

export default function VoiceCallScreen({ onComplete, onEnd }) {
  const initialBlocker = getVoiceCallBlocker()
  const [uiPhase, setUiPhase] = useState(initialBlocker ? UI_PHASE.blocked : UI_PHASE.incoming)
  const [convState, setConvState] = useState(CONVERSATION_STATE.IDLE)
  const [stepIndex, setStepIndex] = useState(0)
  const [statusLine, setStatusLine] = useState(initialBlocker ? 'Unavailable' : 'Incoming call…')
  const [caption, setCaption] = useState('')
  const [errorMsg, setErrorMsg] = useState(initialBlocker || '')
  const [duration, setDuration] = useState(0)
  const [timerOn, setTimerOn] = useState(false)

  const sessionRef = useRef(null)
  const userEndedRef = useRef(false)
  const answersRef = useRef({})
  const stepRef = useRef(0)
  const startedRef = useRef(false)
  const loopRef = useRef(null)

  useEffect(() => {
    stepRef.current = stepIndex
  }, [stepIndex])

  useEffect(() => {
    if (!timerOn) return undefined
    const t = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(t)
  }, [timerOn])

  const ended = useCallback(() => userEndedRef.current, [])

  const runConversationLoop = useCallback(async () => {
    const session = sessionRef.current
    if (!session || ended()) return

    let index = stepRef.current
    let currentAnswers = { ...answersRef.current }

    while (index < VOICE_QUESTIONS.length && !ended()) {
      const q = VOICE_QUESTIONS[index]
      setStepIndex(index)

      const spoken = buildSpokenQuestion(q, currentAnswers)
      let transcript = await session.speakThenListen(spoken)
      if (ended()) return

      while (!ended()) {
        if (!transcript) {
          transcript = await session.speakThenListen(
            buildRetryPrompt('I did not hear you. Please say that again.'),
          )
          if (ended()) return
          continue
        }

        if (wantsToEndCall(transcript)) {
          userEndedRef.current = true
          session.destroy()
          onEnd()
          return
        }

        const parsed = await parseVoiceAnswer(q, transcript, currentAnswers)
        if (!parsed.success) {
          transcript = await session.speakThenListen(buildRetryPrompt(parsed.error))
          if (ended()) return
          continue
        }

        const label = labelForAnswer(q, parsed)
        currentAnswers = applyParsedAnswer(q, parsed, currentAnswers)
        answersRef.current = currentAnswers

        await session.speak(buildAckPrompt(label))
        if (ended()) return

        index += 1
        stepRef.current = index
        break
      }
    }

    if (ended()) return

    setStatusLine('Finishing call…')
    await session.speak(OUTRO)
    setUiPhase(UI_PHASE.ended)
    setStatusLine('Call ended')
    onComplete(currentAnswers)
  }, [ended, onComplete, onEnd])

  const startCall = useCallback(async () => {
    if (startedRef.current || ended()) return
    startedRef.current = true

    const session = new ConversationCallSession({
      onStateChange: (state) => {
        setConvState(state)
        setStatusLine(stateToStatus(state))
      },
      onCaption: setCaption,
    })
    sessionRef.current = session

    try {
      setUiPhase(UI_PHASE.onCall)
      setConvState(CONVERSATION_STATE.CONNECTING)
      setStatusLine('Connecting…')
      setTimerOn(true)

      await session.init()
      if (ended()) return

      await session.speak(INTRO)
      if (ended()) return

      loopRef.current = runConversationLoop()
      await loopRef.current
    } catch (err) {
      if (ended()) return
      setUiPhase(UI_PHASE.error)
      setConvState(CONVERSATION_STATE.ERROR)
      setErrorMsg(err.message || 'Could not start call')
      setStatusLine('Error')
      startedRef.current = false
    }
  }, [runConversationLoop, ended])

  useEffect(
    () => () => {
      sessionRef.current?.destroy()
    },
    [],
  )

  function handleAnswerCall() {
    unlockAudioOnUserGesture()
    void startCall()
  }

  function handleDeclineCall() {
    userEndedRef.current = true
    sessionRef.current?.destroy()
    onEnd()
  }

  function handleEndCall() {
    userEndedRef.current = true
    sessionRef.current?.destroy()
    onEnd()
  }

  function handleTryAgain() {
    unlockAudioOnUserGesture()
    userEndedRef.current = false
    startedRef.current = false
    setErrorMsg('')
    void startCall()
  }

  const q = VOICE_QUESTIONS[stepIndex]
  const progress = q ? `Question ${q.n} of ${VOICE_QUESTIONS.length}` : 'Complete'

  const avatarRing =
    uiPhase === UI_PHASE.incoming
      ? 'animate-pulse ring-4 ring-white/30 ring-offset-4 ring-offset-slate-950'
      : convState === CONVERSATION_STATE.LISTENING
        ? 'ring-4 ring-green-400 ring-offset-4 ring-offset-slate-950 animate-pulse'
        : convState === CONVERSATION_STATE.ASSISTANT_SPEAKING
          ? 'ring-4 ring-teal-300/50 ring-offset-4 ring-offset-slate-950'
          : convState === CONVERSATION_STATE.PROCESSING
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

        {uiPhase === UI_PHASE.onCall && convState === CONVERSATION_STATE.ASSISTANT_SPEAKING && (
          <p className="text-teal-300 text-xs mt-3 font-medium">Speak anytime to interrupt</p>
        )}

        {uiPhase === UI_PHASE.onCall && convState === CONVERSATION_STATE.LISTENING && (
          <p className="text-green-300 text-xs mt-3 font-medium">Go ahead — I am listening</p>
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
            Just talk — no buttons needed. Say &ldquo;goodbye&rdquo; or tap red to end the call.
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
