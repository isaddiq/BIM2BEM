/**
 * Small SVG chart kit for results. Colours come from CSS custom properties (light and
 * dark steps are defined in main.css), so every chart follows the theme. Each chart
 * can switch to a table of the exact values it plots.
 */

// Ramps (reference dataviz palette). Sequential: one hue light → dark. Diverging: blue ↔ red via grey.
const SEQ_BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const SEQ_ORANGE = ['#fde3d6', '#f9c7b0', '#f5ab8a', '#f18f64', '#eb6834', '#d55a29', '#b94a20', '#9c3d19', '#7e3114'];
const DIV_COLD = ['#104281', '#256abf', '#5598e7', '#9ec5f4'];
const DIV_HOT = ['#f2b7b0', '#e87f78', '#d34a46', '#a32a2a'];
const DIV_MID = { light: '#e6e5e1', dark: '#4a4a46' };

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex([r, g, b]) { return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
function rampAt(ramp, t) {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.floor(x), f = x - i;
  if (i >= ramp.length - 1) return ramp[ramp.length - 1];
  const a = hexToRgb(ramp[i]), b = hexToRgb(ramp[i + 1]);
  return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
}
/** Colour for a value on a scale { kind: 'seq'|'seqOrange'|'div', min, max, mid } */
function scaleColor(scale, v, theme = 'light') {
  if (v == null || !Number.isFinite(v)) return null;
  if (scale.kind === 'div') {
    const mid = scale.mid != null ? scale.mid : (scale.min + scale.max) / 2;
    if (v >= mid) return rampAt([DIV_MID[theme === 'dark' ? 'dark' : 'light'], ...DIV_HOT], (v - mid) / ((scale.max - mid) || 1));
    return rampAt([...DIV_COLD, DIV_MID[theme === 'dark' ? 'dark' : 'light']], 1 - (mid - v) / ((mid - scale.min) || 1));
  }
  const ramp = scale.kind === 'seqOrange' ? SEQ_ORANGE : SEQ_BLUE;
  return rampAt(ramp, (v - scale.min) / ((scale.max - scale.min) || 1));
}

const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));

function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(+t.toFixed(10));
  return out;
}

function useWidth(ref) {
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return w;
}

/** Frame with title, legend, provenance note and a chart/table switch. */
function ChartFrame({ title, subtitle, legend, note, table, children, actions }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          {subtitle && <div className="chart-sub">{subtitle}</div>}
        </div>
        <div className="chart-actions">
          {actions}
          {table && <button type="button" className="btn btn-ghost btn-sm" aria-pressed={asTable} onClick={() => setAsTable(v => !v)}><Icons.Table size={14} /> {asTable ? 'Chart' : 'Table'}</button>}
        </div>
      </figcaption>
      {legend && !asTable && <div className="chart-legend">{legend}</div>}
      {asTable && table ? <ValueTable {...table} /> : children}
      {note && <div className="chart-note">{note}</div>}
    </figure>
  );
}

