import { useCallback, useEffect, useRef, useState } from 'react'
import { WavRecorder, WavStreamPlayer } from 'wavtools'
import { normalizeArray } from '../lib/audioUtils.js'

export function useAudio() {
  const wavRecorder = useRef(null)
  const wavPlayer = useRef(null)
  const audioChunks = useRef([])
  const trackId = useRef(null)
  const suppressPlayback = useRef(false)
  const voiceResponseExpected = useRef(false)
  const [frequencies, setFrequencies] = useState([])
  const [audioPlayerIsReady, setAudioPlayerIsReady] = useState(false)
  const [audioRecorderIsReady, setAudioRecorderIsReady] = useState(false)
  const [playbackFrequencies, setPlaybackFrequencies] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    async function init() {
      wavRecorder.current = new WavRecorder({ sampleRate: 24000 })
      await wavRecorder.current.begin()
      setAudioRecorderIsReady(true)
      wavPlayer.current = new WavStreamPlayer({ sampleRate: 24000 })
      await wavPlayer.current.connect()
      setAudioPlayerIsReady(true)
    }
    init()
    return () => {
      wavRecorder.current?.end?.()
      wavPlayer.current?.interrupt?.()
    }
  }, [])

  const getFrequencies = useCallback(async () => {
    if (wavPlayer.current) {
      const newFrequencies = wavPlayer.current.getFrequencies('voice').values
      setPlaybackFrequencies(normalizeArray(newFrequencies, 5))
      const status = await wavPlayer.current?.getTrackSampleOffset()
      if (status) {
        setIsPlaying(true)
        window.requestAnimationFrame(getFrequencies)
      } else {
        setPlaybackFrequencies([])
        setIsPlaying(false)
      }
    }
  }, [])

  /** Stop assistant speech and ignore audio until the next response or audio.done. */
  const interruptPlayback = useCallback(async ({ expectVoiceResponse = false } = {}) => {
    suppressPlayback.current = true
    voiceResponseExpected.current = expectVoiceResponse
    trackId.current = crypto.randomUUID()
    await wavPlayer.current?.interrupt()
    setPlaybackFrequencies([])
    setIsPlaying(false)
  }, [])

  /** Called when the server finishes an audio stream (audio.done). */
  const onPlaybackDone = useCallback(() => {
    suppressPlayback.current = false
    voiceResponseExpected.current = false
    setIsPlaying(false)
    setPlaybackFrequencies([])
  }, [])

  const playAudio = useCallback(
    (audio) => {
      if (suppressPlayback.current) {
        if (!voiceResponseExpected.current) return
        suppressPlayback.current = false
      }

      if (wavPlayer.current) {
        if (!trackId.current) trackId.current = crypto.randomUUID()
        wavPlayer.current.add16BitPCM(audio, trackId.current)
        setIsPlaying(true)
        window.requestAnimationFrame(getFrequencies)
      }
    },
    [getFrequencies],
  )

  async function startRecording() {
    await interruptPlayback({ expectVoiceResponse: false })
    trackId.current = crypto.randomUUID()
    await wavRecorder.current?.clear()
    audioChunks.current = []
    await wavRecorder.current?.record((data) => {
      audioChunks.current.push(data.mono)
      const updatedFrequencies = wavRecorder.current?.getFrequencies('voice') || {
        values: new Float32Array([0]),
      }
      setFrequencies(normalizeArray(updatedFrequencies.values, 30))
    })
  }

  async function stopPlaying() {
    await interruptPlayback({ expectVoiceResponse: false })
  }

  async function stopRecording() {
    await wavRecorder.current?.pause()
    const dataArrays = audioChunks.current.map((chunk) => new Int16Array(chunk))
    const totalLength = dataArrays.reduce((acc, chunk) => acc + chunk.length, 0)
    const mergedAudio = new Int16Array(totalLength)
    let offset = 0
    dataArrays.forEach((chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        mergedAudio[offset + i] = chunk[i]
      }
      offset += chunk.length
    })
    return mergedAudio
  }

  return {
    isReady: audioPlayerIsReady && audioRecorderIsReady,
    isPlaying,
    playAudio,
    startRecording,
    stopRecording,
    stopPlaying,
    interruptPlayback,
    onPlaybackDone,
    frequencies,
    playbackFrequencies,
  }
}
