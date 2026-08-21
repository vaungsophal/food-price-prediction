# Cambodia Food Price Forecast — Vue 3 + Vercel

A Vue 3 web app **and** a Telegram bot, sharing one prediction engine, deployed as a single
Vercel project on the free tier.

```
Browser ──→ /api/options   ┐
Browser ──→ /api/predict   ├──→ api/_lib/predictor.ts ──→ artifacts/*.json
Telegram ─→ /api/webhook   ┘
```

The model was trained with XGBoost in Python, but nothing here imports XGBoost. A
boosted-tree prediction is "walk each tree comparing a feature to a threshold, sum the leaf
weights, add the base score" — so `predictor.ts` reimplements it in ~15 lines. Output matches
the Python model to ~3e-6 (float32 rounding).

This also sidesteps a hard blocker: Vercel's Hobby tier caps a function at **250 MB unzipped**,
and scipy + xgboost + numpy + pandas + scikit-learn come to ~327 MB. The JSON artifacts total
**1.9 MB** with zero runtime ML dependencies.

---

## Setup

### 1. Export the model from Colab

Run `convert_for_web.py` in the folder holding `model_artifacts/` and the original CSV:

```bash
pip install joblib pandas xgboost      # local only, for conversion
python convert_for_web.py
cp web_artifacts/*.json vue_app/api/_lib/artifacts/
```

This writes four files:

| File | Purpose |
|---|---|
| `model.json` | Trees + base score |
| `encoders.json` | Label → integer code maps |
| `feature_cols.json` | Feature order the model expects |
| `history.json` | Last 24 observations per series (charts **and** lag features) |

> The notebook's `price_history.csv` only keeps 3 points per series — enough for the model,
> too few for a chart. `convert_for_web.py` rebuilds a 24-point window from the raw CSV.

### 2. Run locally

```bash
cd vue_app
npm install
npm i -g vercel
vercel dev          # serves the Vue app and the /api functions together
```

Open http://localhost:3000.

> Use `vercel dev`, not `npm run dev`. Plain Vite serves the frontend but not the TypeScript
> functions, so every API call would 404.

### 3. Deploy

```bash
vercel --prod
```

### 4. Connect the Telegram bot

Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token.

In the Vercel dashboard → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `WEBHOOK_SECRET` | any random string (recommended) |
| `SITE_URL` | your deployed URL, so the bot can link to the charts |

Redeploy so they take effect, then register the webhook:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/webhook&secret_token=<YOUR_SECRET>"
```

Check it worked:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

`BOT_TOKEN` never needs to reach Vercel — the webhook replies through its own HTTP response
body rather than calling the Bot API, so the token stays on your machine.

---

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/options` | GET | Commodities plus the markets each is sold at |
| `/api/predict?commodity=&market=` | GET | Forecast plus 24-point history for the chart |
| `/api/webhook` | POST | Telegram updates |
| `/api/webhook` | GET | Health check — returns commodity/market counts |

Visit `/api/webhook` in a browser after deploying. If it returns counts, the artifacts loaded
correctly.

---

## Design notes

The chart is hand-rolled SVG rather than a charting library — Chart.js or similar would add
weight for one chart, and building it directly allows the one thing that actually matters here:
**recorded prices are a solid line, the forecast is a dashed segment ending in a hollow ring.**
The observed/predicted boundary is the honest part of the visualisation, so it gets the visual
emphasis rather than being smoothed into a single continuous line.

Palette and type are drawn from the subject (woven-palm basket, banana-leaf green, mangosteen,
turmeric; Fraunces for display, IBM Plex Sans/Mono for body and figures).

---

## Files

```
vue_app/
├── api/
│   ├── _lib/
│   │   ├── predictor.ts        inference, fuzzy matching, series lookup
│   │   └── artifacts/*.json    model + encoders + history
│   ├── options.ts
│   ├── predict.ts
│   └── webhook.ts              Telegram
├── src/
│   ├── App.vue                 pickers, price board, layout
│   ├── components/PriceChart.vue
│   ├── main.ts
│   └── style.css               design tokens
├── vercel.json                 bundles artifacts into the functions
└── vite.config.ts
```

Directories under `api/` starting with `_` are not exposed as routes, so `_lib` stays private.

---

## Troubleshooting

**API returns 404 locally.** You're running `npm run dev` instead of `vercel dev`.

**`ENOENT` for artifacts after deploy.** The `includeFiles` entry in `vercel.json` is what
bundles `api/_lib/artifacts/**`. Confirm the JSON files exist and were committed.

**Bot silent.** Call `getWebhookInfo`. A 403 in `last_error_message` means `WEBHOOK_SECRET`
differs between your `setWebhook` call and Vercel.

**Forecast dated 2022.** Not a bug. Some commodity/market series stopped reporting years before
the dataset ends, and the app deliberately shows the real last observation instead of implying
data it doesn't have.
