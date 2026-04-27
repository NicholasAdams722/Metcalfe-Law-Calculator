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
const ETH_SUPPLY        = 120_500_000
const ETH_PRICE_FALLBACK = 2309.77
const DAA_FALLBACK       = 885_491

type KScenario = 'bear' | 'base' | 'bull'
const K_VALUES: Record<KScenario, { k: number; label: string; hint: string }> = {
  bear: { k: 425, label: 'Bear',  hint: 'conservative' },
  base: { k: 565, label: 'Base',  hint: 'calibrated'   },
  bull: { k: 750, label: 'Bull',  hint: 'optimistic'   },
}

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'

const GLASSNODE_KEY = import.meta.env.VITE_GLASSNODE_KEY as string | undefined
const GLASSNODE_URL = GLASSNODE_KEY
  ? `https://api.glassnode.com/v1/metrics/addresses/active_count?a=ETH&i=24h&limit=1&api_key=${GLASSNODE_KEY}`
  : null

// ── Slider: log scale 100K → 5M ───────────────────────────────────────────────
const LOG_MIN = Math.log10(100_000)
const LOG_MAX = Math.log10(5_000_000)
function sliderToDaa(v: number): number {
  return Math.round(Math.pow(10, LOG_MIN + (v / 100) * (LOG_MAX - LOG_MIN)))
}
function daaToSlider(daa: number): number {
  return ((Math.log10(daa) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100
}

// ── Formula ────────────────────────────────────────────────────────────────────
function fairValueAtDaa(daa: number, k: number): number {
  const daaM = daa / 1_000_000
  return (k * daaM * daaM * 1_000_000_000) / ETH_SUPPLY
}
function breakEvenDaa(price: number, k: number): number {
  return Math.sqrt((price * ETH_SUPPLY) / (k * 1_000_000_000)) * 1_000_000
}

const CHART_MAX_DAA = 3_000_000

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

  // ── k scenario ──────────────────────────────────────────────────────────────
  const [kScenario, setKScenario] = useState<KScenario>('base')
  const k = K_VALUES[kScenario].k

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
  const [daaBaseline, setDaaBaseline] = useState(DAA_FALLBACK)
  const [daaStatus, setDaaStatus]     = useState<LiveStatus>(GLASSNODE_KEY ? 'loading' : 'error')
  const [daaUpdated, setDaaUpdated]   = useState<Date | null>(null)

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
    const id = setInterval(fetchDaa, 6 * 60 * 60_000)
    return () => clearInterval(id)
  }, [fetchDaa])

  // ── Slider ─────────────────────────────────────────────────────────────────
  const [sliderVal, setSliderVal] = useState(() => daaToSlider(DAA_FALLBACK))
  const hasUserMoved = useRef(false)
  const hasSnapped   = useRef(false)

  useEffect(() => {
    if (daaStatus === 'live' && !hasSnapped.current && !hasUserMoved.current) {
      setSliderVal(daaToSlider(daaBaseline))
      hasSnapped.current = true
    }
  }, [daaStatus, daaBaseline])

  // ── Derived values ─────────────────────────────────────────────────────────
  const daaBreakeven = useMemo(() => breakEvenDaa(ethPrice, k), [ethPrice, k])

  const { daa, fairValue, impliedMarketCap, discountPct, isAtBaseline, isUndervalued } =
    useMemo(() => {
      const daa              = sliderToDaa(sliderVal)
      const fairValue        = fairValueAtDaa(daa, k)
      const impliedMarketCap = fairValue * ETH_SUPPLY
      const discountPct      = ((fairValue - ethPrice) / fairValue) * 100
      const isAtBaseline     = Math.abs(daa - daaBaseline) / daaBaseline < 0.015
      const isUndervalued    = fairValue > ethPrice
      return { daa, fairValue, impliedMarketCap, discountPct, isAtBaseline, isUndervalued }
    }, [sliderVal, ethPrice, daaBaseline, k])

  // Chart data recomputes when k changes
  const chartData = useMemo(() =>
    Array.from({ length: 301 }, (_, i) => {
      const d = (i / 300) * CHART_MAX_DAA
      return { daa: d, fairValue: d < 50_000 ? 0 : Math.round(fairValueAtDaa(d, k)) }
    })
  , [k])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartTooltip = useMemo(() => (props: any) => <ChartTooltip {...props} ethPrice={ethPrice} />, [ethPrice])

  const MARKS = useMemo(() => [
    { label: '100K', daa: 100_000 },
    { label: '500K', daa: 500_000 },
    { label: fmtDAA(daaBaseline), daa: daaBaseline, isNow: true },
    { label: '2M',   daa: 2_000_000 },
    { label: '5M',   daa: 5_000_000 },
  ], [daaBaseline])

  return (
    <div className="app">
      <header className="header">
        <div className="logo-wrap">
          <img src={quantumLogo} alt="Quantum Capital" className="logo" />
        </div>
        <span className="header-divider" />
        <span className="header-title">Metcalfe ETH Calculator</span>
        <div className="header-pills">
          <span className="header-pill-label">ETH</span>
          <LivePill status={priceStatus} lastUpdated={priceUpdated} onRefresh={fetchPrice}
            value={priceStatus !== 'loading' ? fmtUSD(ethPrice) : undefined} />
          <span className="header-pill-label">DAA</span>
          <LivePill status={daaStatus} lastUpdated={daaUpdated} noKey={!GLASSNODE_KEY} onRefresh={fetchDaa}
            value={daaStatus === 'live' ? fmtDAA(daaBaseline) : undefined} />
        </div>
      </header>

      <main className="main">

        {/* ── 1. SCREEN ── */}
        <section className="calc-screen">
          <div className="screen-meta">
            <span className="screen-formula">FV = k × (DAA/1M)²</span>
            <span className="screen-meta-right">
              k = {k} &nbsp;·&nbsp; supply 120.5M
            </span>
          </div>

          <div className="screen-display">
            <div className="screen-col">
              <div className="screen-col-label">METCALFE FAIR VALUE</div>
              <div className="screen-col-value screen-col-value--fair">
                {fmtUSD(fairValue, 0)}
              </div>
              <div className="screen-col-sub">
                at {fmtDAA(daa)} DAA
                {isAtBaseline && <span className="baseline-tag">today</span>}
              </div>
            </div>

            <div className="screen-vs">vs</div>

            <div className="screen-col">
              <div className="screen-col-label">ETH MARKET PRICE</div>
              <div className="screen-col-value screen-col-value--market">
                {fmtUSD(ethPrice)}
              </div>
              <div className="screen-col-sub">
                {priceStatus === 'live' ? 'live · CoinGecko' : 'Apr 27, 2026'}
              </div>
            </div>
          </div>

          <div className={`screen-verdict ${isUndervalued ? 'verdict--under' : 'verdict--over'}`}>
            <span className="verdict-arrow">{isUndervalued ? '▼' : '▲'}</span>
            <span>
              <strong>{Math.abs(discountPct).toFixed(1)}%{' '}
              {isUndervalued ? 'DISCOUNT' : 'PREMIUM'}</strong>
              {' '}to Metcalfe fair value
            </span>
          </div>
        </section>

        {/* ── 2. INPUTS ── */}
        <section className="calc-panel">

          {/* k toggle */}
          <div className="input-block">
            <div className="input-row-label">
              <span className="input-label">K CONSTANT</span>
              <span className="input-hint">fair-value multiplier</span>
            </div>
            <div className="k-buttons">
              {(Object.keys(K_VALUES) as KScenario[]).map(s => (
                <button
                  key={s}
                  className={`k-btn k-btn--${s} ${kScenario === s ? 'k-btn--active' : ''}`}
                  onClick={() => setKScenario(s)}
                  type="button"
                >
                  <span className="k-btn-scenario">{K_VALUES[s].label.toUpperCase()}</span>
                  <span className="k-btn-val">${K_VALUES[s].k}</span>
                  <span className="k-btn-hint">{K_VALUES[s].hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* DAA slider */}
          <div className="input-block">
            <div className="slider-header">
              <div>
                <div className="input-row-label">
                  <span className="input-label">DAILY ACTIVE ADDRESSES</span>
                  <span className="input-hint">model input</span>
                </div>
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
                  min={0} max={100} step={0.1}
                  value={sliderVal}
                  onChange={e => {
                    hasUserMoved.current = true
                    setSliderVal(Number(e.target.value))
                  }}
                  className="slider"
                  aria-label="Daily Active Addresses"
                  style={{
                    background: `linear-gradient(to right, ${
                      isUndervalued ? 'var(--q-blue)' : 'var(--down)'
                    } ${sliderVal}%, var(--border-bright) ${sliderVal}%)`,
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
                    type="button"
                  >
                    {label}
                    {isNow && <span className="mark-now">now</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 3. OUTPUTS ── */}
        <div className="calc-outputs">
          <StatBox label="Network Value" value={fmtUSD(impliedMarketCap)} highlight />
          <StatBox
            label={isUndervalued ? 'Discount' : 'Premium'}
            value={`${Math.abs(discountPct).toFixed(1)}%`}
            sub={isUndervalued ? 'below fair value' : 'above fair value'}
            sentiment={isUndervalued ? 'good' : 'bad'}
          />
          <StatBox
            label="FV / Market"
            value={`${(fairValue / ethPrice).toFixed(2)}×`}
            sub={fairValue >= ethPrice
              ? `+$${(fairValue - ethPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })} / ETH`
              : `-$${(ethPrice - fairValue).toLocaleString(undefined, { maximumFractionDigits: 0 })} / ETH`}
          />
          <StatBox
            label="Break-even DAA"
            value={fmtDAA(daaBreakeven)}
            sub={`live: ${fmtDAA(daaBaseline)}`}
          />
        </div>

        {/* ── 4. CHART ── */}
        <MetcalfeChart
          selectedDaa={daa}
          selectedFairValue={fairValue}
          baselineFairValue={fairValueAtDaa(daaBaseline, k)}
          isUndervalued={isUndervalued}
          ethPrice={ethPrice}
          daaBaseline={daaBaseline}
          daaBreakeven={daaBreakeven}
          chartData={chartData}
          tooltipContent={chartTooltip}
          isMobile={isMobile}
        />
      </main>

      <footer className="footer">
        <div className="footer-top">
          <div className="footer-logo-wrap">
            <img src={quantumLogo} alt="Quantum Capital" className="footer-logo" />
          </div>
          <div className="footer-data">
            ETH {priceStatus !== 'loading' ? fmtUSD(ethPrice) : '—'}
            {priceStatus === 'live' && <span className="footer-live">live</span>}
            <span className="footer-sep">·</span>
            DAA {daaStatus === 'live' ? fmtDAA(daaBaseline) : '—'}
            {daaStatus === 'live' && <span className="footer-live">live</span>}
          </div>
        </div>
        <div className="footer-compliance">
          Mathematical projection from Metcalfe's Law. Not investment advice.
          Patriot Advisory Group LLC dba Quantum Capital · NH-registered RIA
        </div>
      </footer>
    </div>
  )
}

// ── MetcalfeChart ─────────────────────────────────────────────────────────────
function MetcalfeChart({
  selectedDaa, selectedFairValue, baselineFairValue, isUndervalued,
  ethPrice, daaBaseline, daaBreakeven, chartData, tooltipContent, isMobile,
}: {
  selectedDaa: number; selectedFairValue: number; baselineFairValue: number
  isUndervalued: boolean; ethPrice: number; daaBaseline: number
  daaBreakeven: number; isMobile: boolean
  chartData: Array<{ daa: number; fairValue: number }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tooltipContent: (props: any) => ReactElement | null
}) {
  const inRange    = selectedDaa <= CHART_MAX_DAA
  const dotColor   = isUndervalued ? '#5b8ef7' : '#f05252'
  const chartHeight = isMobile ? 240 : 340
  const chartMargin = isMobile
    ? { top: 16, right: 12, bottom: 12, left: 0 }
    : { top: 20, right: 24, bottom: 32, left: 12 }
  const xTicks = isMobile
    ? [0, 1_000_000, 2_000_000, 3_000_000]
    : [0, 500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000]

  return (
    <section className="chart-card">
      <div className="chart-header">
        <div>
          <h2 className="chart-title">Price Curve</h2>
          <p className="chart-subtitle">Fair value vs. DAA — drag the slider to move the dot</p>
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
          <ComposedChart data={chartData} margin={chartMargin}>
            <defs>
              <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#5b8ef7" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#5b8ef7" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1a1e30" vertical={false} />

            <XAxis
              dataKey="daa" type="number"
              domain={[0, CHART_MAX_DAA]}
              ticks={xTicks}
              tickFormatter={v => v === 0 ? '0' : fmtDAA(v)}
              tick={{ fontSize: isMobile ? 9 : 11, fill: '#4a5580' }} tickLine={false}
              axisLine={{ stroke: '#1a1e30' }}
              label={isMobile ? undefined : { value: 'Daily Active Addresses', position: 'insideBottom', offset: -18, fontSize: 11, fill: '#4a5580' }}
            />
            <YAxis
              tickFormatter={fmtYAxis}
              tick={{ fontSize: isMobile ? 9 : 11, fill: '#4a5580' }} tickLine={false} axisLine={false}
              width={isMobile ? 42 : 52}
            />

            <Tooltip content={tooltipContent} cursor={{ stroke: '#1e2338', strokeWidth: 1 }} />

            <Area type="monotone" dataKey="fairValue"
              stroke="#5b8ef7" strokeWidth={2.5} fill="url(#curveGrad)" dot={false} activeDot={false} />

            <ReferenceLine y={ethPrice} stroke="#3d4460" strokeDasharray="6 4" strokeWidth={1.5}
              label={{ value: `Market ${fmtUSD(ethPrice, 0)}`, position: 'insideTopLeft',
                fontSize: isMobile ? 9 : 11, fill: '#5a6488', dy: isMobile ? -10 : -14 }} />

            {!isMobile && (
              <ReferenceLine x={Math.round(daaBreakeven)} stroke="#252840" strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: `Break-even ${fmtDAA(daaBreakeven)}`, position: 'top', fontSize: 10, fill: '#3d4460', dy: -6 }} />
            )}

            <ReferenceLine x={daaBaseline} stroke="#5b8ef7" strokeDasharray="5 3" strokeWidth={1.5} strokeOpacity={0.5}
              label={{ value: isMobile ? fmtDAA(daaBaseline) : `Today ${fmtDAA(daaBaseline)}`,
                position: 'top', fontSize: isMobile ? 9 : 10, fill: '#5b8ef7', dy: -6 }} />

            {inRange && Math.abs(selectedDaa - daaBaseline) / daaBaseline > 0.015 && (
              <ReferenceLine x={selectedDaa} stroke={dotColor} strokeWidth={1.5} strokeOpacity={0.45} />
            )}

            {inRange && (
              <ReferenceDot x={selectedDaa} y={Math.round(selectedFairValue)} r={isMobile ? 5 : 7}
                fill={dotColor} stroke="#0b0e1a" strokeWidth={2.5}
                label={{ value: fmtUSD(selectedFairValue, 0),
                  position: selectedFairValue > 15_000 ? 'bottom' : 'top',
                  fontSize: isMobile ? 9 : 11, fill: dotColor, fontWeight: 700,
                  dy: selectedFairValue > 15_000 ? 14 : -10 }} />
            )}

            <ReferenceDot x={daaBaseline} y={Math.round(baselineFairValue)}
              r={isMobile ? 4 : 5} fill="#5b8ef7" stroke="#0b0e1a" strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {!inRange && (
        <div className="chart-out-of-range">
          DAA ({fmtDAA(selectedDaa)}) is beyond the 3M chart range — check the stats above.
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
        <span className="ct-label">Δ%</span>
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
function LivePill({ status, lastUpdated, noKey, onRefresh, value }: {
  status: LiveStatus; lastUpdated: Date | null; noKey?: boolean
  onRefresh: () => void; value?: string
}) {
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  const label = noKey ? 'no key' : status === 'loading' ? '…' : status === 'error' ? 'offline' : timeStr ?? 'live'

  return (
    <button
      className={`price-pill price-pill--${noKey ? 'error' : status}`}
      onClick={noKey ? undefined : onRefresh}
      title={noKey ? 'Add VITE_GLASSNODE_KEY to .env.local' : 'Click to refresh'}
      type="button"
    >
      <span className={`price-pill-dot ${status === 'live' && !noKey ? 'price-pill-dot--pulse' : ''}`} />
      {value && <span className="price-pill-value">{value}</span>}
      <span className="price-pill-time">{label}</span>
    </button>
  )
}

// ── StatBox ───────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, highlight, sentiment }: {
  label: string; value: string; sub?: string; highlight?: boolean; sentiment?: 'good' | 'bad'
}) {
  return (
    <div className={['stat-box',
      highlight && 'stat-box--highlight',
      sentiment === 'good' && 'stat-box--good',
      sentiment === 'bad'  && 'stat-box--bad',
    ].filter(Boolean).join(' ')}>
      <div className="stat-box-value">{value}</div>
      {sub && <div className="stat-box-sub">{sub}</div>}
      <div className="stat-box-label">{label}</div>
    </div>
  )
}
