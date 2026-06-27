import questionnaire from '../data/questionnaire.json'

const INTRO =
  'Hello, this is HawkerHealth. I will ask you sixteen health questions. ' +
  'After each question, speak your answer, then tap the green button. Let us begin.'

const OUTRO =
  'Thank you. I have everything I need. Your health profile is ready. Goodbye!'

export const VOICE_QUESTIONS = questionnaire.questions

export function buildSpokenQuestion(q, answers) {
  const n = q.n
  const total = VOICE_QUESTIONS.length
  let intro = `Question ${n} of ${total}. `

  if (q.type === 'bmi') {
    return (
      intro +
      'Please tell me your height in centimeters, and your weight in kilograms. ' +
      'For example, one hundred seventy centimeters and seventy kilograms.'
    )
  }

  if (q.type === 'waist') {
    const healthy = answers.gender === 'female' ? '80' : '90'
    return (
      intro +
      `${q.prompt} Please say the number in centimeters. ` +
      `A healthy waist for you is below ${healthy} centimeters.`
    )
  }

  if (q.type === 'multi') {
    const extra = q.maxSelect ? ` Pick up to ${q.maxSelect}.` : ''
    return intro + `${q.prompt}${extra} Say your choices out loud.`
  }

  return intro + q.prompt
}

export function buildRetryPrompt(error) {
  const raw = (error || '').trim()
  const friendly =
    raw === 'Invalid response' || raw === 'Failed to parse answer.'
      ? 'Please say one of the choices for this question.'
      : raw
  return `Sorry, I did not catch that. ${friendly || 'Please try again.'}`
}

export function buildConfirmPrompt(label) {
  return `I heard: ${label}. Is that correct? Say yes to continue, or no to try again.`
}

export { INTRO, OUTRO }

export async function fetchTTS(text) {
  let res
  try {
    res = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch {
    throw new Error('Cannot reach the voice server. Run npm run dev (starts API + web).')
  }

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Voice API is not running. Stop the server and run: npm run dev')
  }

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Speech failed')
  if (!data.audio) throw new Error('No audio returned from voice server.')
  return data
}

export async function transcribeAudio(blob) {
  try {
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const audio = btoa(binary)

    const res = await fetch('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio, mimeType: blob.type || 'audio/webm' }),
    })
    const data = await res.json()
    if (!res.ok) return ''
    return (data.transcript || '').trim()
  } catch {
    return ''
  }
}

export async function parseVoiceAnswer(question, transcript, answers) {
  try {
    const res = await fetch('/api/voice/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, transcript, answers }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { success: false, error: data.error || 'Could not understand. Please try again.' }
    }
    return data
  } catch {
    return { success: false, error: 'Network error. Please try again.' }
  }
}

let sharedAudioContext = null

/** Call synchronously inside a click/tap handler — unlocks audio for later playback. */
export function unlockAudioOnUserGesture() {
  if (typeof window === 'undefined') return
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return
  if (!sharedAudioContext) sharedAudioContext = new Ctx()
  if (sharedAudioContext.state === 'suspended') {
    void sharedAudioContext.resume()
  }
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function pickEnglishVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang === 'en-US') ||
    voices.find((v) => v.lang.startsWith('en')) ||
    voices[0] ||
    null
  )
}

function waitForVoices(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve(null)
      return
    }
    const existing = pickEnglishVoice()
    if (existing) {
      resolve(existing)
      return
    }
    const timer = setTimeout(() => resolve(pickEnglishVoice()), timeoutMs)
    window.speechSynthesis.onvoiceschanged = () => {
      clearTimeout(timer)
      resolve(pickEnglishVoice())
    }
  })
}

export function speakBrowser(text) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve()
      return
    }

    const maxMs = Math.min(8000, Math.max(2500, text.length * 45))

    void waitForVoices().then((voice) => {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'en-US'
      utterance.rate = 0.92
      if (voice) utterance.voice = voice

      const timer = setTimeout(() => {
        window.speechSynthesis.cancel()
        resolve()
      }, maxMs)

      utterance.onend = () => {
        clearTimeout(timer)
        resolve()
      }
      utterance.onerror = () => {
        clearTimeout(timer)
        resolve()
      }

      window.speechSynthesis.speak(utterance)
    })
  })
}

async function playMp3ViaWebAudio(base64) {
  unlockAudioOnUserGesture()
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('Web Audio not supported')
  if (!sharedAudioContext) sharedAudioContext = new Ctx()
  if (sharedAudioContext.state === 'suspended') await sharedAudioContext.resume()

  const bytes = base64ToBytes(base64)
  const audioBuffer = await sharedAudioContext.decodeAudioData(bytes.buffer.slice(0))

  return new Promise((resolve, reject) => {
    const source = sharedAudioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(sharedAudioContext.destination)
    source.onended = () => resolve()
    source.start(0)
    source.onerror = () => reject(new Error('Could not play audio'))
  })
}

