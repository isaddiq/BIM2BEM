/**
 * Weather: EPW parsing, validation and statistics; solar position; and EPW files built
 * from open hourly datasets that browsers can reach (Open-Meteo ERA5 reanalysis and
 * NASA POWER). No value is invented: fields a source does not provide are written as
 * the EPW "missing" code, which EnergyPlus handles with its documented defaults, and
 * the file's comments say which fields were derived and how.
 */

const EPW_FIELDS = [
  'year', 'month', 'day', 'hour', 'minute', 'flags', 'dryBulb', 'dewPoint', 'rh', 'pressure',
  'extHorRad', 'extDirNormRad', 'horIR', 'ghi', 'dni', 'dhi', 'ghIllum', 'dnIllum', 'dhIllum', 'zenLum',
  'windDir', 'windSpeed', 'totalSky', 'opaqueSky', 'visibility', 'ceiling', 'presWeathObs', 'presWeathCodes',
  'precipWater', 'aod', 'snowDepth', 'daysSinceSnow', 'albedo', 'rain', 'rainHours',
];
const EPW_MISSING = { dryBulb: 99.9, dewPoint: 99.9, rh: 999, pressure: 999999, extHorRad: 9999, extDirNormRad: 9999, horIR: 9999, ghi: 9999, dni: 9999, dhi: 9999, ghIllum: 999999, dnIllum: 999999, dhIllum: 999999, zenLum: 9999, windDir: 999, windSpeed: 999, totalSky: 99, opaqueSky: 99, visibility: 9999, ceiling: 99999, presWeathObs: 9, presWeathCodes: 999999999, precipWater: 999, aod: 0.999, snowDepth: 999, daysSinceSnow: 99, albedo: 999, rain: 999, rainHours: 99 };
const EPW_RANGE = { dryBulb: [-70, 70], dewPoint: [-70, 70], rh: [0, 110], pressure: [31000, 120000], ghi: [0, 1600], dni: [0, 1500], dhi: [0, 1000], horIR: [0, 1000], windDir: [0, 360], windSpeed: [0, 40], totalSky: [0, 10], opaqueSky: [0, 10] };
const CORE_FIELDS = ['dryBulb', 'dewPoint', 'rh', 'pressure', 'ghi', 'dni', 'dhi', 'windDir', 'windSpeed'];

function parseEpw(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  if (!/^LOCATION/i.test(lines[0] || '')) throw new Error('Not an EPW file: the first line must start with LOCATION');
  const loc = lines[0].split(',');
  const header = {
    city: (loc[1] || '').trim(), region: (loc[2] || '').trim(), country: (loc[3] || '').trim(), source: (loc[4] || '').trim(), wmo: (loc[5] || '').trim(),
    latitude: Number(loc[6]), longitude: Number(loc[7]), timeZone: Number(loc[8]), elevation: Number(loc[9]),
  };
  const headerLines = lines.slice(0, 8);
  const comments = headerLines.filter(l => /^COMMENTS/i.test(l)).map(l => l.replace(/^COMMENTS \d,?/i, '').trim()).filter(Boolean);
  const dp = headerLines.find(l => /^DATA PERIODS/i.test(l));
  const design = headerLines.find(l => /^DESIGN CONDITIONS/i.test(l));
  const rows = [];
  for (let i = 8; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = lines[i].split(',');
    rows.push(f);
  }
  const n = rows.length;
  const cols = {};
  EPW_FIELDS.forEach((k, j) => {
    if (k === 'flags' || k === 'presWeathCodes') return;
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = rows[i][j] === undefined || rows[i][j] === '' ? NaN : Number(rows[i][j]);
    cols[k] = arr;
  });
  return { header, comments, dataPeriods: dp || null, hasDesignConditions: !!(design && !/DESIGN CONDITIONS,0/i.test(design)), n, cols, fieldCounts: rows.map(r => r.length), text };
}

