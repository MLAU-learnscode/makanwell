"""Food database search for the nutrition advisor agent."""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

FOOD_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "food_database.json"

RATING_PRIORITY = {"safe": 0, "modify": 1, "avoid": 2}

logger.info("Loading food database from %s", FOOD_DB_PATH)
if not FOOD_DB_PATH.exists():
    raise FileNotFoundError(
        f"food_database.json not found at {FOOD_DB_PATH}. "
        "Ensure server/data/food_database.json is present in the build context."
    )

with open(FOOD_DB_PATH, encoding="utf-8") as f:
    DISHES = json.load(f)

if not DISHES:
    raise ValueError(f"food_database.json at {FOOD_DB_PATH} is empty or invalid.")

logger.info("Loaded %d dishes from food database", len(DISHES))


def worst_rating(dish, conditions):
    worst = "safe"
    for cond in conditions:
        rating = dish.get("conditions", {}).get(cond, {}).get("rating", "safe")
        if RATING_PRIORITY[rating] > RATING_PRIORITY[worst]:
            worst = rating
    return worst


def search_dishes(conditions, query=None, category=None, limit=8):
    conditions = conditions or []
    results = DISHES

    if category and category.lower() != "all":
        results = [d for d in results if d.get("category", "").lower() == category.lower()]

    if query:
        q = query.lower()
        results = [
            d for d in results
            if q in d.get("name", "").lower() or q in d.get("local_name", "").lower()
        ]

    if conditions:
        results = sorted(results, key=lambda d: RATING_PRIORITY[worst_rating(d, conditions)])

    safe = [d for d in results if worst_rating(d, conditions) == "safe"][:limit]
    modify = [d for d in results if worst_rating(d, conditions) == "modify"][:limit]

    def fmt(dish):
        rating = worst_rating(dish, conditions) if conditions else "unknown"
        tips = []
        for c in conditions:
            tip = dish.get("conditions", {}).get(c, {}).get("tip")
            if tip:
                tips.append(tip)
        return {
            "name": dish["name"],
            "local_name": dish.get("local_name"),
            "category": dish.get("category"),
            "rating": rating,
            "calories": dish.get("calories"),
            "tip": tips[0] if tips else None,
        }

    return {
        "safe_dishes": [fmt(d) for d in safe[:5]],
        "modify_dishes": [fmt(d) for d in modify[:3]],
        "total_matches": len(results),
    }
