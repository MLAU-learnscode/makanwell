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

/** Fixed low threshold — mic bar at 30%+ always counts as speech */
const SPEECH_THRESHOLD = 8
const SPEECH_END_SILENCE_MS = 1500
const MIN_SPEECH_MS = 200

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
  constructor({ onStateChange, onCaption, onMicLevel, onListenMetrics } = {}) {
    this.onStateChange = onStateChange
    this.onCaption = onCaption
    this.onMicLevel = onMicLevel
    this.onListenMetrics = onListenMetrics
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
    this.timeDomainBuffer = null
    this.listenPeak = 0
    this.listenHadSpeech = false
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

    const track = this.stream.getAudioTracks()[0]
    if (!track) throw new Error('No microphone track available.')
    track.enabled = true

    const Ctx = window.AudioContext || window.webkitAudioContext
    this.audioContext = new Ctx()
    await this.ensureAudioReady()

    const source = this.audioContext.createMediaStreamSource(this.stream)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.2
    source.connect(this.analyser)
    this.timeDomainBuffer = new Uint8Array(this.analyser.fftSize)
  }

  async ensureAudioReady() {
    if (!this.audioContext) return
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }
  }

  /** RMS loudness 0–100 from microphone time-domain samples */
  getVolume() {
    if (!this.analyser || !this.timeDomainBuffer) return 0
    this.analyser.getByteTimeDomainData(this.timeDomainBuffer)
    let sum = 0
    for (let i = 0; i < this.timeDomainBuffer.length; i++) {
      const sample = (this.timeDomainBuffer[i] - 128) / 128
      sum += sample * sample
    }
    const rms = Math.sqrt(sum / this.timeDomainBuffer.length)
    const level = Math.min(100, Math.round(rms * 400))
    this.onMicLevel?.(level)
    return level
  }

  emitListenMetrics() {
    this.onListenMetrics?.({
      peak: this.listenPeak,
      heardSpeech: this.listenHadSpeech,
    })
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

    await this.ensureAudioReady()
    this.setState(CONVERSATION_STATE.ASSISTANT_SPEAKING)
    this.onCaption?.(text)

    const speech = createCancellableSpeech(text)
    this.activeSpeech = speech

    const bargeIn = this.waitForVolume({
      threshold: SPEECH_THRESHOLD,
      holdMs: 200,
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
    await new Promise((r) => setTimeout(r, 400))
    return result
  }

  startRecorder() {
    if (!this.stream?.active) {
      throw new Error('Microphone stream is not active.')
    }
    this.recordingChunks = []
    const mime = pickRecordingMimeType()
    this.recordingMime = mime || 'audio/webm'
    const options = mime ? { mimeType: mime } : {}
    this.mediaRecorder = new MediaRecorder(this.stream, options)
    if (this.mediaRecorder.mimeType) this.recordingMime = this.mediaRecorder.mimeType
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordingChunks.push(e.data)
    }
    this.mediaRecorder.start(100)
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
      if (this.mediaRecorder.state === 'recording') {
        try {
          this.mediaRecorder.requestData()
        } catch {
          /* optional */
        }
        this.mediaRecorder.stop()
      } else {
        this.mediaRecorder = null
        resolve(null)
      }
    })
  }

  async recordUntilSilence({
    silenceMs = SPEECH_END_SILENCE_MS,
    minSpeechMs = MIN_SPEECH_MS,
    maxMs = 30000,
    waitForSpeechMs = 12000,
  } = {}) {
    if (this.aborted) return null

    await this.ensureAudioReady()
    this.setState(CONVERSATION_STATE.LISTENING)

    this.listenPeak = 0
    this.listenHadSpeech = this.userAlreadySpeaking
    this.emitListenMetrics()

    // Start capturing immediately — never wait for VAD before recording
    this.startRecorder()

    const recordStart = Date.now()
    let lastLoud = this.userAlreadySpeaking ? recordStart : null
    let speechStart = this.userAlreadySpeaking ? recordStart : null

    return new Promise((resolve) => {
      const tick = () => {
        if (this.aborted) {
          void this.stopRecorder().then(() => resolve(null))
          return
        }

        const vol = this.getVolume()
        const now = Date.now()

        this.listenPeak = Math.max(this.listenPeak, vol)
        if (vol > SPEECH_THRESHOLD) {
          this.listenHadSpeech = true
          lastLoud = now
          if (!speechStart) speechStart = now
          this.emitListenMetrics()
        }

        const elapsed = now - recordStart
        const silentFor = lastLoud ? now - lastLoud : 0
        const speechDuration = speechStart ? now - speechStart : 0

        const heardSomething = this.listenHadSpeech || this.listenPeak >= SPEECH_THRESHOLD

        const endOfTurn =
          heardSomething &&
          lastLoud &&
          speechDuration >= minSpeechMs &&
          silentFor >= silenceMs

        const timedOut = elapsed >= maxMs
        const noSpeechYet = !heardSomething && elapsed >= waitForSpeechMs

        if (endOfTurn || timedOut || noSpeechYet) {
          this.stopVadLoop()
          void this.stopRecorder().then((blob) => {
            if (!blob || blob.size < 80) {
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

    // If mic clearly picked up speech but Whisper returned nothing, listen once more
    if (!transcript && this.listenPeak >= SPEECH_THRESHOLD) {
      await this.speak('Sorry, I missed that. Could you say it once more?')
      if (this.aborted) return null
      const retryBlob = await this.recordUntilSilence({ waitForSpeechMs: 15000 })
      if (retryBlob) return transcribeAudio(retryBlob)
    }

    return transcript || null
  }

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
