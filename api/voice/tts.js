import { getOpenAI } from '../lib/openai.js'

const VOICE = 'shimmer'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
    return
  }

  try {
    const { text } = req.body || {}
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Body must include "text".' })
      return
    }

    const openai = getOpenAI()
    const speech = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: VOICE,
      input: text.slice(0, 4096),
      response_format: 'mp3',
      speed: 0.95,
    })

    const buffer = Buffer.from(await speech.arrayBuffer())
    res.status(200).json({ audio: buffer.toString('base64'), format: 'mp3' })
  } catch (err) {
    console.error('[/api/voice/tts]', err)
    res.status(500).json({ error: 'Failed to generate speech.' })
  }
}
