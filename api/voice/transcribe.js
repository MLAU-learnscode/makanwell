import { toFile } from 'openai'
import { getOpenAI } from '../lib/openai.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
    return
  }

  try {
    const { audio, mimeType = 'audio/webm' } = req.body || {}
    if (!audio || typeof audio !== 'string') {
      res.status(400).json({ error: 'Body must include base64 "audio".' })
      return
    }

    const buffer = Buffer.from(audio, 'base64')
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    const file = await toFile(buffer, `recording.${ext}`, { type: mimeType })

    const openai = getOpenAI()
    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'en',
    })

    res.status(200).json({ transcript: result.text?.trim() || '' })
  } catch (err) {
    console.error('[/api/voice/transcribe]', err)
    res.status(500).json({ error: 'Failed to transcribe audio.' })
  }
}
