(() => {
  const J_PER_KWH = 36e5;
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ZONE_SERIES = {
    "Zone Mean Air Temperature": "tair",
    "Zone Operative Temperature": "top",
    "Zone Mean Radiant Temperature": "tmrt",
    "Zone Air Relative Humidity": "rh",
    "Zone People Occupant Count": "occ",
    "Zone Ideal Loads Supply Air Total Heating Energy": "heat",
    "Zone Ideal Loads Supply Air Total Cooling Energy": "cool",
    "Zone Ideal Loads Zone Sensible Heating Energy": "heatSens",
    "Zone Ideal Loads Zone Sensible Cooling Energy": "coolSens",
    "Zone Ideal Loads Outdoor Air Standard Density Volume Flow Rate": "oa",
    "Zone Infiltration Standard Density Volume Flow Rate": "inf",
    "Zone Ventilation Standard Density Volume Flow Rate": "natvent",
    "Enclosure Windows Total Transmitted Solar Radiation Energy": "solarIn",
    "Zone Air CO2 Concentration": "co2",
    "Daylighting Reference Point 1 Illuminance": "lux",
    "Daylighting Reference Point 1 Glare Index": "dgi",
    "Zone Ideal Loads Supply Air Total Heating Fuel Energy": "heatFuel",
    "Zone Ideal Loads Supply Air Total Cooling Fuel Energy": "coolFuel",
    "Zone Lights Electricity Energy": "lights",
    "Zone Electric Equipment Electricity Energy": "equip"
  };
  const SITE_SERIES = {
    "Site Outdoor Air Drybulb Temperature": "tout",
    "Site Outdoor Air Relative Humidity": "rhout",
    "Site Wind Speed": "wind",
    "Site Wind Direction": "windDir",
    "Site Direct Solar Radiation Rate per Area": "beam",
    "Site Diffuse Solar Radiation Rate per Area": "diffuse",
    "Site Solar Altitude Angle": "solarAlt",
    "Site Solar Azimuth Angle": "solarAz"
  };
  function sumArr(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
  }
  function maxIdx(a) {
    let b = 0;
    for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
    return b;
  }
  function parseResults(run, tm, names, extra = {}) {
    const eso = run.eso;
    if (!run.success || !eso) throw new Error("The run did not produce results");
    const upper = (m) => {
      const r = /* @__PURE__ */ new Map();
      m.forEach((n2, id) => r.set(String(n2).toUpperCase(), id));
      return r;
    };
    const zoneByName = upper(names.zone);
    if (names.objectZone) names.objectZone.forEach((zk, n2) => zoneByName.set(String(n2).toUpperCase(), zk));
    const surfByName = upper(names.surface);
    const subByName = upper(names.subsurface);
    const zones = new Map(tm.zones.map((z) => [z.key, { key: z.key, series: {}, annual: {}, peaks: {} }]));
    const site = {};
    const surfaces = /* @__PURE__ */ new Map();
    const windows = /* @__PURE__ */ new Map();
    const meters = {};
    let time = null;
    const timeOf = (ts) => {
      const T = ts.timestamps;
      const n2 = ts.values.length;
      const month = new Uint8Array(n2), day = new Uint8Array(n2), hour = new Uint8Array(n2), dow = new Uint8Array(n2);
      for (let i = 0; i < n2; i++) {
        const r = ts.timeIndex[i];
        month[i] = T.month[r];
        day[i] = T.day[r];
        hour[i] = T.hour[r];
      }
      return { n: n2, month, day, hour, dow };
    };
    eso.timeSeries.forEach((ts, id) => {
      const v = ts.variable || eso.variables.get(id);
      if (!v) return;
      const key = String(v.keyValue || "").toUpperCase();
      const freq = String(v.reportFrequency || "").toLowerCase();
      if (freq.startsWith("hour") && !time) time = timeOf(ts);
      const zf = ZONE_SERIES[v.variableName];
      if (zf && freq.startsWith("hour")) {
        const zk = zoneByName.get(key);
        if (zk && zones.has(zk)) zones.get(zk).series[zf] = Float32Array.from(ts.values);
        return;
      }
      const sf = SITE_SERIES[v.variableName];
      if (sf && freq.startsWith("hour")) {
        site[sf] = Float32Array.from(ts.values);
        return;
      }
      if (freq.startsWith("month")) {
        if (v.variableName === "Surface Outside Face Incident Solar Radiation Rate per Area") {
          const sid = surfByName.get(key);
          if (sid) surfaces.set(sid, { ...surfaces.get(sid) || {}, incident: Array.from(ts.values) });
          const wid = subByName.get(key);
          if (wid) windows.set(wid, { ...windows.get(wid) || {}, incident: Array.from(ts.values) });
        } else if (v.variableName === "Surface Inside Face Temperature") {
          const sid = surfByName.get(key);
          if (sid) surfaces.set(sid, { ...surfaces.get(sid) || {}, tInside: Array.from(ts.values) });
        } else if (v.variableName === "Surface Window Transmitted Solar Radiation Energy") {
          const wid = subByName.get(key);
          if (wid) windows.set(wid, { ...windows.get(wid) || {}, transmitted: Array.from(ts.values) });
        }
      }
    });
    if (!time) throw new Error("No hourly output was reported");
    ["lights", "equip"].forEach((k) => {
      let acc = null;
      zones.forEach((z) => {
        const s = z.series[k];
        if (!s) return;
        if (!acc) acc = new Float64Array(s.length);
        for (let i = 0; i < s.length; i++) acc[i] += s[i];
      });
      if (acc) meters[k === "lights" ? "lights" : "equipment"] = acc;
    });
    const months = time.month;
    const monthly = (arr, scale = 1) => {
      const out = new Array(12).fill(0);
      if (!arr) return null;
      for (let i = 0; i < arr.length; i++) out[months[i] - 1] += arr[i] * scale;
      return out;
    };
    const n = time.n;
    const bheat = new Float64Array(n), bcool = new Float64Array(n), bheatFuel = new Float64Array(n), bcoolFuel = new Float64Array(n);
    let haveFuel = false;
    zones.forEach((z) => {
      const s = z.series;
      const zone = tm.zoneByKey.get(z.key);
      if (s.heat) {
        for (let i = 0; i < n; i++) bheat[i] += s.heat[i];
      }
      if (s.cool) {
        for (let i = 0; i < n; i++) bcool[i] += s.cool[i];
      }
      if (s.heatFuel) {
        haveFuel = true;
        for (let i = 0; i < n; i++) bheatFuel[i] += s.heatFuel[i];
      }
      if (s.coolFuel) {
        haveFuel = true;
        for (let i = 0; i < n; i++) bcoolFuel[i] += s.coolFuel[i];
      }
      const a = z.annual;
      a.heatKWh = s.heat ? sumArr(s.heat) / J_PER_KWH : null;
      a.coolKWh = s.cool ? sumArr(s.cool) / J_PER_KWH : null;
      a.heatKWhm2 = a.heatKWh != null && zone.floorArea ? a.heatKWh / zone.floorArea : null;
      a.coolKWhm2 = a.coolKWh != null && zone.floorArea ? a.coolKWh / zone.floorArea : null;
      if (s.heat) {
        const i = maxIdx(s.heat);
        z.peaks.heatW = s.heat[i] / 3600;
        z.peaks.heatAt = i;
        z.peaks.heatWm2 = zone.floorArea ? z.peaks.heatW / zone.floorArea : null;
      }
      if (s.cool) {
        const i = maxIdx(s.cool);
        z.peaks.coolW = s.cool[i] / 3600;
        z.peaks.coolAt = i;
        z.peaks.coolWm2 = zone.floorArea ? z.peaks.coolW / zone.floorArea : null;
      }
      if (s.tair) {
        a.tairMean = sumArr(s.tair) / n;
        a.tairMax = Math.max(...s.tair);
        a.tairMin = Math.min(...s.tair);
      }
      if (s.top) {
        a.topMax = Math.max(...s.top);
      }
      if (s.co2) {
        a.co2Max = Math.max(...s.co2);
      }
      if (s.oa && zone.volume) {
        let sum = 0, cnt = 0;
        for (let i = 0; i < n; i++) if (s.occ && s.occ[i] > 0) {
          sum += s.oa[i] * 3600 / zone.volume;
          cnt++;
        }
        a.oaAchOccupied = cnt ? sum / cnt : null;
      }
      if (s.inf && zone.volume) a.infAchMean = sumArr(s.inf) * 3600 / zone.volume / n;
      if (s.solarIn) a.solarInKWh = sumArr(s.solarIn) / J_PER_KWH;
      a.monthlyHeatKWh = monthly(s.heat, 1 / J_PER_KWH);
      a.monthlyCoolKWh = monthly(s.cool, 1 / J_PER_KWH);
    });
    const floorArea = extra.floorArea || tm.zones.filter((z) => !extra.conditioned || extra.conditioned.has(z.key)).reduce((t, z) => t + z.floorArea, 0);
    const pkH = maxIdx(bheat), pkC = maxIdx(bcool);
    const lightsKWh = meters.lights ? sumArr(meters.lights) / J_PER_KWH : null;
    const equipKWh = meters.equipment ? sumArr(meters.equipment) / J_PER_KWH : null;
    const building = {
      floorArea,
      heatKWh: sumArr(bheat) / J_PER_KWH,
      coolKWh: sumArr(bcool) / J_PER_KWH,
      heatHourlyKWh: Float32Array.from(bheat, (x) => x / J_PER_KWH),
      coolHourlyKWh: Float32Array.from(bcool, (x) => x / J_PER_KWH),
      monthlyHeatKWh: monthly(bheat, 1 / J_PER_KWH),
      monthlyCoolKWh: monthly(bcool, 1 / J_PER_KWH),
      peakHeatKW: bheat[pkH] / 3600 / 1e3,
      peakHeatAt: pkH,
      peakCoolKW: bcool[pkC] / 3600 / 1e3,
      peakCoolAt: pkC,
      lightsKWh,
      equipKWh,
      monthlyLightsKWh: monthly(meters.lights, 1 / J_PER_KWH),
      monthlyEquipKWh: monthly(meters.equipment, 1 / J_PER_KWH),
      fuel: haveFuel ? {
        heatingKWh: sumArr(bheatFuel) / J_PER_KWH,
        coolingKWh: sumArr(bcoolFuel) / J_PER_KWH,
        monthlyHeatingKWh: monthly(bheatFuel, 1 / J_PER_KWH),
        monthlyCoolingKWh: monthly(bcoolFuel, 1 / J_PER_KWH)
      } : null
    };
    building.heatKWhm2 = floorArea ? building.heatKWh / floorArea : null;
    building.coolKWhm2 = floorArea ? building.coolKWh / floorArea : null;
    building.euiKWhm2 = building.fuel && floorArea ? (building.fuel.heatingKWh + building.fuel.coolingKWh + (lightsKWh || 0) + (equipKWh || 0)) / floorArea : null;
    surfaces.forEach((s) => {
      if (s.incident) {
        const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        s.monthlyKWhm2 = s.incident.map((w, i) => w * days[i] * 24 / 1e3);
        s.annualKWhm2 = s.monthlyKWhm2.reduce((a, b) => a + b, 0);
      }
    });
    windows.forEach((w) => {
      if (w.transmitted) w.annualKWh = w.transmitted.reduce((a, b) => a + b, 0) / J_PER_KWH;
    });
    const entries = run.err && run.err.entries || [];
    return {
      meta: {
        engine: eso.programVersion || `EnergyPlus ${window.EP_SCHEMA ? window.EP_SCHEMA.version : ""}`,
        warnings: entries.filter((e) => e.severity === "warning").length,
        severe: entries.filter((e) => e.severity === "severe").length,
        errEntries: entries.filter((e) => e.severity !== "info").slice(0, 400).map((e) => ({ severity: e.severity, message: e.message, count: e.count || 1 })),
        runSeconds: extra.runSeconds || null,
        hours: n,
        scenario: extra.scenario || "Baseline",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      time,
      zones,
      site,
      surfaces,
      windows,
      building
    };
  }
  Object.assign(window, { parseResults, J_PER_KWH, MONTH_NAMES, ZONE_SERIES });
})();
