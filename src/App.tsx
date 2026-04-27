import { useState, useMemo, useEffect, useCallback, useRef, type ReactElement } from 'react'
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts'
import quantumLogo from './assets/quantum-logo.png'
import './App.css'

// ── Model constants ────────────────────────────────────────────────────────────
const K = 565                        // fair-value constant ($ billions per million DAA²)
const ETH_SUPPLY = 120_500_000       // circulating supply
const ETH_PRICE_FALLBACK = 2309.77   // used until live price loads
const DAA_FALLBACK = 885_491         // used until live DAA loads

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'

// VITE_GLASSNODE_KEY must be set in .env.local
// Get a free key at https://studio.glassnode.com/settings/api
const GLASSNODE_KEY = import.meta.env.VITE_GLASSNODE_KEY as string | undefined
const GLASSNODE_URL = GLASSNODE_KEY
  ? `https://api.glassnode.com/v1/metrics/addresses/active_count?a=ETH&i=24h&limit=1&api_key=${GLASSNODE_KEY}`
  : null

// Slider: log scale 100K → 5M
const LOG_MIN = Math.log10(100_000)
const LOG_MAX = Math.log10(5_000_000)
function sliderToDaa(v: number): number {
  return Math.round(Math.pow(10, LOG_MIN + (v / 100) * (LOG_MAX - LOG_MIN)))
}
function daaToSlider(daa: number): number {
  return ((Math.log10(daa) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100
}

function fairValueAtDaa(daa: number): number {
  const daaM = daa / 1_000_000
  return (K * daaM * daaM * 1_000_000_000) / ETH_SUPPLY
}
function breakEvenDaa(price: number): number {
  return Math.sqrt((price * ETH_SUPPLY) / (K * 1_000_000_000)) * 1_000_000
}

// Chart data: linear X 0 → 3M DAA (static — only fairValue curve, no price dependency)
const CHART_MAX_DAA = 3_000_000
const CHART_DATA = Array.from({ length: 301 }, (_, i) => {
  const daa = (i / 300) * CHART_MAX_DAA
  return { daa, fairValue: daa < 50_000 ? 0 : Math.round(fairValueAtDaa(daa)) }
})

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtDAA(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  if (n >= 1_000) return Math.round(n / 1_000) + 'K'
  return n.toLocaleString()
}
function fmtUSD(n: number, decimals = 2): string {
  if (n >= 1_000_000_000_000) return '$' + (n / 1_000_000_000_000).toFixed(2) + 'T'
  if (n >= 1_000_000_000)     return '$' + (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000)         return '$' + (n / 1_000_000).toFixed(2) + 'M'
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtYAxis(v: number): string {
  return v >= 1_000 ? '$' + Math.round(v / 1_000) + 'K' : '$' + v
}

// ── Types ─────────────────────────────────────────────────────────────────────
type LiveStatus = 'loading' | 'live' | 'error'
type TooltipProps = {
  active?: boolean
  payload?: ReadonlyArray<{ payload: { daa: number; fairValue: number } }>
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useIsMobile(breakpoint = 700) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= breakpoint)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])
  return isMobile
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const isMobile = useIsMobile()
  // ── ETH price (CoinGecko, every 60s) ──────────────────────────────────────
  const [ethPrice, setEthPrice]         = useState(ETH_PRICE_FALLBACK)
  const [priceStatus, setPriceStatus]   = useState<LiveStatus>('loading')
  const [priceUpdated, setPriceUpdated] = useState<Date | null>(null)

  const fetchPrice = useCallback(() => {
    fetch(COINGECKO_URL)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(data => {
        setEthPrice(data.ethereum.usd)
        setPriceStatus('live')
        setPriceUpdated(new Date())
      })
      .catch(() => setPriceStatus(p => p === 'loading' ? 'error' : p))
  }, [])

  useEffect(() => {
    fetchPrice()
    const id = setInterval(fetchPrice, 60_000)
    return () => clearInterval(id)
  }, [fetchPrice])

  // ── DAA (Glassnode, every 6h) ──────────────────────────────────────────────
  const [daaBaseline, setDaaBaseline]   = useState(DAA_FALLBACK)
  const [daaStatus, setDaaStatus]       = useState<LiveStatus>(GLASSNODE_KEY ? 'loading' : 'error')
  const [daaUpdated, setDaaUpdated]     = useState<Date | null>(null)

  const fetchDaa = useCallback(() => {
    if (!GLASSNODE_URL) { setDaaStatus('error'); return }
    fetch(GLASSNODE_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data: Array<{ t: number; v: number }>) => {
        const val = data[data.length - 1]?.v
        if (!val) throw new Error('empty')
        setDaaBaseline(Math.round(val))
        setDaaStatus('live')
        setDaaUpdated(new Date())
      })
      .catch(() => setDaaStatus(p => p === 'loading' ? 'error' : p))
  }, [])

  useEffect(() => {
    fetchDaa()
    const id = setInterval(fetchDaa, 6 * 60 * 60_000) // every 6h
    return () => clearInterval(id)
  }, [fetchDaa])

  // ── Slider ─────────────────────────────────────────────────────────────────
  const [sliderVal, setSliderVal] = useState(() => daaToSlider(DAA_FALLBACK))
  const hasUserMoved  = useRef(false)
  const hasSnapped    = useRef(false)

  // Snap slider to live DAA on first successful fetch (if user hasn't touched it)
  useEffect(() => {
    if (daaStatus === 'live' && !hasSnapped.current && !hasUserMoved.current) {
      setSliderVal(daaToSlider(daaBaseline))
      hasSnapped.current = true
    }
  }, [daaStatus, daaBaseline])

  // ── Derived values ─────────────────────────────────────────────────────────
  const daaBreakeven      = useMemo(() => breakEvenDaa(ethPrice), [ethPrice])
  const baselineFairValue = useMemo(() => fairValueAtDaa(daaBaseline), [daaBaseline])

  const { daa, fairValue, impliedMarketCap, discountPct, isAtBaseline, isUndervalued } =
    useMemo(() => {
      const daa             = sliderToDaa(sliderVal)
      const fairValue       = fairValueAtDaa(daa)
      const impliedMarketCap = fairValue * ETH_SUPPLY
      const discountPct     = ((fairValue - ethPrice) / fairValue) * 100
      const isAtBaseline    = Math.abs(daa - daaBaseline) / daaBaseline < 0.015
      const isUndervalued   = fairValue > ethPrice
      return { daa, fairValue, impliedMarketCap, discountPct, isAtBaseline, isUndervalued }
    }, [sliderVal, ethPrice, daaBaseline])

  // Stable tooltip that closes over current ethPrice
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartTooltip = useMemo(() => (props: any) => <ChartTooltip {...props} ethPrice={ethPrice} />, [ethPrice])

  const MARKS = useMemo(() => [
    { label: '100K', daa: 100_000 },
    { label: '250K', daa: 250_000 },
    { label: '500K', daa: 500_000 },
    { label: fmtDAA(daaBaseline), daa: daaBaseline, isNow: true },
    { label: '2M',   daa: 2_000_000 },
    { label: '5M',   daa: 5_000_000 },
  ], [daaBaseline])

  return (
    <div className="app">
      <header className="header">
        <div className="logo-wrap">
          <img src={quantumLogo} alt="Quantum" className="logo" />
        </div>
        <span className="header-divider" />
        <span className="header-title">Metcalfe's Law Calculator</span>
      </header>

      <main className="main">
        {/* ── Intro ── */}
        <section className="intro">
          <div className="eth-badge">
            <EthIcon />
            <span>Ethereum</span>
          </div>
          <h1>ETH is Trading at a Discount to Fair Value</h1>
          <p className="intro-text">
            Using a fair-value constant of <strong>k = 565</strong>, Metcalfe's
            Law implies ETH should be worth{' '}
            <strong>{fmtUSD(baselineFairValue, 0)}</strong> at today's{' '}
            <strong>{fmtDAA(daaBaseline)} daily active addresses</strong> — a{' '}
            <strong>
              {(((baselineFairValue - ethPrice) / baselineFairValue) * 100).toFixed(1)}%
              {' '}discount
            </strong>{' '}
            to network fair value. Drag the slider to model growth scenarios.
          </p>
          <div className="formula-badge">
            <span className="formula">Fair Value = k × (DAA / 1M)²</span>
            <span className="formula-sub">k = 565 &nbsp;·&nbsp; anchored to long-run ETH/DAA relationship</span>
          </div>
        </section>

        {/* ── Calculator card ── */}
        <section className="calc-card">
          <div className="anchor-row">
            <div className="anchor-item">
              <span className="anchor-label">Fair-Value Constant (k)</span>
              <span className="anchor-value anchor-value--accent">565</span>
            </div>
            <div className="anchor-divider" />
            <div className="anchor-item">
              <span className="anchor-label">
                Daily Active Addresses
                <LivePill
                  status={daaStatus}
                  lastUpdated={daaUpdated}
                  noKey={!GLASSNODE_KEY}
                  onRefresh={fetchDaa}
                />
              </span>
              <span className="anchor-value">
                {daaStatus === 'loading'
                  ? <span className="price-loading">fetching…</span>
                  : fmtDAA(daaBaseline)
                }
              </span>
            </div>
            <div className="anchor-divider" />
            <div className="anchor-item">
              <span className="anchor-label">ETH Circulating Supply</span>
              <span className="anchor-value">120.5M</span>
            </div>
            <div className="anchor-divider" />
            <div className="anchor-item">
              <span className="anchor-label">
                ETH Market Price
                <LivePill
                  status={priceStatus}
                  lastUpdated={priceUpdated}
                  onRefresh={fetchPrice}
                />
              </span>
              <span className="anchor-value">
                {priceStatus === 'loading'
                  ? <span className="price-loading">fetching…</span>
                  : fmtUSD(ethPrice)
                }
              </span>
            </div>
          </div>

          <div className="price-hero">
            <div className="price-columns">
              <div className="price-col">
                <div className="price-col-label">Metcalfe Fair Value</div>
                <div className="price-col-value price-col-value--fair">
                  {fmtUSD(fairValue, 0)}
                </div>
                <div className="price-col-sub">
                  at {fmtDAA(daa)} DAA
                  {isAtBaseline && <span className="baseline-tag">today</span>}
                </div>
              </div>
              <div className="price-vs">
                <div className="vs-circle">vs</div>
              </div>
              <div className="price-col">
                <div className="price-col-label">Current Market Price</div>
                <div className="price-col-value price-col-value--market">
                  {fmtUSD(ethPrice)}
                </div>
                <div className="price-col-sub">
                  {priceStatus === 'live' ? 'live via CoinGecko' : 'Apr 27, 2026'}
                </div>
              </div>
            </div>

            <div className={`discount-badge ${isUndervalued ? 'discount-badge--under' : 'discount-badge--over'}`}>
              {isUndervalued ? (
                <>
                  <span className="discount-badge-icon">▼</span>
                  <span>
                    <strong>{Math.abs(discountPct).toFixed(1)}% discount</strong>{' '}
                    to Metcalfe fair value — ETH appears undervalued
                  </span>
                </>
              ) : (
                <>
                  <span className="discount-badge-icon">▲</span>
                  <span>
                    <strong>{Math.abs(discountPct).toFixed(1)}% premium</strong>{' '}
                    to Metcalfe fair value — ETH appears overvalued
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="slider-section">
            <div className="slider-header">
              <div>
                <span className="slider-label">Daily Active Addresses (DAA)</span>
                <span className="slider-sublabel">Break-even: {fmtDAA(daaBreakeven)} DAA</span>
              </div>
              <span className="slider-user-count">
                {fmtDAA(daa)}
                {isAtBaseline && <span className="baseline-tag">current</span>}
              </span>
            </div>
            <div className="slider-track-wrap">
              <div className="slider-with-breakeven">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.1}
                  value={sliderVal}
                  onChange={(e) => {
                    hasUserMoved.current = true
                    setSliderVal(Number(e.target.value))
                  }}
                  className="slider"
                  aria-label="Daily Active Addresses"
                  style={{
                    background: `linear-gradient(to right, ${
                      isUndervalued ? 'var(--q-blue)' : 'var(--down)'
                    } ${sliderVal}%, var(--border) ${sliderVal}%)`,
                    touchAction: 'pan-y',
                  }}
                />
                <div
                  className="breakeven-marker"
                  style={{ left: `${daaToSlider(daaBreakeven)}%` }}
                  title={`Break-even: ${fmtDAA(daaBreakeven)} DAA`}
                />
              </div>
              <div className="slider-marks">
                {MARKS.map(({ label, daa: u, isNow }) => (
                  <button
                    key={isNow ? 'now' : label}
                    className={`slider-mark ${Math.abs(daa - u) / u < 0.015 ? 'slider-mark--active' : ''}`}
                    onClick={() => {
                      hasUserMoved.current = true
                      setSliderVal(daaToSlider(u))
                    }}
                  >
                    {label}
                    {isNow && <span className="mark-now">now</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="stats-row">
            <StatBox label="Implied Market Cap" value={fmtUSD(impliedMarketCap)} highlight />
            <StatBox
              label={isUndervalued ? 'Discount to Fair Value' : 'Premium to Fair Value'}
              value={`${Math.abs(discountPct).toFixed(1)}%`}
              sub={isUndervalued ? 'ETH trades below MV' : 'ETH trades above MV'}
              sentiment={isUndervalued ? 'good' : 'bad'}
            />
            <StatBox
              label="Fair Value / Market Price"
              value={`${(fairValue / ethPrice).toFixed(2)}×`}
              sub={
                fairValue >= ethPrice
                  ? `$${(fairValue - ethPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })} upside per ETH`
                  : `$${(ethPrice - fairValue).toLocaleString(undefined, { maximumFractionDigits: 0 })} downside per ETH`
              }
            />
            <StatBox
              label="Break-even DAA"
              value={fmtDAA(daaBreakeven)}
              sub={`current: ${fmtDAA(daaBaseline)}`}
            />
          </div>
        </section>

        {/* ── Chart ── */}
        <MetcalfeChart
          selectedDaa={daa}
          selectedFairValue={fairValue}
          isUndervalued={isUndervalued}
          ethPrice={ethPrice}
          daaBaseline={daaBaseline}
          daaBreakeven={daaBreakeven}
          tooltipContent={chartTooltip}
          isMobile={isMobile}
        />

        {/* ── Explainer ── */}
        <section className="explainer">
          <h2>How the Model Works</h2>
          <div className="explainer-grid">
            <div className="explainer-card">
              <div className="explainer-icon">📐</div>
              <h3>The Formula</h3>
              <p>
                Fair Value = k × (DAA / 1M)² scaled to per-ETH price via
                circulating supply. Network value grows with the <em>square</em>{' '}
                of daily active addresses — doubling users quadruples value.
              </p>
            </div>
            <div className="explainer-card">
              <div className="explainer-icon">🔧</div>
              <h3>Why k = 565</h3>
              <p>
                k is calibrated to Ethereum's long-run price/DAA relationship.
                At k = 354, the model exactly matches today's price — but k = 565
                reflects the historically observed fair multiple, making today's
                price look discounted.
              </p>
            </div>
            <div className="explainer-card">
              <div className="explainer-icon">⚠️</div>
              <h3>Model Limits</h3>
              <p>
                Metcalfe's Law is a directional signal, not a price target. Macro
                conditions, sentiment, and protocol utility all affect realized price.
                The break-even DAA line shows where the market implicitly prices
                the network today.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-logo-wrap">
          <img src={quantumLogo} alt="Quantum" className="footer-logo" />
        </div>
        <span>
          Metcalfe's Law Calculator &nbsp;·&nbsp;
          ETH {fmtUSD(ethPrice)}{priceStatus === 'live' && <> <span className="footer-live">live</span></>}
          &nbsp;·&nbsp;
          DAA {fmtDAA(daaBaseline)}{daaStatus === 'live' && <> <span className="footer-live">live</span></>}
          &nbsp;·&nbsp; Apr 27, 2026
        </span>
      </footer>
    </div>
  )
}

// ── MetcalfeChart ─────────────────────────────────────────────────────────────
function MetcalfeChart({
  selectedDaa, selectedFairValue, isUndervalued,
  ethPrice, daaBaseline, daaBreakeven, tooltipContent, isMobile,
}: {
  selectedDaa: number; selectedFairValue: number; isUndervalued: boolean
  ethPrice: number; daaBaseline: number; daaBreakeven: number; isMobile: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tooltipContent: (props: any) => ReactElement | null
}) {
  const inRange  = selectedDaa <= CHART_MAX_DAA
  const dotColor = isUndervalued ? '#5b8ef7' : '#f05252'
  const chartHeight = isMobile ? 240 : 360
  const chartMargin = isMobile
    ? { top: 16, right: 12, bottom: 28, left: 0 }
    : { top: 24, right: 28, bottom: 36, left: 16 }
  const xTicks = isMobile
    ? [0, 1_000_000, 2_000_000, 3_000_000]
    : [0, 500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000]

  return (
    <section className="chart-card">
      <div className="chart-header">
        <div>
          <h2>Price Curve</h2>
          <p className="chart-subtitle">
            {isMobile
              ? 'Drag the slider above to move the indicator'
              : 'Metcalfe fair value vs. daily active addresses — drag the slider above to move the indicator'}
          </p>
        </div>
        <div className="chart-legend">
          <div className="legend-item"><div className="legend-swatch legend-swatch--curve" /><span>Fair Value</span></div>
          <div className="legend-item"><div className="legend-swatch legend-swatch--market" /><span>Market</span></div>
          {!isMobile && <div className="legend-item"><div className="legend-swatch legend-swatch--breakeven" /><span>Break-even</span></div>}
          <div className="legend-item"><div className="legend-swatch legend-swatch--selected" /><span>Selected</span></div>
        </div>
      </div>

      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ComposedChart data={CHART_DATA} margin={chartMargin}>
            <defs>
              <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#5b8ef7" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#5b8ef7" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1a1e30" vertical={false} />

            <XAxis
              dataKey="daa" type="number"
              domain={[0, CHART_MAX_DAA]}
              ticks={xTicks}
              tickFormatter={v => v === 0 ? '0' : fmtDAA(v)}
              tick={{ fontSize: isMobile ? 9 : 11, fill: '#3d4a68' }} tickLine={false}
              axisLine={{ stroke: '#1a1e30' }}
              label={isMobile ? undefined : { value: 'Daily Active Addresses (DAA)', position: 'insideBottom', offset: -20, fontSize: 12, fill: '#4b5680' }}
            />

            <YAxis
              tickFormatter={fmtYAxis}
              tick={{ fontSize: isMobile ? 9 : 11, fill: '#3d4a68' }} tickLine={false} axisLine={false}
              width={isMobile ? 42 : 52}
            />

            <Tooltip content={tooltipContent} cursor={{ stroke: '#1e2338', strokeWidth: 1 }} />

            <Area type="monotone" dataKey="fairValue"
              stroke="#5b8ef7" strokeWidth={2.5} fill="url(#curveGrad)" dot={false} activeDot={false} />

            {/* Market price */}
            <ReferenceLine y={ethPrice} stroke="#3d4460" strokeDasharray="6 4" strokeWidth={1.5}
              label={{ value: `Market ${fmtUSD(ethPrice, 0)}`, position: 'insideTopLeft', fontSize: isMobile ? 9 : 11, fill: '#4b5680', dy: isMobile ? -10 : -14 }} />

            {/* Break-even DAA */}
            {!isMobile && (
              <ReferenceLine x={Math.round(daaBreakeven)} stroke="#252840" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: `Break-even ${fmtDAA(daaBreakeven)}`, position: 'top', fontSize: 10, fill: '#3d4460', dy: -6 }} />
            )}

            {/* Today's live DAA */}
            <ReferenceLine x={daaBaseline} stroke="#5b8ef7" strokeDasharray="5 3" strokeWidth={1.5} strokeOpacity={0.5}
              label={{ value: isMobile ? fmtDAA(daaBaseline) : `Today ${fmtDAA(daaBaseline)}`, position: 'top', fontSize: isMobile ? 9 : 10, fill: '#5b8ef7', dy: -6 }} />

            {/* Selected DAA vertical (only when different from baseline) */}
            {inRange && Math.abs(selectedDaa - daaBaseline) / daaBaseline > 0.015 && (
              <ReferenceLine x={selectedDaa} stroke={dotColor} strokeWidth={1.5} strokeOpacity={0.45} />
            )}

            {/* Selected point dot */}
            {inRange && (
              <ReferenceDot x={selectedDaa} y={Math.round(selectedFairValue)} r={isMobile ? 5 : 7}
                fill={dotColor} stroke="#0f1220" strokeWidth={2.5}
                label={{ value: fmtUSD(selectedFairValue, 0), position: selectedFairValue > 15_000 ? 'bottom' : 'top',
                  fontSize: isMobile ? 9 : 11, fill: dotColor, fontWeight: 700, dy: selectedFairValue > 15_000 ? 14 : -10 }} />
            )}

            {/* Baseline dot */}
            <ReferenceDot x={daaBaseline} y={Math.round(fairValueAtDaa(daaBaseline))}
              r={isMobile ? 4 : 5} fill="#5b8ef7" stroke="#0f1220" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {!inRange && (
        <div className="chart-out-of-range">
          Selected DAA ({fmtDAA(selectedDaa)}) is beyond the chart range of 3M. Scroll up to see the stats.
        </div>
      )}
    </section>
  )
}

// ── ChartTooltip ──────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, ethPrice }: TooltipProps & { ethPrice: number }) {
  if (!active || !payload?.length) return null
  const { daa, fairValue } = payload[0].payload
  if (daa < 50_000) return null
  const gap = fairValue - ethPrice
  return (
    <div className="chart-tooltip">
      <div className="ct-daa">{fmtDAA(daa)} DAA</div>
      <div className="ct-row">
        <span className="ct-label">Fair Value</span>
        <span className="ct-val">{fmtUSD(fairValue, 0)}</span>
      </div>
      <div className="ct-row">
        <span className="ct-label">vs Market</span>
        <span className={`ct-val ${gap >= 0 ? 'ct-val--up' : 'ct-val--down'}`}>
          {gap >= 0 ? '+' : ''}{fmtUSD(Math.abs(gap), 0)}
        </span>
      </div>
      <div className="ct-row">
        <span className="ct-label">Discount</span>
        <span className={`ct-val ${gap >= 0 ? 'ct-val--up' : 'ct-val--down'}`}>
          {gap >= 0
            ? `${((gap / fairValue) * 100).toFixed(1)}% below MV`
            : `${((Math.abs(gap) / ethPrice) * 100).toFixed(1)}% above MV`}
        </span>
      </div>
    </div>
  )
}

// ── LivePill ──────────────────────────────────────────────────────────────────
function LivePill({ status, lastUpdated, noKey, onRefresh }: {
  status: LiveStatus; lastUpdated: Date | null; noKey?: boolean; onRefresh: () => void
}) {
  const label = noKey          ? 'add API key' :
    status === 'loading'       ? 'fetching' :
    status === 'error'         ? 'offline' :
    lastUpdated                ? `updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` :
    'live'

  return (
    <button
      className={`price-pill price-pill--${noKey ? 'error' : status}`}
      onClick={noKey ? undefined : onRefresh}
      title={noKey ? 'Add VITE_GLASSNODE_KEY to .env.local' : 'Click to refresh'}
      type="button"
    >
      <span className={`price-pill-dot ${status === 'live' && !noKey ? 'price-pill-dot--pulse' : ''}`} />
      {label}
    </button>
  )
}

// ── StatBox ───────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, highlight, sentiment }: {
  label: string; value: string; sub?: string; highlight?: boolean; sentiment?: 'good' | 'bad'
}) {
  return (
    <div className={['stat-box', highlight && 'stat-box--highlight', sentiment === 'good' && 'stat-box--good', sentiment === 'bad' && 'stat-box--bad'].filter(Boolean).join(' ')}>
      <div className="stat-box-value">{value}</div>
      {sub && <div className="stat-box-sub">{sub}</div>}
      <div className="stat-box-label">{label}</div>
    </div>
  )
}

// ── EthIcon ───────────────────────────────────────────────────────────────────
function EthIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 2L6 16.5L16 21.5L26 16.5L16 2Z" fill="currentColor" opacity="0.9" />
      <path d="M16 23.5L6 18L16 30L26 18L16 23.5Z" fill="currentColor" opacity="0.7" />
    </svg>
  )
}
