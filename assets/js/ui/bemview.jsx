/**
 * 3D views of the energy model: analytical surfaces as a pickable overlay, and the
 * colour/legend definitions for every display mode. Colours always come from a
 * number in the thermal model or the simulation results; a mode without data shows
 * nothing rather than a decorative gradient.
 */

const BC_COLORS = { Outdoors: '#2a78d6', Ground: '#eda100', Surface: '#1baf7a', Adiabatic: '#9aa5b3', Window: '#6250d6', Door: '#eb6834' };
const NO_DATA = '#9aa5b3';

const DISPLAY_MODES = [
  { id: 'bim', label: 'BIM model', group: 'Model' },
  { id: 'bem', label: 'Analytical surfaces', group: 'Model', needs: 'tm' },
  { id: 'zones', label: 'Thermal zones', group: 'Model', needs: 'tm' },
  { id: 'heating', label: 'Heating demand', group: 'Energy', needs: 'results' },
  { id: 'cooling', label: 'Cooling demand', group: 'Energy', needs: 'results' },
  { id: 'temperature', label: 'Indoor air temperature', group: 'Hourly', needs: 'results', hourly: true },
  { id: 'pmv', label: 'Thermal comfort (PMV)', group: 'Hourly', needs: 'results', hourly: true },
  { id: 'co2', label: 'CO₂ concentration', group: 'Hourly', needs: 'co2', hourly: true },
  { id: 'solar', label: 'Solar exposure', group: 'Environment', needs: 'results' },
  { id: 'ventilation', label: 'Outdoor air (occupied)', group: 'Environment', needs: 'results' },
  { id: 'daylight', label: 'Daylight at reference point', group: 'Environment', needs: 'daylight' },
];

/** Analytical surfaces overlay. colorOf(item, kind) → hex or null (skip). */
function buildBemOverlay(tm, colorOf, { selectedId = null, opacity = 0.9 } = {}) {
  const group = new THREE.Group();
  group.name = 'bem-surfaces';
  const shift = tm.shift;
  const toThree = (p) => fromEP([p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]]);
  const ec = (window.earcut && (window.earcut.default || window.earcut));
  const addPoly = (verts, color, id, offset = 0, sel = false) => {
    const n = polyNormal3(verts);
    const b = planeBasis(n);
    const o = verts[0];
    const flat = verts.flatMap(p => to2D(p, o, b));
    const tris = ec(flat);
    if (!tris.length) return;
    const pos = new Float32Array(verts.length * 3);
    verts.forEach((p, i) => { const q = toThree(v3.add(p, v3.scale(n, offset))); pos[i * 3] = q[0]; pos[i * 3 + 1] = q[1]; pos[i * 3 + 2] = q[2]; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(tris);
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: sel ? '#f2b705' : color, side: THREE.DoubleSide, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, depthWrite: opacity >= 1 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData = { pick: id, overlayKey: 'bem' };
    group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: sel ? '#b48200' : '#3d4652', transparent: true, opacity: 0.55 }));
    edges.raycast = () => {};
    group.add(edges);
  };
  tm.surfaces.forEach(s => {
    const c = colorOf(s, 'surface');
    if (c) addPoly(s.vertices, c, s.id, 0, s.id === selectedId);
  });
  tm.subsurfaces.forEach(w => {
    const c = colorOf(w, 'subsurface');
    if (c) addPoly(w.vertices, c, w.hostId, 0.01, w.hostId === selectedId);
  });
  return group;
}

/**
 * Display definition for a mode: zone colours (IfcSpace id → hex), an optional surface
 * colour function, and a legend. Returns { unavailable } with a reason when the data
 * the mode needs does not exist.
 */