/** Structural and physical checks. Returns { ok, errors, warnings, completeness }. */
function validateEpw(epw) {
  const errors = [], warnings = [];
  const { n, cols, header } = epw;
  if (!(n === 8760 || n === 8784)) errors.push(`The file has ${n} hourly records; an annual EPW has 8760 (or 8784 in a leap year).`);
  const badCount = epw.fieldCounts.filter(c => c < 35).length;
  if (badCount) errors.push(`${badCount} records have fewer than 35 fields.`);
  if (!Number.isFinite(header.latitude) || Math.abs(header.latitude) > 90) errors.push('LOCATION latitude is invalid.');
  if (!Number.isFinite(header.longitude) || Math.abs(header.longitude) > 180) errors.push('LOCATION longitude is invalid.');
  if (!Number.isFinite(header.timeZone) || Math.abs(header.timeZone) > 14) errors.push('LOCATION time zone is invalid.');
  // Hour sequence 1..24 and month/day continuity.
  let seqErr = 0;
  for (let i = 0; i < n; i++) {
    const h = cols.hour[i];
    if (!(h >= 1 && h <= 24)) seqErr++;
    else if (i > 0 && !(h === cols.hour[i - 1] + 1 || (h === 1 && cols.hour[i - 1] === 24))) seqErr++;
  }
  if (seqErr) errors.push(`${seqErr} records break the hourly sequence (hour 1–24, consecutive).`);
  const completeness = {};
  CORE_FIELDS.forEach(k => {
    const miss = EPW_MISSING[k];
    const [lo, hi] = EPW_RANGE[k] || [-Infinity, Infinity];
    let missing = 0, out = 0;
    for (let i = 0; i < n; i++) {
      const v = cols[k][i];
      if (!Number.isFinite(v) || v >= miss) missing++;
      else if (v < lo || v > hi) out++;
    }
    completeness[k] = n ? 1 - missing / n : 0;
    if (missing) (missing / n > 0.05 ? errors : warnings).push(`${k}: ${missing} missing values (${(missing / n * 100).toFixed(1)}%).`);
    if (out) warnings.push(`${k}: ${out} values outside the plausible range ${lo}…${hi}.`);
  });
  // Dew point above dry bulb.
  let dpHigh = 0;
  for (let i = 0; i < n; i++) if (cols.dewPoint[i] < 99 && cols.dryBulb[i] < 99 && cols.dewPoint[i] > cols.dryBulb[i] + 0.5) dpHigh++;
  if (dpHigh) warnings.push(`${dpHigh} hours have a dew point above the dry-bulb temperature.`);
  // Night-time solar radiation.
  if (Number.isFinite(header.latitude)) {
    let night = 0;
    const doy0 = dayOfYearIndex(epw);
    for (let i = 0; i < n; i++) {
      const sp = solarPosition(header.latitude, header.longitude, header.timeZone, doy0[i], cols.hour[i] - 0.5);
      if (sp.altitude < -5 && cols.ghi[i] > 20 && cols.ghi[i] < 9999) night++;
    }
    if (night > 24) warnings.push(`${night} hours report global radiation while the sun is more than 5° below the horizon; check the time zone and time convention.`);
  }
  return { ok: !errors.length, errors, warnings, completeness };
}

function dayOfYearIndex(epw) {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const out = new Uint16Array(epw.n);
  for (let i = 0; i < epw.n; i++) {
    const m = epw.cols.month[i], d = epw.cols.day[i];
    const leap = epw.n === 8784 && m > 2 ? 1 : 0;
    out[i] = cum[m - 1] + d + leap;
  }
  return out;
}

/**
 * Solar position (NOAA / Meeus formulation; about ±0.01° between 1901 and 2099).
 * hourLocal is local standard time in decimal hours; returns degrees, azimuth clockwise from north.
 */
