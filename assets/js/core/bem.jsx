/**
 * IFC → thermal (BEM) model.
 *
 *   IfcSpace bodies (or, on request, storey slab outlines) → thermal zones
 *   → planar boundary faces with outward normals (from the closed solid)
 *   → facing faces of neighbouring zones matched within a wall/slab thickness
 *     → paired interzone surfaces of equal area (EnergyPlus "Surface")
 *   → remaining faces classified by casting rays outward through the IFC elements
 *     → Outdoors, Ground, or "unmodelled" (adjacent to building parts without a zone)
 *   → IfcWindow / IfcDoor projected onto the exterior surface they sit in
 *   → constructions from IFC material layers, declared U-values, user-mapped library
 *     materials or, failing those, documented reference constructions.
 *
 * Every zone, surface, opening and construction records what produced it, and every
 * IFC element keeps the list of analytical surfaces it generated (traceability).
 * Geometry is in EnergyPlus axes (Z up), shifted so the lowest zone floor is at z = 0.
 */

const BEM_DEFAULTS = {
  zoning: 'spaces',            // 'spaces' | 'storeys'
  maxWallGap: 0.8,             // m: thickest wall between two zones
  maxSlabGap: 1.6,             // m: thickest floor build-up (slab, screed, plenum)
  unmodelled: 'adiabatic',     // treatment of faces next to building parts with no zone
  includeInteriorDoors: false,
  materialMap: {},             // IFC material name → library material id (user decisions)
  excludedSpaces: [],          // IfcSpace express ids the user removed
  zoneOf: {},                  // IfcSpace express id → zone key (user merges)
};

const ENVELOPE_SKIP = /^Ifc(Space|Opening|VoidingFeature|Furnishing|Furniture|SystemFurniture|Annotation|VirtualElement|Site|GeographicElement|BuildingElementProxy|TransportElement|Railing|Distribution|Flow|Duct|Pipe|Cable|Air|Outlet|Switching|LightFixture|Lamp|Sensor|Actuator|Controller|Alarm|Electric|Junction|Sanitary|SpaceHeater|Pump|Fan|Valve|Tank|Boiler|Chiller|Coil|Damper|Unitary|Protective|EnergyConversion|AudioVisual|Communications|FireSuppression|Stack|Waste|Medical|Compressor|Condenser|Cool|Evapor|HeatExchanger|Humidifier|Interceptor|Filter|Burner|Engine|TubeBundle|Solar|Transformer|Motor|DiscreteAccessory|Fastener|MechanicalFastener|Reinforcing|Tendon|Footing|Pile)/;

function pset(el, model, psetName, prop) {
  const scan = (e) => {
    if (!e) return undefined;
    for (const ps of e.propertySets || []) {
      if (psetName && ps.name !== psetName) continue;
      const p = ps.properties.find(q => q.name === prop);
      if (p && p.value != null && p.value !== '') return { value: p.value, from: `${ps.name}.${prop}` };
    }
    return undefined;
  };
  return scan(el) || (el && el.typeExpressId ? (() => { const r = scan(model.byId.get(el.typeExpressId)); return r && { ...r, from: `${r.from} (type)` }; })() : undefined);
}
const truthy = (v) => v === true || v === 'T' || v === '.T.' || String(v).toUpperCase() === 'TRUE';
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function elementMeshEP(el, shift) {
  const g = el.geometry;
  const P = [];
  for (let i = 0; i < g.positions.length; i += 3) {
    const p = toEP(g.positions[i], g.positions[i + 1], g.positions[i + 2]);
    P.push([p[0] - shift[0], p[1] - shift[1], p[2] - shift[2]]);
  }
  return { P, I: g.indices };
}

function bboxOf(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  P.forEach(p => { for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; } });
  return { min, max };
}

function surfaceKind(n) { return n[2] < -0.7 ? 'Floor' : n[2] > 0.7 ? 'Ceiling' : 'Wall'; }
function tiltAz(n, northAngle = 0) {
  const tilt = Math.acos(Math.max(-1, Math.min(1, n[2]))) * 180 / Math.PI;
  let az = Math.atan2(n[0], n[1]) * 180 / Math.PI; // clockwise from project +Y
  az = ((az + northAngle) % 360 + 360) % 360;
  return { tilt, azimuth: az };
}
function compass(az) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8]; }

/** Extruded prism mesh (EP coords) from a 2D ring, for storey-based zoning. */
function prismMesh(ring, z0, z1) {
  const P = [], I = [];
  const n = ring.length;
  ring.forEach(([x, y]) => P.push([x, y, z0]));
  ring.forEach(([x, y]) => P.push([x, y, z1]));
  const flat = ring.flat();
  const lib = (typeof window !== 'undefined' && window.earcut) || globalThis.earcut;
  const ec = typeof lib === 'function' ? lib : lib.default;
  const tris = ec(flat);
  for (let t = 0; t < tris.length; t += 3) {
    I.push(tris[t], tris[t + 2], tris[t + 1]);         // floor, facing down
    I.push(n + tris[t], n + tris[t + 1], n + tris[t + 2]); // ceiling, facing up
  }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; I.push(i, j, n + j, i, n + j, n + i); }
  return { P, I };
}

