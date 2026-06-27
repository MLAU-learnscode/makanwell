import questionnaire from '../data/questionnaire.json'

export const REALTIME_RELAY_URL =
  import.meta.env.VITE_REALTIME_RELAY_URL || 'ws://localhost:8081'

/** GPT-Realtime model — override with VITE_OPENAI_REALTIME_MODEL in .env.local */
export const REALTIME_MODEL =
  import.meta.env.VITE_OPENAI_REALTIME_MODEL || 'gpt-realtime'

const QUESTIONS = questionnaire.questions

function questionBlock(q) {
  let block = `Q${q.n} id="${q.id}" (${q.type}): ${q.prompt}`
  if (q.options?.length) {
    block += `\n   Allowed: ${q.options.map((o) => `${o.label} → value "${o.value}"`).join('; ')}`
  }
  if (q.type === 'bmi') {
    block += '\n   Record heightCm (100–250) and weightKg (30–300).'
  }
  if (q.type === 'waist') {
    block += '\n   Record waistCm (50–200). Healthy waist depends on gender from Q2.'
  }
  if (q.maxSelect) block += `\n   User may pick up to ${q.maxSelect} options.`
  if (q.examples) block += `\n   Examples: ${q.examples}`
  return block
}

export function buildRealtimeInstructions() {
  const list = QUESTIONS.map(questionBlock).join('\n\n')

  return `You are HawkerHealth, a warm and patient Singapore health helpline assistant on a live phone call.
Your job is to guide the caller through a 16-question health check — like a friendly customer support agent.

Rules:
- Speak naturally in clear English. Keep responses concise (1–3 sentences).
- Ask ONE question at a time, in order (Q1 through Q16).
- After you understand the caller's answer, call save_answer with exact allowed values.
- If the answer is unclear, ask a short follow-up — do not guess.
- The caller may interrupt you at any time; stop speaking and listen.
- For multi-select questions, if they say "none", pass values: ["none"].
- After saving Q16, call complete_assessment, thank them, and say their health profile is ready.

Questionnaire:
${list}
`
}

export const SAVE_ANSWER_TOOL = {
  name: 'save_answer',
  description:
    'Save one questionnaire answer after the caller has clearly responded. Use exact value strings from the allowed list.',
  parameters: {
    type: 'object',
    properties: {
      questionId: {
        type: 'string',
        enum: QUESTIONS.map((q) => q.id),
        description: 'Question id from the questionnaire',
      },
      value: {
        type: 'string',
        description: 'Single-choice answer value (for type single, gender, etc.)',
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multi-select answer values',
      },
      heightCm: { type: 'number', description: 'Height in cm (question bmi)' },
      weightKg: { type: 'number', description: 'Weight in kg (question bmi)' },
      waistCm: { type: 'number', description: 'Waist in cm (question waist)' },
    },
    required: ['questionId'],
  },
}

export const COMPLETE_ASSESSMENT_TOOL = {
  name: 'complete_assessment',
  description: 'Call when all 16 questions have been saved. Ends the health check call.',
  parameters: { type: 'object', properties: {} },
}

function findQuestion(id) {
  return QUESTIONS.find((q) => q.id === id)
}

export function applySaveAnswer(answers, payload) {
  const q = findQuestion(payload.questionId)
  if (!q) return { ok: false, error: `Unknown question: ${payload.questionId}` }

  const next = { ...answers }

  switch (q.type) {
    case 'single':
    case 'gender': {
      const ok = q.options.some((o) => o.value === payload.value)
      if (!ok) return { ok: false, error: `Invalid value for ${q.id}` }
      next[q.id] = payload.value
      break
    }
    case 'multi': {
      const vals = payload.values || []
      if (!vals.length) return { ok: false, error: 'Multi-select needs at least one value' }
      const allowed = new Set(q.options.map((o) => o.value))
      if (vals.some((v) => !allowed.has(v))) {
        return { ok: false, error: 'Unrecognised multi-select value' }
      }
      if (vals.includes('none')) next[q.id] = []
      else next[q.id] = vals.filter((v) => v !== 'none')
      break
    }
    case 'bmi': {
      const h = Number(payload.heightCm)
      const w = Number(payload.weightKg)
      if (h < 100 || h > 250 || w < 30 || w > 300) {
        return { ok: false, error: 'Height or weight out of range' }
      }
      next.heightCm = h
      next.weightKg = w
      break
    }
    case 'waist': {
      const waist = Number(payload.waistCm)
      if (waist < 50 || waist > 200) return { ok: false, error: 'Waist out of range' }
      next.waistCm = waist
      break
    }
    default:
      return { ok: false, error: 'Unhandled question type' }
  }

  return { ok: true, answers: next }
}

export function countSavedQuestions(answers) {
  let n = 0
  for (const q of QUESTIONS) {
    if (q.type === 'bmi') {
      if (answers.heightCm != null && answers.weightKg != null) n++
    } else if (q.type === 'waist') {
      if (answers.waistCm != null) n++
    } else if (q.type === 'multi') {
      if (Array.isArray(answers[q.id])) n++
    } else if (answers[q.id] != null) {
      n++
    }
  }
  return n
}

export function allQuestionsAnswered(answers) {
  return countSavedQuestions(answers) >= QUESTIONS.length
}

export { QUESTIONS as REALTIME_QUESTIONS }
