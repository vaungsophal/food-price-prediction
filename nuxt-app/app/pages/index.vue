<script setup lang="ts">
import type { Forecast } from '~~/server/utils/engine'

const DEFAULT_COMMODITY = 'Rice (mixed, low quality)'
const DEFAULT_MARKET = 'Phnom Penh'

interface Options {
  commodities: string[]
  marketsByCommodity: Record<string, string[]>
}

const route = useRoute()

const { data: options } = await useFetch<Options>('/api/options')

/** Telegram links back here with ?commodity=&market=, so honour those on first load. */
const queryCommodity = typeof route.query.commodity === 'string' ? route.query.commodity : ''
const queryMarket = typeof route.query.market === 'string' ? route.query.market : ''

const commodity = ref(queryCommodity || DEFAULT_COMMODITY)
const market = ref(queryMarket || DEFAULT_MARKET)

/** What the chart is currently showing, as opposed to what the dropdowns are set to. */
const applied = ref({ commodity: commodity.value, market: market.value })

const {
  data: forecast,
  error,
  status,
  refresh,
} = await useFetch<Forecast>('/api/predict', {
  query: applied,
  // Rendered on the server so the chart is on screen at first paint, with no loading flash.
  server: true,
})

const markets = computed(() => options.value?.marketsByCommodity[commodity.value] ?? [])

/**
 * Not every market sells every commodity, so switching commodity can strand the market
 * selection on something that has no data. Move it to a market that does.
 */
watch(commodity, () => {
  if (markets.value.length && !markets.value.includes(market.value)) {
    market.value = markets.value.includes(DEFAULT_MARKET) ? DEFAULT_MARKET : markets.value[0]!
  }
})

const dirty = computed(
  () => commodity.value !== applied.value.commodity || market.value !== applied.value.market,
)

const pending = computed(() => status.value === 'pending')

function submit() {
  applied.value = { commodity: commodity.value, market: market.value }
}

/**
 * Two failures are worth telling apart: the commodity genuinely isn't sold at that market
 * (actionable — here are the markets that do have it), and the service didn't answer
 * (not the user's fault, and retrying is the right move).
 */
const failure = computed(() => {
  if (!error.value) return null
  const payload = (error.value.data as { data?: { error?: string, suggestions?: string[] } } | undefined)?.data
  if (payload?.error) {
    return { message: payload.error, suggestions: payload.suggestions ?? [], retry: false }
  }
  return {
    message: 'The forecast service didn\'t answer. Nothing was lost — try again.',
    suggestions: [],
    retry: true,
  }
})

function chooseMarket(name: string) {
  market.value = name
  submit()
}

const money = (value: number) => `$${value.toFixed(3)}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(iso: string): string {
  const [year, month] = iso.split('-')
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`
}

const nextPeriod = computed(() => {
  if (!forecast.value) return ''
  const [year, month] = forecast.value.lastDate.split('-').map(Number)
  const next = (month! % 12) + 1
  return `${MONTHS[next - 1]} ${next === 1 ? year! + 1 : year}`
})

useHead({
  title: () =>
    forecast.value
      ? `${forecast.value.commodity} · ${forecast.value.market} — Cambodia Food Price Forecast`
      : 'Cambodia Food Price Forecast',
})
</script>

<template>
  <div class="page">
    <header class="masthead">
      <p class="eyebrow">WFP price monitoring · Cambodia</p>
      <h1>
        What the market<br>
        <em>will ask next</em>
      </h1>
      <p class="standfirst">
        Next-period price forecasts for
        <strong>{{ options?.commodities.length ?? 46 }}</strong> commodities across
        <strong>76</strong> markets, from a gradient-boosted model trained on World Food
        Programme observations.
      </p>
    </header>

    <form class="controls" @submit.prevent="submit">
      <div class="field">
        <label class="eyebrow" for="commodity">Commodity</label>
        <select id="commodity" v-model="commodity">
          <option v-for="name in options?.commodities ?? []" :key="name" :value="name">
            {{ name }}
          </option>
        </select>
      </div>

      <div class="field">
        <label class="eyebrow" for="market">Market</label>
        <select id="market" v-model="market">
          <option v-for="name in markets" :key="name" :value="name">
            {{ name }}
          </option>
        </select>
      </div>

      <button type="submit" :disabled="pending || (!dirty && !error)">
        {{ pending ? 'Working…' : 'Forecast' }}
      </button>
    </form>

    <section v-if="failure" class="board board--failure">
      <p class="eyebrow">No forecast</p>
      <p class="failure-message">{{ failure.message }}</p>

      <template v-if="failure.suggestions.length">
        <p class="failure-hint">It is tracked at these markets:</p>
        <ul class="suggestions">
          <li v-for="name in failure.suggestions" :key="name">
            <button type="button" class="chip" @click="chooseMarket(name)">{{ name }}</button>
          </li>
        </ul>
      </template>

      <button v-if="failure.retry" type="button" class="retry" @click="refresh()">
        Try again
      </button>
    </section>

    <template v-else-if="forecast">
      <section class="board" :class="`board--${forecast.trend}`">
        <div class="board__identity">
          <p class="eyebrow">{{ forecast.market }}, {{ forecast.province }} · {{ forecast.pricetype }}</p>
          <h2>{{ forecast.commodity }}</h2>
        </div>

        <dl class="figures">
          <div class="figure">
            <dt class="eyebrow">Last recorded · {{ monthLabel(forecast.lastDate) }}</dt>
            <dd class="mono">{{ money(forecast.lastPrice) }}</dd>
          </div>
          <div class="figure figure--lead">
            <dt class="eyebrow">Forecast · {{ nextPeriod }}</dt>
            <dd class="mono">{{ money(forecast.predictedPrice) }}</dd>
          </div>
          <div class="figure">
            <dt class="eyebrow">Change</dt>
            <dd class="mono change">
              <span aria-hidden="true">{{ forecast.trend === 'up' ? '▲' : forecast.trend === 'down' ? '▼' : '▬' }}</span>
              {{ forecast.changePct >= 0 ? '+' : '' }}{{ forecast.changePct.toFixed(1) }}%
            </dd>
          </div>
        </dl>

        <p class="per-unit mono">per {{ forecast.unit }}, USD</p>
      </section>

      <section class="card">
        <PriceChart
          :dates="forecast.dates"
          :prices="forecast.prices"
          :predicted-price="forecast.predictedPrice"
          :unit="forecast.unit"
          :trend="forecast.trend"
        />
      </section>
    </template>

    <footer class="footnote">
      <p>
        Forecasts are model estimates, not official prices. Each one projects a single
        reporting period past the last genuine observation for that commodity and market.
      </p>
      <p>
        Some series stopped reporting well before 2026, so a chart may end in
        <span class="mono">2022</span> — that is the real end of the record, not a gap in
        this page. No dates are invented.
      </p>
      <p class="colophon mono">
        Source: WFP food prices, Cambodia · XGBoost, 400 trees, traversed in TypeScript
      </p>
    </footer>
  </div>
