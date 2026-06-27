# MakanWell

Personalised hawker food guide for Singaporeans managing chronic disease risk. Users complete a 16-question lifestyle assessment (or fast-track with a confirmed diagnosis), receive a scored risk profile across hypertension, hyperlipidaemia, and diabetes, then browse a food database with per-dish traffic-light ratings filtered to their conditions.

## Features

- **Risk engine** — weighted scoring across 16 questions (age, BMI, waist, ethnicity, activity, diet, sleep, stress, symptoms, family history). Normalises each condition to 0–100 and tiers into Low / Moderate / High.
- **Fast-track path** — skip assessment for users with a confirmed diagnosis; jumps directly to the food guide.
- **Food guide** — dishes sorted safe → modify → avoid per condition, with per-dish macros (sodium, saturated fat, cholesterol, GI) and condition-specific tips. Category and text search.
- **Nearby hawkers** — browser geolocation finds the closest hawker centres, with a Google Places fallback for live search.
- **AI chat** — Claude-backed nutrition assistant; context-aware of the user's risk tier and conditions. Voice input (Web Speech API, `en-SG`) and TTS read-back of AI replies.
- **Responsive layout** — bottom nav on mobile, sidebar on desktop.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite 6 |
| Styling | Tailwind CSS 3 |
| Animation | Motion (Framer) |
| Icons | Lucide React |
| AI | Anthropic SDK (`claude-3-5-sonnet-latest`) via `/api/chat` serverless function |
| Voice | Web Speech API (Chrome/Edge only) |
| Deployment | Vercel (serverless API routes) |

## Project Structure

```
src/
  App.jsx              # All screens and UI components
  lib/
    scoring.js         # Risk engine — reads weights from questionnaire.json
    voice.js           # Web Speech API wrapper (STT + TTS)
  data/
    questionnaire.json # Single source of truth for questions, weights, tiers
    foodSchema.json    # Food database schema
    postalRegions.json # Postal district → region mapping
public/
  food_database.json   # Dish records with per-condition ratings
  hawker_eateries.json # Hawker centre locations dataset
api/
  chat.js              # Serverless — proxies to Anthropic Claude
  places.js            # Serverless — proxies to Google Places API
  hawker-search.js     # Serverless — hawker search helper
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

| Variable | Description | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key — [get one here](https://console.anthropic.com) | Yes (for AI chat) |
| `GOOGLE_PLACES_API_KEY` | Google Places API key — [get one here](https://console.cloud.google.com) | No (falls back to local data) |

> Keys have **no** `VITE_` prefix intentionally — they are read only by serverless functions and never bundled into the client.

## Running Locally

### Food guide only (no AI chat)

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. The food guide, risk assessment, and nearby hawker features work fully. The AI chat tab will show a prompt to use `vercel dev`.

### Full local dev with AI chat

```bash
npm install
npm install -g vercel
vercel dev
```

This runs both the Vite dev server and the `/api/*` serverless functions together. Ensure `.env.local` contains your `ANTHROPIC_API_KEY`.

## Deploying to Vercel

### 1. Install the Vercel CLI

```bash
npm install -g vercel
```

### 2. Link the project

Run this once from the project root:

```bash
vercel link
```

Follow the prompts — create a new project or link to an existing one.

### 3. Set environment variables

Add your secrets via the Vercel dashboard or CLI:

**Option A — Dashboard:**

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard) → your project → **Settings** → **Environment Variables**
2. Add `ANTHROPIC_API_KEY` (and optionally `GOOGLE_PLACES_API_KEY`)
3. Set the environment to **Production**, **Preview**, and **Development** as needed

**Option B — CLI:**

```bash
vercel env add ANTHROPIC_API_KEY
vercel env add GOOGLE_PLACES_API_KEY   # optional
```

### 4. Deploy

```bash
vercel --prod
```

Vercel will build the Vite frontend and deploy the `api/` directory as serverless functions automatically (configured in `vercel.json`).

Your app will be live at `https://<your-project>.vercel.app`.

### Subsequent deploys

Push to your linked Git branch and Vercel will auto-deploy, or run:

```bash
vercel --prod
```

## Risk Scoring

Scores are summed per condition from option `points` in `questionnaire.json`, then normalised against per-condition max scores:

| Condition | Max raw score |
|---|---|
| Hypertension | 40 |
| Hyperlipidaemia | 31 |
| Diabetes | 46 |

Tiers: **Low** < 30 · **Moderate** 30–60 · **High** ≥ 60

> Scores are for general reference only and do not constitute medical diagnosis.

## Data Sources

- Food nutrition data aligned with **HPB (Health Promotion Board) guidelines**
- Hawker centre locations from Singapore open data
- Risk factor weights informed by standard cardiovascular and metabolic risk literature

## Browser Support

Full functionality on **Chrome** and **Edge**. Voice input is unavailable on Firefox and Safari; all other features work.
