import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  Search, MessageCircle, ChevronRight, ChevronLeft,
  Leaf, Activity, ArrowRight, X, CheckCircle2, Stethoscope,
} from 'lucide-react'
import questionnaire from './data/questionnaire.json'
import {
  calculateRisk, computeBMI, sortDishesForConditions, getWorstRating,
  fastTrack, CONDITION_LABEL, TIER_DISPLAY, CONDITIONS,
} from './lib/scoring.js'
import ChatWindow from './components/chat/ChatWindow.jsx'

const FOOD_CATEGORIES = ['All', 'Rice', 'Noodles', 'Soups', 'Drinks', 'Desserts']

const FAST_TRACK_OPTS = [
  { v: 'hypertension', l: 'Hypertension (High BP)', e: '❤️' },
  { v: 'hyperlipidaemia', l: 'Hyperlipidaemia (High Cholesterol)', e: '🫀' },
  { v: 'diabetes', l: 'Diabetes', e: '💉' },
]

const OPTION_EMOJI = {
  male: '👨', female: '👩', Chinese: '🇨🇳', Malay: '🇲🇾', Indian: '🇮🇳', Others: '🌏',
  vigorous: '🏃', moderate: '🚶', light: '🧘', sedentary: '🛋️',
  rarely: '🥗', '1-2x': '🍗', '3-5x': '🍜', daily: '🔥',
  none: '💧', '1': '🧋', '2-3': '🥤', '4+': '⚠️',
  never: '✅', sometimes: '🥢', most: '🍲', always: '🧂',
  good: '😴', fair: '😐', poor: '😫',
  low: '😌', high: '😰', 'very-high': '🆘',
  headaches: '🤕', fatigue: '😴', thirst: '💧', urination: '🚽',
  hypertension: '❤️', hyperlipidaemia: '🫀', diabetes: '💉',
  Rice: '🍛', Noodles: '🍜', Fried: '🍗', Soups: '🍲', Bread: '🫓', Desserts: '🧋',
  '18-30': '🧑', '31-45': '👨', '46-60': '🧔', '60+': '👴',
  'daily-2x': '🍽️', 'daily-1x': '🥡', 'few-times': '📅',
}

const CATEGORY_EMOJI = {
  Rice: '🍛', Noodles: '🍜', Soups: '🍲', Drinks: '🧋', Desserts: '🍰', Fried: '🍗', Bread: '🫓',
}

const CHAT_SUGGESTIONS = [
  'What can I eat for diabetes?',
  'Is chicken rice healthy?',
  'Best low-sodium options?',
  'What to avoid with high BP?',
]

function getBMILabel(bmi) {
  if (bmi < 23) return 'Healthy'
  if (bmi < 27.5) return 'Overweight'
  if (bmi < 32.5) return 'Obese I'
  return 'Obese II'
}

function getHighestTier(riskScore, primary) {
  const tiers = primary.map((c) => riskScore.tier[c])
  if (tiers.includes('High')) return 'High'
  if (tiers.includes('Moderate')) return 'Moderate'
  return 'Low'
}

function tierBadgeClass(tier) {
  if (tier === 'High') return 'bg-red-50 text-red-700 border-red-200'
  if (tier === 'Moderate') return 'bg-amber-50 text-amber-700 border-amber-200'
  return 'bg-emerald-50 text-emerald-700 border-emerald-200'
}

function getDefaultCategory(profile) {
  const fav = profile?.answers?.favCategories
  if (!fav?.length) return 'All'
  const map = { Rice: 'Rice', Noodles: 'Noodles', Soups: 'Soups', Desserts: 'Desserts', Drinks: 'Drinks' }
  return map[fav[0]] ?? 'All'
}

function sanitiseAnswers(answers) {
  const out = { ...answers }
  if (out.familyHistory) out.familyHistory = out.familyHistory.filter((v) => v !== 'none')
  if (out.symptoms) out.symptoms = out.symptoms.filter((v) => v !== 'none')
  return out
}