async function buildThermalModel(model, options = {}) {
  const opts = { ...BEM_DEFAULTS, ...options };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const issues = [];
  const issue = (severity, code, message, extra = {}) => issues.push({ severity, code, message, ids: [], ...extra });
  await model._ensureSecondaryData();
  const scale = (model.lengthUnit && model.lengthUnit.scale) || 1;
  const northAngle = options.northAngle != null ? options.northAngle : (model.geoRef && model.geoRef.northAngle) || 0;

  // ---- Elements we read properties from -------------------------------------------------
  const inst = model.elements.filter(e => !e.isType);
  const spaces = (model.byClass.get('IfcSpace') || []).map(id => model.byId.get(id));
  const openingsEls = inst.filter(e => /^Ifc(Window|Door)/.test(e.ifcClass) && e.geometry);
  const envelopeEls = inst.filter(e => e.geometry && !ENVELOPE_SKIP.test(e.ifcClass) && !SPATIAL_CLASSES.includes(e.ifcClass));
  const toExpand = [...spaces, ...openingsEls, ...envelopeEls];
  for (let i = 0; i < toExpand.length; i++) {
    await model.expandElement(toExpand[i].expressId);
    const t = toExpand[i].typeExpressId;
    if (t) await model.expandElement(t);
  }

  // ---- Zone sources ------------------------------------------------------------------------
  const excluded = new Set(opts.excludedSpaces || []);
  let sources = []; // { key, name, spaceIds, storey, meshFn }
  const spacesNoGeo = spaces.filter(s => !s.geometry).map(s => s.expressId);
  if (spacesNoGeo.length) issue('warning', 'space-no-geometry', `${spacesNoGeo.length} IfcSpace element(s) have no body geometry and cannot become thermal zones.`, { ids: spacesNoGeo });
  if (opts.zoning === 'spaces') {
    spaces.forEach(s => {
      if (!s.geometry || excluded.has(s.expressId)) return;
      const ext = String(s.predefinedType || '').toUpperCase() === 'EXTERNAL' || truthy((pset(s, model, 'Pset_SpaceCommon', 'IsExternal') || {}).value);
      if (ext) { issue('assumption', 'space-external', `${elementLabel(s)} is declared external and is not modelled as a conditioned zone.`, { ids: [s.expressId] }); return; }
      sources.push({ spaceId: s.expressId, el: s });
    });
  }

  // Shift: lowest geometry at z = 0, plan centre at the origin.
  const allP = [];
  (sources.length ? sources.map(s => s.el) : envelopeEls).forEach(el => {
    const b = el.bbox;
    allP.push(toEP(b.min[0], b.min[1], b.min[2]), toEP(b.max[0], b.max[1], b.max[2]));
  });
  if (!allP.length) {
    issue('critical', 'no-geometry', 'The model has no geometry to build a thermal model from.');
    return { zones: [], surfaces: [], subsurfaces: [], constructions: new Map(), windowTypes: new Map(), mapping: new Map(), issues, northAngle, shift: [0, 0, 0], options: opts };
  }
  const bb0 = bboxOf(allP);
  const shift = [(bb0.min[0] + bb0.max[0]) / 2, (bb0.min[1] + bb0.max[1]) / 2, bb0.min[2]];

  if (opts.zoning === 'storeys') {
    // Manual zoning: one zone per storey, prism over the union of that storey's slab outlines.
    const slabs = inst.filter(e => /^IfcSlab/.test(e.ifcClass) && e.geometry && String(e.predefinedType || '').toUpperCase() !== 'ROOF');
    const storeyZ = model.storeys.map(st => {
      const own = slabs.filter(s => s.storey === st);
      if (!own.length) return null;
      const tops = own.map(s => elementMeshEP(s, shift)).map(m => bboxOf(m.P).max[2]);
      return { st, own, z: tops.reduce((a, b) => a + b, 0) / tops.length };
    }).filter(Boolean).sort((a, b) => a.z - b.z);
    storeyZ.forEach((s, i) => {
      const next = storeyZ[i + 1];
      const roofTop = envelopeEls.reduce((m, e) => Math.max(m, bboxOf(elementMeshEP(e, shift).P).max[2]), -Infinity);
      const ceilZ = next ? next.z - 0.25 : Math.min(s.z + 3.0, roofTop);
      const polys = [];
      s.own.forEach(sl => {
        const { P, I } = elementMeshEP(sl, shift);
        for (let t = 0; t < I.length; t += 3) {
          const a = P[I[t]], b = P[I[t + 1]], c = P[I[t + 2]];
          const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
          if (n[2] <= 0 || n[2] / v3.len(n) < 0.99) continue;
          let r = [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]]];
          if (ringArea2(r) < 0) r = r.reverse();
          polys.push([[r]]);
        }
      });
      const rings = multiToRings(mpUnion(polys), 1);
      rings.forEach((ring, k) => sources.push({ storeyZone: s.st.expressId, el: s.st, name: `${elementLabel(s.st)}${rings.length > 1 ? ` part ${k + 1}` : ''}`, mesh: prismMesh(ring, s.z, ceilZ) }));
    });
    issue('assumption', 'storey-zoning', 'Zones were created per storey from slab outlines (manual zoning). Floor-to-ceiling heights are assumed as storey height minus 0.25 m; interior partitions are not modelled as zone boundaries.');
  }

  if (!sources.length) {
    issue('critical', 'no-zones', opts.zoning === 'spaces'
      ? 'No usable IfcSpace was found, so no thermal zones could be built. Use manual zoning (one zone per storey from slab outlines) or add IfcSpace elements in the authoring tool.'
      : 'No storey slabs were found to build zones from.');
    return { zones: [], surfaces: [], subsurfaces: [], constructions: new Map(), windowTypes: new Map(), mapping: new Map(), issues, northAngle, shift, options: opts };
  }

  // ---- Zones and their boundary faces -----------------------------------------------------
  const namer = makeNamer();
  const zones = new Map();
  const faces = []; // candidate surfaces
  sources.forEach(src => {
    const mesh = src.mesh || elementMeshEP(src.el, shift);
    let { P, I } = mesh;
    let vol = meshVolume(P, I);
    if (vol < 0) {
      const J = new Uint32Array(I.length);
      for (let t = 0; t < I.length; t += 3) { J[t] = I[t]; J[t + 1] = I[t + 2]; J[t + 2] = I[t + 1]; }
      I = J; vol = -vol;
    }
    const zoneKey = src.spaceId != null ? (opts.zoneOf[src.spaceId] || `z${src.spaceId}`) : `st${src.storeyZone}-${faces.length}`;
    const fs = meshPlanarFaces(P, I);
    // Closure: the outward area vectors of a closed solid sum to zero.
    const sumVec = fs.reduce((s, f) => v3.add(s, v3.scale(f.normal, f.area)), [0, 0, 0]);
    const totalA = fs.reduce((s, f) => s + f.area, 0);
    const closure = totalA > 0 ? v3.len(sumVec) / totalA : 1;
    const bb = bboxOf(P);
    let z = zones.get(zoneKey);
    if (!z) {
      const label = src.name || (src.el ? `${(src.el.name || '').trim()}${src.el.longName && src.el.longName !== src.el.name ? ` ${src.el.longName}` : ''}`.trim() || elementLabel(src.el) : 'Zone');
      z = { key: zoneKey, name: namer(label, 'Zone'), spaceIds: [], storeyId: src.el && src.el.storey ? src.el.storey.expressId : (src.storeyZone || null), volume: 0, floorArea: 0, bbox: bb, closure: 0, surfaceIds: [], source: src.spaceId != null ? 'IfcSpace' : 'storey slab outline', globalIds: [] };
      zones.set(zoneKey, z);
    }
    if (src.spaceId != null) { z.spaceIds.push(src.spaceId); z.globalIds.push(src.el.globalId); }
    z.volume += vol;
    z.closure = Math.max(z.closure, closure);
    for (let k = 0; k < 3; k++) { z.bbox.min[k] = Math.min(z.bbox.min[k], bb.min[k]); z.bbox.max[k] = Math.max(z.bbox.max[k], bb.max[k]); }
    if (closure > 0.02) issue('warning', 'zone-open', `${z.name} is not a closed solid (area imbalance ${(closure * 100).toFixed(1)}%). Its volume and boundaries may be wrong.`, { ids: z.spaceIds.slice(), zones: [zoneKey] });
    fs.forEach(f => f.rings.forEach(ring => {
      faces.push({ zoneKey, spaceId: src.spaceId, normal: f.normal, origin: f.origin, basis: f.basis, kind: surfaceKind(f.normal), rem: [[ring.map(p => p.slice())]], parts: [] });
    }));
  });

  // 3D bounding boxes per face (for candidate pruning).
  faces.forEach(f => {
    const pts = f.rem[0][0].map(q => to3D(q, f.origin, f.basis));
    f.bb = bboxOf(pts);
    f.plane = v3.dot(f.normal, f.origin);
  });

  // ---- Interzone matching -------------------------------------------------------------------
  const pairs = [];
  for (let i = 0; i < faces.length; i++) {
    const a = faces[i];
    for (let j = i + 1; j < faces.length; j++) {
      const b = faces[j];
      if (a.spaceId != null && a.spaceId === b.spaceId) continue;
      if (a.zoneKey === b.zoneKey && a.spaceId == null) continue;
      if (v3.dot(a.normal, b.normal) > -0.985) continue;
      const gap = -b.plane - a.plane; // distance from a to b along a's normal
      const maxGap = a.kind === 'Wall' ? opts.maxWallGap : opts.maxSlabGap;
      if (gap < -0.05 || gap > maxGap) continue;
      let overlap = true;
      for (let k = 0; k < 3 && overlap; k++) if (a.bb.min[k] > b.bb.max[k] + maxGap || b.bb.min[k] > a.bb.max[k] + maxGap) overlap = false;
      if (overlap) pairs.push({ a, b, gap });
    }
  }
  pairs.sort((p, q) => p.gap - q.gap);
  const mapPoly = (mp, from, to) => mp.map(poly => poly.map(ring => {
    let r = ring.map(q => to2D(to3D(q, from.origin, from.basis), to.origin, to.basis));
    return r;
  }));
  let matchedPairs = 0;
  pairs.forEach(({ a, b, gap }) => {
    if (!a.rem.length || !b.rem.length) return;
    let inter;
    try { inter = mpIntersect(a.rem, mapPoly(b.rem, b, a)); } catch { return; }
    if (mpArea(inter) < 0.05) return;
    const rings = multiToRings(inter, 0.05);
    if (!rings.length) return;
    try {
      a.rem = mpDiff(a.rem, inter);
      b.rem = mpDiff(b.rem, mapPoly(inter, a, b));
    } catch { return; }
    rings.forEach(r => {
      const id = `p${++matchedPairs}`;
      const rb = r.map(q => to2D(to3D(q, a.origin, a.basis), b.origin, b.basis));
      a.parts.push({ ring: r, bc: 'Surface', pairId: id, side: 'a', gap });
      b.parts.push({ ring: ringArea2(rb) < 0 ? rb.reverse() : rb, bc: 'Surface', pairId: id, side: 'b', gap });
    });
  });

  // ---- Ray model of the building fabric ----------------------------------------------------
  const rayEls = [];
  envelopeEls.forEach(el => {
    const { P, I } = elementMeshEP(el, shift);
    rayEls.push({ id: el.expressId, P, I, bb: bboxOf(P), isSpace: false });
  });
  spaces.forEach(el => {
    if (!el.geometry) return;
    const { P, I } = elementMeshEP(el, shift);
    rayEls.push({ id: el.expressId, P, I, bb: bboxOf(P), isSpace: true });
  });
  const castRay = (o, d, maxT = 60) => {
    const hits = [];
    for (const e of rayEls) {
      const tb = rayBox(o, d, e.bb.min, e.bb.max);
      if (tb == null || tb > maxT) continue;
      let best = null;
      for (let t = 0; t < e.I.length; t += 3) {
        const h = rayTri(o, d, e.P[e.I[t]], e.P[e.I[t + 1]], e.P[e.I[t + 2]]);
        if (h != null && (best == null || h < best)) best = h;
      }
      if (best != null && best <= maxT) hits.push({ t: best, id: e.id, isSpace: e.isSpace });
    }
    return hits.sort((x, y) => x.t - y.t);
  };

  const gradeZ = 0.3; // floors within 0.3 m of the lowest zone floor are taken as on grade
  const classify = (f, ring) => {
    const depth = (f.kind === 'Wall' ? opts.maxWallGap : opts.maxSlabGap) + 0.3;
    const samples = ringSamples(ring, 3);
    let ext = 0, inn = 0;
    const counts = new Map();
    const firstHits = new Map();
    samples.forEach(q => {
      const p = v3.add(to3D(q, f.origin, f.basis), v3.scale(f.normal, 0.002));
      const hits = castRay(p, f.normal).filter(h => h.id !== f.spaceId);
      const near = hits.filter(h => h.t <= depth && !h.isSpace);
      near.forEach(h => counts.set(h.id, (counts.get(h.id) || 0) + 1));
      if (near[0]) firstHits.set(near[0].id, (firstHits.get(near[0].id) || 0) + 1);
      const beyond = hits.some(h => h.t > depth || h.isSpace);
      if (beyond) inn++; else ext++;
    });
    const order = [...counts.keys()].sort((x, y) => (firstHits.get(y) || 0) - (firstHits.get(x) || 0) || counts.get(y) - counts.get(x));
    return { exterior: ext >= inn, share: ext / Math.max(1, samples.length), sources: order };
  };

  // ---- Surfaces --------------------------------------------------------------------------------
  const surfaces = [];
  const byPair = new Map();
  faces.forEach(f => {
    multiToRings(f.rem, 0.05).forEach(r => f.parts.push({ ring: r, bc: null }));
    f.parts.forEach(part => {
      const verts = part.ring.map(q => to3D(q, f.origin, f.basis).map(c => Math.round(c * 1e4) / 1e4));
      const area = polyArea3(verts);
      if (area < 0.05) return;
      const zone = zones.get(f.zoneKey);
      let type = f.kind;
      let bc = part.bc, provenance = {};
      let sourceIds = [];
      const minZ = Math.min(...verts.map(p => p[2]));
      const maxZ = Math.max(...verts.map(p => p[2]));
      if (bc === 'Surface') {
        provenance.boundary = `Facing surface of another zone ${part.gap.toFixed(2)} m away (geometric match)`;
        // Elements between the two zones.
        const c = polyCentroid3(verts);
        castRay(v3.add(c, v3.scale(f.normal, 0.002)), f.normal, part.gap + 0.05).filter(h => !h.isSpace).forEach(h => { if (!sourceIds.includes(h.id)) sourceIds.push(h.id); });
        if (type === 'Ceiling') type = 'Ceiling';
      } else {
        const cl = classify(f, part.ring);
        sourceIds = cl.sources;
        const host = sourceIds.map(id => model.byId.get(id)).find(e => e && !/^Ifc(Window|Door)/.test(e.ifcClass)) || null;
        const isExt = host ? pset(host, model, null, 'IsExternal') : null;
        if (f.kind === 'Floor' && maxZ <= gradeZ) {
          bc = 'Ground';
          provenance.boundary = 'Lowest modelled floor, taken as on grade';
        } else if (isExt && isExt.from && cl.share > 0 && cl.share < 1) {
          bc = truthy(isExt.value) ? 'Outdoors' : 'Unmodelled';
          provenance.boundary = `${isExt.from} = ${isExt.value} (ray test was mixed, ${Math.round(cl.share * 100)}% exterior)`;
        } else if (cl.exterior) {
          bc = f.kind === 'Wall' && maxZ <= gradeZ ? 'Ground' : 'Outdoors';
          provenance.boundary = `Ray test: ${Math.round(cl.share * 100)}% of samples leave the building within the element depth`;
          if (isExt && !truthy(isExt.value)) issue('warning', 'isexternal-conflict', `A ${f.kind.toLowerCase()} of ${zone.name} leaves the building geometrically, but ${elementLabel(host)} declares ${isExt.from} = ${isExt.value}.`, { ids: [host.expressId], zones: [f.zoneKey] });
        } else {
          bc = 'Unmodelled';
          provenance.boundary = `Ray test: ${Math.round((1 - cl.share) * 100)}% of samples reach other building parts without a zone`;
        }
        if (type === 'Ceiling' && bc === 'Outdoors') type = 'Roof';
      }
      const tz = tiltAz(polyNormal3(verts), northAngle);
      const s = {
        id: `s${surfaces.length + 1}`,
        name: null,
        zoneKey: f.zoneKey,
        spaceId: f.spaceId,
        type, bc,
        pairId: part.pairId || null,
        vertices: verts,
        area,
        normal: polyNormal3(verts),
        tilt: tz.tilt, azimuth: tz.azimuth,
        minZ, maxZ,
        sourceIds,
        provenance: { geometry: zone.source === 'IfcSpace' ? 'Planar face of the IfcSpace body (reconstructed; the file has no usable IfcRelSpaceBoundary geometry)' : 'Face of the storey zone prism', ...provenance },
        subsurfaceIds: [],
      };
      surfaces.push(s);
      zone.surfaceIds.push(s.id);
      if (s.pairId) { if (!byPair.has(s.pairId)) byPair.set(s.pairId, []); byPair.get(s.pairId).push(s); }
    });
  });
  byPair.forEach(list => {
    if (list.length !== 2) { list.forEach(s => { s.bc = 'Adiabatic'; s.pairId = null; s.provenance.boundary += ' (partner dropped as too small; set adiabatic)'; }); return; }
    list[0].partner = list[1].id; list[1].partner = list[0].id;
    // Both sides share the elements found between them.
    const ids = [...new Set([...list[0].sourceIds, ...list[1].sourceIds])];
    list[0].sourceIds = ids; list[1].sourceIds = ids;
  });

  // Unmodelled neighbours: adiabatic or outdoors, as the user chose.
  const unm = surfaces.filter(s => s.bc === 'Unmodelled');
  unm.forEach(s => {
    s.bc = opts.unmodelled === 'outdoors' ? 'Outdoors' : 'Adiabatic';
    if (s.bc === 'Outdoors' && s.type === 'Ceiling') s.type = 'Roof';
    s.provenance.boundary += `; treated as ${s.bc.toLowerCase()} (setting)`;
    s.unmodelled = true;
  });
  if (unm.length) {
    const a = unm.reduce((t, s) => t + s.area, 0);
    issue('assumption', 'unmodelled-neighbours', `${unm.length} surface(s) (${a.toFixed(1)} m²) face building parts that have no thermal zone, such as shafts or rooms without an IfcSpace. They are treated as ${opts.unmodelled === 'outdoors' ? 'outdoor' : 'adiabatic (no heat flow)'} boundaries.`, { surfaces: unm.map(s => s.id), ids: [...new Set(unm.flatMap(s => s.sourceIds.slice(0, 1)))] });
  }

  // Names
  const zoneList = [...zones.values()];
  zoneList.forEach(z => {
    const counters = {};
    z.surfaceIds.map(id => surfaces.find(s => s.id === id)).forEach(s => {
      const label = s.type === 'Wall' ? `Wall ${compass(s.azimuth)}` : s.type;
      counters[label] = (counters[label] || 0) + 1;
      s.name = namer(`${z.name} ${label} ${counters[label]}`);
    });
    const floors = z.surfaceIds.map(id => surfaces.find(s => s.id === id)).filter(s => s.type === 'Floor');
    z.floorArea = floors.reduce((t, s) => t + s.area, 0);
    z.height = z.bbox.max[2] - z.bbox.min[2];
    z.ceilingHeight = z.floorArea > 0 ? z.volume / z.floorArea : z.height;
  });
  const surfById = new Map(surfaces.map(s => [s.id, s]));

  // ---- Windows and doors ------------------------------------------------------------------------
  const subsurfaces = [];
  const hostOfOpening = new Map();
  const nr = model.navRelations || { fills: new Map(), voids: new Map() };
  const openingToFiller = new Map();
  nr.fills.forEach((fillers, op) => fillers.forEach(f => openingToFiller.set(op, f)));
  nr.voids.forEach((ops, host) => ops.forEach(op => { const f = openingToFiller.get(op); if (f != null) hostOfOpening.set(f, host); }));
  let skippedInterior = 0;
  const skipped = [];
  openingsEls.forEach(el => {
    const isDoor = /^IfcDoor/.test(el.ifcClass);
    const { P } = elementMeshEP(el, shift);
    const c = P.reduce((s, p) => v3.add(s, p), [0, 0, 0]).map(x => x / P.length);
    const hostId = hostOfOpening.get(el.expressId);
    let best = null;
    surfaces.forEach(s => {
      if (s.type === 'Floor') return;
      const d = v3.dot(v3.sub(c, s.vertices[0]), s.normal);
      if (d < -0.3 || d > opts.maxWallGap + 0.4) return;
      const b = planeBasis(s.normal);
      const o = s.vertices[0];
      const q = P.map(p => to2D(p, o, b));
      const us = q.map(x => x[0]), vs = q.map(x => x[1]);
      const rect = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      if (rect[1] - rect[0] < 0.05 || rect[3] - rect[2] < 0.05) return;
      const ring = s.vertices.map(p => to2D(p, o, b));
      const rr = [[rect[0], rect[2]], [rect[1], rect[2]], [rect[1], rect[3]], [rect[0], rect[3]]];
      let inter;
      try { inter = mpIntersect([[ring]], [[rr]]); } catch { return; }
      const ov = mpArea(inter);
      const ra = (rect[1] - rect[0]) * (rect[3] - rect[2]);
      if (ov < 0.5 * ra * 0.5) return;
      const score = ov + (hostId != null && s.sourceIds.includes(hostId) ? 1e3 : 0) - Math.abs(d) * 0.1;
      if (!best || score > best.score) best = { s, b, o, rect, ring, ov, ra, score };
    });
    if (!best) { skipped.push(el.expressId); return; }
    const s = best.s;
    if (s.bc !== 'Outdoors') {
      if (!isDoor || !opts.includeInteriorDoors) { skippedInterior++; return; }
    }
    // Fit inside the host's bounding rectangle with a 2 cm margin.
    const us = best.ring.map(x => x[0]), vs = best.ring.map(x => x[1]);
    const m = 0.02;
    const u0 = Math.max(best.rect[0], Math.min(...us) + m), u1 = Math.min(best.rect[1], Math.max(...us) - m);
    const w0 = Math.max(best.rect[2], Math.min(...vs) + m), w1 = Math.min(best.rect[3], Math.max(...vs) - m);
    if (u1 - u0 < 0.05 || w1 - w0 < 0.05) { skipped.push(el.expressId); return; }
    const corners = [[u0, w1], [u0, w0], [u1, w0], [u1, w1]];
    if (!corners.every(p => pointInRing(p, best.ring))) { skipped.push(el.expressId); return; }
    const overlapping = s.subsurfaceIds.map(id => subsurfaces.find(x => x.id === id)).some(o => !(u1 <= o.rect[0] + 1e-3 || u0 >= o.rect[1] - 1e-3 || w1 <= o.rect[2] + 1e-3 || w0 >= o.rect[3] - 1e-3));
    if (overlapping) { skipped.push(el.expressId); return; }
    // EnergyPlus wants the window counter-clockwise seen from outside, starting upper left.
    const verts = corners.map(p => to3D(p, best.o, best.b).map(x => Math.round(x * 1e4) / 1e4));
    const area = (u1 - u0) * (w1 - w0);
    const clippedShare = 1 - area / best.ra;
    const sub = {
      id: `w${subsurfaces.length + 1}`,
      name: namer(`${s.name} ${isDoor ? 'Door' : 'Window'} ${elementLabel(el)}`),
      hostId: s.id,
      type: isDoor ? 'Door' : 'Window',
      vertices: verts,
      rect: [u0, u1, w0, w1],
      area,
      sourceId: el.expressId,
      provenance: { geometry: `Projection of the ${el.ifcClass} body onto its host surface${hostId != null && s.sourceIds.includes(hostId) ? ' (host wall from IfcRelVoidsElement/IfcRelFillsElement)' : ' (host found geometrically)'}${clippedShare > 0.02 ? `; ${Math.round(clippedShare * 100)}% clipped to fit the zone surface` : ''}` },
    };
    subsurfaces.push(sub);
    s.subsurfaceIds.push(sub.id);
  });
  if (skipped.length) issue('warning', 'openings-skipped', `${skipped.length} window(s)/door(s) were not placed: none lies on a zone surface (for example in parts of the building without zones), or it overlaps another opening or the surface edge.`, { ids: skipped });
  if (skippedInterior) issue('assumption', 'interior-openings', `${skippedInterior} interior door(s)/window(s) are omitted; the wall they sit in is modelled as solid.`);
  const extWalls = surfaces.filter(s => s.bc === 'Outdoors' && s.type === 'Wall');
  if (extWalls.length && !subsurfaces.some(x => x.type === 'Window')) issue('warning', 'no-windows', 'No exterior windows were placed. Solar gains and daylight will be underestimated if the building has glazing.');

  // ---- Constructions ---------------------------------------------------------------------------------
  const constructions = new Map();
  const windowTypes = new Map();
  const unresolved = new Map(); // IFC material name → { ids, suggestion }
  const warnedOrder = new Set();
  const surfaceCategory = (s) => {
    if (s.type === 'Wall') return s.bc === 'Outdoors' ? 'exteriorWall' : s.bc === 'Ground' ? 'exteriorWall' : 'interiorWall';
    if (s.type === 'Roof') return 'roof';
    if (s.type === 'Floor') return s.bc === 'Ground' ? 'groundFloor' : s.bc === 'Outdoors' ? 'exposedFloor' : 'interiorFloor';
    return s.bc === 'Outdoors' ? 'roof' : 'interiorFloor';
  };
  const resistanceCat = (s) => (s.type === 'Wall' ? (s.bc === 'Outdoors' ? 'wall' : 'interior') : s.type === 'Roof' ? 'roof' : s.bc === 'Ground' ? 'floorGround' : s.bc === 'Outdoors' ? (s.type === 'Floor' ? 'floorExposed' : 'roof') : 'interiorFloor');

  const layersOfElement = (el) => {
    const own = (el.materials || []).find(m => m.layers && m.layers.length);
    if (own) return own;
    const t = el.typeExpressId ? model.byId.get(el.typeExpressId) : null;
    const tl = t && (t.materials || []).find(m => m.layers && m.layers.length);
    if (tl) return { ...tl, usage: (el.materials || []).find(m => m.usage)?.usage || tl.usage };
    return null;
  };
  const libProps = (lib) => ({ conductivity: lib.conductivity, density: lib.density, specificHeat: lib.specificHeat });
  const addConstruction = (c) => {
    const sig = JSON.stringify([c.layers.map(l => [l.name, +(l.thickness || 0).toFixed(4), l.conductivity, l.density, l.specificHeat, l.resistance]), c.category]);
    for (const k of constructions.keys()) if (constructions.get(k).sig === sig) return k;
    const key = `c${constructions.size + 1}`;
    constructions.set(key, { ...c, key, sig, surfaceIds: [] });
    return key;
  };

  const constructionFor = (s) => {
    const cat = surfaceCategory(s);
    const rcat = resistanceCat(s);
    const host = s.sourceIds.map(id => model.byId.get(id)).find(e => e && /^Ifc(Wall|Slab|Roof|Covering|CurtainWall|Plate|Member|Column|Beam|BuildingElementPart)/.test(e.ifcClass)) || null;
    if (host) {
      const set = layersOfElement(host);
      if (set) {
        // Outside-first order from the layer set usage and the element's placement.
        let order = set.layers.slice();
        let orderNote = 'layer order as listed in the IFC (no usable IfcMaterialLayerSetUsage)';
        const axes = model.elementAxes ? model.elementAxes(host.expressId) : null;
        if (set.usage && axes && /AXIS[123]/.test(set.usage.direction)) {
          // EnergyPlus axes are the IFC project axes (the conversion only translates).
          const col = axes[['x', 'y', 'z'][Number(set.usage.direction.slice(4)) - 1]];
          const dir = set.usage.sense === 'NEGATIVE' ? v3.scale(col, -1) : col;
          if (v3.dot(dir, s.normal) > 0) { order = order.reverse(); }
          orderNote = `layer order from IfcMaterialLayerSetUsage (${set.usage.direction}, ${set.usage.sense}) and the element placement`;
        } else if (!warnedOrder.has(host.expressId)) {
          warnedOrder.add(host.expressId);
          issue('warning', 'layer-order', `Layer order of ${elementLabel(host)} could not be derived from IfcMaterialLayerSetUsage; the listed order is used outside-first.`, { ids: [host.expressId] });
        }
        const layers = [];
        let ok = true, allIfc = true;
        order.forEach(l => {
          if (!(l.thicknessM > 0)) return; // zero-thickness layers carry no resistance
          const ip = l.materialId != null ? model.materialProps.get(l.materialId) : null;
          const mapped = opts.materialMap[l.name] ? libraryMaterial(opts.materialMap[l.name]) : null;
          if (ip && ip.conductivity && ip.density && ip.specificHeat) {
            layers.push({ name: l.name, thickness: l.thicknessM, conductivity: ip.conductivity, density: ip.density, specificHeat: ip.specificHeat, source: `IFC: ${Object.values(ip.sources).join(', ')}` });
          } else if (ip && ip.conductivity && !mapped) {
            layers.push({ name: l.name, thickness: l.thicknessM, resistance: l.thicknessM / ip.conductivity, source: `IFC conductivity (${ip.sources.conductivity}); density/specific heat missing, so the layer has no thermal mass` });
          } else if (mapped) {
            allIfc = false;
            layers.push({ name: l.name, thickness: l.thicknessM, ...libProps(mapped), source: `IFC thickness; ${mapped.name} (${mapped.source}), assigned by the user`, libraryId: mapped.id });
          } else {
            ok = false;
            if (!unresolved.has(l.name)) unresolved.set(l.name, { ids: new Set(), suggestion: suggestLibraryMaterial(l.name) });
            unresolved.get(l.name).ids.add(host.expressId);
          }
        });
        if (ok && layers.length) {
          const u = uValueOf(layers, rcat);
          return addConstruction({
            name: `${set.name}${cat === 'interiorWall' || cat === 'interiorFloor' ? '' : ` (${cat})`}`, category: cat, rcat, layers, uValue: u,
            origin: allIfc ? 'ifc-layers' : 'library-mapped',
            note: `${allIfc ? 'IFC material layers and thermal properties' : 'IFC layer thicknesses with user-assigned library properties'}; ${orderNote}`,
            sourceElement: host.expressId,
          });
        }
      }
      // Declared U-value.
      const common = `Pset_${host.ifcClass.replace(/^Ifc/, '').replace(/(StandardCase|ElementedCase)$/, '')}Common`;
      const u = pset(host, model, common, 'ThermalTransmittance');
      if (u && num(u.value) > 0) {
        const sr = SURFACE_RESISTANCE[rcat] || SURFACE_RESISTANCE.wall;
        const r = 1 / num(u.value) - sr.rsi - sr.rse;
        if (r > 0.001) {
          return addConstruction({
            name: `${elementLabel(host).slice(0, 60)} U=${num(u.value).toFixed(3)}`, category: cat, rcat,
            layers: [{ name: `R-equivalent of ${u.from}`, resistance: r, source: `IFC ${u.from} = ${u.value} W/(m²·K), minus ISO 6946 surface resistances; no thermal mass` }],
            uValue: num(u.value), origin: 'ifc-uvalue', note: `Declared U-value ${u.from}; thermal mass not represented`, sourceElement: host.expressId,
          });
        }
      }
    }
    const ref = REFERENCE_CONSTRUCTIONS[cat];
    const layers = ref.layers.map(([id, t]) => { const m = libraryMaterial(id); return { name: m.name, thickness: t, ...libProps(m), source: m.source, libraryId: id }; });
    return addConstruction({ name: ref.name, category: cat, rcat, layers, uValue: uValueOf(layers, rcat), origin: 'reference', note: 'Reference construction (no usable thermal data in the IFC for this surface)' });
  };

  surfaces.forEach(s => { if (!s.partner || s.constructionKey) return; });
  surfaces.forEach(s => {
    if (s.constructionKey) return;
    s.constructionKey = constructionFor(s);
    if (s.partner) {
      // The partner gets the same layers reversed, as EnergyPlus expects for interzone pairs.
      const p = surfById.get(s.partner);
      const c = constructions.get(s.constructionKey);
      p.constructionKey = addConstruction({ ...c, name: `${c.name} (reversed)`, layers: c.layers.slice().reverse(), reversedOf: c.key, sig: undefined });
    }
  });
  surfaces.forEach(s => constructions.get(s.constructionKey).surfaceIds.push(s.id));

  subsurfaces.forEach(w => {
    const el = model.byId.get(w.sourceId);
    if (w.type === 'Window') {
      const U = pset(el, model, 'Pset_WindowCommon', 'ThermalTransmittance');
      const g = pset(el, model, 'Pset_DoorWindowGlazingType', 'SolarHeatGainTransmittance');
      const tv = pset(el, model, 'Pset_DoorWindowGlazingType', 'VisibleLightTransmittance');
      const spec = {
        uFactor: U && num(U.value) > 0 ? num(U.value) : REFERENCE_WINDOW.uFactor,
        shgc: g && num(g.value) > 0 && num(g.value) < 1 ? num(g.value) : REFERENCE_WINDOW.shgc,
        vt: tv && num(tv.value) > 0 && num(tv.value) < 1 ? num(tv.value) : REFERENCE_WINDOW.vt,
      };
      const prov = {
        uFactor: U && num(U.value) > 0 ? `IFC ${U.from}` : `Assumed (${REFERENCE_WINDOW.name})`,
        shgc: g && num(g.value) > 0 ? `IFC ${g.from}` : `Assumed (${REFERENCE_WINDOW.name})`,
        vt: tv && num(tv.value) > 0 ? `IFC ${tv.from}` : `Assumed (${REFERENCE_WINDOW.name})`,
      };
      const key = `g-${spec.uFactor.toFixed(3)}-${spec.shgc.toFixed(3)}-${spec.vt.toFixed(3)}`;
      if (!windowTypes.has(key)) windowTypes.set(key, { key, name: `Glazing U${spec.uFactor.toFixed(2)} g${spec.shgc.toFixed(2)} Tv${spec.vt.toFixed(2)}`, ...spec, provenance: prov, subsurfaceIds: [], origin: Object.values(prov).every(p => p.startsWith('IFC')) ? 'ifc' : Object.values(prov).some(p => p.startsWith('IFC')) ? 'partial' : 'reference' });
      windowTypes.get(key).subsurfaceIds.push(w.id);
      w.constructionKey = key;
    } else {
      const U = pset(el, model, 'Pset_DoorCommon', 'ThermalTransmittance');
      let key;
      if (U && num(U.value) > 0 && 1 / num(U.value) - 0.17 > 0.001) {
        key = addConstruction({ name: `Door U=${num(U.value).toFixed(2)}`, category: 'door', rcat: 'wall', layers: [{ name: `R-equivalent of ${U.from}`, resistance: 1 / num(U.value) - 0.17, source: `IFC ${U.from}` }], uValue: num(U.value), origin: 'ifc-uvalue', note: 'Declared door U-value; no thermal mass' });
      } else {
        const ref = REFERENCE_CONSTRUCTIONS.door;
        const layers = ref.layers.map(([id, t]) => { const m = libraryMaterial(id); return { name: m.name, thickness: t, ...libProps(m), source: m.source, libraryId: id }; });
        key = addConstruction({ name: ref.name, category: 'door', rcat: 'wall', layers, uValue: uValueOf(layers, 'wall'), origin: 'reference', note: 'Reference door construction' });
      }
      w.constructionKey = key;
      constructions.get(key).surfaceIds.push(w.id);
    }
  });

  if (unresolved.size) {
    issue('assumption', 'materials-unresolved', `${unresolved.size} IFC material(s) have layer thicknesses but no thermal properties: ${[...unresolved.keys()].slice(0, 6).join(', ')}${unresolved.size > 6 ? ', …' : ''}. Their surfaces use reference constructions until you assign library materials.`, { ids: [...new Set([...unresolved.values()].flatMap(u => [...u.ids]))] });
  }
  const refCount = surfaces.filter(s => constructions.get(s.constructionKey).origin === 'reference').length;
  if (refCount) issue('assumption', 'reference-constructions', `${refCount} of ${surfaces.length} surfaces use reference constructions because the IFC gives no thermal data for them.`, { surfaces: surfaces.filter(s => constructions.get(s.constructionKey).origin === 'reference').map(s => s.id) });
  const refWin = [...windowTypes.values()].filter(w => w.origin !== 'ifc');
  if (refWin.length) issue('assumption', 'reference-glazing', `${refWin.reduce((n, w) => n + w.subsurfaceIds.length, 0)} window(s) use assumed glazing properties for values the IFC does not declare (U, g or τv).`);

  // ---- Checks and traceability ----------------------------------------------------------------------
  zoneList.forEach(z => {
    if (z.volume <= 0.1) issue('critical', 'zone-volume', `${z.name} has no volume.`, { ids: z.spaceIds, zones: [z.key] });
    if (!z.floorArea) issue('warning', 'zone-floor', `${z.name} has no floor surface.`, { ids: z.spaceIds, zones: [z.key] });
  });
  // Duplicate coplanar surfaces in one zone.
  let dup = 0;
  zoneList.forEach(z => {
    const ss = z.surfaceIds.map(id => surfById.get(id));
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) {
      const a = ss[i], b = ss[j];
      if (v3.dot(a.normal, b.normal) < 0.999 || Math.abs(v3.dot(a.normal, v3.sub(a.vertices[0], b.vertices[0]))) > 0.01) continue;
      const bs = planeBasis(a.normal);
      try {
        const ov = mpArea(mpIntersect([[a.vertices.map(p => to2D(p, a.vertices[0], bs))]], [[b.vertices.map(p => to2D(p, a.vertices[0], bs))]]));
        if (ov > 0.01) dup++;
      } catch { /* ignore */ }
    }
  });
  if (dup) issue('warning', 'duplicate-surfaces', `${dup} pair(s) of overlapping coplanar surfaces found in the same zone.`);
  const nGround = surfaces.filter(s => s.bc === 'Ground').length;
  if (!nGround) issue('warning', 'no-ground', 'No surface touches the ground. Check that the lowest storey has floor geometry.');

  const mapping = new Map(); // IFC express id → { surfaces, subsurfaces, zones }
  const link = (id, kind, sid) => {
    if (!mapping.has(id)) mapping.set(id, { surfaces: [], subsurfaces: [], zones: [] });
    const m = mapping.get(id)[kind];
    if (!m.includes(sid)) m.push(sid);
  };
  surfaces.forEach(s => s.sourceIds.forEach(id => link(id, 'surfaces', s.id)));
  subsurfaces.forEach(w => link(w.sourceId, 'subsurfaces', w.id));
  zoneList.forEach(z => z.spaceIds.forEach(id => link(id, 'zones', z.key)));

  const verifiedChecks = [];
  if (zoneList.every(z => z.closure <= 0.02)) verifiedChecks.push(`All ${zoneList.length} zone solids are closed (area-vector imbalance ≤ 2%).`);
  const pairCount = surfaces.filter(s => s.partner).length / 2;
  if (pairCount) verifiedChecks.push(`${pairCount} interzone surface pairs with equal areas and opposite orientation.`);
  verifiedChecks.forEach(m => issue('verified', 'check', m));

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    zones: zoneList,
    zoneByKey: zones,
    surfaces,
    surfById,
    subsurfaces,
    constructions,
    windowTypes,
    unresolvedMaterials: unresolved,
    mapping,
    issues,
    northAngle,
    shift,
    options: opts,
    stats: {
      zones: zoneList.length,
      surfaces: surfaces.length,
      exterior: surfaces.filter(s => s.bc === 'Outdoors').length,
      ground: nGround,
      interzonePairs: pairCount,
      adiabatic: surfaces.filter(s => s.bc === 'Adiabatic').length,
      windows: subsurfaces.filter(w => w.type === 'Window').length,
      doors: subsurfaces.filter(w => w.type === 'Door').length,
      floorArea: zoneList.reduce((t, z) => t + z.floorArea, 0),
      volume: zoneList.reduce((t, z) => t + z.volume, 0),
      windowArea: subsurfaces.filter(w => w.type === 'Window').reduce((t, w) => t + w.area, 0),
      exteriorWallArea: surfaces.filter(s => s.bc === 'Outdoors' && s.type === 'Wall').reduce((t, s) => t + s.area, 0),
      buildMs: t1 - t0,
    },
  };
}

