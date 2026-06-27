import Anthropic from '@anthropic-ai/sdk'

// Vercel serverless function: POST /api/chat
// Holds ANTHROPIC_API_KEY server-side and proxies to Claude. The browser calls
// this endpoint, never api.anthropic.com directly, so the key stays secret.

const MODEL = 'claude-sonnet-4-6'

// Build a system prompt tuned to the user's health profile so the advisor's
// tips line up with MakanWell's traffic-light thresholds.
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
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' })
    return
  }

  try {
    const { messages, profile } = req.body || {}

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Body must include a non-empty "messages" array.' })
      return
    }

    const client = new Anthropic() // reads ANTHROPIC_API_KEY from env

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
