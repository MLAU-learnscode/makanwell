import { useEffect, useState } from 'react'
import { classify } from './lib/classify.js'
import { isVoiceSupported, listenOnce, speak } from './lib/voice.js'

// Minimal scaffold shell. Proves the full stack works (food DB load, traffic
// lights, /api/chat proxy, voice). The frontend teammate replaces this UI with
// QuizStep / FoodCard / ChatBubble components.

const RATING_COLOR = { safe: 'text-safe', modify: 'text-modify', avoid: 'text-avoid' }
const RATING_DOT = { safe: 'bg-safe', modify: 'bg-modify', avoid: 'bg-avoid' }

export default function App() {
  const [dishes, setDishes] = useState([])
  const [filter, setFilter] = useState('all')
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  // Demo profile — in the real app this comes from the questionnaire + classify().
  const profile = classify({ ageGroup: '46-60', conditions: ['Hypertension'], activity: 'Sedentary' })

  useEffect(() => {
    fetch('/food_database.json')
      .then((r) => r.json())
      .then(setDishes)
      .catch(() => setDishes([]))
  }, [])

  const visible = dishes.filter((d) => {
    if (filter === 'all') return true
    // filter by the hypertension rating as a demo lens
    return d.conditions?.hypertension?.rating === filter
  })

  async function sendChat(text) {
    const message = (text ?? input).trim()
    if (!message) return
    setBusy(true)
    setReply('')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { tier: profile.key, conditions: ['Hypertension'] },
          messages: [{ role: 'user', content: message }],
        }),
      })
      const data = await res.json()
      const answer = data.reply || data.error || 'No response.'
      setReply(answer)
      if (data.reply) speak(data.reply)
    } catch {
      setReply('Could not reach the advisor.')
    } finally {
      setBusy(false)
      setInput('')
    }
  }

  async function handleMic() {
    try {
      const transcript = await listenOnce()
      setInput(transcript)
      sendChat(transcript)
    } catch (e) {
      setReply(e.message)
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-gray-800">
      <header className="bg-primary text-white px-6 py-4">
        <h1 className="text-2xl font-bold">MakanWell</h1>
        <p className="text-sm opacity-90">Eat hawker, stay well.</p>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-8">
        <section>
          <div
            className="rounded-lg p-4 text-white"
            style={{ backgroundColor: profile.color }}
          >
            <p className="font-semibold">{profile.label}</p>
            <p className="text-sm opacity-90">{profile.blurb}</p>
          </div>
        </section>

        <section>
          <div className="flex gap-2 mb-3">
            {['all', 'safe', 'modify', 'avoid'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-sm border ${
                  filter === f ? 'bg-primary text-white border-primary' : 'border-gray-300'
                }`}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {visible.map((d) => (
              <div key={d.id} className="bg-white rounded-lg shadow-sm p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-xs text-gray-500">
                      {d.local_name} · {d.category} · {d.serving_size}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">{d.calories} kcal</span>
                </div>
                <div className="flex gap-4 mt-3 text-xs">
                  {Object.entries(d.conditions).map(([cond, info]) => (
                    <span key={cond} className={`flex items-center gap-1 ${RATING_COLOR[info.rating]}`}>
                      <span className={`w-2 h-2 rounded-full ${RATING_DOT[info.rating]}`} />
                      {cond}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {visible.length === 0 && <p className="text-gray-400 text-sm">No dishes match.</p>}
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Ask the advisor</h2>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-gray-300 rounded px-3 py-2"
              placeholder="e.g. Suggest a low-sodium hawker lunch"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
            />
            <button onClick={() => sendChat()} disabled={busy} className="bg-primary text-white px-4 rounded">
              {busy ? '…' : 'Send'}
            </button>
            {isVoiceSupported() && (
              <button onClick={handleMic} disabled={busy} className="border border-gray-300 px-3 rounded" title="Speak">
                🎙️
              </button>
            )}
          </div>
          {reply && <p className="mt-3 bg-white rounded-lg shadow-sm p-4 whitespace-pre-wrap">{reply}</p>}
        </section>
      </main>
    </div>
  )
}
