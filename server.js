import Anthropic from '@anthropic-ai/sdk'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = path.join(__dirname, '.env.local')
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8')
    content.split('\n').forEach((line) => {
      const [key, value] = line.split('=')
      if (key && value) {
        process.env[key.trim()] = value.trim()
      }
    })
  }
}

loadEnv()

const PORT = 3000

// Defense-in-depth: Verify environment at startup
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY not found in environment')
  console.error(`   Checked .env.local at: ${path.join(__dirname, '.env.local')}`)
  process.exit(1)
} else {
  console.log('✅ ANTHROPIC_API_KEY loaded')
}

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

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.writeHead(500)
    res.end(JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY.' }))
    return
  }

  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', async () => {
    try {
      const { messages, profile } = JSON.parse(body)

      if (!Array.isArray(messages) || messages.length === 0) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: 'Body must include a non-empty "messages" array.' }))
        return
      }

      const client = new Anthropic()
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: buildSystemPrompt(profile),
        messages,
      })

      const reply = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ reply, model: response.model }))
    } catch (err) {
      console.error('[/api/chat] error:', err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: 'Failed to get a response from the advisor.' }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`✨ API server running on http://localhost:${PORT}`)
  console.log(`   Make sure .env.local has ANTHROPIC_API_KEY set`)
})
