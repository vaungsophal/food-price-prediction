# Cambodia Food Price Forecast — Nuxt 4

A web app **and** a Telegram bot sharing one prediction engine, deployed as a single Vercel
project on the free Hobby tier.

```
Browser  ──→ GET  /api/options   ┐
Browser  ──→ GET  /api/predict   ├──→ server/utils/predictor.ts ──→ server/assets/artifacts/*.json
Telegram ──→ POST /api/webhook   ┘
```

The model was trained with XGBoost in Python, but nothing here imports XGBoost. A
boosted-tree prediction is "walk each tree comparing a feature to a threshold, sum the leaf
weights, add the base score" — so [`server/utils/engine.ts`](server/utils/engine.ts)
reimplements it in about fifteen lines, and the deployed function ships **zero ML
dependencies**.

That is not just tidiness. Vercel's Hobby tier caps a serverless function at **250 MB
unzipped**, and xgboost + scipy + numpy + pandas + scikit-learn come to roughly 327 MB. The
JSON artifacts total **2.4 MB**.

Covers **46 commodities** across **76 markets**, from World Food Programme price monitoring.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000 — API routes included, no separate process
npm test           # cross-language correctness check + matching/parsing tests
npm run build      # production build into .output/
node .output/server/index.mjs   # run the built output locally
```

Unlike the Vue + Vite version this replaced, `npm run dev` serves the API too — Nitro is
part of the dev server, so there's no `vercel dev` requirement.

---

## Regenerating the model artifacts

The four JSON files are committed, so you only need this after retraining.

1. Run [`../cambodia_food_price_prediction.ipynb`](../cambodia_food_price_prediction.ipynb)
   in Colab. Its last cell downloads `model_artifacts.zip`.
2. Unpack it in the repo root so `model_artifacts/price_model.pkl` exists.
3. From the repo root:

```bash
pip install pandas scikit-learn xgboost joblib   # local only, for the export
python tools/export_artifacts.py
```

That writes `nuxt-app/server/assets/artifacts/`:

| File | Contents |
|---|---|
| `model.json` | Trees + base score, stripped to the five arrays a traversal needs |
| `encoders.json` | Label → integer code maps for the five categorical columns |
| `feature_cols.json` | The feature order the model expects |
| `history.json` | Last 24 observations per series — powers both the chart and the lag features |

It also writes `test/reference.json`: the Python model's own prediction for one known
series, which the test suite asserts the TypeScript port reproduces. Retraining regenerates
that number, so the test always pins the port to the artifacts actually shipped.

> The notebook's own `price_history.csv` keeps only the 3 points the model needs — too few
> to draw a chart. `export_artifacts.py` rebuilds a 24-point window from the raw CSV.

### How the artifacts reach the build output

They live in `server/assets/artifacts/` and are read through
`useStorage('assets:server')`, not imported directly. A direct
`import model from './artifacts/model.json'` does survive bundling — rollup inlines it —
but it turns 2.4 MB of numbers into a JavaScript object literal that V8 has to parse on
every cold start, present in the chunk whether or not a request needs it. Nitro's
server-asset pipeline is the documented path for shipping raw files, so there's no bundler
behaviour to guess at across presets.

Verified, not assumed: `npm run build` emits `.output/server/chunks/raw/model.mjs` (1.35 MB)
and `raw/history.mjs` (1.37 MB), and `GET /api/webhook` against the built output returns
`{"status":"ok","commodities":46,"markets":76}`.

---

## Deploying to Vercel

Nitro detects the Vercel preset on its own — there is no `vercel.json` to maintain.

Because the Nuxt app lives in a subdirectory of this repo, set **Root Directory** to
`nuxt-app` in the Vercel project settings (Settings → General). Then:

```bash
npx vercel --prod
```

### Environment variables

Both are optional, and both use Nuxt's `NUXT_`-prefixed runtime config, so they are read at
request time rather than baked in at build.

| Name | Purpose |
|---|---|
| `NUXT_WEBHOOK_SECRET` | Rejects webhook calls whose `x-telegram-bot-api-secret-token` header doesn't match. Set it. |
| `NUXT_SITE_URL` | Your deployed origin, so bot replies can link back to the chart. |

`BOT_TOKEN` never needs to reach Vercel — see below.

---

## Connecting the Telegram bot

Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token. Set
`NUXT_WEBHOOK_SECRET` in Vercel, redeploy, then register the webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project>.vercel.app/api/webhook&secret_token=<SECRET>"
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

Two decisions worth knowing about:

- **Replies go out in the HTTP response body**, using Telegram's response-method pattern:
  the handler returns `{ method: "sendMessage", chat_id, text, parse_mode: "Markdown" }`
  rather than making an outbound Bot API call. One less round-trip, and the bot token stays
  on your machine.
- **Every request gets a 200**, including malformed ones. Telegram retries any non-2xx with
  the same update, so throwing on bad input would produce a retry loop. Failures are
  reported to the user as text.

Commands: `/start`, `/help`, `/predict <commodity> <market>`, `/commodities`, `/markets`.
`@BotName` suffixes (which group chats append) are stripped, and replies include a Unicode
block sparkline of recent prices.

---

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/options` | GET | Commodities plus the markets each is sold at. `s-maxage=86400`. |
| `/api/predict?commodity=&market=` | GET | Forecast plus the 24-point history. `s-maxage=3600`. |
| `/api/webhook` | POST | Telegram updates. |
| `/api/webhook` | GET | Health check — returns commodity and market counts. |

