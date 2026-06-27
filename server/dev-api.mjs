import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Load .env.local without adding dotenv dependency
try {
  const envPath = resolve(root, '.env.local')
  const lines = readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
} catch {
  console.warn('[dev-api] No .env.local found — API routes need OPENAI_API_KEY')
}

const routes = {
  'POST /api/voice/tts': '../api/voice/tts.js',
  'POST /api/voice/transcribe': '../api/voice/transcribe.js',
  'POST /api/voice/parse': '../api/voice/parse.js',
  'POST /api/chat': '../api/chat.js',
}

const handlers = {}
for (const [route, rel] of Object.entries(routes)) {
  handlers[route] = (await import(pathToFileURL(resolve(__dirname, rel)).href)).default
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolveBody(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function createRes(res) {
  return {
    status(code) {
      res.statusCode = code
      return this
    },
    json(data) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    },
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const key = `${req.method} ${req.url?.split('?')[0]}`
  const handler = handlers[key]

  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  try {
    req.body = await readBody(req)
    await handler(req, createRes(res))
  } catch (err) {
    console.error('[dev-api]', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Internal server error' }))
  }
})

const PORT = 3001
server.listen(PORT, () => {
  console.log(`[dev-api] http://localhost:${PORT} (voice + chat routes)`)
})