function solarPosition(lat, lon, tz, dayOfYear, hourLocal, year = 2023) {
  const rad = Math.PI / 180;
  // Julian century from the date (year-specific, noon-based).
  // Julian day at 0h UT on day `dayOfYear` of `year` (Jan 1 = day 1; 2000-01-01 → 2451544.5), plus UT hours.
  const jd = 367 * year - Math.floor(7 * year / 4) + 30 + 1721013.5 + dayOfYear + (hourLocal - tz) / 24;
  const T = (jd - 2451545) / 36525;
  const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
  const y = Math.tan(eps / 2 * rad) ** 2;
  const eqTime = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)); // minutes
  const tst = (hourLocal * 60 + eqTime + 4 * lon - 60 * tz + 1440) % 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const cosZ = Math.sin(lat * rad) * Math.sin(decl * rad) + Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(ha * rad);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ))) / rad;
  let az;
  const sinZ = Math.sin(zen * rad);
  if (sinZ < 1e-9) az = 180;
  else {
    const cosAz = (Math.sin(lat * rad) * Math.cos(zen * rad) - Math.sin(decl * rad)) / (Math.cos(lat * rad) * sinZ);
    const a = Math.acos(Math.max(-1, Math.min(1, cosAz))) / rad;
    az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { altitude: 90 - zen, azimuth: az, declination: decl, hourAngle: ha, equationOfTime: eqTime };
}

/** Climate statistics from an EPW (all computed from the file's hourly records). */
function epwStats(epw) {
  const { n, cols } = epw;
  const ok = (v, k) => Number.isFinite(v) && v < EPW_MISSING[k];
  const monthly = (k, agg) => {
    const s = new Array(12).fill(0), c = new Array(12).fill(0);
    for (let i = 0; i < n; i++) { const v = cols[k][i]; if (!ok(v, k)) continue; s[cols.month[i] - 1] += v; c[cols.month[i] - 1]++; }
    return s.map((x, m) => (c[m] ? (agg === 'sum' ? x : x / c[m]) : null));
  };
  // Daily means for degree-days.
  const days = [];
  for (let i = 0; i < n; i += 24) {
    let s = 0, c = 0;
    for (let j = i; j < Math.min(n, i + 24); j++) if (ok(cols.dryBulb[j], 'dryBulb')) { s += cols.dryBulb[j]; c++; }
    days.push(c ? s / c : null);
  }
  const valid = days.filter(d => d != null);
  const hdd18 = valid.reduce((t, d) => t + Math.max(0, 18 - d), 0);
  const cdd10 = valid.reduce((t, d) => t + Math.max(0, d - 10), 0);
  const cdd18 = valid.reduce((t, d) => t + Math.max(0, d - 18), 0);
  const db = Array.from(cols.dryBulb).filter(v => ok(v, 'dryBulb')).sort((a, b) => a - b);
  const pct = (p) => db.length ? db[Math.min(db.length - 1, Math.max(0, Math.round(p * (db.length - 1))))] : null;
  // ASHRAE 169-2013 thermal climate zone number from HDD18 and CDD10 (°C·day).
  let zone = null;
  if (valid.length > 300) {
    if (cdd10 > 6000) zone = 0;
    else if (cdd10 > 5000) zone = 1;
    else if (cdd10 > 3500) zone = 2;
    else if (hdd18 <= 2000) zone = 3;
    else if (hdd18 <= 3000) zone = 4;
    else if (hdd18 <= 4000) zone = 5;
    else if (hdd18 <= 5000) zone = 6;
    else if (hdd18 <= 7000) zone = 7;
    else zone = 8;
  }
  const ghiMonthly = monthly('ghi', 'sum').map(x => (x == null ? null : x / 1000)); // kWh/m²
  return {
    monthlyDryBulb: monthly('dryBulb'),
    monthlyRh: monthly('rh'),
    monthlyWind: monthly('windSpeed'),
    monthlyGhiKWh: ghiMonthly,
    annualGhiKWh: ghiMonthly.reduce((a, b) => a + (b || 0), 0),
    annualMeanDryBulb: db.length ? db.reduce((a, b) => a + b, 0) / db.length : null,
    minDryBulb: db[0], maxDryBulb: db[db.length - 1],
    heating996: pct(0.004), cooling004: pct(0.996),
    hdd18, cdd10, cdd18,
    climateZone: zone,
    dailyMeans: days,
  };
}

