import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-3-5-sonnet-latest'
const MAX_MESSAGES = 40
const MAX_CONTENT_LENGTH = 4000

function buildSystemPrompt(profile = {}) {
  const conditions =
    Array.isArray(profile.conditions) && profile.conditions.length
      ? profile.conditions.join(', ')
      : 'none reported'
  const tier = profile.tier || 'unknown'

  return [
    'You are MakanWell, a friendly Singapore hawker-food health advisor.',
    'You help users enjoy hawker culture while managing diet-linked conditions.',
    `The user's health tier is: ${tier}. Diagnosed conditions: ${conditions}.`,
    '',
    'Rate dishes using these thresholds:',
    '- Hypertension: AVOID if sodium >600mg/serve, MODIFY 300-600mg, SAFE <300mg.',
    '- Hyperlipidaemia: AVOID if sat fat >6g OR cholesterol >150mg; MODIFY if sat fat 3-6g or chol 75-150mg; SAFE if sat fat <3g AND chol <75mg.',
    '- Diabetes: AVOID high GI + sugar >20g; MODIFY medium GI watch portion; SAFE low GI + high fibre.',
    '',
    'Give concrete, local, actionable tips ("ask for less gravy", "swap to steamed", "less rice, more cucumber").',
    'Keep replies short and conversational — this may be read aloud by a voice assistant.',
  ].join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' })
  }

  const { messages, profile } = req.body || {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty "messages" array.' })
  }

  // Layer 1: cap message count to prevent abuse
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES}).` })
  }

  // Layer 2: sanitise each message — only allow valid roles and reasonable length
  const VALID_ROLES = new Set(['user', 'assistant'])
  for (const msg of messages) {
    if (!VALID_ROLES.has(msg.role)) {
      return res.status(400).json({ error: `Invalid message role: ${msg.role}` })
    }
    if (typeof msg.content !== 'string' || msg.content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({ error: `Message content too long (max ${MAX_CONTENT_LENGTH} chars).` })
    }
  }

  try {
    const client = new Anthropic()

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(profile),
      messages,
    })

    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    res.status(200).json({ reply, model: response.model })
  } catch (err) {
    console.error('[/api/chat] error:', err)
    res.status(500).json({ error: 'Failed to get a response from the advisor.' })
  }
}