</template>

<style scoped>
.page {
  max-width: 860px;
  margin: 0 auto;
  padding: clamp(32px, 7vw, 72px) clamp(18px, 5vw, 32px) 64px;
  display: flex;
  flex-direction: column;
  gap: clamp(24px, 4vw, 36px);
}

/* --- Masthead --- */

.masthead h1 {
  font-size: clamp(2.5rem, 9vw, 4.25rem);
  margin: 10px 0 0;
}

.masthead h1 em {
  font-style: italic;
  font-weight: 400;
  color: var(--palm);
}

.standfirst {
  max-width: 54ch;
  margin-top: 18px;
  color: var(--ink-soft);
  font-size: 1.0625rem;
}

.standfirst strong {
  color: var(--ink);
  font-weight: 500;
  font-family: var(--mono);
  font-size: 0.95em;
}

/* --- Controls --- */

.controls {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
  gap: 14px;
  align-items: end;
  padding: 18px;
  background: var(--chalk);
  border: 1px solid var(--basket-deep);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

select {
  appearance: none;
  width: 100%;
  padding: 11px 34px 11px 12px;
  font: inherit;
  font-size: 0.9375rem;
  color: var(--ink);
  background: var(--chalk);
  background-image: linear-gradient(45deg, transparent 50%, var(--palm) 50%),
    linear-gradient(135deg, var(--palm) 50%, transparent 50%);
  background-position: calc(100% - 18px) calc(50% + 2px), calc(100% - 13px) calc(50% + 2px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  border: 1px solid var(--basket-deep);
  border-radius: var(--radius);
  cursor: pointer;
  text-overflow: ellipsis;
}

select:hover {
  border-color: var(--palm-light);
}

button[type='submit'] {
  padding: 12px 26px;
  font: inherit;
  font-family: var(--mono);
  font-size: 0.8125rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--chalk);
  background: var(--palm);
  border: 1px solid var(--palm);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background-color 140ms ease;
}

button[type='submit']:hover:not(:disabled) {
  background: var(--palm-light);
}

button[type='submit']:disabled {
  opacity: 0.45;
  cursor: default;
}

/* --- Price board --- */

.board {
  padding: clamp(20px, 4vw, 30px);
  background: var(--chalk);
  border: 1px solid var(--basket-deep);
  border-left: 4px solid var(--palm);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.board--up {
  border-left-color: var(--turmeric);
}

.board--down {
  border-left-color: var(--mangosteen);
}

.board__identity h2 {
  font-size: clamp(1.5rem, 4.5vw, 2rem);
  margin-top: 6px;
}

.figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 22px;
  margin: 26px 0 0;
  padding-top: 22px;
  border-top: 1px solid var(--basket-deep);
}

.figure dd {
  margin: 4px 0 0;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}

.figure--lead dd {
  font-size: 2.25rem;
  color: var(--palm);
}

.board--up .figure--lead dd,
.board--up .change {
  color: #a06d05;
}

.board--down .figure--lead dd,
.board--down .change {
  color: var(--mangosteen);
}

.change span {
  font-size: 0.8em;
}

.per-unit {
  margin-top: 14px;
  font-size: 0.75rem;
  color: var(--ink-soft);
  letter-spacing: 0.04em;
}

/* --- Failure --- */

.board--failure {
  border-left-color: var(--mangosteen);
}

.failure-message {
  margin-top: 8px;
  font-family: var(--display);
  font-size: 1.375rem;
  line-height: 1.3;
}

.failure-hint {
  margin-top: 18px;
  color: var(--ink-soft);
  font-size: 0.9375rem;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.chip,
.retry {
  font: inherit;
  font-size: 0.875rem;
  padding: 7px 14px;
  color: var(--palm);
  background: var(--basket);
  border: 1px solid var(--basket-deep);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}

.chip:hover,
.retry:hover {
  border-color: var(--palm);
  color: var(--ink);
}

.retry {
  margin-top: 18px;
  border-radius: var(--radius);
}

/* --- Chart card --- */

.card {
  padding: clamp(16px, 3vw, 24px);
  background: var(--chalk);
  border: 1px solid var(--basket-deep);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

/* --- Footnote --- */

.footnote {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 62ch;
  color: var(--ink-soft);
  font-size: 0.875rem;
}

.colophon {
  margin-top: 6px;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  opacity: 0.8;
}

@media (max-width: 620px) {
  .controls {
    grid-template-columns: 1fr;
  }

  button[type='submit'] {
    width: 100%;
  }
}
</style>
