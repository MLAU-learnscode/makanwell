/** Local silence before forcing end-of-turn (backup when server VAD is fooled by noise) */
export const LOCAL_SILENCE_MS = 650
/** Hard cap on one utterance */
export const MAX_UTTERANCE_MS = 16000
/** Calibrate ambient noise before accepting speech */
export const NOISE_CALIBRATION_MS = 900

/**
 * server_vad with a high threshold — ignores most room noise.
 * (semantic_vad was keeping the turn open on background sound.)
 */
export const REALTIME_TURN_DETECTION = {
  type: 'server_vad',
  threshold: 0.88,
  prefix_padding_ms: 200,
  silence_duration_ms: 450,
}

export function forceEndUserTurn(client) {
  if (!client?.realtime?.isConnected()) return false
  try {
    client.realtime.send('input_audio_buffer.commit')
    return true
  } catch {
    return false
  }
}

/**
 * Adaptive end-of-turn: learns your room's noise floor, then ends the turn when
 * your voice drops well below your peak — not when an absolute mic level is hit.
 */
export class LocalSilenceWatchdog {
  constructor({
    onEndTurn,
    onSpeechStart,
    speechMargin = 18,
    quietMargin = 6,
    quietRatio = 0.32,
    quietMs = LOCAL_SILENCE_MS,
    maxMs = MAX_UTTERANCE_MS,
    calibrationMs = NOISE_CALIBRATION_MS,
  } = {}) {
    this.onEndTurn = onEndTurn
    this.onSpeechStart = onSpeechStart
    this.speechMargin = speechMargin
    this.quietMargin = quietMargin
    this.quietRatio = quietRatio
    this.quietMs = quietMs
    this.maxMs = maxMs
    this.calibrationMs = calibrationMs
    this.enabled = false
    this.calibrating = false
    this.calibrationStarted = 0
    this.noiseFloor = 4
    this.userTalking = false
    this.peakLevel = 0
    this.quietSince = null
    this.talkStarted = null
    this.committed = false
  }

  reset() {
    this.userTalking = false
    this.peakLevel = 0
    this.quietSince = null
    this.talkStarted = null
    this.committed = false
  }

  beginCalibration() {
    this.calibrating = true
    this.calibrationStarted = Date.now()
    this.noiseFloor = 4
    this.reset()
  }

  onServerSpeechStopped() {
    this.reset()
  }

  /** Ignore server speech_started — background noise often triggers it falsely */
  onServerSpeechStarted() {
    /* local peak-based detection only */
  }

  speechThreshold() {
    return this.noiseFloor + this.speechMargin
  }

  quietThreshold() {
    if (!this.userTalking) return this.noiseFloor + this.quietMargin
    const relative = this.peakLevel * this.quietRatio
    const absolute = this.noiseFloor + this.quietMargin
    return Math.max(absolute, relative)
  }

  tick(micLevel) {
    if (!this.enabled || this.committed) return

    const now = Date.now()

    if (this.calibrating) {
      this.noiseFloor = this.noiseFloor * 0.85 + micLevel * 0.15
      if (now - this.calibrationStarted >= this.calibrationMs) {
        this.calibrating = false
      }
      return
    }

    if (!this.userTalking) {
      this.noiseFloor = this.noiseFloor * 0.96 + micLevel * 0.04
    }

    const speechAt = this.speechThreshold()
    const quietAt = this.quietThreshold()

    if (micLevel >= speechAt) {
      if (!this.userTalking) {
        this.talkStarted = now
        this.onSpeechStart?.()
      }
      this.userTalking = true
      this.peakLevel = Math.max(this.peakLevel, micLevel)
      this.quietSince = null
    } else if (this.userTalking && micLevel < quietAt) {
      if (!this.quietSince) this.quietSince = now
      else if (now - this.quietSince >= this.quietMs) {
        this.committed = true
        this.onEndTurn?.('local_silence')
        return
      }
    } else if (this.userTalking) {
      this.quietSince = null
    }

    if (this.userTalking && this.talkStarted && now - this.talkStarted >= this.maxMs) {
      this.committed = true
      this.onEndTurn?.('max_duration')
    }
  }
}