const WIND_SPEED_BINS = [0.5, 2, 4, 6, 8, 10];
/** Wind rose: frequency (share of all hours) by 16 sectors × speed bins; calms below 0.5 m/s. */
function windRose(epw, { sectors = 16, months = null } = {}) {
  const { n, cols } = epw;
  const counts = Array.from({ length: sectors }, () => new Array(WIND_SPEED_BINS.length).fill(0));
  let calm = 0, total = 0, sum = 0;
  const width = 360 / sectors;
  for (let i = 0; i < n; i++) {
    if (months && !months.includes(cols.month[i])) continue;
    const s = cols.windSpeed[i], d = cols.windDir[i];
    if (!(s < 999) || !(d < 999)) continue;
    total++; sum += s;
    if (s < WIND_SPEED_BINS[0]) { calm++; continue; }
    const sec = Math.floor(((d + width / 2) % 360) / width);
    let b = WIND_SPEED_BINS.length - 1;
    for (let k = 1; k < WIND_SPEED_BINS.length; k++) if (s < WIND_SPEED_BINS[k]) { b = k - 1; break; }
    counts[sec][b]++;
  }
  const freq = counts.map(row => row.map(c => (total ? c / total : 0)));
  const sectorTotals = freq.map(r => r.reduce((a, b) => a + b, 0));
  const prevailing = sectorTotals.indexOf(Math.max(...sectorTotals));
  return { sectors, bins: WIND_SPEED_BINS, freq, counts, calm: total ? calm / total : 0, total, meanSpeed: total ? sum / total : null, prevailingDeg: prevailing * width, sectorTotals };
}

// ---------------------------------------------------------------------------
// EPW writing from open hourly datasets
// ---------------------------------------------------------------------------
/** Standard (non-DST) UTC offset in hours for an IANA zone, from January and July offsets. */
function standardOffsetHours(timeZone, year) {
  const off = (d) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
    const g = (t) => Number(parts.find(p => p.type === t).value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
    return (asUtc - d.getTime()) / 3600000;
  };
  return Math.min(off(new Date(Date.UTC(year, 0, 15, 12))), off(new Date(Date.UTC(year, 6, 15, 12))));
}

function fmtNum(v, d) { return Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d).toFixed(d) : null; }

function dewPointFromRh(t, rh) {
  // Magnus formula (Alduchov & Eskridge 1996 coefficients), for records lacking dew point.
  const a = 17.625, b = 243.04;
  const g = Math.log(Math.max(rh, 0.1) / 100) + a * t / (b + t);
  return b * g / (a - g);
}

/**
 * Write an EPW from hourly records already in local standard time, one per EPW hour
 * (value for hour h = instantaneous at h:00, radiation = mean over (h-1):00..h:00).
 * rec: { year, month, day, hour (1..24), dryBulb, dewPoint, rh, pressure (Pa), ghi, dni, dhi, horIR, windDir, windSpeed, totalSky, opaqueSky, precip, snowDepthCm }
 */