function ValueTable({ columns, rows }) {
  return (
    <div className="chart-table-wrap">
      <table className="dtbl compact">
        <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'mono' : ''}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function LegendItems({ items }) {
  return items.map(it => (
    <span key={it.label} className="legend-item"><span className="legend-swatch" style={{ background: it.color }} />{it.label}</span>
  ));
}

/** Grouped vertical bars (e.g. monthly heating and cooling). series: [{ label, color, values }] */
function BarChart({ categories, series, unit, height = 220, digits = 0 }) {
  const ref = useRef(null);
  const W = useWidth(ref);
  const [hover, setHover] = useState(null);
  const m = { l: 52, r: 12, t: 22, b: 26 };
  const vals = series.flatMap(s => s.values.filter(v => Number.isFinite(v)));
  // The value axis always includes zero and extends below it when any value is negative
  // (for example monthly mean temperatures in a cold climate).
  const max = Math.max(1e-9, ...vals);
  const min = Math.min(0, ...vals);
  const ticks = niceTicks(min, max, min < 0 ? 6 : 4);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : max;
  if (min < 0 && ticks[0] > min + 1e-9) ticks.unshift(+(ticks[0] - step).toFixed(10));
  const bot = Math.min(min, ticks[0]);
  const top = Math.max(max, ticks[ticks.length - 1]);
  const iw = W - m.l - m.r, ih = height - m.t - m.b;
  const band = iw / categories.length;
  const gap = 2;
  const bw = Math.max(2, Math.min(28, (band * 0.72 - gap * (series.length - 1)) / series.length));
  const y = (v) => m.t + ih - ((v - bot) / (top - bot)) * ih;
  const y0 = y(0);
  // Bars grow from the zero line; the rounded end is at the bar's tip (top for positive, bottom for negative values).
  const bar = (x, v, w) => {
    const y1 = y(v), r = Math.min(4, w / 2, Math.abs(y0 - y1));
    return v >= 0
      ? `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`
      : `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  };
  return (
    <div ref={ref} className="chart-body" onMouseLeave={() => setHover(null)}>
      <svg width={W} height={height} role="img" aria-label={`${series.map(s => s.label).join(' and ')} by ${categories.length} categories`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={m.l - 6} y={y(t)} className="axis-text" textAnchor="end" dominantBaseline="middle">{fmt(t, t < 10 && t % 1 ? 1 : 0)}</text>
          </g>
        ))}
        <text x={m.l - 6} y={4} className="axis-text" textAnchor="end" dominantBaseline="hanging">{unit}</text>
        {categories.map((c, i) => {
          const x0 = m.l + i * band + (band - (bw * series.length + gap * (series.length - 1))) / 2;
          return (
            <g key={c} onMouseEnter={() => setHover(i)}>
              <rect x={m.l + i * band} y={m.t} width={band} height={ih} fill="transparent" />
              {series.map((s, k) => Number.isFinite(s.values[i]) && s.values[i] !== 0 && <path key={k} d={bar(x0 + k * (bw + gap), s.values[i], bw)} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55} />)}
              <text x={m.l + i * band + band / 2} y={height - 8} className="axis-text" textAnchor="middle">{c}</text>
            </g>
          );
        })}
        <line x1={m.l} x2={W - m.r} y1={y0} y2={y0} className="axis-line" />
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: Math.min(W - 170, m.l + hover * band + band / 2 + 8), top: 8 }}>
          <div className="tip-title">{categories[hover]}</div>
          {series.map(s => <div key={s.label} className="tip-row"><span className="legend-swatch" style={{ background: s.color }} />{s.label}<b className="mono">{fmt(s.values[hover], digits)} {unit}</b></div>)}
        </div>
      )}
    </div>
  );
}

/** Line chart over an index (hours). series: [{ label, color, values (array-like) }]; xLabel(i) for ticks/tooltips. */
function LineChart({ series, unit, height = 220, xLabel, xTicks, digits = 1, yMin, yMax, bands = [] }) {
  const ref = useRef(null);
  const W = useWidth(ref);
  const [hover, setHover] = useState(null);
  const m = { l: 52, r: 12, t: 22, b: 26 };
  const n = series[0] ? series[0].values.length : 0;
  let lo = Infinity, hi = -Infinity;
  series.forEach(s => { for (let i = 0; i < s.values.length; i++) { const v = s.values[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } });
  if (yMin != null) lo = Math.min(lo, yMin);
  if (yMax != null) hi = Math.max(hi, yMax);
  if (!(hi > lo)) { hi = lo + 1; }
  const ticks = niceTicks(lo, hi, 4);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const iw = W - m.l - m.r, ih = height - m.t - m.b;
  const x = (i) => m.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const path = (vals) => {
    // Min/max per pixel column keeps long series fast and faithful.
    const cols = Math.max(1, Math.floor(iw));
    if (vals.length <= cols * 2) {
      let d = '';
      for (let i = 0; i < vals.length; i++) if (Number.isFinite(vals[i])) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`;
      return d;
    }
    let d = '';
    const per = vals.length / cols;
    for (let c = 0; c < cols; c++) {
      let mn = Infinity, mx = -Infinity;
      for (let i = Math.floor(c * per); i < Math.floor((c + 1) * per); i++) { const v = vals[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (!Number.isFinite(mn)) continue;
      const px = m.l + c;
      d += `${d ? 'L' : 'M'}${px},${y(mn).toFixed(1)}L${px},${y(mx).toFixed(1)}`;
    }
    return d;
  };
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - m.l) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  const tickIdx = xTicks || niceTicks(0, n - 1, 6).filter(t => Number.isInteger(t));
  return (
    <div ref={ref} className="chart-body" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={height} role="img" aria-label={`${series.map(s => s.label).join(', ')} over ${n} points`}>
        {bands.map((b, i) => <rect key={i} x={m.l} width={iw} y={y(Math.min(hi, b.to))} height={Math.max(0, y(Math.max(lo, b.from)) - y(Math.min(hi, b.to)))} className="chart-band" />)}
        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={m.l - 6} y={y(t)} className="axis-text" textAnchor="end" dominantBaseline="middle">{fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>
          </g>
        ))}
        <text x={m.l - 6} y={4} className="axis-text" textAnchor="end" dominantBaseline="hanging">{unit}</text>
        {tickIdx.map(i => <text key={i} x={x(i)} y={height - 8} className="axis-text" textAnchor="middle">{xLabel ? xLabel(i, true) : i}</text>)}
        {series.map(s => <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} className="crosshair" />}
        {hover != null && series.map(s => Number.isFinite(s.values[hover]) && <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} className="hover-dot" />)}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: Math.min(W - 190, x(hover) + 10), top: 8 }}>
          <div className="tip-title">{xLabel ? xLabel(hover, false) : hover}</div>
          {series.map(s => <div key={s.label} className="tip-row"><span className="legend-swatch" style={{ background: s.color }} />{s.label}<b className="mono">{fmt(s.values[hover], digits)} {unit}</b></div>)}
        </div>
      )}
    </div>
  );
}

