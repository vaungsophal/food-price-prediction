<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PriceChart from './components/PriceChart.vue'

interface Prediction {
  commodity: string
  market: string
  province: string
  pricetype: string
  unit: string
  lastDate: string
  lastPrice: number
  predictedPrice: number
  changePct: number
  trend: 'up' | 'down' | 'stable'
  dates: string[]
  prices: number[]
}

const commodities = ref<string[]>([])
const marketsByCommodity = ref<Record<string, string[]>>({})
const commodity = ref('')
const market = ref('')

const prediction = ref<Prediction | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const optionsReady = ref(false)

const markets = computed(() => marketsByCommodity.value[commodity.value] ?? [])

onMounted(async () => {
  try {
    const response = await fetch('/api/options')
    if (!response.ok) throw new Error()
    const data = await response.json()
    commodities.value = data.commodities
    marketsByCommodity.value = data.marketsByCommodity
    optionsReady.value = true

    // Open on something real rather than an empty state
    const defaultCommodity =
      commodities.value.find((c) => c.startsWith('Rice')) ?? commodities.value[0]
    commodity.value = defaultCommodity
    market.value =
      (marketsByCommodity.value[defaultCommodity] ?? []).find((m) => m === 'Phnom Penh') ??
      marketsByCommodity.value[defaultCommodity]?.[0] ??
      ''
    await runForecast()
  } catch {
    errorMessage.value = "Couldn't load the commodity list. Refresh to try again."
  }
})

// Switching commodity can strand a market that doesn't sell it
watch(commodity, () => {
  if (!markets.value.includes(market.value)) market.value = markets.value[0] ?? ''
})

async function runForecast() {
  if (!commodity.value || !market.value) return
  loading.value = true
  errorMessage.value = ''

  try {
    const params = new URLSearchParams({ commodity: commodity.value, market: market.value })
    const response = await fetch(`/api/predict?${params}`)
    const data = await response.json()

    if (!response.ok) {
      prediction.value = null
      errorMessage.value = data.suggestions?.length
        ? `${data.error} Try ${data.suggestions.slice(0, 3).join(', ')}.`
        : data.error
      return
    }
    prediction.value = data
  } catch {
    prediction.value = null
    errorMessage.value = 'The forecast service is unreachable. Try again in a moment.'
  } finally {
    loading.value = false
  }
}

const monthLabel = computed(() => {
  if (!prediction.value) return ''
  const [year, month] = prediction.value.lastDate.split('-')
  const next = new Date(Number(year), Number(month), 1)
  return next.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
})

const lastLabel = computed(() => {
  if (!prediction.value) return ''
  const [year, month] = prediction.value.lastDate.split('-')
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
  })
})
</script>

<template>
  <div class="page">
    <header class="masthead">
      <p class="eyebrow">World Food Programme market data · 2019–2026</p>
      <h1>
        What will it cost
        <em>next month?</em>
      </h1>
      <p class="standfirst">
        Pick a commodity and a market. A gradient-boosted model trained on
        {{ commodities.length || '46' }} commodities across Cambodian markets projects the next
        recorded price.
      </p>
    </header>

    <section class="picker" aria-label="Choose what to forecast">
      <label class="field">
        <span>Commodity</span>
        <select v-model="commodity" :disabled="!optionsReady">
          <option v-for="c in commodities" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>

      <label class="field">
        <span>Market</span>
        <select v-model="market" :disabled="!markets.length">
          <option v-for="m in markets" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>

      <button class="go" :disabled="loading || !market" @click="runForecast">
        {{ loading ? 'Working…' : 'Forecast' }}
      </button>
    </section>

    <p v-if="errorMessage" class="notice" role="status">{{ errorMessage }}</p>

    <main v-if="prediction" class="result">
      <aside class="board">
        <p class="board-eyebrow">Projected · {{ monthLabel }}</p>
        <p class="price">
          <span class="currency">$</span>{{ prediction.predictedPrice.toFixed(2)
          }}<span class="per">/{{ prediction.unit }}</span>
        </p>
        <p class="delta" :class="prediction.trend">
          {{ prediction.changePct >= 0 ? '▲' : '▼' }}
          {{ Math.abs(prediction.changePct).toFixed(1) }}%
          <span>from ${{ prediction.lastPrice.toFixed(2) }} in {{ lastLabel }}</span>
        </p>

        <dl class="meta">
          <div>
            <dt>Commodity</dt>
            <dd>{{ prediction.commodity }}</dd>
          </div>
          <div>
            <dt>Market</dt>
            <dd>{{ prediction.market }}, {{ prediction.province }}</dd>
          </div>
          <div>
            <dt>Price type</dt>
            <dd>{{ prediction.pricetype }}</dd>
          </div>
        </dl>
      </aside>

      <section class="chart-panel">
        <h2>Recorded prices, and where the model expects them to go</h2>
        <PriceChart
          :dates="prediction.dates"
          :prices="prediction.prices"
          :predicted-price="prediction.predictedPrice"
          :unit="prediction.unit"
        />
      </section>
    </main>

    <footer>
      <p>
        Forecasts are model estimates, not official prices. Some series stopped reporting before
        2026 — the chart always ends at the last genuine observation.
      </p>
      <p class="credit">
        Data: WFP Food Prices for Cambodia (CC BY-IGO) · Model: gradient-boosted trees
      </p>
    </footer>
  </div>
