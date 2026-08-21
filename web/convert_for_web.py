"""
convert_for_web.py — export the trained model as JSON for the TypeScript/Vue app.

Run after training, in the folder containing model_artifacts/.

Produces four files consumed by the Vercel Node functions:
    model.json         trees + base score (prediction only, no training metadata)
    encoders.json      label -> integer code maps
    feature_cols.json  feature order the model expects
    history.json       last 24 observations per series (charts + lag features)

Nothing here is XGBoost-specific at runtime: a boosted-tree prediction is just
"walk each tree, sum the leaf values, add the base score", which ports to any language.
"""

import json
from pathlib import Path

import joblib
import pandas as pd

ART = Path("model_artifacts")
OUT = Path("web_artifacts")
OUT.mkdir(exist_ok=True)

CHART_POINTS = 24  # ~2 years of monthly observations per series

# ---------- 1. Model ----------
model = joblib.load(ART / "price_model.pkl")
booster = model.get_booster()

tmp = OUT / "_full.json"
booster.save_model(str(tmp))
full = json.loads(tmp.read_text())
tmp.unlink()

base_score = float(full["learner"]["learner_model_param"]["base_score"].strip("[]"))

# Keep only the arrays needed to traverse a tree. Dropping loss_changes, sum_hessian,
# parents and the categorical scaffolding cuts the file by roughly a third.
trees = [
    {
        "l": t["left_children"],
        "r": t["right_children"],
        "f": t["split_indices"],
        "t": t["split_conditions"],
        "w": t["base_weights"],
    }
    for t in full["learner"]["gradient_booster"]["model"]["trees"]
]

(OUT / "model.json").write_text(
    json.dumps({"base_score": base_score, "trees": trees}, separators=(",", ":"))
)

# ---------- 2. Encoders ----------
encoders = joblib.load(ART / "encoders.pkl")
(OUT / "encoders.json").write_text(
    json.dumps(
        {col: {str(label): i for i, label in enumerate(le.classes_)} for col, le in encoders.items()},
        separators=(",", ":"),
    )
)

# ---------- 3. Feature order ----------
feature_cols = list(joblib.load(ART / "feature_cols.pkl"))
(OUT / "feature_cols.json").write_text(json.dumps(feature_cols))

# ---------- 4. History ----------
# Rebuilt from the raw CSV (not price_history.csv) because charts need a longer
# window than the 3 points the model itself requires.
RAW_CSV = "wfp_food_prices_khm.csv"
df = pd.read_csv(RAW_CSV, parse_dates=["date"])
df = df[df["date"] >= "2019-01-01"]
counts = df["commodity"].value_counts()
df = df[df["commodity"].isin(counts[counts >= 300].index)]

group_cols = ["commodity", "market", "pricetype"]
recent = df.sort_values("date").groupby(group_cols).tail(CHART_POINTS)

history: dict = {}
for (commodity, market, pricetype), grp in recent.groupby(group_cols):
    grp = grp.sort_values("date")
    last = grp.iloc[-1]
    history.setdefault(commodity, {}).setdefault(market, {})[pricetype] = {
        "admin1": str(last["admin1"]),
        "category": str(last["category"]),
        "unit": str(last["unit"]),
        "dates": [d.strftime("%Y-%m") for d in grp["date"]],
        "prices": [round(float(p), 3) for p in grp["usdprice"]],
    }

(OUT / "history.json").write_text(json.dumps(history, separators=(",", ":")))

# ---------- Report ----------
print("Exported to web_artifacts/ — copy into api/_lib/artifacts/")
total = 0.0
for f in sorted(OUT.iterdir()):
    kb = f.stat().st_size / 1024
    total += kb
    print(f"  {f.name:<20} {kb:>8.1f} KB")
print(f"  {'TOTAL':<20} {total:>8.1f} KB")
