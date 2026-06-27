// MakanWell risk-scoring engine. Faithful to questionnaire-spec v1.0.
// All point weights live in src/data/questionnaire.json (single source of truth);
// this module only implements the algorithm over them.

import questionnaire from '../data/questionnaire.json'

export const CONDITIONS = ['hypertension', 'hyperlipidaemia', 'diabetes']

export const CONDITION_LABEL = {
  hypertension: 'Hypertension',
  hyperlipidaemia: 'Hyperlipidaemia',
  diabetes: 'Diabetes',
}

// Risk-tier display copy + badge colours (spec: Health Profile screen).
export const TIER_DISPLAY = {
  High: { label: 'Red Alert', color: '#dc2626', subtext: 'Your lifestyle signals significant risk. Act now.' },
  Moderate: { label: 'Watch Out', color: '#d97706', subtext: 'Some risk factors present. Small changes go a long way.' },
  Low: { label: 'Prevention Mode', color: '#16a34a', subtext: 'Low risk now. Keep it that way.' },
}

const zero = () => ({ hypertension: 0, hyperlipidaemia: 0, diabetes: 0 })
const addPoints = (acc, points) => {
  for (const c of CONDITIONS) acc[c] += points?.[c] ?? 0
}

export function computeBMI(heightCm, weightKg) {
  const h = Number(heightCm) / 100
  if (!h || !weightKg) return null
  return Number(weightKg) / (h * h)
}

// Find the matching band/option in an ordered band list by numeric value.
function findBand(bands, value) {
  return bands.find(
    (b) => (b.min === undefined || value >= b.min) && (b.max === undefined || value < b.max),
  )
}

/**
 * Compute the full risk score from questionnaire answers.
 * @param {object} answers — shape matches QuestionnaireAnswers in the spec.
 * @returns {{raw, normalised, tier, primaryConditions, isTie}}
 */
export function calculateRisk(answers = {}) {
  const raw = zero()

  for (const q of questionnaire.questions) {
    if (!q.scored) continue

    switch (q.type) {
      case 'single': {
        const opt = q.options.find((o) => o.value === answers[q.id])
        if (opt) addPoints(raw, opt.points)
        break
      }
      case 'multi': {
        const selected = answers[q.id] || []
        for (const v of selected) {
          const opt = q.options.find((o) => o.value === v)
          if (opt) addPoints(raw, opt.points)
        }
        break
      }
      case 'bmi': {
        const bmi = computeBMI(answers.heightCm, answers.weightKg)
        if (bmi != null) {
          const band = findBand(q.bands, bmi)
          if (band) addPoints(raw, band.points)
        }
        break
      }
      case 'waist': {
        const bands = q.thresholds[answers.gender]
        const waist = Number(answers.waistCm)
        if (bands && waist) {
          const band = findBand(bands, waist)
          if (band) addPoints(raw, band.points)
        }
        break
      }
      default:
        break
    }
  }

  // Normalise each condition to 0–100 against its own max.
  const normalised = {}
  const tier = {}
  for (const c of CONDITIONS) {
    const pct = Math.round(((raw[c] / questionnaire.maxScores[c]) * 100) * 10) / 10
    normalised[c] = pct
    tier[c] = tierForScore(pct)
  }

  // Rank; co-primary if top two are within the tie threshold.
  const sorted = CONDITIONS.map((c) => [c, normalised[c]]).sort((a, b) => b[1] - a[1])
  const isTie = sorted[0][1] - sorted[1][1] <= questionnaire.tieThreshold
  const primaryConditions = isTie ? [sorted[0][0], sorted[1][0]] : [sorted[0][0]]

  return { raw, normalised, tier, primaryConditions, isTie }
}

export function tierForScore(pct) {
  const match = questionnaire.tiers.find((t) => pct >= t.min && pct < t.max)
  return match ? match.tier : 'Low'
}

// ── Food dashboard helpers ──────────────────────────────────────────────

const RATING_PRIORITY = { safe: 0, modify: 1, avoid: 2 }

/** Most restrictive rating for a dish across one or more conditions. */
export function getWorstRating(dish, conditions) {
  return conditions.reduce((worst, cond) => {
    const rating = dish.conditions?.[cond]?.rating ?? 'safe'
    return RATING_PRIORITY[rating] > RATING_PRIORITY[worst] ? rating : worst
  }, 'safe')
}

/**
 * Sort dishes safe → modify → avoid for the given primary condition(s).
 * For multiple conditions, sorts by the worst (most restrictive) rating.
 */
export function sortDishesForConditions(dishes, conditions) {
  return [...dishes].sort(
    (a, b) => RATING_PRIORITY[getWorstRating(a, conditions)] - RATING_PRIORITY[getWorstRating(b, conditions)],
  )
}

/** Fast-track path: confirmed conditions bypass scoring entirely. */
export function fastTrack(conditions) {
  return { primaryConditions: conditions, isTie: conditions.length > 1, fastTrack: true }
}
