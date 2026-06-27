# MakanWell

Personalised hawker food guide for Singaporeans managing chronic disease risk. Users complete a 16-question lifestyle assessment (or skip to fast-track with a confirmed diagnosis), receive a scored risk profile across hypertension, hyperlipidaemia, and diabetes, then browse a food database with per-dish traffic-light ratings filtered to their conditions.

## Features

- **Risk engine** — weighted scoring across 16 questions (age, BMI, waist, ethnicity, activity, diet, sleep, stress, symptoms, family history). Normalises each condition to 0–100 and tiers into Low / Moderate / High. Co-primary conditions flagged when scores are within 5 points.
- **Fast-track path** — skip assessment for users with a confirmed diagnosis; jumps directly to the food guide.
- **Food guide** — dishes sorted safe → modify → avoid per condition, with per-dish macros (sodium, saturated fat, cholesterol, GI) and condition-specific tips. Category and text search.
- **Nearby hawkers** — browser geolocation finds the three closest hawker centres from a bundled GeoJSON dataset.
- **AI chat** — Claude-backed nutrition assistant; context-aware of the user's risk tier and conditions. Voice input (Web Speech API, `en-SG`) and TTS read-back of AI replies.
- **Responsive layout** — bottom nav on mobile, sidebar on desktop.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite 6 |
| Styling | Tailwind CSS 3 |
| Animation | Motion (Framer) |
| Icons | Lucide React |
| AI | Anthropic SDK (`claude-sonnet-4-6`) via `/api/chat` serverless function |
| Voice | Web Speech API (Chrome/Edge only) |
| Deployment | Vercel (serverless API route) |

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
  hawker_eateries.json # Hawker centre GeoJSON
api/
  chat.js              # Vercel serverless function — proxies to Anthropic
```

## Getting Started

```bash
npm install
npm run dev          # http://localhost:5173 (food guide works; chat needs Vercel)
```

To test the AI chat locally:

```bash
npm install -g vercel
vercel dev           # runs both Vite and the /api/chat serverless function
```

Set `ANTHROPIC_API_KEY` in your environment or a `.env` file before running `vercel dev`.

## Risk Scoring

Scores are summed per condition from option `points` in `questionnaire.json` (single source of truth), then normalised against per-condition max scores:

| Condition | Max raw score |
|---|---|
| Hypertension | 40 |
| Hyperlipidaemia | 31 |
| Diabetes | 46 |

Tiers: **Low** < 30 · **Moderate** 30–60 · **High** ≥ 60.

> Scores are for general reference only and do not constitute medical diagnosis.

## Data Sources

- Food nutrition data aligned with **HPB (Health Promotion Board) guidelines**
- Hawker centre locations from Singapore open data
- Risk factor weights informed by standard cardiovascular and metabolic risk literature

## Browser Support

Full functionality on **Chrome** and **Edge**. Voice input unavailable on Firefox and Safari (all other features work).
