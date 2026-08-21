"""
export_artifacts.py - export the trained model as JSON for the Nuxt app.

Reads the pickles the notebook writes (model_artifacts/) and produces the four files the
TypeScript predictor consumes. Nothing is retrained here.

    model.json         trees + base score (prediction only, no training metadata)
    encoders.json      label -> integer code maps
    feature_cols.json  feature order the model expects
    history.json       last 24 observations per series (charts + lag features)

It also writes nuxt-app/test/reference.json - the Python model's own prediction for one
known series, which the Vitest suite asserts the TypeScript port reproduces.

Run from the repo root:  python tools/export_artifacts.py
Requires pandas, xgboost, scikit-learn, joblib - development only. The deployed app ships
no ML dependencies at all.
"""

import json
import sys
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_CSV = ROOT / "wfp_food_prices_khm.csv"
OUT = ROOT / "nuxt-app" / "server" / "assets" / "artifacts"
FIXTURE = ROOT / "nuxt-app" / "test" / "reference.json"

CHART_POINTS = 24  # ~2 years of monthly observations per series

# The notebook's download unpacks as model_artifacts/model_artifacts/; accept either.
CANDIDATES = [ROOT / "model_artifacts" / "model_artifacts", ROOT / "model_artifacts"]
ART = next((p for p in CANDIDATES if (p / "price_model.pkl").exists()), None)
if ART is None:
    sys.exit(
        "price_model.pkl not found. Run the notebook, download model_artifacts.zip and\n"
        "unpack it in the repo root so that model_artifacts/price_model.pkl exists."
    )
print(f"Reading artifacts from {ART.relative_to(ROOT)}")

# ---------- 1. Model ----------
model = joblib.load(ART / "price_model.pkl")
booster = model.get_booster()

tmp = OUT / "_full.json"
OUT.mkdir(parents=True, exist_ok=True)
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
print(f"model: base_score={base_score}  trees={len(trees)}")

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
print("features:", feature_cols)

# ---------- 4. History ----------
# Rebuilt from the raw CSV rather than the notebook's price_history.csv, which keeps only
# the 3 points the model needs - too few to draw a chart. Same filters as notebook cell 14.
df = pd.read_csv(RAW_CSV, parse_dates=["date"])
df = df[df["date"] >= "2019-01-01"]
counts = df["commodity"].value_counts()
df = df[df["commodity"].isin(counts[counts >= 300].index)]

group_cols = ["commodity", "market", "pricetype"]
recent = df.sort_values("date").groupby(group_cols).tail(CHART_POINTS)

# A series carrying a label the encoders never saw can't be encoded, and one with fewer
# than three points can't fill lag_3 - drop both rather than predict on a NaN.
known = {col: set(le.classes_) for col, le in encoders.items()}

history: dict = {}
skipped = 0
for (commodity, market, pricetype), g in recent.groupby(group_cols):
    g = g.sort_values("date")
    last = g.iloc[-1]
    if (
        len(g) < 3
        or commodity not in known["commodity"]
        or market not in known["market"]
        or str(last["admin1"]) not in known["admin1"]
        or str(last["category"]) not in known["category"]
        or pricetype not in known["pricetype"]
    ):
        skipped += 1
        continue
    history.setdefault(commodity, {}).setdefault(market, {})[pricetype] = {
        "admin1": str(last["admin1"]),
        "category": str(last["category"]),
        "unit": str(last["unit"]),
        "dates": [d.strftime("%Y-%m") for d in g["date"]],
        "prices": [round(float(p), 3) for p in g["usdprice"]],
    }

(OUT / "history.json").write_text(json.dumps(history, separators=(",", ":")))
markets = {m for by_market in history.values() for m in by_market}
print(f"history: {len(history)} commodities, {len(markets)} markets, {skipped} series skipped")

# ---------- 5. Correctness reference ----------
# The Python model's own answer for one known series. The Vitest suite asserts the
# TypeScript traversal reproduces it, which is what catches a wrong feature order or a
# wrong comparison direction in the tree walk.
series = history["Rice (mixed, low quality)"]["Phnom Penh"]["Wholesale"]
prices, dates = series["prices"], series["dates"]
next_month = (int(dates[-1].split("-")[1]) % 12) + 1
row = pd.DataFrame(
    [
        {
            "commodity_enc": encoders["commodity"].transform(["Rice (mixed, low quality)"])[0],
            "market_enc": encoders["market"].transform(["Phnom Penh"])[0],
            "admin1_enc": encoders["admin1"].transform([series["admin1"]])[0],
            "category_enc": encoders["category"].transform([series["category"]])[0],
            "pricetype_enc": encoders["pricetype"].transform(["Wholesale"])[0],
            "month": next_month,
            "quarter": (next_month - 1) // 3 + 1,
            "lag_1": prices[-1],
            "lag_3": prices[-3],
            "rolling_mean_3": sum(prices[-3:]) / 3,
        }
    ]
)[feature_cols]

reference = {
    "commodity": "Rice (mixed, low quality)",
    "market": "Phnom Penh",
    "pricetype": "Wholesale",
    "lastDate": dates[-1],
    "lastPrice": prices[-1],
    "features": [float(v) for v in row.iloc[0].tolist()],
    "pythonPrediction": round(float(model.predict(row)[0]), 6),
}
FIXTURE.parent.mkdir(parents=True, exist_ok=True)
FIXTURE.write_text(json.dumps(reference, indent=2) + "\n")

print("\nReference: Rice (mixed, low quality) / Phnom Penh / Wholesale")
print(f"  last date {dates[-1]}  last price {prices[-1]}")
print(f"  python prediction = {reference['pythonPrediction']:.6f}")

print("\nWrote:")
total = 0.0
for f in sorted(OUT.iterdir()):
    kb = f.stat().st_size / 1024
    total += kb
    print(f"  {f.name:<20} {kb:>9.1f} KB")
print(f"  {'TOTAL':<20} {total:>9.1f} KB")