/** Wind rose: stacked speed bins per sector, frequencies in % of hours. */
function WindRose({ rose, size = 300 }) {
  const [hover, setHover] = useState(null);
  const c = size / 2, R = size / 2 - 28;
  const max = Math.max(...rose.sectorTotals, 1e-9);
  const ticks = niceTicks(0, max * 100, 3).filter(t => t > 0);
  const top = Math.max(max * 100, ticks[ticks.length - 1] || 1);
  const width = 360 / rose.sectors;
  const binColors = rose.bins.map((_, i) => rampAt(SEQ_BLUE.slice(3), i / Math.max(1, rose.bins.length - 1)));
  const wedge = (a0, a1, r0, r1) => {
    const p = (a, r) => [c + r * Math.sin(a * Math.PI / 180), c - r * Math.cos(a * Math.PI / 180)];
    const [x0, y0] = p(a0, r0), [x1, y1] = p(a0, r1), [x2, y2] = p(a1, r1), [x3, y3] = p(a1, r0);
    return `M${x0},${y0}L${x1},${y1}A${r1},${r1} 0 0 1 ${x2},${y2}L${x3},${y3}A${r0},${r0} 0 0 0 ${x0},${y0}Z`;
  };
  return (
    <div className="rose-wrap">
      <svg width={size} height={size} role="img" aria-label="Wind rose: frequency of wind direction and speed">
        {ticks.map(t => <circle key={t} cx={c} cy={c} r={(t / top) * R} className="grid-line" fill="none" />)}
        {ticks.map(t => <text key={`t${t}`} x={c + 3} y={c - (t / top) * R - 2} className="axis-text">{t}%</text>)}
        {['N', 'E', 'S', 'W'].map((d, i) => <text key={d} x={c + (R + 14) * Math.sin(i * Math.PI / 2)} y={c - (R + 14) * Math.cos(i * Math.PI / 2)} className="axis-text strong" textAnchor="middle" dominantBaseline="middle">{d}</text>)}
        {rose.freq.map((row, s) => {
          let acc = 0;
          return row.map((f, b) => {
            const r0 = (acc * 100 / top) * R; acc += f;
            const r1 = (acc * 100 / top) * R;
            if (f <= 0) return null;
            return <path key={`${s}-${b}`} d={wedge(s * width - width / 2 + 1, s * width + width / 2 - 1, r0, r1)} fill={binColors[b]} stroke="var(--surface)" strokeWidth="1" opacity={hover == null || hover === s ? 1 : 0.5} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)} />;
          });
        })}
      </svg>
      <div className="rose-side">
        <div className="chart-legend col">{rose.bins.map((b, i) => <span key={b} className="legend-item"><span className="legend-swatch" style={{ background: binColors[i] }} />{i < rose.bins.length - 1 ? `${b}–${rose.bins[i + 1]} m/s` : `≥ ${b} m/s`}</span>)}</div>
        <div className="muted small">Calm (&lt; {rose.bins[0]} m/s): {fmt(rose.calm * 100, 1)}% · mean {fmt(rose.meanSpeed, 1)} m/s · {rose.total.toLocaleString()} h</div>
        {hover != null && <div className="small">Sector {Math.round(hover * width)}°: {fmt(rose.sectorTotals[hover] * 100, 1)}% of hours</div>}
      </div>
    </div>
  );
}

