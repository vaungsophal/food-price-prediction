<script setup lang="ts">
/**
 * Hand-rolled SVG, no charting library — because the one thing that matters here is the
 * thing a library would smooth away: recorded prices are a solid line, the forecast is a
 * dashed segment ending in a hollow ring. Drawing both as one continuous stroke would
 * imply the prediction is as solid as the observations. It isn't.
 */

const props = defineProps<{
  dates: string[]
  prices: number[]
  predictedPrice: number
  unit: string
  trend: 'up' | 'down' | 'stable'
  /** "YYYY-MM" of the month being forecast. */
  targetPeriod: string
}>()

/**
 * Under 760px the SVG scales down and 11px labels land at roughly 5px. Shrinking the type
 * further makes it worse, so the fix is a narrower viewBox: the same drawing in a smaller
 * coordinate space means the type is proportionally larger once it scales to fit.
 */
const narrow = ref(false)

onMounted(() => {
  const query = window.matchMedia('(max-width: 760px)')
  narrow.value = query.matches
  const update = (event: MediaQueryListEvent) => (narrow.value = event.matches)
  query.addEventListener('change', update)
  onBeforeUnmount(() => query.removeEventListener('change', update))
})

const box = computed(() =>
  narrow.value
    ? { w: 400, h: 250, left: 46, right: 16, top: 18, bottom: 34, label: 11, dot: 3.5, ring: 5.5, stroke: 2.2 }
    : { w: 720, h: 300, left: 62, right: 26, top: 24, bottom: 42, label: 11, dot: 3, ring: 5, stroke: 2 },
)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2022-06" -> "Jun 2022" */
function monthLabel(iso: string): string {
  const [year, month] = iso.split('-')
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`
}

/** The period the forecast covers. Comes from the server so the axis cannot drift from the card. */
const forecastLabel = computed(() => monthLabel(props.targetPeriod))

const geometry = computed(() => {
  const { w, h, left, right, top, bottom } = box.value
  const prices = props.prices
  const slots = prices.length // observed points occupy slots 0..n-1, forecast sits at n
  const plotW = w - left - right
  const plotH = h - top - bottom

  const all = [...prices, props.predictedPrice]
  const rawMin = Math.min(...all)
  const rawMax = Math.max(...all)
  const pad = (rawMax - rawMin || rawMax || 1) * 0.15
  const min = Math.max(0, rawMin - pad)
  const max = rawMax + pad

  const x = (i: number) => left + (slots === 0 ? 0 : (i / slots) * plotW)
  const y = (v: number) => top + plotH - ((v - min) / (max - min || 1)) * plotH

  const observed = prices.map((p, i) => ({ x: x(i), y: y(p), price: p, date: props.dates[i]! }))
  const lastPoint = observed[observed.length - 1]!
  const forecast = { x: x(slots), y: y(props.predictedPrice) }

  // Four gridlines, labelled with real prices rather than round numbers — the range is
  // narrow enough that rounded ticks would collapse onto each other.
  const ticks = [0, 1, 2, 3].map((i) => {
    const value = min + ((max - min) * i) / 3
    return { value, y: y(value) }
  })

  return {
    observed,
    lastPoint,
    forecast,
    ticks,
    baseline: top + plotH,
    path: observed.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
  }
})

const forecastColor = computed(() => (props.trend === 'down' ? 'var(--mangosteen)' : 'var(--turmeric)'))

const summary = computed(() => {
  const first = props.dates[0]
  const last = props.dates[props.dates.length - 1]
  return (
    `Line chart. ${props.prices.length} recorded prices per ${props.unit} from ${monthLabel(first ?? '')} to `
    + `${monthLabel(last ?? '')}, ranging $${Math.min(...props.prices).toFixed(3)} to `
    + `$${Math.max(...props.prices).toFixed(3)}. Forecast for ${forecastLabel.value}: `
    + `$${props.predictedPrice.toFixed(3)}, trending ${props.trend}.`
  )
})

const formatTick = (value: number) => (value >= 10 ? value.toFixed(1) : value.toFixed(2))
</script>

<template>
  <figure class="chart">
    <svg
      :viewBox="`0 0 ${box.w} ${box.h}`"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      :aria-label="summary"
    >
      <!-- Guides -->
      <g class="mono">
        <line
          v-for="tick in geometry.ticks"
          :key="`grid-${tick.value}`"
          :x1="box.left"
          :x2="box.w - box.right"
          :y1="tick.y"
          :y2="tick.y"
          stroke="var(--basket-deep)"
          stroke-width="1"
        />
        <text
          v-for="tick in geometry.ticks"
          :key="`tick-${tick.value}`"
          :x="box.left - 8"
          :y="tick.y + box.label * 0.35"
          text-anchor="end"
          :font-size="box.label"
          fill="var(--ink-soft)"
        >${{ formatTick(tick.value) }}</text>
      </g>

      <!-- Where the record stops and the model starts. -->
      <line
        :x1="geometry.lastPoint.x"
        :x2="geometry.lastPoint.x"
        :y1="box.top"
        :y2="geometry.baseline"
        stroke="var(--basket-deep)"
        stroke-width="1"
        stroke-dasharray="2 4"
      />

      <!-- Recorded prices: one solid, continuous stroke. -->
      <path
        :d="geometry.path"
        fill="none"
        stroke="var(--palm)"
        :stroke-width="box.stroke"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="point in geometry.observed"
        :key="point.date"
        :cx="point.x"
        :cy="point.y"
        :r="box.dot * 0.6"
        fill="var(--palm)"
        opacity="0.55"
      />
      <circle
        :cx="geometry.lastPoint.x"
        :cy="geometry.lastPoint.y"
        :r="box.dot"
        fill="var(--palm)"
      />

      <!-- The forecast: dashed, and it ends in a hollow ring rather than a filled dot. -->
      <line
        :x1="geometry.lastPoint.x"
        :y1="geometry.lastPoint.y"
        :x2="geometry.forecast.x"
        :y2="geometry.forecast.y"
        :stroke="forecastColor"
        :stroke-width="box.stroke"
        stroke-dasharray="5 4"
        stroke-linecap="round"
      />
      <circle
        :cx="geometry.forecast.x"
        :cy="geometry.forecast.y"
        :r="box.ring"
        fill="var(--chalk)"
        :stroke="forecastColor"
        :stroke-width="box.stroke"
      />

      <!--
        Axis carries the two ends of the visible range. The last recorded month can't go
        here too: the final observation sits within about 25px of the forecast point, so a
        third label on this row lands on top of the amber one. It annotates the boundary
        rule instead, where there is nothing to collide with.
      -->
      <g class="mono" :font-size="box.label" fill="var(--ink-soft)">
        <text :x="box.left" :y="geometry.baseline + box.label + 8" text-anchor="start">
          {{ monthLabel(props.dates[0] ?? '') }}
        </text>
        <text
          :x="box.w - box.right"
          :y="geometry.baseline + box.label + 8"
          text-anchor="end"
          :fill="forecastColor"
        >
          {{ forecastLabel }}
        </text>
        <text
          :x="geometry.lastPoint.x - 6"
          :y="box.top - 5"
          text-anchor="end"
          fill="var(--ink)"
        >
          {{ monthLabel(props.dates[props.dates.length - 1] ?? '') }}
        </text>
      </g>
    </svg>

    <figcaption>
      <span class="key">
        <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--palm)" stroke-width="2" stroke-linecap="round" /></svg>
        Recorded
      </span>
      <span class="key">
        <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" :stroke="forecastColor" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" /></svg>
        Forecast
      </span>
      <span class="unit mono">USD / {{ unit }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
}

svg {
  display: block;
  width: 100%;
  height: auto;
}

figcaption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 20px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--basket-deep);
  font-size: 0.8125rem;
  color: var(--ink-soft);
}

.key {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.key svg {
  width: 26px;
  flex: none;
}

.unit {
  margin-left: auto;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
}

@media (max-width: 480px) {
  .unit {
    margin-left: 0;
    width: 100%;
  }
}
</style>
