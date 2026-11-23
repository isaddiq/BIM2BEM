(() => {
  async function sha256Hex(data) {
    const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const csv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const baseName = (ctx) => ctx.model ? ctx.model.fileName.replace(/\.[^.]+$/, "") : "bim2bem";
  function zonesCsv(tm) {
    return csv([
      ["Zone", "Source", "IfcSpace GlobalIds", "Floor area m2", "Volume m3", "Ceiling height m", "Exterior surfaces", "Ground surfaces", "Interzone surfaces", "Adiabatic surfaces", "Window area m2"],
      ...tm.zones.map((z) => {
        const ss = z.surfaceIds.map((id) => tm.surfById.get(id));
        const win = ss.flatMap((s) => s.subsurfaceIds).map((id) => tm.subsurfaces.find((w) => w.id === id)).filter((w) => w && w.type === "Window").reduce((t, w) => t + w.area, 0);
        return [z.name, z.source, z.globalIds.join(" "), z.floorArea.toFixed(3), z.volume.toFixed(3), z.ceilingHeight.toFixed(3), ss.filter((s) => s.bc === "Outdoors").length, ss.filter((s) => s.bc === "Ground").length, ss.filter((s) => s.bc === "Surface").length, ss.filter((s) => s.bc === "Adiabatic").length, win.toFixed(3)];
      })
    ]);
  }
  function resultsCsv(tm, res) {
    const head = ["Hour", "Month", "Day", "Hour of day", "Outdoor dry-bulb C", "Building heating kWh", "Building cooling kWh"];
    const rows = [head];
    for (let i = 0; i < res.time.n; i++) rows.push([i + 1, res.time.month[i], res.time.day[i], res.time.hour[i], res.site.tout ? res.site.tout[i].toFixed(2) : "", res.building.heatHourlyKWh[i].toFixed(4), res.building.coolHourlyKWh[i].toFixed(4)]);
    return csv(rows);
  }
  function zoneResultsCsv(tm, res) {
    return csv([
      ["Zone", "Floor area m2", "Heating kWh", "Heating kWh/m2", "Cooling kWh", "Cooling kWh/m2", "Peak heating W", "Peak cooling W", "Mean air C", "Max air C", "Max operative C", "Max CO2 ppm", "Mean infiltration ach", "Occupied OA ach", "Window solar kWh"],
      ...tm.zones.map((z) => {
        const r = res.zones.get(z.key);
        const a = r.annual;
        return [z.name, z.floorArea.toFixed(2), a.heatKWh, a.heatKWhm2, a.coolKWh, a.coolKWhm2, r.peaks.heatW, r.peaks.coolW, a.tairMean, a.tairMax, a.topMax, a.co2Max, a.infAchMean, a.oaAchOccupied, a.solarInKWh].map((v) => typeof v === "number" ? +v.toFixed(3) : v);
      })
    ]);
  }
  function ieqCsv(tm, ieq) {
    return csv([
      ["Zone", "Occupied h", "PMV cat A share", "B share", "C share", "Outside share", "Mean PPD %", "Operative >26C h", "CO2 mean ppm", "CO2 max ppm", "CO2 >1000 h", "Daylight autonomy share", "UDI useful share"],
      ...tm.zones.map((z) => {
        const q = ieq.zones.get(z.key);
        if (!q) return [z.name];
        const c = q.comfort, s = c.categoryShare || {};
        return [z.name, c.occupiedHours, s.A, s.B, s.C, s.out, c.meanPpd, c.operative && c.operative.hoursAbove26, q.co2.mean, q.co2.max, q.co2.hoursOver1000, q.daylight.autonomy, q.daylight.udi && q.daylight.udi.useful].map((v) => typeof v === "number" ? +v.toFixed(4) : v == null ? "" : v);
      })
    ]);
  }
  function assumptionsJson(ctx) {
    const c = ctx.config;
    return {
      location: ctx.location,
      building: { northAngle: ctx.location.northAngle, terrain: ctx.location.terrain },
      loads: c.loads,
      loadSources: c.loadSources,
      infiltrationAch: c.infiltrationAch,
      schedule: c.schedule,
      setpoints: c.setpoints,
      hvac: c.hvac,
      naturalVentilation: c.natvent,
      comfort: c.comfort,
      co2: c.co2,
      daylight: c.daylight,
      run: c.run,
      constructionOverrides: c.constructionOverrides,
      glazingOverrides: c.glazingOverrides,
      zoneOverrides: c.zoneOverrides,
      conversion: ctx.tm ? ctx.tm.options : null,
      referenceLibrary: LIBRARY_MATERIALS.map((m) => ({ id: m.id, name: m.name, conductivity: m.conductivity, density: m.density, specificHeat: m.specificHeat, source: m.source })),
      surfaceResistances: { values: SURFACE_RESISTANCE, source: SURFACE_RESISTANCE_SOURCE }
    };
  }
  async function manifestJson(ctx) {
    const run = ctx.runs[ctx.activeId];
    return {
      generator: "BIM2BEM",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      ifc: ctx.model ? { fileName: ctx.model.fileName, bytes: ctx.model.fileSize, sha256: ctx.model.fileSha256 || null, schema: ctx.model.schemaVersion } : null,
      parser: "web-ifc 0.0.35",
      engine: { energyPlus: ENGINE_INFO.energyPlus, loader: ENGINE_INFO.loader, assets: engineSource() },
      weather: ctx.weather ? { name: ctx.weather.meta.name, provider: ctx.weather.meta.provider, classification: ctx.weather.meta.classification, url: ctx.weather.meta.url || null, sha256: await sha256Hex(ctx.weather.text), latitude: ctx.weather.meta.latitude, longitude: ctx.weather.meta.longitude, distanceKm: ctx.weather.meta.distanceKm } : null,
      scenario: ctx.scenarios.find((s) => s.id === ctx.activeId) || null,
      idfSha256: run && run.idf ? await sha256Hex(run.idf) : null,
      resultsSummary: run && run.results ? { heatKWh: run.results.building.heatKWh, coolKWh: run.results.building.coolKWh, peakHeatKW: run.results.building.peakHeatKW, peakCoolKW: run.results.building.peakCoolKW, warnings: run.results.meta.warnings, severe: run.results.meta.severe } : null,
      conversion: ctx.tm ? {
        stats: ctx.tm.stats,
        options: ctx.tm.options,
        surfaceGeometry: ctx.tm.boundaries ? { mode: ctx.tm.boundaries.mode, boundariesInFile: ctx.tm.boundaries.inFile, secondLevel: ctx.tm.boundaries.secondLevel, pairsFromCorrespondingBoundary: ctx.tm.boundaries.pairsFromIfc || 0, spaces: ctx.tm.boundaries.spaces.map((s) => ({ ifcGlobalId: s.globalId, name: s.name, source: s.source, origin: s.source === "IfcRelSpaceBoundary" ? "extracted from the IFC" : "reconstructed by the conversion", forced: s.forced, reason: s.source === "IfcRelSpaceBoundary" ? null : s.reason, checks: s.checks })) } : null,
        issues: ctx.tm.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message }))
      } : null,
      assumptions: assumptionsJson(ctx)
    };
  }
  function svgBars(categories, series, unit, w = 640, h = 220) {
    const m = { l: 50, r: 10, t: 12, b: 24 };
    const max = Math.max(1e-9, ...series.flatMap((s2) => s2.values.filter((v) => v != null)));
    const ticks = niceTicks(0, max, 4);
    const top = Math.max(max, ticks[ticks.length - 1]);
    const iw = w - m.l - m.r, ih = h - m.t - m.b, band = iw / categories.length, bw = Math.min(22, band * 0.7 / series.length);
    const y = (v) => m.t + ih - v / top * ih;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="IBM Plex Sans, sans-serif" font-size="10">`;
    ticks.forEach((t) => {
      s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e4e3df"/><text x="${m.l - 4}" y="${y(t) + 3}" text-anchor="end" fill="#52514e">${fmt(t, 0)}</text>`;
    });
    s += `<text x="4" y="10" fill="#52514e">${esc(unit)}</text>`;
    categories.forEach((c, i) => {
      const x0 = m.l + i * band + (band - bw * series.length - 2 * (series.length - 1)) / 2;
      series.forEach((se, k) => {
        const v = se.values[i] || 0;
        if (v > 0) s += `<rect x="${x0 + k * (bw + 2)}" y="${y(v)}" width="${bw}" height="${m.t + ih - y(v)}" rx="2" fill="${se.color}"/>`;
      });
      s += `<text x="${m.l + i * band + band / 2}" y="${h - 8}" text-anchor="middle" fill="#52514e">${esc(c)}</text>`;
    });
    s += "</svg>";
    return s;
  }
  function reportHtml(ctx) {
    const { model, location, weather, tm, config, runs, scenarios, activeId, ieq, issues } = ctx;
    const run = runs[activeId];
    const res = run && run.status === "done" ? run.results : null;
    const b = res && res.building;
    const sec = [];
    const kv = (rows) => `<table class="kv">${rows.filter(Boolean).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>`;
    const table = (head, rows) => `<table class="t"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const n = (v, d = 1) => fmt(v, d);
    sec.push(["Building identification", kv([["IFC file", esc(model.fileName)], ["Schema", esc(model.schemaVersion)], ["Project", esc(elementLabel(model.project))], ["Building", esc(model.building.name || "\u2014")], ["File SHA-256", `<code>${esc(model.fileSha256 || "\u2014")}</code>`]])]);
    sec.push(["Geographic location", kv([["Latitude, longitude", `${n(location.latitude, 5)}, ${n(location.longitude, 5)}`], ["Elevation", `${n(location.elevation, 1)} m`], ["Time zone", esc(location.timeZoneName || "\u2014")], ["North angle", `${n(location.northAngle, 1)}\xB0`], ["Address", esc(location.address || "\u2014")], ["Sources", esc(Object.entries(location.source).map(([k, v]) => `${k}: ${v}`).join("; "))]])]);
    sec.push(["IFC model summary", kv([["Elements", model.elements.length.toLocaleString()], ["Storeys", model.storeys.length], ["Spaces", (model.byClass.get("IfcSpace") || []).length], ["Windows", ["IfcWindow", "IfcWindowStandardCase"].reduce((t, c) => t + (model.byClass.get(c) || []).length, 0)], ["Triangles", model.stats.triangles.toLocaleString()]])]);
    if (tm) {
      const nSb = tm.stats.zonesFromIfcBoundaries || 0;
      const sbText = nSb ? `Surfaces of ${nSb} of ${tm.stats.zones} zones are the file's second-level space boundaries (IfcRelSpaceBoundary2ndLevel), checked against the IfcSpace bodies (closed, outward normals, area and volume within ${(tm.options.boundaryTolerance * 100).toFixed(0)}%); interzone pairs from CorrespondingBoundary, boundary conditions from InternalOrExternalBoundary (cross-checked by ray tests), openings from window and door boundaries.${nSb < tm.stats.zones ? " Surfaces of the other zones are reconstructed:" : ""}` : `Boundaries reconstructed geometrically${tm.boundaries && tm.boundaries.secondLevel ? " (the file has second-level space boundaries, but they failed the completeness checks; see the checks)" : tm.options.boundarySource === "reconstructed" ? " (IFC space boundaries switched off)" : " (the file has no second-level space boundaries)"}:`;
      sec.push(["BEM model generation", `<p>Zones from ${tm.options.zoning === "spaces" ? "IfcSpace elements" : "storey slab outlines (manual zoning)"}. ${sbText}${nSb < tm.stats.zones ? ` facing zone surfaces within ${tm.options.maxWallGap} m / ${tm.options.maxSlabGap} m become interzone pairs; others are classified by ray tests through the IFC elements.` : ""} Surfaces next to building parts without a zone: ${tm.options.unmodelled}.</p>` + kv([["Surface geometry source", nSb ? `IfcRelSpaceBoundary2ndLevel: ${nSb} zones, ${tm.stats.surfacesFromIfcBoundaries} surfaces; reconstructed: ${tm.stats.zones - nSb} zones` : "Reconstructed from IfcSpace bodies"], ["Zones", tm.stats.zones], ["Surfaces", `${tm.stats.surfaces} (${tm.stats.exterior} outdoor, ${tm.stats.ground} ground, ${tm.stats.interzonePairs} interzone pairs, ${tm.stats.adiabatic} adiabatic)`], ["Windows / doors", `${tm.stats.windows} / ${tm.stats.doors}`], ["Window area", `${n(tm.stats.windowArea, 1)} m\xB2`], ["Conditioned floor area", `${n(tm.stats.floorArea, 1)} m\xB2`]])]);
      sec.push(["Thermal zones", table(["Zone", "Area m\xB2", "Volume m\xB3", "Height m", "Source"], tm.zones.map((z) => [z.name, n(z.floorArea, 1), n(z.volume, 0), n(z.ceilingHeight, 2), z.source]))]);
      sec.push(["Material properties and constructions", table(["Construction", "Origin", "U W/m\xB2K", "Layers (outside first)"], [...tm.constructions.values()].filter((c) => !c.reversedOf).map((c) => {
        const ls = (config.constructionOverrides[c.key] || {}).layers || c.layers;
        return [c.name, config.constructionOverrides[c.key] ? "user" : c.origin, n(uValueOf(ls, c.rcat), 3), ls.map((l) => l.resistance != null ? `R ${n(l.resistance, 3)}` : `${l.name} ${Math.round(l.thickness * 1e3)} mm \u03BB${l.conductivity}`).join(" | ")];
      })) + table(["Glazing", "U", "g", "\u03C4v", "Origin"], [...tm.windowTypes.values()].map((g) => {
        const v = { ...g, ...config.glazingOverrides[g.key] || {} };
        return [g.name, n(v.uFactor, 2), n(v.shgc, 2), n(v.vt, 2), g.origin];
      }))]);
    }
    if (weather) sec.push(["Weather data", kv([["Dataset", esc(weather.meta.name)], ["Source", esc(weather.meta.provider)], ["Type", esc(weather.meta.classification)], ["Location in file", `${n(weather.meta.latitude, 3)}, ${n(weather.meta.longitude, 3)}, ${n(weather.meta.elevation, 0)} m`], ["Distance to building", `${n(weather.meta.distanceKm, 1)} km`], ["HDD18 / CDD10", `${n(weather.stats.hdd18, 0)} / ${n(weather.stats.cdd10, 0)} K\xB7d`], ["Climate zone (ASHRAE 169 thresholds)", weather.stats.climateZone], ["Licence", esc(weather.meta.license || "\u2014")]])]);
    if (res) {
      sec.push(["Energy performance", `<p>Scenario: <b>${esc(scenarios.find((s) => s.id === activeId).name)}</b>. Ideal-loads thermal demand (not fuel or electricity), EnergyPlus ${esc(res.meta.engine)}, ${res.meta.hours} hours, ${res.meta.warnings} warnings, ${res.meta.severe} severe errors.</p>` + kv([["Heating demand", `${n(b.heatKWhm2)} kWh/m\xB2\xB7a (${n(b.heatKWh, 0)} kWh)`], ["Cooling demand", `${n(b.coolKWhm2)} kWh/m\xB2\xB7a (${n(b.coolKWh, 0)} kWh)`], ["Peak heating (hourly mean)", `${n(b.peakHeatKW)} kW`], ["Peak cooling (hourly mean)", `${n(b.peakCoolKW)} kW`], ["Lighting / equipment", `${n(b.lightsKWh / b.floorArea)} / ${n(b.equipKWh / b.floorArea)} kWh/m\xB2\xB7a`], b.fuel ? ["EUI (modelled end uses, constant efficiencies)", `${n(b.euiKWhm2)} kWh/m\xB2\xB7a`] : null]) + svgBars(MONTH_NAMES, [{ values: b.monthlyHeatKWh, color: "#eb6834" }, { values: b.monthlyCoolKWh, color: "#2a78d6" }], "kWh (heating orange, cooling blue)")]);
      if (ieq) sec.push(["Indoor environmental quality", "<p>Reported separately; no composite score is computed.</p>" + table(["Zone", "PMV cat. B or better %", "Mean PPD %", "CO\u2082 max ppm", "CO\u2082 >1000 ppm h", "Daylight \u2265 setpoint %"], tm.zones.map((z) => {
        const q = ieq.zones.get(z.key);
        if (!q) return [z.name, "", "", "", "", ""];
        const s = q.comfort.categoryShare || {};
        return [z.name, q.comfort.occupiedHours ? n(((s.A || 0) + (s.B || 0)) * 100, 0) : "\u2014", n(q.comfort.meanPpd, 1), q.co2.supported ? n(q.co2.max, 0) : "not modelled", q.co2.supported ? q.co2.hoursOver1000 : "", q.daylight.supported ? n(q.daylight.autonomy * 100, 0) : "\u2014"];
      })) + `<p>PMV/PPD: ISO 7730:2005 with air speed ${config.comfort.airSpeed} m/s, ${config.loads.activityMet} met, ${config.comfort.clothingWinter}/${config.comfort.clothingSummer} clo (assumed). Acoustic comfort: not assessed.</p>`]);
    }
    if (weather) sec.push(["Solar and wind analysis", kv([["Annual global horizontal", `${n(weather.stats.annualGhiKWh, 0)} kWh/m\xB2`], ["Mean wind speed", `${n(weather.rose.meanSpeed, 1)} m/s`], ["Prevailing direction", `${n(weather.rose.prevailingDeg, 0)}\xB0`], ["Calm hours", `${n(weather.rose.calm * 100, 1)}%`]]) + "<p>Wind statistics are from the weather file; no airflow network or CFD was run.</p>"]);
    const done = scenarios.filter((s) => runs[s.id] && runs[s.id].status === "done");
    if (done.length > 1) sec.push(["Scenario comparison", table(["Scenario", "Heating kWh/m\xB2", "Cooling kWh/m\xB2", "Peak heating kW", "Peak cooling kW"], done.map((s) => {
      const r = runs[s.id].results.building;
      return [s.name, n(r.heatKWhm2), n(r.coolKWhm2), n(r.peakHeatKW), n(r.peakCoolKW)];
    })) + "<p>Each scenario is a separate EnergyPlus run.</p>"]);
    sec.push(["Validation and limitations", `<ul>${issues.map((i) => `<li><b>${esc(SEV_LABEL[i.severity] || i.severity)}:</b> ${esc(i.message)}</li>`).join("")}</ul><p>Limitations: ideal loads represent thermal demand; HVAC energy (if shown) uses constant efficiencies; daylight is a single-point split-flux result; no AirflowNetwork, CFD or acoustic analysis; reference constructions and loads are assumptions where the IFC gives no data.</p>`]);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(baseName(ctx))} \xB7 BIM2BEM report</title>
