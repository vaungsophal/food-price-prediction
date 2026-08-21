# Prompt: Port the Cambodia Food Price app to Nuxt 4

> Paste everything below into Claude Code (or another coding agent) from the project root.
> It is self-contained — the agent does not need this conversation's history.

---

Build a **Nuxt 4** application that serves both a web UI and a Telegram bot for forecasting
food commodity prices in Cambodia. It deploys as a single Vercel project on the free Hobby tier.

I have an existing Vue 3 + Vite version that works; you are porting it to Nuxt 4. The trained
model artifacts already exist — do not retrain anything.

## Critical constraints (verified, do not deviate)

1. **Nuxt 4, not Nuxt 3.** Nuxt 3 reached end of life on 31 July 2026. Current stable is 4.5.x.
   Ignore any Nuxt 3 patterns from your training data.

2. **No ML libraries at runtime.** Vercel's Hobby tier caps a serverless function at 250 MB
   unzipped. Installing xgboost (84 MB) + scipy (111 MB) + numpy (58 MB) + pandas (42 MB) +
   scikit-learn (32 MB) totals ~327 MB and the deploy fails. Prediction is implemented in plain
   TypeScript instead — see the algorithm below. The JSON artifacts total ~1.9 MB.

3. **Verify Nitro bundles the artifacts.** `history.json` is 1.2 MB. Confirm by actually
   building (`npm run build`) that the JSON files resolve at runtime in the built output, not
   just in dev. If a direct `import` doesn't survive bundling, use
   `useStorage('assets:server')` with the files in `server/assets/`. Report which approach you
   used and why.

## Artifacts (already exist — copy them in, do not regenerate)

Four JSON files:

| File | Shape |
|---|---|
| `model.json` | `{ base_score: number, trees: Array<{ l, r, f, t, w: number[] }> }` |
| `encoders.json` | `Record<column, Record<label, integerCode>>` — columns: `commodity`, `market`, `admin1`, `category`, `pricetype` |
| `feature_cols.json` | `string[]` — the feature order the model expects |
| `history.json` | `commodity → market → pricetype → { admin1, category, unit, dates: string[], prices: number[] }` (up to 24 monthly points per series) |

Covers **46 commodities** across **76 markets**.

## The prediction algorithm

The model is XGBoost `reg:squarederror`, 200 trees, 10 features. Predicting is just tree
traversal:

```ts
function rawPredict(features: number[]): number {
  let total = BASE_SCORE
  for (const tree of TREES) {
    let node = 0
    while (tree.l[node] !== -1) {          // -1 marks a leaf
      node = features[tree.f[node]] < tree.t[node] ? tree.l[node] : tree.r[node]
    }
    total += tree.w[node]
  }
  return total
}
```

Feature order (from `feature_cols.json`):
`commodity_enc, market_enc, admin1_enc, category_enc, pricetype_enc, month, quarter, lag_1, lag_3, rolling_mean_3`

Building the feature vector for a series:

- `*_enc` — look up the label in `encoders.json`
- `month` — the month **after** the last recorded date, wrapping December → January
- `quarter` — `Math.floor((month - 1) / 3) + 1`
- `lag_1` — the last recorded price
- `lag_3` — the first of the last three prices
- `rolling_mean_3` — mean of the last three prices

**Correctness check:** `Rice (mixed, low quality)` at `Phnom Penh`, pricetype `Wholesale`, has
last price `0.44` and must predict **`0.460394`** (±1e-5). If your port returns anything else,
the feature order or the traversal is wrong. Write a test asserting this.

## Input matching

Users type "rice", not "Rice (mixed, low quality)". Match in this order:

1. Exact, case-insensitive
2. Substring — if several match, take the **shortest** (so "rice" lands on plain rice, not a
   longer variant)
3. Levenshtein similarity, minimum 0.6, otherwise return no match rather than guessing

Also implement `splitCommodityMarket("rice phnom penh") → ["rice", "phnom penh"]`: market names
contain spaces, so try progressively longer candidates from the right against the known market
list, falling back to treating only the last word as the market.

## Routes

