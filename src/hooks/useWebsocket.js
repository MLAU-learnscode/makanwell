import { useCallback, useEffect, useRef, useState } from 'react'
import { arrayBufferToBase64, base64ToArrayBuffer } from '../lib/audioUtils.js'

function getDefaultWsUrl() {
  if (import.meta.env.VITE_WEBSOCKET_ENDPOINT) {
    return import.meta.env.VITE_WEBSOCKET_ENDPOINT
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }
  return 'ws://localhost:8000/ws'
}

const MAX_RETRIES = 8
const RETRY_MS = 1500

export function useWebsocket({
  url,
  mode = 'intake',
  profile = null,
  lang = 'en',
  onNewAudio,
  onAudioDone,
  onSessionComplete,
} = {}) {
  const [isReady, setIsReady] = useState(false)
  const [history, setHistory] = useState([])
  const [agentName, setAgentName] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [connectionError, setConnectionError] = useState(null)
  const [retryCount, setRetryCount] = useState(0)

  const wsUrl = url ?? getDefaultWsUrl()
  const websocket = useRef(null)
  const retryTimer = useRef(null)
  const unmounted = useRef(false)
  const everConnected = useRef(false)
  const intentionalClose = useRef(false)

  const modeRef = useRef(mode)
  const profileRef = useRef(profile)
  const langRef = useRef(lang)
  const onNewAudioRef = useRef(onNewAudio)
  const onAudioDoneRef = useRef(onAudioDone)
  const onSessionCompleteRef = useRef(onSessionComplete)

  modeRef.current = mode
  profileRef.current = profile
  langRef.current = lang
  onNewAudioRef.current = onNewAudio
  onAudioDoneRef.current = onAudioDone
  onSessionCompleteRef.current = onSessionComplete

  const sendSessionInit = useCallback((ws) => {
    ws.send(JSON.stringify({
      type: 'session.init',
      mode: modeRef.current,
      profile: profileRef.current,
      lang: langRef.current,
    }))
  }, [])

  useEffect(() => {
    unmounted.current = false
    intentionalClose.current = false
    everConnected.current = false
    setConnectionError(null)
    setRetryCount(0)

    function connect(attempt) {
      if (unmounted.current) return

      const ws = new WebSocket(wsUrl)
      websocket.current = ws

      ws.addEventListener('open', () => {
        if (unmounted.current) return
        everConnected.current = true
        setIsReady(true)
        setConnectionError(null)
        setRetryCount(0)
        sendSessionInit(ws)
      })

      ws.addEventListener('close', () => {
        if (unmounted.current || intentionalClose.current) return
        setIsReady(false)
        scheduleRetry(attempt)
      })

      ws.addEventListener('error', () => {
        // close handler will schedule retry; avoid sticky error from Strict Mode cleanup
        if (!everConnected.current && unmounted.current) return
      })

      ws.addEventListener('message', (event) => {
        let data
        try { data = JSON.parse(event.data) } catch { return }
        if (data.type === 'history.updated') {
          if (data.inputs?.length && data.inputs[data.inputs.length - 1].role !== 'user') {
            setIsLoading(false)
          }
          setHistory(data.inputs || [])
          if (data.agent_name) setAgentName(data.agent_name)
        } else if (data.type === 'response.audio.delta') {
          const audioData = new Int16Array(base64ToArrayBuffer(data.delta))
          onNewAudioRef.current?.(audioData)
        } else if (data.type === 'audio.done') {
          onAudioDoneRef.current?.()
        } else if (data.type === 'session.complete') {
          onSessionCompleteRef.current?.(data.profile)
        } else if (data.type === 'session.ready') {
          if (data.agent_name) setAgentName(data.agent_name)
        }
      })
    }

    function scheduleRetry(attempt) {
      if (unmounted.current || attempt >= MAX_RETRIES) {
        if (!unmounted.current && !everConnected.current) {
          setConnectionError(
            'Could not connect to the voice server. Make sure it is running (npm run dev starts it on port 8000).',
          )
        }
        return
      }
      setRetryCount(attempt + 1)
      retryTimer.current = setTimeout(() => connect(attempt + 1), RETRY_MS)
    }

    connect(0)

    return () => {
      unmounted.current = true
      intentionalClose.current = true
      clearTimeout(retryTimer.current)
      websocket.current?.close()
    }
  }, [wsUrl, sendSessionInit])

  function sendTextMessage(message) {
    if (!websocket.current || websocket.current.readyState !== WebSocket.OPEN) return
    setIsLoading(true)
    const newHistory = [
      ...history,
      { role: 'user', content: message, type: 'message' },
    ]
    setHistory(newHistory)
    websocket.current.send(JSON.stringify({
      type: 'history.update',
      inputs: newHistory,
    }))
  }

  function resetHistory() {
    setHistory([])
    setIsLoading(false)
    setAgentName(null)
    websocket.current?.send(JSON.stringify({
      type: 'history.update',
      inputs: [],
      reset_agent: true,
    }))
  }

  function sendAudioMessage(audio) {
    if (!websocket.current || websocket.current.readyState !== WebSocket.OPEN) {
      throw new Error('Websocket not connected')
    }
    setIsLoading(true)
    websocket.current.send(JSON.stringify({
      type: 'history.update',
      inputs: history,
    }))
    websocket.current.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      delta: arrayBufferToBase64(audio.buffer),
    }))
    websocket.current.send(JSON.stringify({
      type: 'input_audio_buffer.commit',
    }))
  }

  function updateLang(newLang) {
    langRef.current = newLang
    if (websocket.current?.readyState === WebSocket.OPEN) {
      sendSessionInit(websocket.current)
    }
  }

  return {
    isReady,
    sendTextMessage,
    sendAudioMessage,
    history,
    resetHistory,
    agentName,
    isLoading,
    connectionError,
    retryCount,
    updateLang,
  }
}