function writeEpw(meta, recs) {
  const lines = [];
  const clean = (s) => String(s || '').replace(/,/g, ' ').trim();
  lines.push(`LOCATION,${clean(meta.city)},${clean(meta.region)},${clean(meta.country)},${clean(meta.source)},${clean(meta.wmo || '')},${meta.latitude.toFixed(4)},${meta.longitude.toFixed(4)},${meta.timeZone.toFixed(1)},${meta.elevation.toFixed(1)}`);
  lines.push('DESIGN CONDITIONS,0');
  lines.push('TYPICAL/EXTREME PERIODS,0');
  lines.push('GROUND TEMPERATURES,0');
  lines.push('HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0');
  lines.push(`COMMENTS 1,${clean(meta.comment1)}`);
  lines.push(`COMMENTS 2,${clean(meta.comment2)}`);
  const dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(recs[0].year, recs[0].month - 1, recs[0].day)).getUTCDay()];
  const last = recs[recs.length - 1];
  lines.push(`DATA PERIODS,1,1,Data,${dow}, ${recs[0].month}/${String(recs[0].day).padStart(2, ' ')},${last.month}/${String(last.day).padStart(2, ' ')}`);
  const M = EPW_MISSING;
  const val = (v, miss, d) => (Number.isFinite(v) ? fmtNum(v, d) : String(miss));
  recs.forEach(r => {
    const f = [
      r.year, r.month, r.day, r.hour, 60, r.flags || '?9?9?9?9E0?9?9?9?9?9?9?9?9?9?9?9?9?9?9?9*9*9?9?9?9',
      val(r.dryBulb, M.dryBulb, 1), val(r.dewPoint, M.dewPoint, 1), val(r.rh, M.rh, 0), val(r.pressure, M.pressure, 0),
      M.extHorRad, M.extDirNormRad, val(r.horIR, M.horIR, 0), val(r.ghi, M.ghi, 0), val(r.dni, M.dni, 0), val(r.dhi, M.dhi, 0),
      M.ghIllum, M.dnIllum, M.dhIllum, M.zenLum,
      val(r.windDir, M.windDir, 0), val(r.windSpeed, M.windSpeed, 1), val(r.totalSky, M.totalSky, 0), val(r.opaqueSky, M.opaqueSky, 0),
      M.visibility, M.ceiling, 9, M.presWeathCodes, M.precipWater, M.aod, val(r.snowDepthCm, M.snowDepth, 0), M.daysSinceSnow, M.albedo, val(r.precip, M.rain, 1), Number.isFinite(r.precip) ? 1 : M.rainHours,
    ];
    lines.push(f.join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

/** Map UTC-indexed hourly arrays onto EPW hours (local standard time) for a calendar year. */
function epwRecordsFromUtc(year, tzHours, getUtc, { dropLeapDay = true } = {}) {
  const recs = [];
  const start = Date.UTC(year, 0, 1, 1) - tzHours * 3600000; // local 01:00 on Jan 1
  const end = Date.UTC(year + 1, 0, 1, 0) - tzHours * 3600000;  // local 24:00 on Dec 31
  for (let t = start; t <= end; t += 3600000) {
    const local = new Date(t + tzHours * 3600000);
    let y = local.getUTCFullYear(), mo = local.getUTCMonth() + 1, d = local.getUTCDate(), h = local.getUTCHours();
    if (h === 0) { const prev = new Date(t + tzHours * 3600000 - 3600000); y = prev.getUTCFullYear(); mo = prev.getUTCMonth() + 1; d = prev.getUTCDate(); h = 24; }
    if (dropLeapDay && mo === 2 && d === 29) continue;
    recs.push({ year: y, month: mo, day: d, hour: h, ...getUtc(t) });
  }
  return recs;
}

const OPEN_METEO_VARS = ['temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'surface_pressure', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'shortwave_radiation', 'direct_normal_irradiance', 'diffuse_radiation', 'precipitation', 'snow_depth'];

/** Open-Meteo historical API (ERA5) → EPW for one calendar year. */
async function epwFromOpenMeteo({ latitude, longitude, year, timeZone, fetchFn = fetch, signal }) {
  const tz = standardOffsetHours(timeZone, year);
  const pad = (d) => d.toISOString().slice(0, 10);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}`
    + `&start_date=${pad(new Date(Date.UTC(year - 1, 11, 31)))}&end_date=${pad(new Date(Date.UTC(year + 1, 0, 1)))}`
    + `&hourly=${OPEN_METEO_VARS.join(',')}&models=era5&timezone=GMT&wind_speed_unit=ms`;
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo returned HTTP ${res.status}${res.status === 429 ? ' (rate limit; try again later)' : ''}`);
  const j = await res.json();
  if (j.error) throw new Error(`Open-Meteo: ${j.reason || 'error'}`);
  const H = j.hourly;
  const index = new Map(H.time.map((t, i) => [Date.parse(t + ':00Z'), i]));
  const at = (k, i) => { const v = H[k] && H[k][i]; return v == null ? NaN : v; };
  const recs = epwRecordsFromUtc(year, tz, (t) => {
    const i = index.get(t);
    if (i == null) return {};
    const db = at('temperature_2m', i);
    const rh = at('relative_humidity_2m', i);
    let dp = at('dew_point_2m', i);
    if (!Number.isFinite(dp) && Number.isFinite(db) && Number.isFinite(rh)) dp = dewPointFromRh(db, rh);
    const cc = at('cloud_cover', i);
    return {
      dryBulb: db, dewPoint: dp, rh, pressure: at('surface_pressure', i) * 100,
      ghi: at('shortwave_radiation', i), dni: at('direct_normal_irradiance', i), dhi: at('diffuse_radiation', i),
      horIR: NaN, windDir: at('wind_direction_10m', i), windSpeed: at('wind_speed_10m', i),
      totalSky: Number.isFinite(cc) ? Math.round(cc / 10) : NaN, opaqueSky: Number.isFinite(cc) ? Math.round(cc / 10) : NaN,
      precip: at('precipitation', i), snowDepthCm: at('snow_depth', i) * 100,
    };
  });
  const missingHours = recs.filter(r => !Number.isFinite(r.dryBulb)).length;
  if (missingHours > 0) throw new Error(`Open-Meteo returned ${missingHours} hours without temperature for ${year}; choose an earlier year.`);
  const meta = {
    city: 'ERA5 grid cell', region: '', country: '', source: 'ERA5-OpenMeteo',
    latitude: j.latitude, longitude: j.longitude, elevation: j.elevation, timeZone: tz,
    comment1: `Actual year ${year} built by BIM2BEM from ERA5 reanalysis via the Open-Meteo historical weather API (CC BY 4.0). Grid cell ${j.latitude.toFixed(3)} ${j.longitude.toFixed(3)} at ${j.elevation} m; requested ${latitude.toFixed(4)} ${longitude.toFixed(4)}.`,
    comment2: 'Hours in local standard time; radiation is the mean of the preceding hour. Sky cover = ERA5 total cloud cover (opaque cover not available; used for both). Horizontal infrared left missing (EnergyPlus computes it from sky cover). Illuminance fields missing. Feb 29 removed in leap years.',
  };
  return { epw: writeEpw(meta, recs), meta: { provider: 'Open-Meteo (ERA5)', year, gridLatitude: j.latitude, gridLongitude: j.longitude, gridElevation: j.elevation, timeZone: tz, url, license: 'CC BY 4.0, Open-Meteo.com; ERA5: Copernicus Climate Change Service', resolution: 'ERA5 0.25° (≈ 25–30 km)', classification: `Actual meteorological year ${year} (reanalysis; not a typical year)` } };
}

const POWER_PARAMS = ['T2M', 'T2MDEW', 'RH2M', 'PS', 'WS10M', 'WD10M', 'ALLSKY_SFC_SW_DWN', 'ALLSKY_SFC_SW_DNI', 'ALLSKY_SFC_SW_DIFF', 'ALLSKY_SFC_LW_DWN', 'PRECTOTCORR'];

/** NASA POWER hourly API → EPW for one calendar year. */
async function epwFromNasaPower({ latitude, longitude, year, timeZone, fetchFn = fetch, signal }) {
  const tz = standardOffsetHours(timeZone, year);
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=${POWER_PARAMS.join(',')}&community=RE`
    + `&longitude=${longitude.toFixed(4)}&latitude=${latitude.toFixed(4)}&start=${ymd(new Date(Date.UTC(year - 1, 11, 31)))}&end=${ymd(new Date(Date.UTC(year + 1, 0, 1)))}&format=JSON&time-standard=UTC`;
  const res = await fetchFn(url, { signal });
  if (!res.ok) throw new Error(`NASA POWER returned HTTP ${res.status}`);
  const j = await res.json();
  const P = j.properties && j.properties.parameter;
  if (!P) throw new Error('NASA POWER returned no data');
  const fill = (j.header && j.header.fill_value) != null ? j.header.fill_value : -999;
  const get = (k, key) => { const v = P[k] && P[k][key]; return v == null || v === fill ? NaN : v; };
  // POWER hourly values are labelled by the start of the hour (YYYYMMDDHH, UTC); the
  // EPW hour ending at t is therefore POWER's hour starting at t − 1 h for radiation.
  const keyOf = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`; };
  const recs = epwRecordsFromUtc(year, tz, (t) => {
    const kNow = keyOf(t), kPrev = keyOf(t - 3600000);
    const db = get('T2M', kNow), rh = get('RH2M', kNow);
    let dp = get('T2MDEW', kNow);
    if (!Number.isFinite(dp) && Number.isFinite(db) && Number.isFinite(rh)) dp = dewPointFromRh(db, rh);
    return {
      dryBulb: db, dewPoint: dp, rh, pressure: get('PS', kNow) * 1000,
      ghi: get('ALLSKY_SFC_SW_DWN', kPrev), dni: get('ALLSKY_SFC_SW_DNI', kPrev), dhi: get('ALLSKY_SFC_SW_DIFF', kPrev), horIR: get('ALLSKY_SFC_LW_DWN', kPrev),
      windDir: get('WD10M', kNow), windSpeed: get('WS10M', kNow), totalSky: NaN, opaqueSky: NaN, precip: get('PRECTOTCORR', kPrev),
    };
  });
  const missingHours = recs.filter(r => !Number.isFinite(r.dryBulb)).length;
  if (missingHours > 24) throw new Error(`NASA POWER returned ${missingHours} hours without temperature for ${year}.`);
  const coords = j.geometry && j.geometry.coordinates;
  const elev = coords && Number.isFinite(coords[2]) ? coords[2] : 0;
  const meta = {
    city: 'NASA POWER grid cell', region: '', country: '', source: 'NASA-POWER',
    latitude, longitude, elevation: elev, timeZone: tz,
    comment1: `Actual year ${year} built by BIM2BEM from the NASA POWER hourly API (MERRA-2 meteorology; CERES/GEWEX radiation). Requested ${latitude.toFixed(4)} ${longitude.toFixed(4)}.`,
    comment2: 'Hours in local standard time; radiation and precipitation are the preceding hour. Sky cover not available (EnergyPlus uses its defaults); horizontal infrared from ALLSKY_SFC_LW_DWN. Feb 29 removed in leap years.',
  };
  return { epw: writeEpw(meta, recs), meta: { provider: 'NASA POWER', year, gridLatitude: latitude, gridLongitude: longitude, gridElevation: elev, timeZone: tz, url, license: 'NASA POWER data are freely available; cite NASA Langley Research Center POWER Project', resolution: 'MERRA-2 0.5°×0.625° (meteorology), 1° (radiation)', classification: `Actual meteorological year ${year} (reanalysis/satellite; not a typical year)` } };
}

/** Great-circle distance in km. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Read the .epw inside a .zip (stored or deflate) using the browser's DecompressionStream. */
async function epwFromZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (p + 30 < bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const csize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen));
    const start = p + 30 + nlen + xlen;
    const data = bytes.subarray(start, start + csize);
    if (/\.epw$/i.test(name)) {
      if (method === 0) return { name, text: new TextDecoder().decode(data) };
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
        return { name, text: new TextDecoder().decode(out) };
      }
      throw new Error(`Unsupported zip compression method ${method}`);
    }
    p = start + csize;
  }
  throw new Error('No .epw file found in the zip');
}

Object.assign(window, {
  EPW_FIELDS, EPW_MISSING, parseEpw, validateEpw, solarPosition, epwStats, windRose, WIND_SPEED_BINS, writeEpw,
  epwFromOpenMeteo, epwFromNasaPower, standardOffsetHours, haversineKm, epwFromZip, dayOfYearIndex, epwRecordsFromUtc, dewPointFromRh,
});