| Route | Purpose |
|---|---|
| `GET /api/options` | `{ commodities, marketsByCommodity }` — drives a dependent dropdown |
| `GET /api/predict?commodity=&market=` | Forecast **plus** the 24-point history for the chart |
| `POST /api/webhook` | Telegram updates |
| `GET /api/webhook` | Health check returning commodity/market counts |

Use Nuxt file conventions: `server/api/predict.get.ts`, `server/api/webhook.post.ts`, etc.
Shared logic goes in `server/utils/predictor.ts` (auto-imported).

Cache `options` with `s-maxage=86400`, `predict` with `s-maxage=3600`.

### Telegram specifics

- Commands: `/start`, `/help`, `/predict <commodity> <market>`, `/commodities`, `/markets`
- Strip `@BotName` from commands (group chats append it)
- **Reply via the response-method pattern**: return
  `{ method: "sendMessage", chat_id, text, parse_mode: "Markdown" }` in the HTTP response body
  rather than making an outbound Bot API call. Saves a round-trip and means `BOT_TOKEN` never
  needs to be set on Vercel.
- **Always return HTTP 200**, including on malformed input — a non-200 makes Telegram retry the
  same update in a loop.
- If `WEBHOOK_SECRET` is set, reject requests whose `x-telegram-bot-api-secret-token` header
  doesn't match.
- Telegram caps messages at 4096 chars; truncate `/commodities` and `/markets`.
- Include a Unicode block sparkline (`▁▂▃▄▅▆▇█`) of recent prices in the prediction reply.

## Frontend

Single page: two dropdowns (commodity, market) + a forecast button, a price card, and a chart.
SSR the default forecast (Rice / Phnom Penh) so the chart is visible on first paint with no
loading flash.

Switching commodity can strand a market that doesn't sell it — reset the market selection when
that happens.

### The chart — this is the important part

Hand-rolled SVG, no charting library.

**Recorded prices render as a solid line; the forecast is a dashed segment extending past the
last real point, ending in a hollow ring.** The observed/predicted boundary is the honest part
of this visualisation and must be visually unmistakable. A charting library would draw both as
one continuous line, which implies the prediction is as solid as the observations. Do not do
that.

Dashed segment is amber when the forecast rises, deep red when it falls.

On screens under 760px the SVG scales down and label text becomes unreadable (~5px). Fix by
using a **narrower viewBox** on mobile (≈400 wide instead of 720) so type stays proportionally
larger — don't just shrink font sizes.

### Design tokens

```css
--basket: #e9e7db;        /* background — woven palm */
--basket-deep: #dcd9c9;   /* borders, guides */
--chalk: #fcfbf7;         /* cards */
--ink: #191e19;
--ink-soft: #5c625a;
--palm: #2f5d46;          /* primary, recorded line */
--palm-light: #4d8065;
--mangosteen: #6b2545;    /* falling forecast, errors */
--turmeric: #d99a0b;      /* rising forecast */
```

Type: **Fraunces** (display, use italic for the second line of the headline), **IBM Plex Sans**
(body), **IBM Plex Mono** (figures, labels, eyebrows). Palette and faces come from the subject —
a Cambodian wet market — so keep them; don't substitute a generic dark theme or a cream/serif/
terracotta layout.

Quality floor: responsive to 390px, visible keyboard focus, `prefers-reduced-motion` respected.

## Copy

Errors explain what happened and what to do — never vague, never apologetic. Two real cases:

- A commodity isn't sold at the chosen market → say so and list up to 8 markets where it **is**
  tracked.
- The forecast service is unreachable → say that plainly and suggest retrying.

Include a footer note: forecasts are model estimates, not official prices, and some series
stopped reporting before 2026, so the chart ends at the last genuine observation. **Do not
fabricate recent dates** — if a series' last point is June 2022, the UI says June 2022.

## Deliverables

1. Working Nuxt 4 app, `npm run build` passing with type checking
2. A test asserting the 0.460394 correctness check
3. `README.md` covering local dev, deploy, and connecting the Telegram webhook
4. Confirmation you built it and the artifacts resolve in the built output

Before writing code, tell me your plan for the artifact-loading approach and flag anything above
you think is wrong.