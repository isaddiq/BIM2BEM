/**
 * Indoor environmental quality indicators computed from simulated zone conditions.
 *
 *  - PMV/PPD: ISO 7730:2005 Annex D algorithm (Fanger). Inputs: air temperature and
 *    mean radiant temperature (EnergyPlus zone outputs), relative humidity (EnergyPlus),
 *    and the occupant parameters the user set (relative air speed, metabolic rate,
 *    clothing). Results outside the standard's input ranges are flagged.
 *  - Adaptive comfort: EN 16798-1:2019 (θc = 0.33 θrm + 18.8) and ASHRAE 55-2020
 *    (tc = 0.31 tpma + 17.8). Valid only for occupant-controlled, naturally conditioned
 *    spaces without mechanical cooling, which the caller must respect.
 *  - CO₂: statistics of the EnergyPlus zone CO₂ balance during occupied hours.
 *  - Daylight at the reference point: shares of occupied hours above a threshold and
 *    in useful-daylight bands, from EnergyPlus illuminance at one point per zone.
 */

/** PMV and PPD (ISO 7730:2005 Annex D). ta, tr °C; vr m/s; rh %; met met; clo clo; wme met. */
function pmvPpd(ta, tr, vr, rh, met, clo, wme = 0) {
  const pa = rh * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235)); // water vapour pressure, Pa
  const icl = 0.155 * clo;
  const m = met * 58.15;
  const w = wme * 58.15;
  const mw = m - w;
  const fcl = icl <= 0.078 ? 1 + 1.29 * icl : 1.05 + 0.645 * icl;
  const hcf = 12.1 * Math.sqrt(vr);
  const taa = ta + 273;
  const tra = tr + 273;
  const tcla = taa + (35.5 - ta) / (3.5 * icl + 0.1);
  const p1 = icl * fcl;
  const p2 = p1 * 3.96;
  const p3 = p1 * 100;
  const p4 = p1 * taa;
  const p5 = 308.7 - 0.028 * mw + p2 * Math.pow(tra / 100, 4);
  let xn = tcla / 100;
  let xf = tcla / 50;
  let hc = hcf;
  let n = 0;
  while (Math.abs(xn - xf) > 0.00015) {
    xf = (xf + xn) / 2;
    const hcn = 2.38 * Math.pow(Math.abs(100 * xf - taa), 0.25);
    hc = hcf > hcn ? hcf : hcn;
    xn = (p5 + p4 * hc - p2 * Math.pow(xf, 4)) / (100 + p3 * hc);
    if (++n > 150) return { pmv: NaN, ppd: NaN, converged: false };
  }
  const tcl = 100 * xn - 273;
  const hl1 = 3.05e-3 * (5733 - 6.99 * mw - pa);
  const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
  const hl3 = 1.7e-5 * m * (5867 - pa);
  const hl4 = 0.0014 * m * (34 - ta);
  const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4));
  const hl6 = fcl * hc * (tcl - ta);
  const ts = 0.303 * Math.exp(-0.036 * m) + 0.028;
  const pmv = ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
  const ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
  const inRange = ta >= 10 && ta <= 30 && tr >= 10 && tr <= 40 && vr >= 0 && vr <= 1 && pa >= 0 && pa <= 2700 && met >= 0.8 && met <= 4 && clo >= 0 && clo <= 2 && pmv >= -2 && pmv <= 2;
  return { pmv, ppd, tcl, converged: true, inRange };
}

/** ISO 7730 Annex A category from PMV (A: |PMV| < 0.2, B: < 0.5, C: < 0.7). */
function pmvCategory(pmv) {
  const a = Math.abs(pmv);
  return a < 0.2 ? 'A' : a < 0.5 ? 'B' : a < 0.7 ? 'C' : 'out';
}

/** Months (1–12) in which winter clothing applies: heating-season months by hemisphere; none within the tropics. */
function defaultWinterMonths(latitude) {
  if (latitude == null || Math.abs(latitude) < 23.5) return [];
  return latitude >= 0 ? [1, 2, 3, 4, 10, 11, 12] : [5, 6, 7, 8, 9];
}

/** Exponentially weighted running mean of daily mean outdoor temperature (EN 16798-1, α = 0.8). */
function runningMeanOutdoor(dailyMeans, alpha = 0.8) {
  const out = new Array(dailyMeans.length).fill(null);
  // Seed with the mean of the last 7 days of the year so January has a defined value (cyclic year).
  const tail = dailyMeans.slice(-7).filter(x => x != null);
  let trm = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : dailyMeans.find(x => x != null);
  for (let d = 0; d < dailyMeans.length; d++) {
    out[d] = trm;
    if (dailyMeans[d] != null) trm = (1 - alpha) * dailyMeans[d] + alpha * trm;
  }
  return out;
}

/**
 * Zone thermal comfort over occupied hours.
 * series: { tair, tmrt, top, rh, occ } Float32Array; time: { month, day, hour }; site.tout
 */
