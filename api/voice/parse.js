import { getOpenAI } from '../lib/openai.js'

function buildParsePrompt(question, transcript, answers) {
  const base = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    transcript,
    priorAnswers: answers,
  }

  if (question.options) {
    base.allowedValues = question.options.map((o) => ({
      value: o.value,
      label: o.label,
    }))
  }
  if (question.maxSelect) base.maxSelect = question.maxSelect

  return base
}

function validateParsed(question, parsed) {
  if (!parsed.success) return parsed

  switch (question.type) {
    case 'single':
    case 'gender': {
      const ok = question.options.some((o) => o.value === parsed.value)
      if (!ok) return { success: false, error: 'Could not match your answer. Please try again.' }
      return parsed
    }
    case 'multi': {
      if (!Array.isArray(parsed.value) || parsed.value.length === 0) {
        return { success: false, error: 'Please name at least one option, or say none.' }
      }
      const allowed = new Set(question.options.map((o) => o.value))
      if (parsed.value.some((v) => !allowed.has(v))) {
        return { success: false, error: 'Some options were not recognised. Please try again.' }
      }
      if (parsed.value.includes('none') && parsed.value.length > 1) {
        return { success: true, value: ['none'] }
      }
      if (question.maxSelect && parsed.value.filter((v) => v !== 'none').length > question.maxSelect) {
        return { success: false, error: `Please pick up to ${question.maxSelect} options.` }
      }
      return parsed
    }
    case 'bmi': {
      const h = Number(parsed.heightCm)
      const w = Number(parsed.weightKg)
      if (h < 100 || h > 250 || w < 30 || w > 300) {
        return { success: false, error: 'Height or weight out of range. Please say again.' }
      }
      return { success: true, heightCm: h, weightKg: w }
    }
    case 'waist': {
      const waist = Number(parsed.waistCm)
      if (waist < 50 || waist > 200) {
        return { success: false, error: 'Waist measurement not clear. Please say centimeters only.' }
      }
      return { success: true, waistCm: waist }
    }
    default:
      return { success: false, error: 'Unknown question type.' }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
    return
  }

  try {
    const { question, transcript, answers = {} } = req.body || {}
    if (!question?.id || !transcript) {
      res.status(400).json({ error: 'Body must include "question" and "transcript".' })
      return
    }

    const openai = getOpenAI()
    const ctx = buildParsePrompt(question, transcript, answers)

    const system = `You parse spoken answers for a Singapore health questionnaire.
Map the user's speech to EXACT allowed values only. Never invent values.
For numbers, extract digits (e.g. "one seventy" -> 170).
For multi-select, return an array of value strings. If they say none/nothing/no, use ["none"].
If you cannot map the speech, return { "success": false, "error": "Could not match your answer. Please try again." }
Respond with JSON only.`

    let schemaHint
    switch (question.type) {
      case 'bmi':
        schemaHint = '{ "success": true, "heightCm": number, "weightKg": number } OR { "success": false, "error": "..." }'
        break
      case 'waist':
        schemaHint = '{ "success": true, "waistCm": number } OR { "success": false, "error": "..." }'
        break
      case 'multi':
        schemaHint = '{ "success": true, "value": string[] } OR { "success": false, "error": "..." }'
        break
      default:
        schemaHint = '{ "success": true, "value": string } OR { "success": false, "error": "..." }'
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Question context:\n${JSON.stringify(ctx, null, 2)}\n\nReturn shape:\n${schemaHint}`,
        },
      ],
    })

    let parsed
    try {
      parsed = JSON.parse(completion.choices[0].message.content)
    } catch {
      res.status(200).json({ success: false, error: 'Could not understand. Please try again.' })
      return
    }

    const validated = validateParsed(question, parsed)
    res.status(200).json(validated)
  } catch (err) {
    console.error('[/api/voice/parse]', err)
    res.status(500).json({ error: 'Failed to parse answer.' })
  }
}