Visit `/api/webhook` in a browser after deploying. If it returns counts, the artifacts
loaded correctly.

Both GET routes fuzzy-match their input, so `?commodity=rice` works: exact match first, then
substring with the shortest candidate winning (so "rice" lands on plain rice rather than a
longer variant), then edit distance with a 0.6 floor. Below that it returns an error rather
than charting the wrong commodity.

---

## The chart

Hand-rolled SVG, no charting library — because the one thing that matters here is the thing
a library would smooth away:

**Recorded prices are a solid line. The forecast is a dashed segment past the last real
point, ending in a hollow ring** — amber when the price rises, mangosteen when it falls.
Drawing both as one continuous stroke would imply the prediction is as solid as the
observations.

Under 760px the component switches to a **narrower viewBox** (400 wide instead of 720)
rather than shrinking its type. Same drawing, smaller coordinate space, so labels stay
proportionally legible once the SVG scales to fit — at 720 wide, 11px labels render at about
5px on a phone.

Palette and type come from the subject, a Cambodian wet market: woven-palm basket for the
ground, chalk for the price boards, banana-leaf green for anything primary, mangosteen and
turmeric for the two directions a forecast can go. Fraunces for display, IBM Plex Sans for
body, IBM Plex Mono for figures.

---

## Testing

```bash
npm test
```

The load-bearing case is a cross-language check: the TypeScript traversal must reproduce the
Python model's own answer for `Rice (mixed, low quality)` at `Phnom Penh`, pricetype
`Wholesale` — last recorded price `$0.44` in June 2022, forecast **`0.460955`**. A wrong
feature order or a flipped comparison in the tree walk changes that number, and nothing else
in the suite would catch it.

> The original task brief quoted `0.460394` for this series. That figure came from an
> earlier training run; the model in `model_artifacts/price_model.pkl` answers `0.460955`,
> confirmed by calling xgboost directly. The test asserts against the model actually
> shipped, and `test/reference.json` is regenerated whenever the model is.

`npm run typecheck` runs `vue-tsc` over the app, server routes and config.

---

## Files

```
nuxt-app/
├── app/
│   ├── app.vue
│   ├── assets/css/main.css          design tokens
│   ├── components/PriceChart.vue    the SVG chart
│   └── pages/index.vue              pickers, price board, layout
├── server/
│   ├── api/
│   │   ├── options.get.ts
│   │   ├── predict.get.ts
│   │   ├── webhook.get.ts           health check
│   │   └── webhook.post.ts          Telegram
│   ├── assets/artifacts/*.json      model + encoders + history
│   └── utils/
│       ├── engine.ts                inference, fuzzy matching, series lookup
│       └── predictor.ts             loads the artifacts, memoises an Engine
├── test/
│   ├── predictor.test.ts
│   └── reference.json               generated by tools/export_artifacts.py
└── nuxt.config.ts
```

`engine.ts` deliberately imports nothing from Nitro, Vue or Node, so the test suite can hand
it artifacts read straight off disk without booting a Nuxt environment. `predictor.ts` is
the thin wrapper that does the loading.

---

## Troubleshooting

**Forecast dated 2022.** Not a bug. Some commodity/market series stopped reporting years
before the dataset ends, and the app deliberately shows the real last observation rather
than implying data it doesn't have.

**Bot silent.** Call `getWebhookInfo`. `Wrong response from the webhook` in
`last_error_message` usually means a Markdown parse failure; `bad secret token` in the
response body means `NUXT_WEBHOOK_SECRET` differs between your `setWebhook` call and Vercel.

**`Model artifact "model.json" is missing from the build output.`** The JSON files aren't in
`server/assets/artifacts/`. Regenerate them with `python tools/export_artifacts.py` and
commit them.

**Vercel build can't find the app.** Root Directory isn't set to `nuxt-app`.