function zoneComfort(series, time, opts) {
  const { airSpeed = 0.1, met = 1.2, cloWinter = 1.0, cloSummer = 0.5, winterMonths = [], mechanicalCooling = true, siteTout = null } = opts;
  const n = time.n;
  if (!series.tair || !series.tmrt || !series.rh) return { supported: false, reason: 'Zone air temperature, mean radiant temperature or humidity was not reported.' };
  const occ = series.occ;
  const pmv = new Float32Array(n).fill(NaN);
  const ppd = new Float32Array(n).fill(NaN);
  let occHours = 0, sumPpd = 0, outRange = 0;
  const cat = { A: 0, B: 0, C: 0, out: 0 };
  let hot = 0, cold = 0;
  for (let i = 0; i < n; i++) {
    if (occ && !(occ[i] > 0)) continue;
    const clo = winterMonths.includes(time.month[i]) ? cloWinter : cloSummer;
    const r = pmvPpd(series.tair[i], series.tmrt[i], airSpeed, series.rh[i], met, clo);
    if (!r.converged) continue;
    pmv[i] = r.pmv; ppd[i] = r.ppd;
    occHours++; sumPpd += r.ppd;
    if (!r.inRange) outRange++;
    cat[pmvCategory(r.pmv)]++;
    if (r.pmv > 0.5) hot++; else if (r.pmv < -0.5) cold++;
  }
  const result = {
    supported: true,
    pmv, ppd,
    occupiedHours: occHours,
    meanPpd: occHours ? sumPpd / occHours : null,
    categoryShare: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, occHours ? v / occHours : null])),
    hoursOutsideB: hot + cold, hoursWarm: hot, hoursCool: cold,
    outOfRangeHours: outRange,
  };
  // Operative temperature statistics.
  if (series.top) {
    let s = 0, c = 0, max = -Infinity, over26 = 0, under20 = 0;
    for (let i = 0; i < n; i++) {
      if (occ && !(occ[i] > 0)) continue;
      const t = series.top[i];
      s += t; c++; if (t > max) max = t;
      if (t > 26) over26++;
      if (t < 20) under20++;
    }
    result.operative = { mean: c ? s / c : null, max: c ? max : null, hoursAbove26: over26, hoursBelow20: under20 };
  }
  // Adaptive comfort (only meaningful without mechanical cooling).
  if (siteTout) {
    const daily = [];
    for (let i = 0; i < n; i += 24) { let s = 0; for (let j = i; j < i + 24 && j < n; j++) s += siteTout[j]; daily.push(s / Math.min(24, n - i)); }
    const trm = runningMeanOutdoor(daily);
    if (mechanicalCooling) {
      result.adaptive = { supported: false, reason: 'The adaptive models apply only to occupant-controlled, naturally conditioned spaces without mechanical cooling. This zone is cooled in the model.' };
    } else if (series.top) {
      const en = { I: 0, II: 0, III: 0, out: 0, notApplicable: 0 };
      let ash80 = 0, ash90 = 0, ashNA = 0, cnt = 0;
      for (let i = 0; i < n; i++) {
        if (occ && !(occ[i] > 0)) continue;
        cnt++;
        const r = trm[Math.floor(i / 24)];
        const t = series.top[i];
        if (r > 10 && r < 30) {
          const c = 0.33 * r + 18.8;
          const d = t - c;
          if (d <= 2 && d >= -3) en.I++; else if (d <= 3 && d >= -4) en.II++; else if (d <= 4 && d >= -5) en.III++; else en.out++;
        } else en.notApplicable++;
        if (r >= 10 && r <= 33.5) {
          const c = 0.31 * r + 17.8;
          if (Math.abs(t - c) <= 2.5) ash90++;
          if (Math.abs(t - c) <= 3.5) ash80++;
        } else ashNA++;
      }
      result.adaptive = {
        supported: true,
        en16798: Object.fromEntries(Object.entries(en).map(([k, v]) => [k, cnt ? v / cnt : null])),
        ashrae55: { within90: cnt ? ash90 / cnt : null, within80: cnt ? ash80 / cnt : null, notApplicable: cnt ? ashNA / cnt : null },
        occupiedHours: cnt,
      };
    }
  }
  return result;
}

/** CO₂ during occupied hours. Thresholds: EN 16798-1:2019 Annex B (above outdoor) and an absolute 1000 ppm indicator. */
function zoneCo2(series, outdoorPpm) {
  if (!series.co2) return { supported: false, reason: 'CO₂ was not modelled (enable the zone CO₂ balance).' };
  const occ = series.occ;
  let s = 0, c = 0, max = -Infinity, over1000 = 0, overCatII = 0, overCatI = 0;
  for (let i = 0; i < series.co2.length; i++) {
    if (occ && !(occ[i] > 0)) continue;
    const v = series.co2[i];
    s += v; c++; if (v > max) max = v;
    if (v > 1000) over1000++;
    if (v - outdoorPpm > 800) overCatII++;
    if (v - outdoorPpm > 550) overCatI++;
  }
  return { supported: true, occupiedHours: c, mean: c ? s / c : null, max: c ? max : null, hoursOver1000: over1000, hoursOverCatII: overCatII, hoursOverCatI: overCatI };
}

/** Daylight at the zone reference point during occupied daytime hours. */
function zoneDaylight(series, threshold = 300) {
  if (!series.lux) return { supported: false, reason: 'No daylighting reference point in this zone (no floor polygon centroid inside the zone, or daylighting disabled).' };
  const occ = series.occ;
  let c = 0, above = 0, udiLow = 0, udiUseful = 0, udiHigh = 0, glare = 0;
  for (let i = 0; i < series.lux.length; i++) {
    if (occ && !(occ[i] > 0)) continue;
    c++;
    const e = series.lux[i];
    if (e >= threshold) above++;
    if (e < 100) udiLow++; else if (e <= 2000) udiUseful++; else udiHigh++;
    if (series.dgi && series.dgi[i] > 22) glare++;
  }
  return {
    supported: true, occupiedHours: c,
    autonomy: c ? above / c : null,
    udi: { fellShort: c ? udiLow / c : null, useful: c ? udiUseful / c : null, exceeded: c ? udiHigh / c : null },
    glareHours: series.dgi ? glare : null,
  };
}

Object.assign(window, { pmvPpd, pmvCategory, defaultWinterMonths, runningMeanOutdoor, zoneComfort, zoneCo2, zoneDaylight });
