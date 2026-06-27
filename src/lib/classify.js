// Questionnaire → health tier classification (runs in the browser, no API call).
// Mirrors the workplan's 5-question flow and classification logic.

// Question option constants — keep frontend selects in sync with these.
export const CONDITIONS = ['Hyperlipidaemia', 'Hypertension', 'Diabetes', 'None']
export const AGE_GROUPS = ['18-30', '31-45', '46-60', '60+']
export const ACTIVITY = ['Very active', 'Moderately active', 'Somewhat sedentary', 'Sedentary']

export const TIERS = {
  RED_ALERT: {
    key: 'Red Alert',
    label: 'Red Alert',
    color: '#dc2626',
    blurb: 'Multiple diet-linked conditions — choose carefully every meal.',
  },
  WATCH_OUT: {
    key: 'Watch Out',
    label: 'Watch Out',
    color: '#d97706',
    blurb: 'One condition to manage — small swaps make a big difference.',
  },
  PREVENTION: {
    key: 'Prevention Mode',
    label: 'Prevention Mode',
    color: '#0d9488',
    blurb: 'No diagnosis, but age or lifestyle means prevention matters.',
  },
  HEALTH_CONSCIOUS: {
    key: 'Health Conscious',
    label: 'Health Conscious',
    color: '#16a34a',
    blurb: 'Low risk — keep enjoying hawker food mindfully.',
  },
}

/**
 * Classify a questionnaire answer set into a health tier.
 * @param {object} answers
 * @param {string} answers.ageGroup        one of AGE_GROUPS
 * @param {string[]} answers.conditions    subset of CONDITIONS
 * @param {string} answers.activity        one of ACTIVITY
 * @returns {object} a TIERS entry
 */
export function classify({ ageGroup, conditions = [], activity } = {}) {
  const real = conditions.filter((c) => c && c !== 'None')

  if (real.length >= 2) return TIERS.RED_ALERT
  if (real.length === 1) return TIERS.WATCH_OUT

  // No diagnosed conditions from here on.
  const olderOrSedentary =
    ageGroup === '46-60' ||
    ageGroup === '60+' ||
    activity === 'Somewhat sedentary' ||
    activity === 'Sedentary'

  if (olderOrSedentary) return TIERS.PREVENTION
  return TIERS.HEALTH_CONSCIOUS
}
