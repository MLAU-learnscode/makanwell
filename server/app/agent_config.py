import json

from agents import Agent, function_tool

from app.food_tools import search_dishes as _search_dishes
from app.scoring import build_profile, validate_answers

STYLE = (
    "Use a warm, conversational tone. Write in short paragraphs suitable for voice read-back. "
    "Do not use markdown headers, bullet lists, or emojis."
)

LANG_INSTRUCTION = (
    "Detect and respond in the same language the user writes or speaks in "
    "(English, Mandarin, Malay, Tamil, or others). "
    "If a language hint is provided in your context, prefer that language."
)

INTAKE_TOPICS = """
Collect health information through natural conversation covering these topics (one or two at a time):
1. Age group (18-30, 31-45, 46-60, 60+)
2. Gender (male/female — needed for waist thresholds)
3. Ethnicity (Chinese, Malay, Indian, Others)
4. Height in cm and weight in kg
5. Waist circumference in cm
6. Family history of hypertension, hyperlipidaemia, or diabetes (can be none)
7. Physical activity level (vigorous daily, moderate 3-5x/week, light 1-2x/week, sedentary)
8. Fried food frequency (rarely, 1-2x/week, 3-5x/week, daily)
9. Sugary drinks per day (none, 1, 2-3, 4+)
10. Extra salt/sauces at meals (never, sometimes, most meals, always)
11. Smoking status (never, ex-smoker, current)
12. Sleep quality (good, fair, poor)
13. Stress level (low, moderate, high, very-high)
14. Symptoms: headaches, fatigue, excessive thirst, frequent urination, or none
15. Hawker food frequency (daily-2x, daily-1x, few-times, rarely)
16. Favourite hawker categories — up to 3 from: Rice, Noodles, Fried, Soups, Bread, Desserts

When you have all answers, call complete_assessment with a JSON string of the collected data.
Use these exact field names: age, gender, ethnicity, heightCm, weightKg, waistCm,
familyHistory (array), activityLevel, friedFoodFreq, sugaryDrinksPerDay, extraSalt,
smokingStatus, sleepQuality, stressLevel, symptoms (array), hawkerFrequency, favCategories (array).
For multi-select fields, use arrays of value strings. Remove "none" from arrays if other items are selected.
Confirm key details briefly before calling the tool.
"""


@function_tool
def complete_assessment(answers_json: str):
    """Finalize the health intake with all collected questionnaire answers as a JSON string."""
    try:
        answers = json.loads(answers_json)
    except json.JSONDecodeError:
        return json.dumps({"success": False, "errors": ["Invalid JSON in answers_json"]})

    errors = validate_answers(answers)
    if errors:
        return json.dumps({"success": False, "errors": errors})

    profile = build_profile(answers)
    conditions = profile["primaryConditions"]
    summary = (
        f"Assessment complete. Primary focus: {', '.join(conditions)}. "
        "The user can now view their personalised Food Guide."
    )
    return json.dumps({"success": True, "profile": profile, "summary": summary})


def make_advisor_tools(conditions):
    cond_list = conditions or []

    @function_tool
    def search_dishes(query: str = "", category: str = "All"):
        """Search hawker dishes safe or modifiable for the user's health conditions."""
        return json.dumps(_search_dishes(cond_list, query or None, category or None))

    return [search_dishes]


def get_intake_agent(lang_hint: str = "en"):
    lang_note = f" Language hint: {lang_hint}." if lang_hint else ""
    return Agent(
        name="Health Intake Agent",
        model="gpt-4o-mini",
        instructions=(
            f"You are MakanWell, a friendly Singapore hawker-food health advisor conducting a health intake. "
            f"{STYLE} {LANG_INSTRUCTION}{lang_note}\n\n{INTAKE_TOPICS}"
        ),
        tools=[complete_assessment],
    )


def get_advisor_agent(profile: dict | None = None, lang_hint: str = "en"):
    profile = profile or {}
    conditions = profile.get("primaryConditions") or []
    risk = profile.get("riskScore") or {}
    tiers = risk.get("tier") or {}
    tier_str = ", ".join(f"{c}: {tiers.get(c, 'unknown')}" for c in conditions) if conditions else "unknown"
    lang_note = f" Language hint: {lang_hint}." if lang_hint else ""

    return Agent(
        name="Nutrition Advisor",
        model="gpt-4o-mini",
        instructions=(
            f"You are MakanWell, a friendly Singapore hawker-food health advisor. "
            f"{STYLE} {LANG_INSTRUCTION}{lang_note}\n\n"
            f"User conditions: {', '.join(conditions) or 'none'}. Risk tiers: {tier_str}.\n\n"
            "Rate dishes using these thresholds:\n"
            "- Hypertension: AVOID if sodium >600mg, MODIFY 300-600mg, SAFE <300mg.\n"
            "- Hyperlipidaemia: AVOID if sat fat >6g OR cholesterol >150mg; MODIFY in between; SAFE otherwise.\n"
            "- Diabetes: AVOID high GI + sugar; MODIFY medium GI; SAFE low GI + high fibre.\n\n"
            "Use search_dishes to look up specific dishes from the database. "
            "Give concrete local tips (less gravy, steamed not fried, etc.). "
            "When the user wants their full personalised food list, tell them to tap "
            "'View Food Guide' to see all traffic-light rated dishes."
        ),
        tools=make_advisor_tools(conditions),
    )


def get_starting_agent(mode: str = "intake", profile: dict | None = None, lang: str = "en"):
    if mode == "advisor":
        return get_advisor_agent(profile, lang)
    return get_intake_agent(lang)