<style>body{font:13px/1.5 "IBM Plex Sans",system-ui,sans-serif;color:#1b1b1a;margin:32px auto;max-width:860px;padding:0 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}.sub{color:#555}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid #eee;vertical-align:top;font-size:12px}.kv th{width:34%;color:#555;font-weight:500}.t th{background:#f5f5f3}code{font-size:11px;word-break:break-all}svg{max-width:100%}@media print{body{margin:0}h2{break-after:avoid}table{break-inside:auto}}</style></head><body>
<h1>Building performance report</h1><div class="sub">${esc(model.fileName)} \xB7 generated by BIM2BEM on ${(/* @__PURE__ */ new Date()).toLocaleString()} \xB7 EnergyPlus ${ENGINE_INFO.energyPlus}</div>
${sec.map(([t, body], i) => `<h2>${i + 1}. ${esc(t)}</h2>${body}`).join("\n")}
</body></html>`;
  }
  function ReportsPanel(ctx) {
    const { model, tm, weather, runs, activeId, toast, ieq } = ctx;
    const run = runs[activeId];
    const res = run && run.status === "done" ? run.results : null;
    const bn = baseName(ctx);
    const dl = (content, name, mime, what) => {
      download(content, name, mime);
      toast({ kind: "ok", msg: `${what} downloaded` });
    };
    const items = [
      ["EnergyPlus IDF", "The model that was simulated (active scenario).", !!(run && run.idf), () => dl(run.idf, `${bn}.idf`, "text/plain", "IDF")],
      ["epJSON", "The same model in EnergyPlus JSON; field names checked against the bundled schema.", !!(run && run.epjson), () => dl(JSON.stringify(run.epjson, null, 1), `${bn}.epJSON`, "application/json", "epJSON")],
      ["Thermal zones (CSV)", "Area, volume, height and boundary counts per zone.", !!tm, () => dl(zonesCsv(tm), `${bn}-zones.csv`, "text/csv", "Zones")],
      ["IFC \u2192 BEM mapping (JSON)", "Every IFC element with the zones, surfaces and openings it produced.", !!tm, () => dl(JSON.stringify(mappingRows(tm, model), null, 1), `${bn}-ifc-bem-mapping.json`, "application/json", "Mapping")],
      ["IFC \u2192 BEM mapping (CSV)", "Same, as a table.", !!tm, () => {
        const rows = mappingRows(tm, model);
        dl(csv([Object.keys(rows[0] || { ifcGlobalId: "" }), ...rows.map((r) => Object.values(r))]), `${bn}-ifc-bem-mapping.csv`, "text/csv", "Mapping");
      }],
      ["Hourly results (CSV)", "Building heating and cooling per hour, outdoor temperature.", !!res, () => dl(resultsCsv(tm, res), `${bn}-hourly.csv`, "text/csv", "Hourly results")],
      ["Zone results (CSV)", "Annual demand, peaks, temperatures, ventilation per zone.", !!res, () => dl(zoneResultsCsv(tm, res), `${bn}-zone-results.csv`, "text/csv", "Zone results")],
      ["IEQ results (CSV)", "Comfort categories, PPD, CO\u2082 and daylight per zone.", !!(res && ieq), () => dl(ieqCsv(tm, ieq), `${bn}-ieq.csv`, "text/csv", "IEQ results")],
      ["Environmental analysis (CSV)", "Wind rose frequencies and monthly climate from the weather file.", !!weather, () => dl(csv([["Sector deg", ...weather.rose.bins.map((b) => `>=${b} m/s`)], ...weather.rose.freq.map((r, s) => [s * 360 / weather.rose.sectors, ...r.map((f) => f.toFixed(5))]), [], ["Month", "Mean dry-bulb C", "GHI kWh/m2", "Mean wind m/s"], ...MONTH_NAMES.map((m, i) => [m, weather.stats.monthlyDryBulb[i], weather.stats.monthlyGhiKWh[i], weather.stats.monthlyWind[i]])]), `${bn}-environment.csv`, "text/csv", "Environmental data")],
      ["Input assumptions (JSON)", "Every configuration value with its source, plus the reference library.", true, () => dl(JSON.stringify(assumptionsJson(ctx), null, 1), `${bn}-assumptions.json`, "application/json", "Assumptions")],
      ["Simulation log", "EnergyPlus warnings and errors (eplusout.err entries).", !!(run && run.errEntries), () => dl(run.errEntries.map((e) => `${e.severity.toUpperCase()}${e.count > 1 ? ` (x${e.count})` : ""}: ${e.message}`).join("\n"), `${bn}-eplusout-err.txt`, "text/plain", "Log")],
      ["EnergyPlus tabular report", "eplustbl.htm written by EnergyPlus.", !!(run && run.html), () => dl(run.html, `${bn}-eplustbl.htm`, "text/html", "Tabular report")],
      ["Weather file (EPW)", "The exact weather data used.", !!weather, () => dl(weather.text, `${bn}-weather.epw`, "text/plain", "EPW")],
      ["Weather metadata (JSON)", "Source, coordinates, distance, licence, validation.", !!weather, () => dl(JSON.stringify({ meta: weather.meta, validation: weather.validation, stats: { ...weather.stats, dailyMeans: void 0 } }, null, 1), `${bn}-weather-meta.json`, "application/json", "Weather metadata")],
      ["Reproducibility manifest", "IFC and weather hashes, engine versions, settings and a results summary.", !!(model && tm), async () => dl(JSON.stringify(await manifestJson(ctx), null, 1), `${bn}-manifest.json`, "application/json", "Manifest")]
    ];
    const openReport = (print) => {
      const html = reportHtml(ctx);
      if (!print) {
        dl(html, `${bn}-report.html`, "text/html", "Report");
        return;
      }
      const w = window.open("", "_blank");
      if (!w) {
        toast({ kind: "warn", msg: "Pop-up blocked", sub: "Download the HTML report instead and print it." });
        return;
      }
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "flow" }, /* @__PURE__ */ React.createElement(SectionTitle, { icon: Icons.Report, title: "Building performance report", info: "Sections are included only for analyses that were completed. Print to PDF from the browser's print dialog." }), /* @__PURE__ */ React.createElement("div", { className: "row-actions-inline" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary btn-sm", disabled: !model, onClick: () => openReport(true) }, /* @__PURE__ */ React.createElement(Icons.Report, { size: 14 }), " Print / save as PDF"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: !model, onClick: () => openReport(false) }, /* @__PURE__ */ React.createElement(Icons.Download, { size: 14 }), " HTML report")), /* @__PURE__ */ React.createElement(SectionTitle, { icon: Icons.Download, title: "Exports" }), /* @__PURE__ */ React.createElement("ul", { className: "export-list" }, items.map(([label, desc, ok, fn]) => /* @__PURE__ */ React.createElement("li", { key: label }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, label), /* @__PURE__ */ React.createElement("div", { className: "small muted" }, desc)), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: !ok, onClick: fn }, /* @__PURE__ */ React.createElement(Icons.Download, { size: 14 }))))));
  }
  Object.assign(window, { ReportsPanel, reportHtml, sha256Hex, zonesCsv, resultsCsv, zoneResultsCsv, manifestJson, assumptionsJson });
})();
