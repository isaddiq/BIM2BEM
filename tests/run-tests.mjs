// BIM2BEM functional and numerical tests (the prompt's tests 1–10, Node part).
//
//   npm test                 offline tests (uses the bundled EPW fixture)
//   npm run test:network     also Test 4: weather built from Open-Meteo and NASA POWER
//                            for Seoul, Singapore, Berlin and Denver
//
// Each check compares against an independent reference: hand calculations from the
// generator's known inputs, ISO 7730 tabulated values, an analytical CO2 mass balance,
// EnergyPlus's own solar angles, and synthetic data with known answers. Passing these
// checks does not validate the platform as a whole; it verifies the listed behaviours.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadIfc, readText, energyPlus, disposeEngine, ROOT } from './harness.mjs';

const NETWORK = process.argv.includes('--network');
const results = [];
let current = '';
const section = (name) => { current = name; console.log(`\n${name}`); };
const check = (name, ok, detail = '') => {
  results.push({ test: current, name, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const EPW_CHICAGO = 'tests/fixtures/USA_IL_Chicago-OHare.Intl.AP.725300_TMY3.epw';

async function simulate(tm, cfg, scenario = null) {
  const out = composeIdf(tm, cfg, scenario, { fileName: 'test' });
  const crit = out.issues.filter(i => i.severity === 'critical');
  if (crit.length) throw new Error(crit[0].message);
  const ep = await energyPlus();
  const t0 = Date.now();
  const run = await ep.run({ idf: out.idf, epw: cfg.__epw, outputs: { sql: false, html: false } });
  const seconds = (Date.now() - t0) / 1000;
  const res = run.success ? parseResults(run, tm, out.names, { conditioned: out.conditioned, runSeconds: seconds }) : null;
  return { out, run, res, seconds };
}
function configFor(epwText) {
  const epw = parseEpw(epwText);
  const cfg = defaultConfig();
  Object.assign(cfg.site, { name: 'Test site', latitude: epw.header.latitude, longitude: epw.header.longitude, timeZone: epw.header.timeZone, elevation: epw.header.elevation });
  cfg.__epw = epwText;
  return cfg;
}

// ---------------------------------------------------------------------------
section('Test 1 · IFC loading (site parser, web-ifc 0.0.35)');
const models = {};
for (const [key, file, minEl] of [['demo', 'assets/ifc/BEMDemoOffice.ifc', 50], ['rc', 'assets/ifc/ResearchCentre.ifc', 500], ['large', 'assets/ifc/LargeBuilding.ifc', 150]]) {
  const t0 = Date.now();
  const m = await loadIfc(file);
  models[key] = m;
  check(`${path.basename(file)} parses`, m.elements.length >= minEl, `${m.elements.length} elements, ${m.schemaVersion}, ${Date.now() - t0} ms`);
}
const demo = models.demo;
check('IfcSpace bodies are streamed', (demo.byClass.get('IfcSpace') || []).every(id => demo.byId.get(id).geometry), `${(demo.byClass.get('IfcSpace') || []).length} spaces`);
check('IfcSite latitude read (37°33′58.68″ N)', near(demo.geoRef.latitude, 37.5663, 1e-4), demo.geoRef.latitude.toFixed(6));
check('IfcSite longitude read (126°58′40.44″ E)', near(demo.geoRef.longitude, 126.9779, 1e-4), demo.geoRef.longitude.toFixed(6));
check('TrueNorth → north angle 15°', near(demo.geoRef.northAngle, 15, 1e-6), demo.geoRef.northAngle.toFixed(4));
check('IFC4 material thermal properties read', demo.materialProps.size === 7, `${demo.materialProps.size} materials`);
check('IFC2x3 length unit (mm) read', models.large.lengthUnit.scale === 0.001, JSON.stringify(models.large.lengthUnit));

// ---------------------------------------------------------------------------
section('Test 2 · Thermal model conversion against the reference model');
const tm = await buildThermalModel(demo, {});
const st = tm.stats;
check('8 zones from 8 IfcSpaces', st.zones === 8);
check('Floor area 8 × 9.9 × 5.9 = 467.28 m²', near(st.floorArea, 467.28, 0.01), st.floorArea.toFixed(3));
check('Volume 467.28 × 3.24 = 1513.99 m³', near(st.volume, 1513.9872, 0.05), st.volume.toFixed(3));
check('Window area 2 × (12 + 12 + 9 + 9) = 84.00 m²', near(st.windowArea, 84, 0.01), st.windowArea.toFixed(3));
check('Exterior wall area 63.2 m × 3.24 m × 2 = 409.536 m²', near(st.exteriorWallArea, 409.536, 0.01), st.exteriorWallArea.toFixed(3));
check('12 interzone pairs (4 partition pairs per storey × 2 + 4 floor/ceiling pairs)', st.interzonePairs === 12, `${st.interzonePairs}`);
check('4 ground floors, 4 roofs', st.ground === 4 && tm.surfaces.filter(s => s.type === 'Roof').length === 4);
check('No adiabatic surfaces in a fully zoned building', st.adiabatic === 0);
check('All zone solids closed', tm.zones.every(z => z.closure <= 0.02));
const pairsOk = tm.surfaces.filter(s => s.partner).every(s => { const p = tm.surfById.get(s.partner); return near(s.area, p.area, 1e-6) && v3.dot(s.normal, p.normal) < -0.999; });
check('Interzone pairs: equal area, opposite normals', pairsOk);
const ext = [...tm.constructions.values()].filter(c => c.category === 'exteriorWall');
check('Exterior walls: one construction, from IFC layers', ext.length === 1 && ext[0].origin === 'ifc-layers', ext.map(c => c.name).join(', '));
check('Layer order outside → inside: render first, plaster last', ext.length && ext[0].layers[0].name === 'Cement render' && ext[0].layers[3].name === 'Gypsum plaster');
// Hand calculation, ISO 6946: R = 0.13 + 0.04 + 0.015/1.0 + 0.16/0.035 + 0.2/2.3 + 0.015/0.57
const uWall = 1 / (0.13 + 0.04 + 0.015 / 1.0 + 0.16 / 0.035 + 0.2 / 2.3 + 0.015 / 0.57);
check(`Exterior wall U = ${uWall.toFixed(4)} W/m²K (hand calculation)`, ext.length && near(ext[0].uValue, uWall, 1e-9), ext.length ? ext[0].uValue.toFixed(4) : '');
const roof = [...tm.constructions.values()].find(c => c.category === 'roof');
const uRoof = 1 / (0.10 + 0.04 + 0.22 / 0.035 + 0.2 / 2.3);
check(`Roof U = ${uRoof.toFixed(4)}, insulation outside`, roof && near(roof.uValue, uRoof, 1e-9) && roof.layers[0].name === 'Mineral wool', roof && roof.uValue.toFixed(4));
const gf = [...tm.constructions.values()].find(c => c.category === 'groundFloor');
const uGf = 1 / (0.17 + 0.25 / 2.3 + 0.1 / 0.034 + 0.06 / 1.0);
check(`Ground floor U = ${uGf.toFixed(4)} (no ground resistance), concrete outside`, gf && near(gf.uValue, uGf, 1e-9) && gf.layers[0].name === 'Reinforced concrete', gf && gf.uValue.toFixed(4));
const glz = [...tm.windowTypes.values()];
check('Glazing from IFC psets: U 1.1, g 0.45, τv 0.7', glz.length === 1 && near(glz[0].uFactor, 1.1, 1e-9) && near(glz[0].shgc, 0.45, 1e-9) && near(glz[0].vt, 0.7, 1e-9) && glz[0].origin === 'ifc');
const wallEls = (demo.byClass.get('IfcWall') || []).map(id => demo.byId.get(id)).filter(e => /Exterior/.test(e.name));
check('Every exterior IfcWall maps to analytical surfaces', wallEls.every(e => tm.mapping.get(e.expressId) && tm.mapping.get(e.expressId).surfaces.length > 0), `${wallEls.length} walls`);
check('Every IfcWindow maps to one fenestration surface', (demo.byClass.get('IfcWindow') || []).every(id => tm.mapping.get(id) && tm.mapping.get(id).subsurfaces.length === 1));
const rows = mappingRows(tm, demo);
check('Mapping export rows carry GlobalIds', rows.length > 0 && rows.every(r => r.ifcGlobalId && r.ifcGlobalId.length === 22), `${rows.length} rows`);
const tmRc = await buildThermalModel(models.rc, {});
const rcRoof = tmRc.surfaces.filter(s => s.type === 'Roof').reduce((t, s) => t + s.area, 0);
const rcGround = tmRc.surfaces.filter(s => s.bc === 'Ground').reduce((t, s) => t + s.area, 0);
check('Research centre: 56 closed zones', tmRc.zones.length === 56 && tmRc.zones.every(z => z.closure <= 0.02));
check('Research centre: stacked plan, roof area = ground area', near(rcRoof, rcGround, 0.5), `${rcRoof.toFixed(1)} / ${rcGround.toFixed(1)} m²`);
const tmLb = await buildThermalModel(models.large, {});
check('Revit sample: unresolved "Default …" materials flagged, not guessed', tmLb.unresolvedMaterials.size === 3 && [...tmLb.constructions.values()].every(c => c.origin !== 'ifc-layers'));
check('Revit sample: declared window U (Pset_WindowCommon) used', [...tmLb.windowTypes.values()].some(w => w.provenance.uFactor.startsWith('IFC')));
const tmSt = await buildThermalModel(demo, { zoning: 'storeys' });
check('Manual zoning: one zone per storey from slab outlines', tmSt.zones.length === 2, `${tmSt.zones.length} zones, ${tmSt.stats.floorArea.toFixed(1)} m²`);

// Schema validation catches errors before EnergyPlus.
const bad = new IdfModel();
bad.add('Version', null, { version_identifier: '26.2' });
bad.add('BuildingSurface:Detailed', 'S', { surface_type: 'Wal', zone_name: 'Z', outside_boundary_condition: 'Outdoors', vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] });
const badIssues = bad.validate();
check('IDF validator rejects an invalid choice ("Wal")', badIssues.some(i => i.field === 'surface_type'), badIssues.map(i => i.message).join('; '));

// ---------------------------------------------------------------------------
section('Test 3 · EnergyPlus execution (EnergyPlus 26.2 WebAssembly, Node worker)');
const chicago = readText(EPW_CHICAGO);
const cfgChi = configFor(chicago);
const base = await simulate(tm, cfgChi);
check('IDF passes schema validation', base.out.issues.filter(i => i.severity === 'critical').length === 0);
check('Run succeeds', base.run.success, `${base.seconds.toFixed(1)} s, exit ${base.run.exitCode}`);
const severe = (base.run.err?.entries || []).filter(e => e.severity === 'severe' || e.severity === 'fatal');
check('No severe or fatal errors in eplusout.err', severe.length === 0, `${(base.run.err?.entries || []).filter(e => e.severity === 'warning').length} warnings`);
const r = base.res;
check('8760 hourly records', r && r.time.n === 8760);
check('Every zone reports temperature and loads', r && tm.zones.every(z => r.zones.get(z.key).series.tair && r.zones.get(z.key).series.heat));
// Lighting energy = Σ zones LPD × area × schedule; the schedule is 1 when occupied and 0.05 otherwise.
let occHours = 0;
const occ = r.zones.get(tm.zones[0].key).series.occ;
for (let i = 0; i < occ.length; i++) if (occ[i] > 0) occHours++;
const lightsExpected = cfgChi.loads.lightingWm2 * st.floorArea * (occHours + 0.05 * (8760 - occHours)) / 1000;
check(`Lighting energy = LPD × area × schedule (${lightsExpected.toFixed(0)} kWh)`, near(r.building.lightsKWh, lightsExpected, lightsExpected * 0.005), `${r.building.lightsKWh.toFixed(1)} kWh`);
check('Heating and cooling demand are positive and finite', r.building.heatKWh > 0 && r.building.coolKWh > 0 && Number.isFinite(r.building.heatKWh));
console.log(`        Chicago TMY3: heating ${r.building.heatKWhm2.toFixed(1)}, cooling ${r.building.coolKWhm2.toFixed(1)} kWh/m²·a; peaks ${r.building.peakHeatKW.toFixed(1)} / ${r.building.peakCoolKW.toFixed(1)} kW`);

// ---------------------------------------------------------------------------
section('Test 4 · Regional weather');
const epw = parseEpw(chicago);
const val = validateEpw(epw);
check('Bundled TMY3 EPW validates', val.ok, `${val.errors.length} errors, ${val.warnings.length} warnings`);
const stats = epwStats(epw);
check('Degree-days computed (Chicago TMY3: HDD18 within 3000–4000 K·d)', stats.hdd18 > 3000 && stats.hdd18 < 4000, `HDD18 ${stats.hdd18.toFixed(0)}, CDD10 ${stats.cdd10.toFixed(0)}, zone ${stats.climateZone}`);
// EPW writer round trip.
const recs = [];
for (let i = 0; i < epw.n; i++) recs.push({ year: 2023, month: epw.cols.month[i], day: epw.cols.day[i], hour: epw.cols.hour[i], dryBulb: epw.cols.dryBulb[i], dewPoint: epw.cols.dewPoint[i], rh: epw.cols.rh[i], pressure: epw.cols.pressure[i], ghi: epw.cols.ghi[i], dni: epw.cols.dni[i], dhi: epw.cols.dhi[i], horIR: epw.cols.horIR[i], windDir: epw.cols.windDir[i], windSpeed: epw.cols.windSpeed[i], totalSky: epw.cols.totalSky[i], opaqueSky: epw.cols.opaqueSky[i] });
const written = writeEpw({ city: 'Round trip', region: '', country: '', source: 'test', latitude: epw.header.latitude, longitude: epw.header.longitude, timeZone: epw.header.timeZone, elevation: epw.header.elevation, comment1: '', comment2: '' }, recs);
const back = parseEpw(written);
let maxDiff = 0;
for (let i = 0; i < epw.n; i++) maxDiff = Math.max(maxDiff, Math.abs(back.cols.dryBulb[i] - epw.cols.dryBulb[i]), Math.abs(back.cols.ghi[i] - epw.cols.ghi[i]));
check('EPW writer → parser round trip', validateEpw(back).ok && maxDiff < 0.051, `max difference ${maxDiff.toFixed(3)}`);
// Fallback upload: an EPW inside a zip (stored entry).
const enc = new TextEncoder().encode(chicago);
const name = new TextEncoder().encode('station.epw');
const hdr = new Uint8Array(30 + name.length);
const dv = new DataView(hdr.buffer);
dv.setUint32(0, 0x04034b50, true); dv.setUint16(8, 0, true); dv.setUint32(18, enc.length, true); dv.setUint32(22, enc.length, true); dv.setUint16(26, name.length, true);
hdr.set(name, 30);
const zip = new Uint8Array(hdr.length + enc.length); zip.set(hdr); zip.set(enc, hdr.length);
const unz = await epwFromZip(zip);
check('EPW extracted from an uploaded zip', unz.text === chicago, unz.name);
check('Standard UTC offset ignores daylight saving (America/Chicago → −6)', standardOffsetHours('America/Chicago', 2023) === -6);
check('Standard UTC offset (Australia/Sydney → +10, DST in January)', standardOffsetHours('Australia/Sydney', 2023) === 10);

if (NETWORK) {
  const sites = [
    ['Seoul, South Korea', 37.5665, 126.978, 'Asia/Seoul', 9, [10, 16]],
    ['Singapore', 1.3521, 103.8198, 'Asia/Singapore', 8, [25.5, 29.5]],
    ['Berlin, Germany', 52.52, 13.405, 'Europe/Berlin', 1, [8, 13]],
    ['Denver, United States', 39.7392, -104.9903, 'America/Denver', -7, [7, 14]],
  ];
  for (const [label, lat, lon, tz, off, range] of sites) {
    for (const [prov, fn] of [['Open-Meteo ERA5', epwFromOpenMeteo], ['NASA POWER', epwFromNasaPower]]) {
      try {
        const w = await fn({ latitude: lat, longitude: lon, year: 2023, timeZone: tz });
        const pe = parseEpw(w.epw);
        const v = validateEpw(pe);
        const s2 = epwStats(pe);
        const km = haversineKm(lat, lon, pe.header.latitude, pe.header.longitude);
        check(`${label} · ${prov}: valid EPW in local standard time (UTC${off >= 0 ? '+' : ''}${off})`, v.ok && pe.header.timeZone === off, `${pe.n} h, ${v.warnings.length} warnings`);
        if (prov.startsWith('Open')) check(`${label} · ${prov}: ERA5 grid cell within 30 km`, km < 30, `${km.toFixed(1)} km`);
        else check(`${label} · ${prov}: data for the requested point (POWER cell ${w.meta.resolution})`, km < 0.01 && !!w.meta.resolution);
        check(`${label} · ${prov}: annual mean temperature plausible (${range[0]}–${range[1]} °C)`, s2.annualMeanDryBulb > range[0] && s2.annualMeanDryBulb < range[1], `${s2.annualMeanDryBulb.toFixed(1)} °C, GHI ${s2.annualGhiKWh.toFixed(0)} kWh/m²`);
        if (label.startsWith('Singapore') && prov.startsWith('Open')) {
          const rr = await simulate(tm, configFor(w.epw));
          check('EnergyPlus runs with a browser-built ERA5 EPW (Singapore)', rr.run.success && !(rr.run.err?.entries || []).some(e => e.severity === 'severe'), rr.res ? `cooling ${rr.res.building.coolKWhm2.toFixed(1)}, heating ${rr.res.building.heatKWhm2.toFixed(2)} kWh/m²·a` : rr.run.fatalError);
        }
      } catch (err) {
        check(`${label} · ${prov}: dataset retrieved`, false, err.message);
      }
    }
  }
} else console.log('  (network checks skipped; run with --network)');

// ---------------------------------------------------------------------------
section('Test 5 · Thermal comfort: PMV/PPD against ISO 7730:2005 Annex D, Table D.1');
// ta, tr, vr, RH, met, clo → PMV, PPD, as tabulated in ISO 7730:2005 Table D.1 (transcribed;
// verify against the printed standard). Row 7 was first transcribed as 0.50 / 10; BIM2BEM and the
// independent pythermalcomfort 4.8.1 implementation both give 0.36 / 7.7 for it, so 0.36 / 8 is used.
const D1 = [
  [22, 22, 0.1, 60, 1.2, 0.5, -0.75, 17], [27, 27, 0.1, 60, 1.2, 0.5, 0.77, 17], [27, 27, 0.3, 60, 1.2, 0.5, 0.44, 9],
  [23.5, 25.5, 0.1, 60, 1.2, 0.5, -0.01, 5], [23.5, 25.5, 0.3, 60, 1.2, 0.5, -0.55, 11], [19, 19, 0.1, 40, 1.2, 1.0, -0.60, 13],
  [23.5, 23.5, 0.1, 40, 1.2, 1.0, 0.36, 8], [23.5, 23.5, 0.3, 40, 1.2, 1.0, 0.12, 5], [23, 21, 0.1, 40, 1.2, 1.0, 0.05, 5],
  [23, 21, 0.3, 40, 1.2, 1.0, -0.16, 6], [22, 22, 0.1, 60, 1.6, 0.5, 0.05, 5], [27, 27, 0.1, 60, 1.6, 0.5, 1.17, 34], [27, 27, 0.3, 60, 1.6, 0.5, 0.95, 24],
];
let worstPmv = 0, worstPpd = 0;
D1.forEach(([ta, tr, vr, rh, met, clo, pmvRef, ppdRef]) => {
  const q = pmvPpd(ta, tr, vr, rh, met, clo);
  worstPmv = Math.max(worstPmv, Math.abs(q.pmv - pmvRef));
  worstPpd = Math.max(worstPpd, Math.abs(Math.round(q.ppd) - ppdRef));
});
check(`13 reference cases: |ΔPMV| ≤ 0.01`, worstPmv <= 0.01, `worst ${worstPmv.toFixed(3)}`);
check(`13 reference cases: PPD within 1 percentage point`, worstPpd <= 1, `worst ${worstPpd}`);
// 60 random cases computed by an independent implementation (pythermalcomfort, ISO 7730-2005 model).
const ptc = JSON.parse(readText('tests/fixtures/pmv-pythermalcomfort.json'));
let worstPtc = 0, worstPtcPpd = 0;
ptc.rows.forEach(([ta, tr, vr, rh, met, clo, pmvRef, ppdRef]) => { const q = pmvPpd(ta, tr, vr, rh, met, clo); worstPtc = Math.max(worstPtc, Math.abs(q.pmv - pmvRef)); worstPtcPpd = Math.max(worstPtcPpd, Math.abs(q.ppd - ppdRef)); });
check(`${ptc.rows.length} cases vs ${ptc.source.split(' pmv')[0]}: |ΔPMV| ≤ 0.006 (reference rounded to 0.01)`, worstPtc <= 0.006, `worst ${worstPtc.toFixed(4)}, PPD worst ${worstPtcPpd.toFixed(2)}`);
const zc = zoneComfort(r.zones.get(tm.zones[0].key).series, r.time, { airSpeed: 0.1, met: 1.2, cloWinter: 1, cloSummer: 0.5, winterMonths: [1, 2, 3, 4, 10, 11, 12], mechanicalCooling: true, siteTout: r.site.tout });
check('Zone comfort uses occupied hours only', zc.occupiedHours === occHours, `${zc.occupiedHours} h`);
check('Adaptive model withheld for a mechanically cooled zone', zc.adaptive && zc.adaptive.supported === false);

// ---------------------------------------------------------------------------
section('Test 6 · Indoor air quality: CO₂ balance against an analytical steady state');
// One zone, constant occupancy, constant outdoor air and infiltration:
//   C_ss = C_out + N·G / Q,  G = 3.82e-8 m³/(s·W) × activity (EnergyPlus default generation rate)
{
  const m = new IdfModel();
  const W = 10, D = 8, H = 3;
  const add = (t, n, f) => m.add(t, n, f);
  add('Version', null, { version_identifier: '26.2' });
  add('SimulationControl', null, { do_zone_sizing_calculation: 'No', do_system_sizing_calculation: 'No', do_plant_sizing_calculation: 'No', run_simulation_for_sizing_periods: 'No', run_simulation_for_weather_file_run_periods: 'Yes' });
  add('Building', 'Box', { terrain: 'City', solar_distribution: 'FullExterior' });
  add('Timestep', null, { number_of_timesteps_per_hour: 6 });
  add('RunPeriod', 'Jan', { begin_month: 1, begin_day_of_month: 1, end_month: 1, end_day_of_month: 31 });
  add('GlobalGeometryRules', null, { starting_vertex_position: 'UpperLeftCorner', vertex_entry_direction: 'Counterclockwise', coordinate_system: 'World' });
  add('ZoneAirContaminantBalance', null, { carbon_dioxide_concentration: 'Yes', outdoor_carbon_dioxide_schedule_name: 'CO2out' });
  add('ScheduleTypeLimits', 'Any', {});
  [['On', 1], ['CO2out', 420], ['Act', 126], ['Hsp', 20], ['Csp', 26], ['Ctl', 4]].forEach(([n, v]) => add('Schedule:Constant', n, { schedule_type_limits_name: 'Any', hourly_value: v }));
  add('Material', 'M', { roughness: 'MediumRough', thickness: 0.2, conductivity: 1, density: 2000, specific_heat: 1000 });
  add('Construction', 'C', { outside_layer: 'M' });
  add('Zone', 'Z', { volume: W * D * H });
  const sf = (n, type, bc, v) => add('BuildingSurface:Detailed', n, { surface_type: type, construction_name: 'C', zone_name: 'Z', outside_boundary_condition: bc, sun_exposure: bc === 'Outdoors' ? 'SunExposed' : 'NoSun', wind_exposure: bc === 'Outdoors' ? 'WindExposed' : 'NoWind', vertices: v });
  sf('S', 'Wall', 'Outdoors', [[0, 0, H], [0, 0, 0], [W, 0, 0], [W, 0, H]]); sf('E', 'Wall', 'Outdoors', [[W, 0, H], [W, 0, 0], [W, D, 0], [W, D, H]]);
  sf('N', 'Wall', 'Outdoors', [[W, D, H], [W, D, 0], [0, D, 0], [0, D, H]]); sf('Wst', 'Wall', 'Outdoors', [[0, D, H], [0, D, 0], [0, 0, 0], [0, 0, H]]);
  sf('F', 'Floor', 'Adiabatic', [[0, D, 0], [W, D, 0], [W, 0, 0], [0, 0, 0]]); sf('R', 'Roof', 'Outdoors', [[0, 0, H], [W, 0, H], [W, D, H], [0, D, H]]);
  add('People', 'P', { zone_or_zonelist_or_space_or_spacelist_name: 'Z', number_of_people_schedule_name: 'On', number_of_people_calculation_method: 'People', number_of_people: 4, activity_level_schedule_name: 'Act' });
  add('DesignSpecification:OutdoorAir', 'OA', { outdoor_air_method: 'Flow/Zone', outdoor_air_flow_per_zone: 0.03 });
  add('ZoneHVAC:IdealLoadsAirSystem', 'IL', { zone_supply_air_node_name: 'Zs', design_specification_outdoor_air_object_name: 'OA' });
  add('ZoneHVAC:EquipmentList', 'EL', { load_distribution_scheme: 'SequentialLoad', equipment: [{ zone_equipment_object_type: 'ZoneHVAC:IdealLoadsAirSystem', zone_equipment_name: 'IL', zone_equipment_cooling_sequence: 1, zone_equipment_heating_or_no_load_sequence: 1 }] });
  add('ZoneHVAC:EquipmentConnections', null, { zone_name: 'Z', zone_conditioning_equipment_list_name: 'EL', zone_air_inlet_node_or_nodelist_name: 'Zs', zone_air_node_name: 'Za', zone_return_air_node_or_nodelist_name: 'Zr' });
  add('ThermostatSetpoint:DualSetpoint', 'SP', { heating_setpoint_temperature_schedule_name: 'Hsp', cooling_setpoint_temperature_schedule_name: 'Csp' });
  add('ZoneControl:Thermostat', 'T', { zone_or_zonelist_name: 'Z', control_type_schedule_name: 'Ctl', control_1_object_type: 'ThermostatSetpoint:DualSetpoint', control_1_name: 'SP' });
  ['Zone Air CO2 Concentration', 'Zone Ideal Loads Outdoor Air Standard Density Volume Flow Rate'].forEach(v => add('Output:Variable', null, { key_value: '*', variable_name: v, reporting_frequency: 'Hourly' }));
  const ep = await energyPlus();
  const run = await ep.run({ idf: m.toIDF(), epw: chicago, outputs: { sql: false, html: false } });
  const series = (name) => { for (const ts of run.eso.timeSeries.values()) if (ts.variable.variableName === name) return ts.values; return null; };
  const co2 = series('Zone Air CO2 Concentration');
  const oa = series('Zone Ideal Loads Outdoor Air Standard Density Volume Flow Rate');
  const G = 3.82e-8 * 126 * 4; // m³/s
  const Q = oa ? oa.reduce((a, b) => a + b, 0) / oa.length : 0.03;
  const expected = 420 + G / Q * 1e6;
  const last = co2 ? co2.slice(-24 * 7).reduce((a, b) => a + b, 0) / (24 * 7) : NaN;
  check('CO₂ model runs (ppm, hourly)', run.success && co2 && co2.length === 744, `${co2 ? co2.length : 0} h`);
  check(`Steady-state CO₂ = 420 + N·G/Q = ${expected.toFixed(1)} ppm (±2%)`, near(last, expected, expected * 0.02), `simulated ${last.toFixed(1)} ppm, Q ${Q.toFixed(4)} m³/s`);
}
const co2stats = zoneCo2(r.zones.get(tm.zones[0].key).series, 420);
check('Zone CO₂ statistics over occupied hours', co2stats.supported && co2stats.occupiedHours === occHours && co2stats.max > 420, `mean ${co2stats.mean.toFixed(0)}, max ${co2stats.max.toFixed(0)} ppm`);

// ---------------------------------------------------------------------------
section('Test 7 · Solar and wind');
const h = epw.header;
const doy = dayOfYearIndex(epw);
// EnergyPlus evaluates the sun at the end of each zone timestep (mid-hour with one timestep per
// hour) and reports the hourly mean, so the reference is BIM2BEM's position averaged at those times.
const tsPerHour = cfgChi.run.timesteps;
let n7 = 0, sum7 = 0, max7 = 0, bias7 = 0;
for (let i = 0; i < r.time.n; i++) {
  const eAlt = r.site.solarAlt[i];
  if (!(eAlt > 10)) continue;
  let js = 0;
  for (let k = 1; k <= tsPerHour; k++) js += solarPosition(h.latitude, h.longitude, h.timeZone, doy[i], epw.cols.hour[i] - 1 + (tsPerHour === 1 ? 0.5 : k / tsPerHour)).altitude;
  const d = js / tsPerHour - eAlt;
  sum7 += Math.abs(d); bias7 += d; n7++; max7 = Math.max(max7, Math.abs(d));
}
check('Solar altitude vs EnergyPlus (altitude > 10°): mean |Δ| < 0.3°, max < 0.5°, no bias', sum7 / n7 < 0.3 && max7 < 0.5 && Math.abs(bias7 / n7) < 0.05, `mean ${(sum7 / n7).toFixed(3)}°, bias ${(bias7 / n7).toFixed(3)}°, max ${max7.toFixed(3)}° over ${n7} h; EnergyPlus updates declination and equation of time once per day`);
const decl = solarPosition(45, 0, 0, 172, 12, 2023).declination;
check('Declination at the June solstice ≈ +23.44°', near(decl, 23.44, 0.02), decl.toFixed(3));
// Wind rose on synthetic data with known answers.
const syn = { n: 10, cols: { month: new Float32Array(10).fill(1), windSpeed: Float32Array.from([0.2, 1, 1, 3, 3, 3, 5, 7, 9, 12]), windDir: Float32Array.from([0, 0, 359, 90, 90, 91, 180, 180, 270, 270]) } };
const rose = windRose(syn, { sectors: 4 });
check('Wind rose: calm share 1/10', near(rose.calm, 0.1, 1e-12));
check('Wind rose: N sector holds 2 hours of 0.5–2 m/s (0° and 359°)', rose.counts[0][0] === 2);
check('Wind rose: E sector 3 hours of 2–4 m/s', rose.counts[1][1] === 3);
check('Wind rose: frequencies + calm sum to 1', near(rose.freq.flat().reduce((a, b) => a + b, 0) + rose.calm, 1, 1e-12));
check('Wind rose: mean speed', near(rose.meanSpeed, 4.42, 1e-9), rose.meanSpeed.toFixed(3));
const realRose = windRose(epw);
let windSum = 0, windN = 0;
for (let i = 0; i < epw.n; i++) if (epw.cols.windSpeed[i] < 999) { windSum += epw.cols.windSpeed[i]; windN++; }
check('Wind rose mean = arithmetic mean of the EPW records', near(realRose.meanSpeed, windSum / windN, 1e-9));
const solarSurf = tm.surfaces.filter(s => s.bc === 'Outdoors' && s.type === 'Wall').map(s => [compass(s.azimuth), r.surfaces.get(s.id)?.annualKWhm2]);
const southish = solarSurf.filter(([c]) => /S/.test(c)).map(x => x[1]);
const northish = solarSurf.filter(([c]) => /^N/.test(c)).map(x => x[1]);
check('Incident solar: south-facing walls receive more than north-facing walls', Math.min(...southish) > Math.max(...northish), `S ${Math.min(...southish).toFixed(0)}, N ${Math.max(...northish).toFixed(0)} kWh/m²·a`);

// ---------------------------------------------------------------------------
section('Test 8 · Scenario comparison re-runs EnergyPlus');
const insul = { id: 'ins', name: 'Improved insulation', mods: { insulation: { exteriorWall: 0.1, roof: 0.1, groundFloor: 0, material: 'mineral-wool' } } };
const sc = await simulate(tm, cfgChi, insul);
check('Scenario IDF differs from the baseline IDF', sc.out.idf !== base.out.idf);
check('Scenario run executed by EnergyPlus', sc.run.success && sc.seconds > 0.5, `${sc.seconds.toFixed(1)} s`);
check('More insulation lowers heating demand', sc.res.building.heatKWh < r.building.heatKWh, `${r.building.heatKWh.toFixed(0)} → ${sc.res.building.heatKWh.toFixed(0)} kWh`);
const glzSc = await simulate(tm, cfgChi, { id: 'g', name: 'Glazing', mods: { glazing: { shgc: 0.25 } } });
check('Lower g-value lowers solar transmitted through windows', glzSc.res.zones.get(tm.zones[0].key).annual.solarInKWh < r.zones.get(tm.zones[0].key).annual.solarInKWh);

// ---------------------------------------------------------------------------
section('Test 9 · Static hosting checks');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/'(assets\/[^']+\.js)'/g)].map(x => x[1]);
check('Every script listed in index.html exists', srcs.length > 20 && srcs.every(s => existsSync(path.join(ROOT, s))), `${srcs.length} scripts`);
check('No root-absolute asset paths (GitHub Pages subpath safe)', !/(src|href)="\/(?!\/)/.test(html));
check('Engine loader and worker are vendored', existsSync(path.join(ROOT, 'assets/vendor/idfkit-engine-0.6.0/index.js')) && existsSync(path.join(ROOT, 'assets/vendor/idfkit-engine-0.6.0/engine.worker.js')));
check('Engine assets resolve from the CDN pin or a self-hosted copy', /cdn\.jsdelivr\.net\/npm\/@idfkit\/engine-assets@26\.2\.0\/assets/.test(readFileSync(path.join(ROOT, 'assets/js/core/engine.jsx'), 'utf8')));
check('Sample IFC files are bundled', ['BEMDemoOffice.ifc', 'ResearchCentre.ifc', 'LargeBuilding.ifc'].every(f => existsSync(path.join(ROOT, 'assets/ifc', f))));

// ---------------------------------------------------------------------------
section('Test 10 · Reproducibility');
const again = await simulate(tm, cfgChi);
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(a));
check('Same inputs → same heating demand (relative difference < 1e-12)', rel(again.res.building.heatKWh, r.building.heatKWh) < 1e-12, `${again.res.building.heatKWh} vs ${r.building.heatKWh}`);
check('Same inputs → same cooling demand', rel(again.res.building.coolKWh, r.building.coolKWh) < 1e-12);
const tm2 = await buildThermalModel(demo, {});
check('Conversion is deterministic (same surfaces and areas)', tm2.surfaces.length === tm.surfaces.length && tm2.surfaces.every((s, i) => s.name === tm.surfaces[i].name && s.area === tm.surfaces[i].area));

disposeEngine();
Object.values(models).forEach(m => m.close());
const failed = results.filter(x => !x.ok);
writeFileSync(path.join(ROOT, 'tests/last-run.json'), JSON.stringify({ date: new Date().toISOString(), network: NETWORK, node: process.version, energyPlus: EP_SCHEMA.version, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
