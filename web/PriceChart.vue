<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  dates: string[]
  prices: number[]
  predictedPrice: number
  unit: string
}>()

/**
 * On a phone the SVG scales down, which would shrink label text to an unreadable
 * ~5px. Using a narrower viewBox on small screens keeps the type proportionally
 * larger instead of relying on font sizes that don't survive the scale-down.
 */
const compact = ref(false)
let query: MediaQueryList | null = null
const sync = (e: MediaQueryList | MediaQueryListEvent) => (compact.value = e.matches)

onMounted(() => {
  query = window.matchMedia('(max-width: 760px)')
  sync(query)
  query.addEventListener('change', sync)
})
onUnmounted(() => query?.removeEventListener('change', sync))

const W = computed(() => (compact.value ? 400 : 720))
const H = computed(() => (compact.value ? 250 : 260))
const PAD = computed(() =>
  compact.value
    ? { top: 22, right: 58, bottom: 34, left: 48 }
    : { top: 24, right: 60, bottom: 34, left: 52 },
)

/**
 * The chart's job is to make the observed/predicted boundary unmistakable:
 * recorded prices are a solid line, the forecast is a dashed segment ending
 * in a hollow ring. Never let the two read as the same kind of fact.
 */
const geometry = computed(() => {
  const observed = props.prices
  const all = [...observed, props.predictedPrice]

  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = (max - min || max || 1) * 0.18
  const lo = Math.max(0, min - pad)
  const hi = max + pad

  const pad2 = PAD.value
  const plotW = W.value - pad2.left - pad2.right
  const plotH = H.value - pad2.top - pad2.bottom
  const steps = all.length - 1 || 1

  const x = (i: number) => pad2.left + (i / steps) * plotW
  const y = (v: number) => pad2.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH

  const observedPoints = observed.map((v, i) => ({ x: x(i), y: y(v), v }))
  const last = observedPoints[observedPoints.length - 1]
  const forecast = { x: x(all.length - 1), y: y(props.predictedPrice), v: props.predictedPrice }

  return {
    observedPath: observedPoints.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    areaPath:
      `M${observedPoints[0].x.toFixed(1)},${(H.value - pad2.bottom).toFixed(1)} ` +
      observedPoints.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
      ` L${last.x.toFixed(1)},${(H.value - pad2.bottom).toFixed(1)} Z`,
    observedPoints,
    last,
    forecast,
    ticks: [hi, (hi + lo) / 2, lo].map((v) => ({ v, y: y(v) })),
    baseline: H.value - pad2.bottom,
  }
})

const rising = computed(() => props.predictedPrice >= props.prices[props.prices.length - 1])

function shortDate(iso: string) {
  const [year, month] = iso.split('-')
  return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month)]} ${year.slice(2)}`
}
</script>

<template>
  <figure class="chart">
    <svg :class="{ compact }" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`Price history and forecast in US dollars per ${unit}`">
      <!-- horizontal guides -->
      <g class="guides">
        <line v-for="t in geometry.ticks" :key="t.v" :x1="PAD.left" :x2="W - PAD.right" :y1="t.y" :y2="t.y" />
      </g>

      <!-- value labels -->
      <g class="axis">
        <text v-for="t in geometry.ticks" :key="`l-${t.v}`" :x="PAD.left - 10" :y="t.y + 4" text-anchor="end">
          ${{ t.v.toFixed(2) }}
        </text>
      </g>

      <path class="area" :d="geometry.areaPath" />
      <path class="observed" :d="geometry.observedPath" />

      <!-- the signature: forecast as a dashed leap past the last real reading -->
      <path
        class="projection"
        :class="{ falling: !rising }"
        :d="`M${geometry.last.x},${geometry.last.y} L${geometry.forecast.x},${geometry.forecast.y}`"
      />

      <circle
        v-for="p in geometry.observedPoints"
        :key="`${p.x}-${p.y}`"
        class="dot"
        :cx="p.x"
        :cy="p.y"
        r="2.5"
      />
      <circle class="forecast-dot" :class="{ falling: !rising }" :cx="geometry.forecast.x" :cy="geometry.forecast.y" r="6" />

      <text class="forecast-label" :x="geometry.forecast.x + 12" :y="geometry.forecast.y + 4">
        ${{ predictedPrice.toFixed(2) }}
      </text>

      <!-- date bookends only: a label per point would be unreadable at this width -->
      <g class="axis">
        <text :x="PAD.left" :y="geometry.baseline + 22" text-anchor="start">{{ shortDate(dates[0]) }}</text>
        <text :x="geometry.last.x" :y="geometry.baseline + 22" text-anchor="middle">
          {{ shortDate(dates[dates.length - 1]) }}
        </text>
      </g>
    </svg>

    <figcaption>
      <span class="key"><i class="swatch solid" /> recorded</span>
      <span class="key"><i class="swatch dashed" /> forecast</span>
      <span class="unit">US$ per {{ unit }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
}

svg {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}

.guides line {
  stroke: var(--basket-deep);
  stroke-width: 1;
}

.axis text {
  font-family: var(--mono);
  font-size: 11px;
  fill: var(--ink-soft);
}

.compact .axis text {
  font-size: 13px;
}

.compact .forecast-label {
  font-size: 15px;
}

.area {
  fill: var(--palm);
  opacity: 0.07;
}

.observed {
  fill: none;
  stroke: var(--palm);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.dot {
  fill: var(--palm);
}

.projection {
  fill: none;
  stroke: var(--turmeric);
  stroke-width: 2.5;
  stroke-dasharray: 5 5;
  stroke-linecap: round;
  animation: draw 0.6s ease-out;
}

.projection.falling {
  stroke: var(--mangosteen);
}

.forecast-dot {
  fill: var(--chalk);
  stroke: var(--turmeric);
  stroke-width: 2.5;
}

.forecast-dot.falling {
  stroke: var(--mangosteen);
}

.forecast-label {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 500;
  fill: var(--ink);
}

@keyframes draw {
  from {
    stroke-dashoffset: 40;
    opacity: 0;
  }
  to {
    stroke-dashoffset: 0;
    opacity: 1;
  }
}

figcaption {
  display: flex;
  gap: 18px;
  align-items: center;
  margin-top: 14px;
  font-size: 12px;
  color: var(--ink-soft);
  flex-wrap: wrap;
}

.key {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.swatch {
  width: 20px;
  height: 0;
  border-top: 2px solid var(--palm);
}

.swatch.dashed {
  border-top: 2px dashed var(--turmeric);
}

.unit {
  margin-left: auto;
  font-family: var(--mono);
}
</style>
