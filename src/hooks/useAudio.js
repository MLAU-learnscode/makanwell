import { useCallback, useEffect, useRef, useState } from 'react'
import { WavRecorder, WavStreamPlayer } from 'wavtools'
import { normalizeArray } from '../lib/audioUtils.js'

export function useAudio() {
  const wavRecorder = useRef(null)
  const wavPlayer = useRef(null)
  const audioChunks = useRef([])
  const trackId = useRef(null)
  const [frequencies, setFrequencies] = useState([])
  const [audioPlayerIsReady, setAudioPlayerIsReady] = useState(false)
  const [audioRecorderIsReady, setAudioRecorderIsReady] = useState(false)
  const [playbackFrequencies, setPlaybackFrequencies] = useState([])

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
        window.requestAnimationFrame(getFrequencies)
      } else {
        setPlaybackFrequencies([])
      }
    }
  }, [])

  const playAudio = useCallback(
    (audio) => {
      if (wavPlayer.current) {
        wavPlayer.current.add16BitPCM(audio, trackId.current ?? undefined)
        window.requestAnimationFrame(getFrequencies)
      }
    },
    [getFrequencies],
  )

  async function startRecording() {
    await stopPlaying()
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
    await wavPlayer.current?.interrupt()
    setPlaybackFrequencies(Array.from({ length: 30 }, () => 0))
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
    playAudio,
    startRecording,
    stopRecording,
    stopPlaying,
    frequencies,
    playbackFrequencies,
  }
}
