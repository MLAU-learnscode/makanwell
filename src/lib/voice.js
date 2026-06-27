// Web Speech API wrapper — runs entirely in the browser, no API key, no server.
// Works in Chrome and Edge. Does NOT work in Firefox or Safari (demo on Chrome).

export function isVoiceSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

/**
 * Listen for a single spoken phrase and resolve with the transcript.
 * @param {object} opts
 * @param {string} [opts.lang='en-SG']
 * @returns {Promise<string>} the recognized transcript
 */
export function listenOnce({ lang = 'en-SG' } = {}) {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      reject(new Error('Voice input not supported in this browser. Use Chrome or Edge.'))
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      resolve(transcript)
    }
    recognition.onerror = (e) => reject(new Error(e.error || 'Voice recognition error'))

    recognition.start()
  })
}

/**
 * Speak text aloud (text-to-speech read-back of the AI reply).
 * @param {string} text
 * @param {object} opts
 * @param {string} [opts.lang='en-SG']
 * @param {number} [opts.rate=0.95]
 */
export function speak(text, { lang = 'en-SG', rate = 0.95 } = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = rate
  window.speechSynthesis.speak(utterance)
}