/** Sun path (polar: altitude as radius) for the 21st of selected months, with hour marks. */
function SunPath({ lat, lon, tz, size = 300 }) {
  const c = size / 2, R = size / 2 - 22;
  const days = [[355, 'Dec 21'], [80, 'Mar 21 / Sep 23'], [172, 'Jun 21']];
  const pt = (alt, az) => { const r = R * (1 - alt / 90); return [c + r * Math.sin(az * Math.PI / 180), c - r * Math.cos(az * Math.PI / 180)]; };
  const colors = ['var(--series-1)', 'var(--series-3)', 'var(--series-2)'];
  return (
    <div className="rose-wrap">
      <svg width={size} height={size} role="img" aria-label="Sun path diagram">
        {[0, 30, 60].map(a => <circle key={a} cx={c} cy={c} r={R * (1 - a / 90)} className="grid-line" fill="none" />)}
        {[30, 60].map(a => <text key={a} x={c + 3} y={c - R * (1 - a / 90) - 2} className="axis-text">{a}°</text>)}
        {['N', 'E', 'S', 'W'].map((d, i) => <text key={d} x={c + (R + 12) * Math.sin(i * Math.PI / 2)} y={c - (R + 12) * Math.cos(i * Math.PI / 2)} className="axis-text strong" textAnchor="middle" dominantBaseline="middle">{d}</text>)}
        {days.map(([doy], k) => {
          let d = '';
          for (let h = 0; h <= 24; h += 0.25) {
            const sp = solarPosition(lat, lon, tz, doy, h);
            if (sp.altitude < 0) continue;
            const [x, y] = pt(sp.altitude, sp.azimuth);
            d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
          }
          return <path key={doy} d={d} fill="none" stroke={colors[k]} strokeWidth="2" />;
        })}
        {[6, 9, 12, 15, 18].map(h => {
          const sp = solarPosition(lat, lon, tz, 172, h);
          if (sp.altitude < 0) return null;
          const [x, y] = pt(sp.altitude, sp.azimuth);
          return <text key={h} x={x} y={y - 6} className="axis-text" textAnchor="middle">{h}h</text>;
        })}
      </svg>
      <div className="rose-side">
        <div className="chart-legend col">{days.map(([, l], k) => <span key={l} className="legend-item"><span className="legend-swatch" style={{ background: colors[k] }} />{l}</span>)}</div>
        <div className="muted small">Local standard time, UTC{tz >= 0 ? '+' : ''}{tz}. Radius is solar altitude (horizon at the edge).</div>
      </div>
    </div>
  );
}

/** Continuous colour legend for 3D heatmaps. */
function ScaleLegend({ title, scale, unit, theme, digits = 0 }) {
  const stops = Array.from({ length: 9 }, (_, i) => scale.min + (scale.max - scale.min) * i / 8);
  return (
    <div className="scale-legend">
      <div className="scale-title">{title}</div>
      <div className="scale-bar" style={{ background: `linear-gradient(90deg, ${stops.map(v => scaleColor(scale, v, theme)).join(',')})` }} />
      <div className="scale-ticks mono"><span>{fmt(scale.min, digits)}</span>{scale.mid != null && <span>{fmt(scale.mid, digits)}</span>}<span>{fmt(scale.max, digits)} {unit}</span></div>
    </div>
  );
}

function StatTile({ label, value, unit, sub, tone }) {
  return (
    <div className="stat-tile" data-tone={tone}>
      <div className="stat-label">{label}</div>
      <div className="stat-value"><span className="mono">{value}</span>{unit && <span className="stat-unit">{unit}</span>}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

Object.assign(window, { SEQ_BLUE, SEQ_ORANGE, scaleColor, rampAt, fmt, niceTicks, ChartFrame, ValueTable, LegendItems, BarChart, LineChart, WindRose, SunPath, ScaleLegend, StatTile });
