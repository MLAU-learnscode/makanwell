"""Port of src/lib/scoring.js — must stay in sync with questionnaire.json."""

import json
from pathlib import Path

QUESTIONNAIRE_PATH = Path(__file__).resolve().parents[2] / "src" / "data" / "questionnaire.json"

CONDITIONS = ["hypertension", "hyperlipidaemia", "diabetes"]

with open(QUESTIONNAIRE_PATH, encoding="utf-8") as f:
    QUESTIONNAIRE = json.load(f)


def compute_bmi(height_cm, weight_kg):
    h = float(height_cm) / 100 if height_cm else 0
    if not h or not weight_kg:
        return None
    return float(weight_kg) / (h * h)


def _find_band(bands, value):
    for band in bands:
        if band.get("min") is not None and value < band["min"]:
            continue
        if band.get("max") is not None and value >= band["max"]:
            continue
        return band
    return None


def _add_points(acc, points):
    for c in CONDITIONS:
        acc[c] += (points or {}).get(c, 0)


def tier_for_score(pct):
    for t in QUESTIONNAIRE["tiers"]:
        if pct >= t["min"] and pct < t["max"]:
            return t["tier"]
    return "Low"


def calculate_risk(answers=None):
    answers = answers or {}
    raw = {c: 0 for c in CONDITIONS}

    for q in QUESTIONNAIRE["questions"]:
        if not q.get("scored"):
            continue

        qtype = q["type"]
        if qtype == "single":
            opt = next((o for o in q["options"] if o["value"] == answers.get(q["id"])), None)
            if opt:
                _add_points(raw, opt.get("points"))
        elif qtype == "multi":
            for v in answers.get(q["id"]) or []:
                opt = next((o for o in q["options"] if o["value"] == v), None)
                if opt:
                    _add_points(raw, opt.get("points"))
        elif qtype == "bmi":
            bmi = compute_bmi(answers.get("heightCm"), answers.get("weightKg"))
            if bmi is not None:
                band = _find_band(q["bands"], bmi)
                if band:
                    _add_points(raw, band.get("points"))
        elif qtype == "waist":
            bands = q["thresholds"].get(answers.get("gender"))
            waist = float(answers["waistCm"]) if answers.get("waistCm") else None
            if bands and waist:
                band = _find_band(bands, waist)
                if band:
                    _add_points(raw, band.get("points"))

    normalised = {}
    tier = {}
    for c in CONDITIONS:
        pct = round((raw[c] / QUESTIONNAIRE["maxScores"][c]) * 100, 1)
        normalised[c] = pct
        tier[c] = tier_for_score(pct)

    sorted_conds = sorted(CONDITIONS, key=lambda c: normalised[c], reverse=True)
    is_tie = normalised[sorted_conds[0]] - normalised[sorted_conds[1]] <= QUESTIONNAIRE["tieThreshold"]
    primary = [sorted_conds[0], sorted_conds[1]] if is_tie else [sorted_conds[0]]

    return {
        "raw": raw,
        "normalised": normalised,
        "tier": tier,
        "primaryConditions": primary,
        "isTie": is_tie,
    }


REQUIRED_FIELDS = [
    "age", "gender", "ethnicity", "heightCm", "weightKg", "waistCm",
    "familyHistory", "activityLevel", "friedFoodFreq", "sugaryDrinksPerDay",
    "extraSalt", "smokingStatus", "sleepQuality", "stressLevel", "symptoms",
    "hawkerFrequency", "favCategories",
]


def validate_answers(answers):
    errors = []
    for field in REQUIRED_FIELDS:
        val = answers.get(field)
        if val is None or val == "" or val == []:
            errors.append(f"Missing required field: {field}")
    return errors


def build_profile(answers):
    risk = calculate_risk(answers)
    bmi = compute_bmi(answers.get("heightCm"), answers.get("weightKg"))
    return {
        "entryPath": "ai-intake",
        "answers": answers,
        "riskScore": risk,
        "primaryConditions": risk["primaryConditions"],
        "bmi": round(bmi, 1) if bmi else None,
    }