</template>

<style scoped>
.page {
  max-width: 980px;
  margin: 0 auto;
  padding: 64px 24px 80px;
}

/* ---------- masthead ---------- */
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin: 0 0 20px;
}

h1 {
  font-family: var(--display);
  font-weight: 600;
  font-size: clamp(2.6rem, 7vw, 4.4rem);
  line-height: 1.02;
  letter-spacing: -0.025em;
  margin: 0 0 20px;
  max-width: 14ch;
}

h1 em {
  display: block;
  font-style: italic;
  font-weight: 400;
  color: var(--palm);
}

.standfirst {
  max-width: 52ch;
  margin: 0;
  color: var(--ink-soft);
  font-size: 1.02rem;
}

/* ---------- picker ---------- */
.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-end;
  margin: 44px 0 32px;
  padding: 22px;
  background: var(--chalk);
  border: var(--line);
  border-radius: var(--radius);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1 1 220px;
  min-width: 0;
}

.field span {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

select {
  width: 100%;
  padding: 11px 12px;
  background: var(--basket);
  border: 1px solid var(--basket-deep);
  border-radius: var(--radius);
  cursor: pointer;
}

select:disabled {
  opacity: 0.5;
  cursor: default;
}

.go {
  padding: 12px 26px;
  background: var(--palm);
  color: var(--chalk);
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0.01em;
  transition: background 0.15s ease;
}

.go:hover:not(:disabled) {
  background: var(--palm-light);
}

.go:disabled {
  opacity: 0.55;
  cursor: default;
}

.notice {
  padding: 14px 16px;
  background: var(--chalk);
  border-left: 3px solid var(--mangosteen);
  border-radius: var(--radius);
  color: var(--ink-soft);
  font-size: 0.94rem;
}

/* ---------- result ---------- */
.result {
  display: grid;
  grid-template-columns: minmax(240px, 300px) 1fr;
  gap: 28px;
  align-items: start;
}

.board {
  padding: 26px 24px 22px;
  background: var(--chalk);
  border: var(--line);
  border-top: 3px solid var(--palm);
  border-radius: var(--radius);
}

.board-eyebrow {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin: 0 0 14px;
}

.price {
  font-family: var(--display);
  font-size: clamp(3rem, 8vw, 3.8rem);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.03em;
  margin: 0 0 12px;
}

.currency {
  font-size: 0.5em;
  vertical-align: super;
  color: var(--ink-soft);
  margin-right: 2px;
}

.per {
  font-family: var(--mono);
  font-size: 0.9rem;
  font-weight: 400;
  color: var(--ink-soft);
  letter-spacing: 0;
}

.delta {
  font-family: var(--mono);
  font-size: 0.86rem;
  margin: 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.delta.up {
  color: var(--turmeric);
}

.delta.down {
  color: var(--mangosteen);
}

.delta.stable {
  color: var(--ink-soft);
}

.delta span {
  color: var(--ink-soft);
  font-size: 0.78rem;
}

.meta {
  margin: 0;
  padding-top: 18px;
  border-top: var(--line);
  display: grid;
  gap: 12px;
}

.meta div {
  display: grid;
  gap: 2px;
}

.meta dt {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.meta dd {
  margin: 0;
  font-size: 0.9rem;
}

.chart-panel {
  padding: 26px 24px;
  background: var(--chalk);
  border: var(--line);
  border-radius: var(--radius);
}

.chart-panel h2 {
  font-family: var(--display);
  font-weight: 400;
  font-size: 1.08rem;
  margin: 0 0 22px;
  color: var(--ink-soft);
  max-width: 40ch;
}

/* ---------- footer ---------- */
footer {
  margin-top: 52px;
  padding-top: 22px;
  border-top: var(--line);
  color: var(--ink-soft);
  font-size: 0.84rem;
}

footer p {
  margin: 0 0 8px;
  max-width: 62ch;
}

.credit {
  font-family: var(--mono);
  font-size: 0.74rem;
}

@media (max-width: 760px) {
  .page {
    padding: 40px 18px 60px;
  }

  .result {
    grid-template-columns: 1fr;
  }

  .go {
    flex: 1 1 100%;
  }
}
</style>