function displayFor(mode, { tm, results, ieq, hour, theme, config }) {
  if (mode === 'bim') return null;
  if (!tm) return { unavailable: 'Build the energy model first (BEM Conversion).' };
  const zoneColors = new Map();
  const paintZone = (z, color) => z.spaceIds.forEach(id => zoneColors.set(id, color));
  if (mode === 'bem') {
    return {
      surfaceColor: (it, kind) => (kind === 'subsurface' ? BC_COLORS[it.type] : BC_COLORS[it.bc]),
      legend: { kind: 'categorical', title: 'Boundary condition', items: [['Outdoors', BC_COLORS.Outdoors], ['Ground', BC_COLORS.Ground], ['Interzone', BC_COLORS.Surface], ['Adiabatic', BC_COLORS.Adiabatic], ['Window', BC_COLORS.Window], ['Door', BC_COLORS.Door]] },
    };
  }
  if (mode === 'zones') {
    tm.zones.forEach(z => paintZone(z, config.zoneOverrides[z.key] && config.zoneOverrides[z.key].conditioned === false ? NO_DATA : '#2a78d6'));
    return { zoneColors, legend: { kind: 'categorical', title: 'Thermal zones', items: [['Conditioned', '#2a78d6'], ['Unconditioned', NO_DATA]] } };
  }
  if (!results) return { unavailable: 'Run a simulation to colour the model with results.' };
  const zr = (z) => results.zones.get(z.key);
  const zoneScale = (title, unit, kind, value, digits = 0, fixed) => {
    const vals = tm.zones.map(z => value(z)).filter(v => v != null && Number.isFinite(v));
    if (!vals.length && !fixed) return { unavailable: `No values were reported for ${title}.` };
    const scale = fixed || { kind, min: Math.min(...vals), max: Math.max(...vals) };
    if (!fixed && scale.max - scale.min < 1e-6) scale.max = scale.min + 1;
    tm.zones.forEach(z => { const v = value(z); paintZone(z, v != null && Number.isFinite(v) ? scaleColor(scale, v, theme) : NO_DATA); });
    return { zoneColors, legend: { kind: 'scale', title, unit, scale, digits } };
  };
  if (mode === 'heating') return zoneScale('Heating demand', 'kWh/m²·a', 'seqOrange', z => zr(z).annual.heatKWhm2);
  if (mode === 'cooling') return zoneScale('Cooling demand', 'kWh/m²·a', 'seq', z => zr(z).annual.coolKWhm2);
  if (mode === 'ventilation') return zoneScale('Outdoor air, occupied mean', 'ach', 'seq', z => zr(z).annual.oaAchOccupied, 2);
  if (mode === 'temperature') return zoneScale(`Air temperature · ${hourLabel(results.time, hour)}`, '°C', 'div', z => { const s = zr(z).series.tair; return s ? s[hour] : null; }, 1, { kind: 'div', min: 14, mid: 22, max: 30 });
  if (mode === 'co2') {
    if (!tm.zones.some(z => zr(z).series.co2)) return { unavailable: 'CO₂ was not modelled in this run.' };
    return zoneScale(`CO₂ · ${hourLabel(results.time, hour)}`, 'ppm', 'seq', z => { const s = zr(z).series.co2; return s ? s[hour] : null; }, 0, { kind: 'seq', min: 400, max: 1400 });
  }
  if (mode === 'pmv') {
    if (!ieq) return { unavailable: 'Comfort indicators are not available.' };
    return zoneScale(`PMV · ${hourLabel(results.time, hour)} (grey: unoccupied)`, '', 'div', z => { const q = ieq.zones.get(z.key); const v = q && q.comfort.pmv ? q.comfort.pmv[hour] : NaN; return Number.isFinite(v) ? v : null; }, 1, { kind: 'div', min: -2, mid: 0, max: 2 });
  }
  if (mode === 'daylight') {
    if (!ieq || !tm.zones.some(z => ieq.zones.get(z.key) && ieq.zones.get(z.key).daylight.supported)) return { unavailable: 'Daylight was not modelled in this run.' };
    return zoneScale(`Hours ≥ ${config.daylight.setpointLux} lx at the reference point`, '% occ.', 'seq', z => { const q = ieq.zones.get(z.key); return q && q.daylight.supported ? q.daylight.autonomy * 100 : null; }, 0, { kind: 'seq', min: 0, max: 100 });
  }
  if (mode === 'solar') {
    const vals = tm.surfaces.filter(s => s.bc === 'Outdoors').map(s => results.surfaces.get(s.id)).filter(r => r && r.annualKWhm2 != null).map(r => r.annualKWhm2);
    if (!vals.length) return { unavailable: 'No surface solar results.' };
    const scale = { kind: 'seqOrange', min: 0, max: Math.max(...vals) };
    return {
      surfaceColor: (it, kind) => {
        if (kind === 'subsurface') return null;
        if (it.bc !== 'Outdoors') return null;
        const r = results.surfaces.get(it.id);
        return r && r.annualKWhm2 != null ? scaleColor(scale, r.annualKWhm2, theme) : NO_DATA;
      },
      legend: { kind: 'scale', title: 'Incident solar radiation (exterior surfaces)', unit: 'kWh/m²·a', scale, digits: 0 },
    };
  }
  return null;
}

function DisplayLegend({ legend, theme }) {
  if (!legend) return null;
  if (legend.kind === 'categorical') {
    return <div className="viewer-legend"><div className="scale-title">{legend.title}</div><div className="chart-legend"><LegendItems items={legend.items.map(([label, color]) => ({ label, color }))} /></div></div>;
  }
  return <div className="viewer-legend"><ScaleLegend title={legend.title} scale={legend.scale} unit={legend.unit} theme={theme} digits={legend.digits} /></div>;
}

Object.assign(window, { BC_COLORS, DISPLAY_MODES, buildBemOverlay, displayFor, DisplayLegend });
