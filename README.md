# MakanWell (HawkerHealth)

Personalised hawker food recommendations for Singapore, with traffic-light dish ratings, nearby healthier eateries, and an AI voice chat assistant.

## Features

- **16-question health assessment** or **fast-track** for known conditions
- **AI Chat with AI** — conversational intake via text or push-to-talk voice (multi-language)
- **Food Guide** — traffic-light rated dishes filtered by your health profile
- **Nearby hawkers** — HPB Healthier Dining outlets near you

## Quick start

### Prerequisites

- Node.js 18+
- Python 3.11+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- OpenAI API key

### Setup

```bash
# Install frontend dependencies
npm install

# Install Python voice server dependencies
cd server && uv sync && cd ..

# Configure secrets
cp .env.example .env.local
# Add your OPENAI_API_KEY to .env.local
```

### Development

```bash
npm run dev
```

This starts both:
- **Vite** frontend at `http://localhost:5173`
- **Python voice server** WebSocket at `ws://localhost:8000/ws`

The voice server reads `OPENAI_API_KEY` from `.env.local` or `.env` in the project root.

### Voice chat only (without Vite)

```bash
npm run dev:voice   # Python server on port 8000
npm run dev:vite    # Vite only
```

## Architecture

| Component | Tech | Purpose |
|-----------|------|---------|
| Frontend | React + Vite + Tailwind | UI, chat window, food guide |
| Voice server | FastAPI + OpenAI Agents SDK | WebSocket chat + voice pipeline |
| Scoring | Shared questionnaire.json | Risk calculation (JS + Python port) |
| Legacy chat | Anthropic via `/api/chat` | Optional REST fallback |

## Production deployment

The app splits across two hosts:

| Service | Host | Env vars |
|---------|------|----------|
| React SPA | Vercel | `VITE_WEBSOCKET_ENDPOINT=wss://your-voice-api.example.com/ws` |
| Voice server | Railway / Render / Fly.io | `OPENAI_API_KEY` |

Vercel serverless functions cannot host persistent WebSocket connections — deploy the Python server separately.

## AI chat entry points

1. **Landing → Chat with AI** — AI conducts health intake, then opens Food Guide
2. **Nav → AI Chat** — ongoing nutrition Q&A with your profile context

Both support text and push-to-talk voice in English, Mandarin, Malay, Tamil, and other languages.