function elementLabelSafe(el) {
  if (!el) return '—';
  return (el.name && String(el.name).trim()) || (el.longName && String(el.longName).trim()) || `${el.ifcClass.replace(/^Ifc/, '')} #${el.expressId}`;
}
if (typeof window !== 'undefined' && typeof window.elementLabel !== 'function') window.elementLabel = elementLabelSafe;

/** IFC → BEM traceability table, one row per (IFC element, analytical object). */
function mappingRows(tm, model) {
  const rows = [];
  tm.mapping.forEach((m, id) => {
    const el = model.byId.get(id);
    const base = { ifcExpressId: id, ifcGlobalId: el ? el.globalId : '', ifcClass: el ? el.ifcClass : '', ifcName: el ? elementLabelSafe(el) : '' };
    m.zones.forEach(k => { const z = tm.zoneByKey.get(k); rows.push({ ...base, bemObject: 'Zone', bemName: z.name, zone: z.name, boundary: '', construction: '', area: +z.floorArea.toFixed(3), uValue: '' }); });
    m.surfaces.forEach(sid => {
      const s = tm.surfById.get(sid);
      const c = tm.constructions.get(s.constructionKey);
      rows.push({ ...base, bemObject: `BuildingSurface:Detailed (${s.type})`, bemName: s.name, zone: tm.zoneByKey.get(s.zoneKey).name, boundary: s.bc, construction: c ? c.name : '', area: +s.area.toFixed(3), uValue: c && c.uValue ? +c.uValue.toFixed(3) : '' });
    });
    m.subsurfaces.forEach(wid => {
      const w = tm.subsurfaces.find(x => x.id === wid);
      const host = tm.surfById.get(w.hostId);
      const g = w.type === 'Window' ? tm.windowTypes.get(w.constructionKey) : tm.constructions.get(w.constructionKey);
      rows.push({ ...base, bemObject: `FenestrationSurface:Detailed (${w.type})`, bemName: w.name, zone: tm.zoneByKey.get(host.zoneKey).name, boundary: host.bc, construction: g ? g.name : '', area: +w.area.toFixed(3), uValue: g ? +(g.uFactor || g.uValue || 0).toFixed(3) : '' });
    });
  });
  return rows;
}

Object.assign(window, { BEM_DEFAULTS, buildThermalModel, mappingRows, tiltAz, compass, bemPset: pset });
