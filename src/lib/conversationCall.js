import {
  unlockAudioOnUserGesture,
  transcribeAudio,
  createCancellableSpeech,
  stopActiveSpeech,
} from './voiceApi.js'

/** Conversation states shown in the call UI */
export const CONVERSATION_STATE = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  ASSISTANT_SPEAKING: 'assistant_speaking',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  ENDED: 'ended',
  ERROR: 'error',
}

function pickRecordingMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/**
 * Hands-free phone call session: continuous mic, VAD end-of-turn detection,
 * and barge-in (user speech stops the assistant mid-sentence).
 */
export class ConversationCallSession {
  constructor({ onStateChange, onCaption } = {}) {
    this.onStateChange = onStateChange
    this.onCaption = onCaption
    this.state = CONVERSATION_STATE.IDLE
    this.aborted = false
    this.stream = null
    this.audioContext = null
    this.analyser = null
    this.vadFrame = null
    this.mediaRecorder = null
    this.recordingMime = 'audio/webm'
    this.recordingChunks = []
    this.activeSpeech = null
    this.userAlreadySpeaking = false
  }

  setState(next) {
    this.state = next
    this.onStateChange?.(next)
  }

  async init() {
    unlockAudioOnUserGesture()
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone not supported in this browser.')
    }
    if (!window.isSecureContext) {
      throw new Error(
        'Microphone blocked: use https:// or open http://localhost:5173 on this machine.',
      )
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    const Ctx = window.AudioContext || window.webkitAudioContext
    this.audioContext = new Ctx()
    if (this.audioContext.state === 'suspended') await this.audioContext.resume()

    const source = this.audioContext.createMediaStreamSource(this.stream)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.4
    source.connect(this.analyser)
  }

  getVolume() {
    if (!this.analyser) return 0
    const data = new Uint8Array(this.analyser.frequencyBinCount)
    this.analyser.getByteFrequencyData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]
    return sum / data.length
  }

  stopVadLoop() {
    if (this.vadFrame) cancelAnimationFrame(this.vadFrame)
    this.vadFrame = null
  }

  stopSpeech() {
    this.activeSpeech?.stop?.()
    this.activeSpeech = null
    stopActiveSpeech()
  }

  waitForVolume({ threshold, holdMs, timeoutMs = 0 }) {
    return new Promise((resolve) => {
      const started = Date.now()
      let loudSince = null

      const tick = () => {
        if (this.aborted) {
          resolve(false)
          return
        }

        const vol = this.getVolume()
        if (vol > threshold) {
          if (!loudSince) loudSince = Date.now()
          if (Date.now() - loudSince >= holdMs) {
            this.stopVadLoop()
            resolve(true)
            return
          }
        } else {
          loudSince = null
        }

        if (timeoutMs > 0 && Date.now() - started >= timeoutMs) {
          this.stopVadLoop()
          resolve(false)
          return
        }

        this.vadFrame = requestAnimationFrame(tick)
      }

      this.vadFrame = requestAnimationFrame(tick)
    })
  }

  async speak(text) {
    if (this.aborted) return { bargedIn: false }

    this.setState(CONVERSATION_STATE.ASSISTANT_SPEAKING)
    this.onCaption?.(text)
    this.userAlreadySpeaking = false

    const speech = createCancellableSpeech(text)
    this.activeSpeech = speech

    const bargeIn = this.waitForVolume({
      threshold: 32,
      holdMs: 300,
    })

    const result = await Promise.race([
      speech.done.then(() => ({ bargedIn: false })),
      bargeIn.then(() => ({ bargedIn: true })),
    ])
    this.stopVadLoop()

    if (result.bargedIn) {
      this.stopSpeech()
      this.userAlreadySpeaking = true
      return { bargedIn: true }
    }

    this.activeSpeech = null
    return result
  }

  startRecorder() {
    this.recordingChunks = []
    const mime = pickRecordingMimeType()
    this.recordingMime = mime || 'audio/webm'
    const options = mime ? { mimeType: mime } : {}
    this.mediaRecorder = new MediaRecorder(this.stream, options)
    if (this.mediaRecorder.mimeType) this.recordingMime = this.mediaRecorder.mimeType
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordingChunks.push(e.data)
    }
    this.mediaRecorder.start(200)
  }

  stopRecorder() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null)
        return
      }
      this.mediaRecorder.onstop = () => {
        const blob =
          this.recordingChunks.length > 0
            ? new Blob(this.recordingChunks, { type: this.recordingMime })
            : null
        this.mediaRecorder = null
        this.recordingChunks = []
        resolve(blob)
      }
      this.mediaRecorder.stop()
    })
  }

  async recordUntilSilence({
    speechThreshold = 16,
    silenceMs = 1300,
    minSpeechMs = 300,
    maxMs = 45000,
  } = {}) {
    if (this.aborted) return null

    this.setState(CONVERSATION_STATE.LISTENING)

    if (!this.userAlreadySpeaking) {
      const heard = await this.waitForVolume({
        threshold: speechThreshold,
        holdMs: 220,
        timeoutMs: 22000,
      })
      if (!heard || this.aborted) return null
    }

    this.startRecorder()
    const recordStart = Date.now()
    let speechStart = Date.now()
    let lastLoud = Date.now()
    let hadSpeech = this.userAlreadySpeaking

    return new Promise((resolve) => {
      const tick = () => {
        if (this.aborted) {
          void this.stopRecorder().then(() => resolve(null))
          return
        }

        const vol = this.getVolume()
        const now = Date.now()

        if (vol > speechThreshold) {
          lastLoud = now
          if (!hadSpeech) {
            hadSpeech = true
            speechStart = now
          }
        }

        const elapsed = now - recordStart
        const silentFor = now - lastLoud
        const speechDuration = hadSpeech ? now - speechStart : 0

        const done =
          hadSpeech &&
          speechDuration >= minSpeechMs &&
          silentFor >= silenceMs

        if (done || elapsed >= maxMs) {
          this.stopVadLoop()
          void this.stopRecorder().then((blob) => {
            if (!blob || !hadSpeech || speechDuration < minSpeechMs) {
              resolve(null)
              return
            }
            resolve(blob)
          })
          return
        }

        this.vadFrame = requestAnimationFrame(tick)
      }

      this.vadFrame = requestAnimationFrame(tick)
    })
  }

  async listenForUtterance() {
    if (this.aborted) return null

    this.userAlreadySpeaking = false
    const blob = await this.recordUntilSilence()
    if (this.aborted || !blob) return null

    this.setState(CONVERSATION_STATE.PROCESSING)
    const transcript = await transcribeAudio(blob)
    return transcript || null
  }

  /** Speak, then automatically listen. Barge-in skips straight to listening. */
  async speakThenListen(text) {
    const { bargedIn } = await this.speak(text)
    if (this.aborted) return null
    if (bargedIn) this.userAlreadySpeaking = true
    return this.listenForUtterance()
  }

  destroy() {
    this.aborted = true
    this.stopVadLoop()
    this.stopSpeech()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.audioContext?.state !== 'closed') {
      void this.audioContext.close()
    }
    this.audioContext = null
    this.analyser = null
  }
}

export function wantsToEndCall(transcript) {
  const t = transcript.toLowerCase()
  return /\b(end call|hang up|goodbye|good bye|stop call|cancel call|quit|exit)\b/.test(t)
}
