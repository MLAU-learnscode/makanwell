// Vercel serverless function: POST /api/hawker-search
// Proxies Google Places Text Search for hawker stalls so the API key stays server-side.
// Body: { food: string, lat: number, lng: number }
// Returns: { places: [{ name, address, rating }], query: string }

const HAWKER_SEARCH_SUFFIX = 'hawker stall Singapore'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return res.status(500).json({ error: 'Missing GOOGLE_PLACES_API_KEY' })

  const { food, lat, lng } = req.body || {}

  if (!food || typeof food !== 'string' || !food.trim()) {
    return res.status(400).json({ error: 'food must be a non-empty string' })
  }
  if (food.length > 200) {
    return res.status(400).json({ error: 'food too long (max 200 chars)' })
  }
  if (!isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'lat must be a valid latitude (-90 to 90)' })
  }
  if (!isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lng must be a valid longitude (-180 to 180)' })
  }

  const searchQuery = `${food.trim()} ${HAWKER_SEARCH_SUFFIX}`
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&location=${lat},${lng}&radius=3000&key=${key}`

  try {
    const r = await fetch(url)
    const data = await r.json()

    const places = (data.results ?? []).slice(0, 5).map((p) => ({
      name: p.name,
      address: p.formatted_address,
      rating: p.rating ?? null,
    }))

    res.status(200).json({ places, query: searchQuery })
  } catch (err) {
    console.error('[/api/hawker-search] error:', err)
    res.status(500).json({ error: 'Hawker search failed' })
  }
}