// ── UI Atoms ───────────────────────────────────────────────────────────
function TLBadge({ light }) {
  const map = {
    safe: { label: 'Safe', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
    modify: { label: 'Modify', cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-400' },
    avoid: { label: 'Avoid', cls: 'bg-red-50 text-red-600', dot: 'bg-red-500' },
  }[light]
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </span>
  )
}

function RiskBar({ label, score, tier }) {
  const color = TIER_DISPLAY[tier].color
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-xs font-bold" style={{ color }}>{score}% · {tier}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(score, 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function MacroPill({ label, value, unit, color, text }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1.5">
      <span className={`text-sm font-bold ${color} ${text ? 'capitalize' : 'font-mono'}`}>
        {text ? value : <>{value}<span className="text-[10px] font-normal">{unit}</span></>}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

const MOBILE_NAV_H = 'pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0'

const NAV_TABS = [
  { id: 'profile', icon: Activity, label: 'Profile' },
  { id: 'dashboard', icon: Search, label: 'Food' },
  { id: 'chat', icon: MessageCircle, label: 'AI Chat' },
]

function BottomNav({ screen, setScreen }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-xl border-t border-border md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around px-2 py-3 max-w-lg mx-auto">
        {NAV_TABS.map((tab) => {
          const active = screen === tab.id
          return (
            <button key={tab.id} onClick={() => setScreen(tab.id)}
              className={`flex flex-col items-center gap-1 px-6 py-1.5 rounded-2xl transition-all ${active ? 'text-primary' : 'text-muted-foreground'}`}>
              <tab.icon size={21} strokeWidth={active ? 2.5 : 1.8} />
              <span className={`text-[10px] font-semibold tracking-wide ${active ? 'text-primary' : ''}`}>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SideNav({ screen, setScreen }) {
  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-56 flex-col bg-white border-r border-border">
      <div className="px-5 pt-8 pb-6 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm">
          <Leaf size={16} className="text-white" />
        </div>
        <span className="text-lg font-bold text-foreground tracking-tight">HawkerHealth</span>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {NAV_TABS.map((tab) => {
          const active = screen === tab.id
          return (
            <button key={tab.id} onClick={() => setScreen(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${active ? 'bg-teal-50 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>
              <tab.icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              {tab.label}
            </button>
          )
        })}
      </nav>
      <div className="px-5 py-5 text-xs text-muted-foreground font-semibold">🇸🇬 Singapore</div>
    </aside>
  )
}

// ── Landing ─────────────────────────────────────────────────────────────
function LandingScreen({ onCheckRisk, onFastTrack, onChatWithAI }) {
  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-gradient-to-b from-teal-50 via-background to-background">
      <div className="w-full max-w-6xl mx-auto flex-1 flex flex-col min-h-0">
        <div className="px-5 sm:px-8 pt-5 sm:pt-6 md:pt-8 pb-1 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <Leaf size={15} className="text-white" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight">HawkerHealth</span>
          </div>
          <span className="text-xs text-muted-foreground font-semibold bg-white border border-border px-3 py-1 rounded-full shadow-sm">🇸🇬 Singapore</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 pt-3 pb-4 lg:grid lg:grid-cols-2 lg:gap-8 lg:items-center lg:overflow-visible">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="relative w-full h-36 sm:h-48 lg:h-72 rounded-3xl bg-gradient-to-br from-teal-500 via-teal-600 to-emerald-700 flex items-center justify-center mb-4 lg:mb-0 overflow-hidden shadow-2xl shadow-teal-300/40">
            <div className="absolute inset-0 select-none pointer-events-none">
              <span className="absolute top-5 left-5 text-5xl opacity-20 rotate-12">🍜</span>
              <span className="absolute top-10 right-8 text-4xl opacity-20 -rotate-6">🍛</span>
              <span className="absolute bottom-8 left-10 text-4xl opacity-20 -rotate-12">🐟</span>
              <span className="absolute bottom-5 right-6 text-3xl opacity-20 rotate-6">🥘</span>
            </div>
            <div className="relative z-10 text-center px-6">
              <div className="text-5xl lg:text-6xl mb-2">🫀</div>
              <div className="text-white text-lg lg:text-xl font-bold mb-0.5">Eat Smart. Live Well.</div>
              <div className="text-teal-100 text-xs lg:text-sm">At your favourite hawker centre</div>
            </div>
          </motion.div>

          <div className="flex flex-col">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-foreground leading-tight mb-2">
                Healthier hawker choices,<br className="hidden sm:block" /> made easy.
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4 max-w-xl">
                Personalised food recommendations for your health — right at Singapore&apos;s hawker centres.
              </p>
            </motion.div>

            <div className="space-y-2 sm:grid sm:grid-cols-2 lg:grid-cols-1 sm:gap-2 sm:space-y-0 mb-4">
              {[
                { icon: '🎯', title: 'Personalised for you', desc: 'Based on your health conditions and goals' },
                { icon: '🚦', title: 'Traffic light ratings', desc: 'Know instantly what is safe, modify, or avoid' },
                { icon: '🤖', title: 'AI nutrition assistant', desc: 'Get instant answers about any hawker dish' },
              ].map((b, i) => (
                <motion.div key={b.title} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.2 + i * 0.08 }}
                  className={`flex items-center gap-3 bg-white rounded-2xl p-3 shadow-sm border border-border ${i === 2 ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
                  <span className="text-2xl">{b.icon}</span>
                  <div>
                    <div className="font-semibold text-sm text-foreground">{b.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{b.desc}</div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="hidden sm:flex flex-wrap items-center justify-start gap-x-4 gap-y-1 mb-4">
              {['HPB Guidelines', 'Nutritionist Verified', 'Free'].map((t) => (
                <div key={t} className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
                  <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                  {t}
                </div>
              ))}
            </div>

            <div className="max-w-md lg:max-w-none space-y-2 flex-shrink-0">
              <button onClick={onCheckRisk}
                className="w-full bg-primary text-white rounded-2xl py-3.5 font-bold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-teal-400/30 hover:bg-teal-700 active:scale-[0.98] transition-all">
                Check My Risk <ArrowRight size={18} />
              </button>
              <button onClick={onFastTrack}
                className="w-full bg-white text-primary border-2 border-primary/30 rounded-2xl py-3.5 font-bold text-sm sm:text-base flex items-center justify-center gap-2 hover:bg-teal-50 active:scale-[0.98] transition-all">
                <Stethoscope size={18} /> I Already Have a Diagnosis
              </button>
              <button onClick={onChatWithAI}
                className="w-full bg-white text-foreground border border-border rounded-2xl py-3.5 font-bold text-sm sm:text-base flex items-center justify-center gap-2 hover:bg-muted/50 active:scale-[0.98] transition-all">
                <MessageCircle size={18} className="text-primary" /> Chat with AI
              </button>
              <p className="text-center sm:text-left text-[11px] text-muted-foreground">16-question assessment · ~5 min · No sign-up needed</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Fast-Track ────────────────────────────────────────────────────────────
function FastTrackScreen({ onComplete }) {
  const [selected, setSelected] = useState([])

  function toggle(cond) {
    setSelected((prev) => prev.includes(cond) ? prev.filter((c) => c !== cond) : [...prev, cond])
  }

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-background">
      <div className="w-full max-w-3xl mx-auto flex-1 flex flex-col min-h-0">
        <div className="px-5 sm:px-8 pt-5 sm:pt-6 pb-3 flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-extrabold text-foreground mb-1">Your diagnosis</h2>
          <p className="text-muted-foreground text-sm">Select all conditions you have been diagnosed with. We&apos;ll filter your food guide immediately.</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 space-y-2.5 pb-2">
          {FAST_TRACK_OPTS.map((opt) => {
            const sel = selected.includes(opt.v)
            return (
              <button key={opt.v} onClick={() => toggle(opt.v)}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all ${sel ? 'border-primary bg-teal-50/70 shadow-sm' : 'border-border bg-white hover:border-teal-200'}`}>
                <span className="text-2xl">{opt.e}</span>
                <span className={`font-semibold text-sm flex-1 ${sel ? 'text-primary' : 'text-foreground'}`}>{opt.l}</span>
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'bg-primary border-primary' : 'border-border'}`}>
                  {sel && <CheckCircle2 size={12} className="text-white" />}
                </div>
              </button>
            )
          })}
        </div>
        <div className="px-5 sm:px-8 py-4 flex-shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button onClick={() => onComplete(selected)} disabled={selected.length === 0}
            className={`w-full sm:max-w-md sm:mx-auto rounded-2xl py-3.5 font-bold text-base flex items-center justify-center gap-2 transition-all ${selected.length > 0 ? 'bg-primary text-white shadow-lg shadow-teal-300/30 hover:bg-teal-700' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}>
            Go to Food Guide <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Assessment ──────────────────────────────────────────────────────────
function AssessmentScreen({ onComplete }) {
  const questions = questionnaire.questions
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [waistCm, setWaistCm] = useState('')
  const q = questions[step]

  function setSingle(key, val) {
    setAnswers((prev) => ({ ...prev, [key]: val }))
  }

  function toggleMulti(key, val, noneVal = 'none') {
    const prev = answers[key] || []
    if (val === noneVal) { setSingle(key, [noneVal]); return }
    const without = prev.filter((v) => v !== noneVal)
    if (without.includes(val)) setSingle(key, without.filter((v) => v !== val))
    else setSingle(key, [...without, val])
  }

  function toggleFav(val) {
    const prev = answers.favCategories || []
    if (prev.includes(val)) setSingle('favCategories', prev.filter((v) => v !== val))
    else if (prev.length < (q.maxSelect ?? 3)) setSingle('favCategories', [...prev, val])
  }

  function isSelected(val) {
    if (q.type === 'multi' || (q.type === 'multi' && q.maxSelect)) {
      return (answers[q.id] || []).includes(val)
    }
    if (q.id === 'favCategories') return (answers.favCategories || []).includes(val)
    if (q.type === 'gender') return answers.gender === val
    return answers[q.id] === val
  }

  function canProceed() {
    if (q.type === 'bmi') {
      const h = parseFloat(heightCm), w = parseFloat(weightKg)
      return h >= 100 && h <= 250 && w >= 30 && w <= 300
    }
    if (q.type === 'waist') {
      const waist = parseFloat(waistCm)
      return waist >= 50 && waist <= 200
    }
    if (q.type === 'multi') {
      if (q.id === 'favCategories') return (answers.favCategories || []).length > 0
      return (answers[q.id] || []).length > 0
    }
    if (q.type === 'gender') return !!answers.gender
    return !!answers[q.id]
  }

  function next() {
    let merged = { ...answers }
    if (q.type === 'bmi') {
      merged.heightCm = parseFloat(heightCm)
      merged.weightKg = parseFloat(weightKg)
    }
    if (q.type === 'waist') merged.waistCm = parseFloat(waistCm)
    setAnswers(merged)

    if (step < questions.length - 1) { setStep(step + 1); return }
    onComplete(sanitiseAnswers(merged))
  }

  const bmiPreview = heightCm && weightKg ? computeBMI(parseFloat(heightCm), parseFloat(weightKg)) : null
  const gender = answers.gender ?? 'male'
  const waistHint = gender === 'male' ? 'Healthy: < 90 cm' : 'Healthy: < 80 cm'
  const isMulti = q.type === 'multi'
  const isFav = q.id === 'favCategories'

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-background">
      <div className="w-full max-w-3xl mx-auto flex-1 flex flex-col min-h-0">
        <div className="px-5 sm:px-8 pt-5 sm:pt-6 pb-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => step > 0 && setStep(step - 1)}
              className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all ${step > 0 ? 'bg-muted text-muted-foreground hover:bg-accent' : 'opacity-0 pointer-events-none'}`}>
              <ChevronLeft size={18} />
            </button>
            <span className="text-xs text-muted-foreground font-semibold">Q{q.n} of {questions.length}</span>
            <div className="w-9" />
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500 ease-out" style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-8 pb-2">
          <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>
            <h2 className="text-xl sm:text-2xl font-extrabold text-foreground mb-1.5">{q.prompt}</h2>
            {q.note && <p className="text-muted-foreground text-sm mb-1.5">{q.note}</p>}
            {q.examples && <p className="text-xs text-muted-foreground/80 mb-4 italic">e.g. {q.examples}</p>}
            {!q.examples && !q.note && <div className="mb-4" />}
            {q.note && !q.examples && <div className="mb-2" />}

            {q.type === 'bmi' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-2 block">Height (cm)</label>
                    <input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="170"
                      className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-2 block">Weight (kg)</label>
                    <input type="number" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="70"
                      className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-primary" />
                  </div>
                </div>
                {bmiPreview && (
                  <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 text-center">
                    <div className="text-2xl font-bold text-primary font-mono">{bmiPreview.toFixed(1)}</div>
                    <div className="text-sm text-teal-700 font-semibold">{getBMILabel(bmiPreview)} (Asian BMI cutoffs)</div>
                  </div>
                )}
              </div>
            )}

            {q.type === 'waist' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block">Waist circumference (cm)</label>
                  <input type="number" value={waistCm} onChange={(e) => setWaistCm(e.target.value)} placeholder={gender === 'male' ? '85' : '75'}
                    className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-primary" />
                </div>
                <p className="text-xs text-muted-foreground">{waistHint}</p>
              </div>
            )}

            {(q.type === 'single' || q.type === 'gender' || isMulti) && q.options && (
              <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
                {q.options.map((opt) => {
                  const sel = isSelected(opt.value)
                  const atMax = isFav && !sel && (answers.favCategories?.length ?? 0) >= (q.maxSelect ?? 3)
                  const emoji = OPTION_EMOJI[opt.value] ?? '•'
                  return (
                    <button key={opt.value} disabled={atMax}
                      onClick={() => {
                        if (q.type === 'single') setSingle(q.id, opt.value)
                        else if (q.type === 'gender') setSingle('gender', opt.value)
                        else if (isFav) toggleFav(opt.value)
                        else toggleMulti(q.id, opt.value)
                      }}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all disabled:opacity-40 ${sel ? 'border-primary bg-teal-50/70 shadow-sm' : 'border-border bg-white hover:border-teal-200'}`}>
                      <span className="text-2xl leading-none">{emoji}</span>
                      <span className={`font-semibold text-sm flex-1 ${sel ? 'text-primary' : 'text-foreground'}`}>{opt.label}</span>
                      {isMulti ? (
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'bg-primary border-primary' : 'border-border'}`}>
                          {sel && <CheckCircle2 size={12} className="text-white" />}
                        </div>
                      ) : (
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? 'border-primary' : 'border-border'}`}>
                          {sel && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            {isFav && <p className="text-xs text-muted-foreground mt-4 text-center">{(answers.favCategories?.length ?? 0)} / {q.maxSelect} selected</p>}
          </motion.div>
        </div>

        <div className="px-5 sm:px-8 py-4 flex-shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button onClick={next} disabled={!canProceed()}
            className={`w-full sm:max-w-md sm:mx-auto rounded-2xl py-3.5 font-bold text-base flex items-center justify-center gap-2 transition-all ${canProceed() ? 'bg-primary text-white shadow-lg shadow-teal-300/30 hover:bg-teal-700 active:scale-[0.98]' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}>
            {step === questions.length - 1 ? 'See my risk profile' : 'Continue'} <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Profile ─────────────────────────────────────────────────────────────
function ProfileScreen({ profile, onExplore }) {
  const isFastTrack = profile.entryPath === 'fast-track'
  const { riskScore, primaryConditions } = profile
  const highestTier = isFastTrack ? null : getHighestTier(riskScore, primaryConditions)
  const tierCopy = highestTier ? TIER_DISPLAY[highestTier] : null

  return (
    <div className={`h-dvh flex flex-col overflow-hidden bg-background ${MOBILE_NAV_H}`}>
      <div className="bg-gradient-to-br from-teal-500 to-emerald-600 px-5 sm:px-8 pt-5 sm:pt-6 pb-8 flex-shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center"><Leaf size={14} className="text-white" /></div>
            <span className="text-white font-bold tracking-tight">HawkerHealth</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white mb-0.5">{isFastTrack ? 'Your Health Profile' : 'Your Risk Profile'}</h2>
          <p className="text-teal-100 text-sm">
            {isFastTrack ? 'Food guide personalised to your diagnosed conditions' : 'Based on your 16-question lifestyle assessment'}
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-5xl mx-auto px-5 sm:px-8 -mt-6 space-y-3 pb-4">
          {isFastTrack ? (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-5 shadow-md border border-border/40">
              <div className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Confirmed Conditions</div>
              <div className="flex flex-wrap gap-2 mb-3">
                {primaryConditions.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 bg-teal-50 text-teal-800 px-3 py-1.5 rounded-full text-xs font-semibold border border-teal-200">{CONDITION_LABEL[c]}</span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">Food ratings use the most restrictive label across your conditions.</p>
            </motion.div>
          ) : riskScore && tierCopy && (
            <>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-5 shadow-md border border-border/40">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Primary Focus</div>
                    <div className="flex flex-wrap gap-2">
                      {primaryConditions.map((c) => (
                        <span key={c} className="text-lg font-extrabold text-foreground">{CONDITION_LABEL[c]}</span>
                      ))}
                    </div>
                    {riskScore.isTie && <p className="text-xs text-muted-foreground mt-2">Co-primary conditions — scores within 5 points</p>}
                  </div>
                  <span className={`px-3 py-1.5 rounded-full text-xs font-bold border flex-shrink-0 ${tierBadgeClass(highestTier)}`}>{tierCopy.label}</span>
                </div>
                <p className="text-sm text-foreground leading-relaxed">{tierCopy.subtext}</p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
                className="bg-white rounded-3xl p-5 shadow-sm border border-border/40 space-y-4">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risk Scores by Condition</div>
                {CONDITIONS.map((c) => (
                  <RiskBar key={c} label={CONDITION_LABEL[c]} score={riskScore.normalised[c]} tier={riskScore.tier[c]} />
                ))}
              </motion.div>
              {profile.bmi && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
                  className="bg-white rounded-3xl p-5 shadow-sm border border-border/40">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">BMI (Asian cutoffs)</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-foreground font-mono">{profile.bmi.toFixed(1)}</span>
                    <span className="text-sm font-semibold text-muted-foreground">{getBMILabel(profile.bmi)}</span>
                  </div>
                </motion.div>
              )}
            </>
          )}

          <button onClick={onExplore}
            className="w-full sm:max-w-md sm:mx-auto bg-primary text-white rounded-2xl py-3.5 font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-teal-300/30 hover:bg-teal-700 active:scale-[0.98] transition-all">
            Explore Food Recommendations <ArrowRight size={18} />
          </button>
          <p className="text-center text-[11px] text-muted-foreground">Risk scores are for general reference only. Consult a healthcare professional for diagnosis.</p>
        </div>
    </div>
  )
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return (R * c * 1000).toFixed(0)
}

function scoreEatery(eateryName, foodName) {
  const words = foodName.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const name = eateryName.toLowerCase()
  return words.filter(w => name.includes(w)).length
}

// ── Dashboard ───────────────────────────────────────────────────────────
function DashboardScreen({ profile, dishes }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(() => getDefaultCategory(profile))
  const [expanded, setExpanded] = useState(null)
  const [eateries, setEateries] = useState([])
  const [userLoc, setUserLoc] = useState(null)
  const [locError, setLocError] = useState(null)
  const [placesResults, setPlacesResults] = useState([])
  const [placesLoading, setPlacesLoading] = useState(false)
  const primary = profile?.primaryConditions ?? []

  useEffect(() => {
    fetch('/hawker_eateries.json').then((r) => r.json()).then(setEateries).catch(() => setEateries([]))
  }, [])

  useEffect(() => {
    if (!expanded || !userLoc) return
    const food = dishes.find(d => d.id === expanded)
    if (!food) return
    setPlacesLoading(true)
    setPlacesResults([])
    fetch('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: food.name, lat: userLoc.lat, lng: userLoc.lon }),
    })
      .then(r => r.json())
      .then(d => {
        const places = d.places ?? []
        if (places.length > 0) {
          setPlacesResults(places)
        } else {
          setPlacesResults(getNearbyEateries(food))
        }
      })
      .catch(() => setPlacesResults(getNearbyEateries(food)))
      .finally(() => setPlacesLoading(false))
  }, [expanded, userLoc])

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocError('Geolocation not supported')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setLocError(null)
      },
      (err) => {
        setLocError('Location access denied. Please enable location to see nearby hawkers.')
      }
    )
  }

  function getNearbyEateries(food) {
    if (!userLoc || !eateries.length) return []
    return eateries
      .map((e) => ({
        ...e,
        distance: Math.round(calculateDistance(userLoc.lat, userLoc.lon, e.coordinates[1], e.coordinates[0])) || 0,
        score: food ? scoreEatery(e.name, food.name) : 0,
      }))
      .sort((a, b) => b.score - a.score || a.distance - b.distance)
      .slice(0, 3)
  }

  const filtered = sortDishesForConditions(
    dishes.filter((f) => {
      const matchQ = f.name.toLowerCase().includes(query.toLowerCase()) || f.local_name?.toLowerCase().includes(query.toLowerCase())
      const matchC = query.trim() !== '' || category === 'All' || f.category === category
      return matchQ && matchC
    }),
    primary,
  )

  const safeCnt = filtered.filter((f) => getWorstRating(f, primary) === 'safe').length
  const avoidCnt = filtered.filter((f) => getWorstRating(f, primary) === 'avoid').length

  return (
    <div className={`h-dvh flex flex-col overflow-hidden bg-background ${MOBILE_NAV_H}`}>
      <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 flex-shrink-0">
        <div className="pt-5 sm:pt-6 pb-3 md:flex md:items-end md:justify-between md:gap-6">
          <div className="mb-3 md:mb-0">
            <h2 className="text-xl sm:text-2xl font-extrabold text-foreground mb-0.5">Food Guide</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">Tap any dish for full nutrition details</p>
          </div>
          <div className="hidden md:block flex-1 max-w-md">
            <div className="flex items-center gap-3 bg-white border border-border rounded-2xl px-4 py-3 shadow-sm">
              <Search size={16} className="text-muted-foreground flex-shrink-0" />
              <input value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setCategory('All') }} placeholder="Search dishes..."
                className="flex-1 outline-none text-sm text-foreground placeholder:text-muted-foreground bg-transparent" />
              {query && <button onClick={() => setQuery('')}><X size={15} className="text-muted-foreground" /></button>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-emerald-700">{safeCnt} Safe</span>
          </div>
          <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs font-semibold text-red-600">{avoidCnt} Avoid</span>
          </div>
          {profile && (
            <div className="md:ml-auto flex flex-wrap gap-2">
              {primary.map((c) => (
                <span key={c} className="bg-teal-50 border border-teal-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-teal-700">{CONDITION_LABEL[c]} ✓</span>
              ))}
            </div>
          )}
        </div>

        <div className="md:hidden mb-3">
          <div className="flex items-center gap-3 bg-white border border-border rounded-2xl px-4 py-3 shadow-sm">
            <Search size={16} className="text-muted-foreground flex-shrink-0" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setCategory('All') }} placeholder="Search dishes..."
              className="flex-1 outline-none text-sm bg-transparent" />
            {query && <button onClick={() => setQuery('')}><X size={15} className="text-muted-foreground" /></button>}
          </div>
        </div>

        <div className="flex flex-wrap md:flex-nowrap gap-2 mb-3 overflow-x-auto scrollbar-hide pb-1">
          {FOOD_CATEGORIES.map((cat) => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${category === cat ? 'bg-primary text-white shadow-sm' : 'bg-white border border-border text-muted-foreground hover:border-teal-300'}`}>
              {cat}
            </button>
          ))}
        </div>
      </div>

        <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-6xl mx-auto px-5 sm:px-8 pb-4">
        <div className="space-y-3 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4 md:space-y-0">
          {filtered.map((food) => {
            const light = getWorstRating(food, primary)
            const open = expanded === food.id
            const emoji = CATEGORY_EMOJI[food.category] ?? '🍽️'
            return (
              <div key={food.id} className="bg-white rounded-3xl border border-border/50 shadow-sm overflow-hidden">
                <button className="w-full flex items-center gap-4 p-4 text-left" onClick={() => setExpanded(open ? null : food.id)}>
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-50 flex items-center justify-center text-[26px] flex-shrink-0">{emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-foreground mb-1.5 truncate">{food.name}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <TLBadge light={light} />
                      <span className="text-xs text-muted-foreground font-mono">{food.calories} kcal</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className={`text-muted-foreground flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
                </button>
                {open && (
                  <div className="px-4 pb-4 border-t border-border/50">
                    <p className="text-xs text-muted-foreground mt-3 mb-2">{food.local_name} · {food.serving_size}</p>
                    <div className="flex items-center justify-around py-3 bg-muted/40 rounded-2xl my-3">
                      <MacroPill label="Sodium" value={food.sodium_mg} unit="mg" color="text-purple-500" />
                      <div className="w-px h-8 bg-border" />
                      <MacroPill label="Sat. fat" value={food.saturated_fat_g} unit="g" color="text-rose-400" />
                      <div className="w-px h-8 bg-border" />
                      <MacroPill label="Chol." value={food.cholesterol_mg} unit="mg" color="text-amber-500" />
                      <div className="w-px h-8 bg-border" />
                      <MacroPill label="GI" value={food.gi_level} color="text-blue-500" text />
                    </div>
                    <div className="space-y-2">
                      {primary.map((cond) => (
                        <div key={cond} className="flex gap-2.5 bg-amber-50 border border-amber-100 rounded-2xl p-3.5">
                          <span className="flex-shrink-0 text-base">💡</span>
                          <div>
                            {primary.length > 1 && <div className="text-[10px] font-bold text-amber-900 uppercase mb-0.5">{CONDITION_LABEL[cond]}</div>}
                            <p className="text-xs text-amber-800 leading-relaxed">{food.conditions[cond]?.tip}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">📍 Nearby healthy eateries</div>
                        {userLoc && <button onClick={(e) => { e.stopPropagation(); setUserLoc(null) }} className="text-[10px] text-muted-foreground hover:text-foreground underline">reset</button>}
                      </div>
                      {!userLoc ? (
                        <button onClick={(e) => { e.stopPropagation(); requestLocation() }}
                          className="w-full bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-700 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                          📍 Show nearby hawkers
                        </button>
                      ) : (() => {
                          const local = getNearbyEateries(food)
                          const hasMatch = local.some(e => e.score > 0)
                          if (hasMatch) return (
                            <div className="space-y-2">
                              {local.map((e) => (
                                <div key={e.id} className="text-xs bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <div className="font-semibold text-emerald-900">{e.name}</div>
                                      <div className="text-emerald-700 text-[11px] mt-0.5">{e.address}</div>
                                    </div>
                                    <div className="flex-shrink-0 text-right">
                                      <div className="font-bold text-emerald-900">{e.distance}m</div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                          if (placesLoading) return <p className="text-xs text-muted-foreground">Searching nearby...</p>
                          if (placesResults.length > 0) return (
                            <div className="space-y-2">
                              {placesResults.map((e, i) => (
                                <div key={i} className="text-xs bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
                                  <div className="font-semibold text-emerald-900">{e.name}</div>
                                  <div className="text-emerald-700 text-[11px] mt-0.5">{e.address}</div>
                                </div>
                              ))}
                            </div>
                          )
                          return (
                            <div className="space-y-2">
                              {local.map((e) => (
                                <div key={e.id} className="text-xs bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <div className="font-semibold text-emerald-900">{e.name}</div>
                                      <div className="text-emerald-700 text-[11px] mt-0.5">{e.address}</div>
                                    </div>
                                    <div className="flex-shrink-0 text-right">
                                      <div className="font-bold text-emerald-900">{e.distance}m</div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        })()
                      }
                      {locError && <p className="text-xs text-red-600 mt-2">{locError}</p>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-center py-20 md:col-span-2 xl:col-span-3">
              <div className="text-5xl mb-4">🔍</div>
              <div className="text-base font-bold text-foreground mb-1.5">No dishes found</div>
              <div className="text-sm text-muted-foreground">Try a different search term or category</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Root ────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('landing')
  const [profile, setProfile] = useState(null)
  const [dishes, setDishes] = useState([])
  const showNav = screen === 'profile' || screen === 'dashboard' || screen === 'chat'

  useEffect(() => {
    fetch('/food_database.json').then((r) => r.json()).then(setDishes).catch(() => setDishes([]))
  }, [])

  function handleQuestionnaireComplete(answers) {
    const riskScore = calculateRisk(answers)
    setProfile({
      entryPath: 'questionnaire',
      answers,
      riskScore,
      primaryConditions: riskScore.primaryConditions,
      bmi: computeBMI(answers.heightCm, answers.weightKg),
    })
    setScreen('profile')
  }

  function handleFastTrackComplete(conditions) {
    const ft = fastTrack(conditions)
    setProfile({
      entryPath: 'fast-track',
      confirmedConditions: conditions,
      primaryConditions: ft.primaryConditions,
      fastTrack: true,
    })
    setScreen('dashboard')
  }

  function handleAiIntakeComplete(completedProfile) {
    setProfile(completedProfile)
    setScreen('dashboard')
  }

  return (
    <div className="h-dvh overflow-hidden bg-background">
      {showNav && <SideNav screen={screen} setScreen={setScreen} />}
      <main className={`h-full overflow-hidden ${showNav ? 'md:ml-56' : ''}`}>
        {screen === 'landing' && (
          <LandingScreen
            onCheckRisk={() => setScreen('assessment')}
            onFastTrack={() => setScreen('fast-track')}
            onChatWithAI={() => setScreen('ai-intake')}
          />
        )}
        {screen === 'ai-intake' && (
          <ChatWindow
            mode="intake"
            title="AI Health Intake"
            subtitle="Tell me about yourself — type or speak"
            onComplete={handleAiIntakeComplete}
            onBack={() => setScreen('landing')}
          />
        )}
        {screen === 'fast-track' && <FastTrackScreen onComplete={handleFastTrackComplete} />}
        {screen === 'assessment' && <AssessmentScreen onComplete={handleQuestionnaireComplete} />}
        {screen === 'profile' && profile && <ProfileScreen profile={profile} onExplore={() => setScreen('dashboard')} />}
        {screen === 'dashboard' && <DashboardScreen profile={profile} dishes={dishes} />}
        {screen === 'chat' && (
          <ChatWindow
            mode="advisor"
            profile={profile}
            suggestions={CHAT_SUGGESTIONS}
            onViewFood={() => setScreen('dashboard')}
            showNavPadding
          />
        )}
      </main>
      {showNav && <BottomNav screen={screen} setScreen={setScreen} />}
    </div>
  )
}