async function playMp3ViaBlobUrl(base64) {
  unlockAudioOnUserGesture()
  const bytes = base64ToBytes(base64)
  const blob = new Blob([bytes], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const audio = new Audio(url)
    audio.volume = 1
    audio.setAttribute('playsinline', 'true')
    audio.onended = () => {
      URL.revokeObjectURL(url)
      resolve()
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not play audio'))
    }
    audio.play().catch(reject)
  })
}

export async function playBase64Mp3(base64) {
  try {
    await playMp3ViaWebAudio(base64)
  } catch {
    await playMp3ViaBlobUrl(base64)
  }
}

/** OpenAI TTS (primary). Falls back to browser speech only if API or playback fails. */
export async function speakAloud(text) {
  unlockAudioOnUserGesture()
  try {
    const { audio } = await fetchTTS(text)
    await playBase64Mp3(audio)
  } catch (err) {
    console.warn('[voice] OpenAI TTS failed, using browser fallback:', err.message)
    await speakBrowser(text)
  }
}

export function applyParsedAnswer(question, parsed, answers) {
  const next = { ...answers }
  switch (question.type) {
    case 'single':
    case 'gender':
      next[question.id] = parsed.value
      break
    case 'multi':
      next[question.id] = parsed.value.filter((v) => v !== 'none')
      if (parsed.value.includes('none')) next[question.id] = []
      break
    case 'bmi':
      next.heightCm = parsed.heightCm
      next.weightKg = parsed.weightKg
      break
    case 'waist':
      next.waistCm = parsed.waistCm
      break
    default:
      break
  }
  return next
}

export function labelForAnswer(question, parsed) {
  if (question.type === 'bmi') {
    return `${parsed.heightCm} centimeters tall, ${parsed.weightKg} kilograms`
  }
  if (question.type === 'waist') {
    return `${parsed.waistCm} centimeters waist`
  }
  if (question.type === 'multi') {
    const vals = parsed.value || []
    if (vals.includes('none') || vals.length === 0) return 'none'
    return vals
      .map((v) => question.options.find((o) => o.value === v)?.label || v)
      .join(', ')
  }
  return question.options?.find((o) => o.value === parsed.value)?.label || parsed.value
}

export function isYes(transcript) {
  const t = transcript.toLowerCase()
  return /\b(yes|yeah|yep|correct|right|confirm|ok|okay|sure)\b/.test(t)
}

export function isNo(transcript) {
  const t = transcript.toLowerCase()
  return /\b(no|nope|wrong|again|repeat|not)\b/.test(t)
}

function pickRecordingMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export class AudioRecorder {
  constructor() {
    this.mediaRecorder = null
    this.chunks = []
    this.stream = null
    this.recordingMime = 'audio/webm'
    this.startedAt = null
  }

  async ensureStream() {
    if (this.stream?.active) return
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone not supported in this browser.')
    }
    if (!window.isSecureContext) {
      throw new Error(
        'Microphone blocked: use https:// or open http://localhost:5173 on this machine.',
      )
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Microphone permission denied. Allow mic access in browser settings.')
      }
      throw err
    }
  }

  async start() {
    await this.ensureStream()
    this.chunks = []
    this.startedAt = Date.now()
    const mime = pickRecordingMimeType()
    this.recordingMime = mime || 'audio/webm'
    const options = mime ? { mimeType: mime } : {}
    this.mediaRecorder = new MediaRecorder(this.stream, options)
    if (this.mediaRecorder.mimeType) this.recordingMime = this.mediaRecorder.mimeType
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    // Flush chunks regularly so stop() always has audio data.
    this.mediaRecorder.start(250)
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve({ blob: null, durationMs: 0 })
        return
      }
      const durationMs = this.startedAt ? Date.now() - this.startedAt : 0
      this.startedAt = null
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recordingMime })
        this.mediaRecorder = null
        resolve({ blob, durationMs })
      }
      if (this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop()
      } else {
        this.mediaRecorder = null
        resolve({ blob: null, durationMs })
      }
    })
  }

  cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.mediaRecorder = null
    this.startedAt = null
  }
}

export function formatCallDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Browsers only allow mic + reliable audio on HTTPS or localhost. */
export function getVoiceCallBlocker() {
  if (typeof window === 'undefined') return 'Voice call is not available here.'
  if (!window.isSecureContext) {
    return (
      'Voice call needs a secure connection (HTTPS) or localhost. ' +
      'Port-forwarded HTTP links cannot use the microphone. ' +
      'Open the app at http://localhost:5173 on this computer, or use an HTTPS tunnel (e.g. ngrok).'
    )
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Your browser does not support microphone access. Try Chrome or Edge.'
  }
  return null
}

export async function requestMicPermission() {
  const blocker = getVoiceCallBlocker()
  if (blocker) throw new Error(blocker)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error(
        'Microphone access was blocked. Please allow the microphone in your browser settings and try again.',
      )
    }
    if (err.name === 'NotFoundError') {
      throw new Error('No microphone found on this device.')
    }
    throw new Error(err.message || 'Could not access the microphone.')
  }
}