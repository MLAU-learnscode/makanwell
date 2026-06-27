// Vercel serverless function: POST /api/places
// Proxies Google Places Text Search so the API key stays server-side.
// Body: { query: string, lat: number, lng: number }
// Returns: { places: [{ name, address, rating, place_id, lat, lng }] }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return res.status(500).json({ error: 'Missing GOOGLE_PLACES_API_KEY' })

  const { query, lat, lng } = req.body || {}

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query must be a non-empty string' })
  }
  if (query.length > 200) {
    return res.status(400).json({ error: 'query too long (max 200 chars)' })
  }
  if (!isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'lat must be a valid latitude (-90 to 90)' })
  }
  if (!isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lng must be a valid longitude (-180 to 180)' })
  }

  // ponytail: Text Search handles arbitrary food-name queries better than Nearby Search
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' Singapore')}&location=${lat},${lng}&radius=2000&key=${key}`

  try {
    const r = await fetch(url)
    const data = await r.json()

    const places = (data.results ?? []).slice(0, 5).map((p) => ({
      name: p.name,
      address: p.formatted_address,
      rating: p.rating,
      place_id: p.place_id,
      lat: p.geometry.location.lat,
      lng: p.geometry.location.lng,
    }))

    res.status(200).json({ places })
  } catch (err) {
    console.error('[/api/places] error:', err)
    res.status(500).json({ error: 'Places lookup failed' })
  }
}
