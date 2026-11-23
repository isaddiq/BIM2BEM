/**
 * IFC loader powered by web-ifc (WASM).
 *
 * Two layers:
 *   ensureWebIfc()          browser bootstrap — lazily loads the bundled web-ifc-three
 *                           runtime and returns an IFC runtime { api, W, codeToName, nameToCode }.
 *   parseIfcBuffer(rt, …)   pure parser — no DOM access, so it can run in Node tests or
 *                           a Web Worker (needed for Version 2 grid generation at scale).
 *
 * Critical path (blocks first render):
 *   OpenModel → rel indexes (aggregates, containment, types) → spatial walk → orphan scan
 *   → StreamAllMeshes → bake (positions, normals, indices, bbox per element)
 *
 * Deferred path (starts after first render, awaited by expandElement):
 *   pset / material / classification links → space boundaries, fills and voids
 *   (IfcRelSpaceBoundary, IfcRelFillsElement, IfcRelVoidsElement)
 */

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
const IFC_LOADER_BUNDLE_URL = 'assets/js/ifc-loader-bundle.js?v=web-ifc-0.0.35';
const IFC_WASM_PATH = 'web-ifc-0.0.35/';

let _ifcPromise = null;
let _ifcBundlePromise = null;

function loadIfcLoaderBundle(onLog) {
  if (window.IFCLoader) return Promise.resolve();
  if (_ifcBundlePromise) return _ifcBundlePromise;
  _ifcBundlePromise = new Promise((resolve, reject) => {
    onLog && onLog('info', 'Loading bundled <span class="hl">web-ifc</span> runtime');
    const script = document.createElement('script');
    script.src = IFC_LOADER_BUNDLE_URL;
    script.async = true;
    script.onload = () => {
      if (window.IFCLoader) resolve();
      else reject(new Error('IFC loader bundle loaded, but window.IFCLoader was not registered'));
    };
    script.onerror = () => {
      _ifcBundlePromise = null;
      reject(new Error(`Failed to load ${IFC_LOADER_BUNDLE_URL}`));
    };
    document.head.appendChild(script);
  });
  return _ifcBundlePromise;
}

async function initIfcApi(api) {
  // web-ifc prints a banner on init; keep the console clean.
  const originalLog = console.log;
  console.log = (...args) => {
    const message = args.map(String).join(' ');
    if (message.includes('web-ifc:') && message.includes('threading:')) return;
    originalLog.apply(console, args);
  };
  try {
    await api.Init();
  } finally {
    console.log = originalLog;
  }
}

// Map the all-caps web-ifc keys ("IFCWALLSTANDARDCASE") back to schema casing.
const _casingByKey = new Map();
function casedClassName(key) {
  if (!_casingByKey.size) {
    [...SPATIAL_CLASSES, ...IFC_CLASS_CATALOGUE, ...IFC_TYPE_CATALOGUE,
      'IfcRelAggregates', 'IfcRelContainedInSpatialStructure', 'IfcRelDefinesByType', 'IfcRelDefinesByProperties',
      'IfcRelAssociatesMaterial', 'IfcRelAssociatesClassification', 'IfcRelSpaceBoundary', 'IfcRelFillsElement', 'IfcRelVoidsElement',
    ].forEach(n => _casingByKey.set(n.toUpperCase(), n));
  }
  const known = _casingByKey.get(key);
  if (known) return known;
  return 'Ifc' + key.slice(3).toLowerCase().replace(/^./, ch => ch.toUpperCase());
}

/** Build a runtime from an initialised IfcAPI and a { code: 'IFCKEY' } map. */
function createIfcRuntime(api, typesMap) {
  const W = {};
  const codeToName = new Map();
  const nameToCode = new Map();
  Object.entries(typesMap || {}).forEach(([code, key]) => {
    const n = Number(code);
    W[key] = n;
    const name = casedClassName(key);
    codeToName.set(n, name);
    nameToCode.set(name, n);
  });
  return { api, W, codeToName, nameToCode };
}

function ensureWebIfc(onLog) {
  if (_ifcPromise) return _ifcPromise;
  _ifcPromise = (async () => {
    onLog && onLog('info', 'Initialising local <span class="hl">web-ifc</span> WASM runtime');
    await loadIfcLoaderBundle(onLog);
    const ifcLoader = new window.IFCLoader();
    await ifcLoader.ifcManager.setWasmPath(IFC_WASM_PATH);
    const api = ifcLoader.ifcManager.ifcAPI;
    if (!api.wasmModule) await initIfcApi(api);
    onLog && onLog('ok', 'WASM runtime ready');
    return createIfcRuntime(api, ifcLoader.ifcManager.typesMap);
  })();
  _ifcPromise.catch(() => { _ifcPromise = null; });
  return _ifcPromise;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
function val(x) {
  if (x == null) return null;
  if (Array.isArray(x)) return x;
  if (typeof x === 'object') {
    if ('expressID' in x) return x.expressID;
    if ('value' in x) return x.value;
  }
  return x;
}
function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}
function yieldUI() {
  return new Promise(r => setTimeout(r, 0));
}

async function readIfcSchema(file) {
  if (!file || typeof file.slice !== 'function') return null;
  const header = await file.slice(0, Math.min(file.size || 0, 1024 * 1024)).text();
  const match = header.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  return match ? match[1].toUpperCase() : null;
}

function isSupportedIfcSchema(schema) {
  if (!schema) return true;
  const normalized = String(schema).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return normalized === 'IFC2X3' || normalized.startsWith('IFC4');
}

const SI_PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };

// ---------------------------------------------------------------------------
// Browser entry
// ---------------------------------------------------------------------------
async function loadRealIfc(file, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const onLog = opts.onLog || (() => {});
  onProgress(0.02, 'Starting web-ifc runtime');
  const runtime = opts.runtime || await ensureWebIfc(onLog);
  onProgress(0.12, 'Reading file');
  const buffer = new Uint8Array(await file.arrayBuffer());
  const schemaHint = await readIfcSchema(file);
  return parseIfcBuffer(runtime, buffer, { ...opts, fileName: file.name, fileSize: file.size, schemaHint });
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
async function parseIfcBuffer(runtime, buffer, opts = {}) {
  const { api, W, codeToName, nameToCode } = runtime;
  const onProgress = opts.onProgress || (() => {});
  const onLog = opts.onLog || (() => {});
  const fileName = opts.fileName || 'model.ifc';
  const fileSize = opts.fileSize || buffer.byteLength;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const timing = {};
  const mark = (n) => { timing[n] = now(); };

  mark('total_start');
  onProgress(0.15, 'Parsing STEP data');
  onLog('info', `Parsing <span class="hl">${fileName}</span> (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
  mark('open_start');
  const modelID = api.OpenModel(buffer, { COORDINATE_TO_ORIGIN: true, USE_FAST_BOOLS: true });
  mark('open_end');

  let schemaVersion = opts.schemaHint || 'IFC';
  try { if (api.GetModelSchema) schemaVersion = api.GetModelSchema(modelID) || schemaVersion; } catch { /* older web-ifc */ }
  onLog('ok', `Opened model with schema <span class="hl">${schemaVersion}</span>`);

  const getLine = (id) => api.GetLine(modelID, id, false);
  const idsOfCode = (code) => {
    const out = [];
    if (code == null) return out;
    const v = api.GetLineIDsWithType(modelID, code);
    for (let i = 0; i < v.size(); i++) out.push(v.get(i));
    return out;
  };

  // ---- Relations on the critical path ---------------------------------------
  onProgress(0.3, 'Indexing spatial relationships');
  mark('rel_start');
  const aggMap = await relMap([W.IFCRELAGGREGATES], 'RelatingObject', 'RelatedObjects');
  const containMap = await relMap([W.IFCRELCONTAINEDINSPATIALSTRUCTURE], 'RelatingStructure', 'RelatedElements');
  const typeByEl = new Map();
  for (const relId of idsOfCode(W.IFCRELDEFINESBYTYPE)) {
    const rel = getLine(relId);
    const typeId = val(rel.RelatingType);
    asArray(rel.RelatedObjects).forEach(o => typeByEl.set(val(o), typeId));
  }
  mark('rel_end');

  // ---- Element records -------------------------------------------------------
  onProgress(0.42, 'Building the spatial hierarchy');
  mark('elem_start');
  const elements = [];
  const byId = new Map();
  const idToClass = new Map();
  const storeys = [];
  let project = null, site = null, building = null;

  const classOf = (id) => {
    if (idToClass.has(id)) return idToClass.get(id);
    let cls = null;
    try { cls = codeToName.get(getLine(id).type) || null; } catch { cls = null; }
    idToClass.set(id, cls);
    return cls;
  };

  function buildElement(id, cls, parentExpressId, storey) {
    let line = {};
    try { line = getLine(id); } catch { /* keep a minimal record */ }
    const el = {
      expressId: id,
      globalId: val(line.GlobalId) || '',
      ifcClass: cls,
      name: val(line.Name),
      description: val(line.Description),
      objectType: val(line.ObjectType),
      tag: val(line.Tag),
      predefinedType: val(line.PredefinedType),
      longName: val(line.LongName),
      elevation: val(line.Elevation),
      overallWidth: val(line.OverallWidth),
      overallHeight: val(line.OverallHeight),
      typeExpressId: typeByEl.get(id) || null,
      typeGlobalId: null,
      isType: /(Type|Style)$/.test(cls),
      storey,
      parentExpressId,
      childrenExpressIds: [],
      _psetIds: [],
      _matIds: [],
      _classIds: [],
      _expanded: false,
      propertySets: [],
      quantitySets: [],
      materials: [],
      classifications: [],
      geometry: null,
      bbox: null,
      rawAttributes: null,
    };
    idToClass.set(id, cls);
    elements.push(el);
    byId.set(id, el);
    if (cls === 'IfcSite' && !site) site = el;
    if (cls === 'IfcBuilding' && !building) building = el;
    if (cls === 'IfcBuildingStorey') storeys.push(el);
    return el;
  }

  // Walk aggregation + containment from a node. Storey membership is inherited,
  // so spaces aggregated under a storey (and stair flights under a stair) know their level.
  function expand(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      const storeyOfKids = node.ifcClass === 'IfcBuildingStorey' ? node : node.storey;
      const kids = [...(aggMap.get(node.expressId) || []), ...(containMap.get(node.expressId) || [])];
      for (const cid of kids) {
        if (byId.has(cid)) continue;
        const cls = classOf(cid);
        if (!cls) continue;
        const child = buildElement(cid, cls, node.expressId, storeyOfKids);
        node.childrenExpressIds.push(cid);
        stack.push(child);
      }
    }
  }

  const projIds = idsOfCode(W.IFCPROJECT);
  if (projIds.length === 0) throw new Error('No IfcProject found in file');
  project = buildElement(projIds[0], 'IfcProject', null, null);
  expand(project);

  // Elements reachable only through an unscanned parent, or not related at all.
  const orphanParent = () => building || site || project;
  const adoptOrphan = (id, cls) => {
    const parent = orphanParent();
    const el = buildElement(id, cls, parent.expressId, null);
    parent.childrenExpressIds.push(id);
    expand(el);
    return el;
  };
  IFC_CLASS_CATALOGUE.forEach(cls => {
    idsOfCode(nameToCode.get(cls)).forEach(id => {
      if (!byId.has(id)) adoptOrphan(id, cls);
    });
  });

  // Type objects (attached to the project, kept out of the tree).
  const typeIds = new Set(typeByEl.values());
  IFC_TYPE_CATALOGUE.forEach(cls => idsOfCode(nameToCode.get(cls)).forEach(id => typeIds.add(id)));
  typeIds.forEach(id => {
    if (byId.has(id)) return;
    const cls = classOf(id);
    if (cls) buildElement(id, cls, project.expressId, null);
  });
  byId.forEach(el => {
    if (el.typeExpressId) {
      const t = byId.get(el.typeExpressId);
      if (t) el.typeGlobalId = t.globalId;
    }
  });
  mark('elem_end');

  // ---- Units and georeferencing -------------------------------------------------------
  const lengthUnit = readLengthUnit();
  const geoRef = readGeoReference();

  // ---- Geometry streaming ------------------------------------------------------
  onProgress(0.55, 'Tessellating geometry');
  onLog('info', 'Streaming geometry');
  mark('stream_start');
  const geomByEl = new Map();
  let placedCount = 0;
  const onMesh = (flatMesh) => {
    const id = flatMesh.expressID;
    const placed = flatMesh.geometries;
    const buffers = geomByEl.get(id) || [];
    for (let i = 0; i < placed.size(); i++) {
      const pg = placed.get(i);
      const geom = api.GetGeometry(modelID, pg.geometryExpressID);
      const vData = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const iData = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      // Copy out of WASM memory before it is reused.
      buffers.push({
        vData: new Float32Array(vData),
        iData: new Uint32Array(iData),
        transform: Array.from(pg.flatTransformation),
        color: pg.color && { r: pg.color.x, g: pg.color.y, b: pg.color.z, a: pg.color.w },
      });
      placedCount++;
    }
    geomByEl.set(id, buffers);
  };
  api.StreamAllMeshes(modelID, onMesh);
  // web-ifc skips IfcSpace by default; rooms become thermal zones.
  if (W.IFCSPACE != null && api.StreamAllMeshesWithTypes) {
    try { api.StreamAllMeshesWithTypes(modelID, [W.IFCSPACE], onMesh); } catch (err) { onLog('warn', `Could not stream IfcSpace geometry: ${err.message || err}`); }
  }
  mark('stream_end');
  onLog('ok', `Streamed <span class="hl">${placedCount}</span> placed geometries for <span class="hl">${geomByEl.size}</span> elements`);

  // ---- Bake ----------------------------------------------------------------------
  onProgress(0.75, 'Preparing meshes');
  mark('bake_start');
  const stats = { triangles: 0, vertices: 0, geometryBytes: 0, recoveredElements: 0 };
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const geomEntries = [...geomByEl.entries()];
  for (let i = 0; i < geomEntries.length; i++) {
    const [id, buffers] = geomEntries[i];
    let el = byId.get(id);
    if (!el) {
      // Geometry for a class we did not scan — keep it instead of silently dropping it.
      const cls = classOf(id);
      if (!cls) continue;
      el = adoptOrphan(id, cls);
      stats.recoveredElements++;
    }
    const combined = combineBuffers(buffers);
    // `placement` keeps the first item's 4×4 transform (column-major, viewer frame): the
    // element's local axes, which IfcMaterialLayerSetUsage directions refer to.
    el.geometry = { kind: 'mesh', positions: combined.positions, normals: combined.normals, indices: combined.indices, color: combined.color, placement: buffers[0].transform };
    el.bbox = combined.bbox;
    for (let a = 0; a < 3; a++) {
      bounds.min[a] = Math.min(bounds.min[a], combined.bbox.min[a]);
      bounds.max[a] = Math.max(bounds.max[a], combined.bbox.max[a]);
    }
    stats.triangles += combined.indices.length / 3;
    stats.vertices += combined.positions.length / 3;
    stats.geometryBytes += combined.positions.byteLength + combined.normals.byteLength + combined.indices.byteLength;
    if (i % 64 === 63) {
      onProgress(0.75 + 0.2 * (i / geomEntries.length), 'Preparing meshes');
      await yieldUI();
    }
  }
  if (stats.recoveredElements) {
    onLog('warn', `Recovered <span class="hl">${stats.recoveredElements}</span> elements whose class was outside the scanned catalogue`);
  }
  mark('bake_end');
  onLog('ok', `Prepared ${stats.triangles.toLocaleString()} triangles`);

  // Storeys in elevation order (IFC attribute; geometric levels are derived later).
  storeys.sort((a, b) => (Number(a.elevation) || 0) - (Number(b.elevation) || 0));

  // ---- Indexes -------------------------------------------------------------------
  const byClass = new Map();
  elements.forEach(el => {
    if (el.isType) return;
    if (!byClass.has(el.ifcClass)) byClass.set(el.ifcClass, []);
    byClass.get(el.ifcClass).push(el.expressId);
  });

  // ---- Relationship records (inspector + traceability) ---------------------------
  const relationships = [];
  let rid = 1;
  const pushRel = (relationshipType, sourceExpressId, targetExpressIds, description) => {
    relationships.push({ expressId: -rid++, relationshipType, sourceExpressId, targetExpressIds, description });
  };
  aggMap.forEach((kids, parentId) => pushRel('IfcRelAggregates', parentId, kids, 'Decomposes into'));
  containMap.forEach((els, spId) => pushRel('IfcRelContainedInSpatialStructure', spId, els, 'Contains'));
  typeByEl.forEach((typeId, elId) => pushRel('IfcRelDefinesByType', typeId, [elId], 'Defines type of'));

  let relIndex = null;
  const relationsOf = (id) => {
    if (!relIndex) {
      relIndex = new Map();
      const add = (k, r) => { if (!relIndex.has(k)) relIndex.set(k, []); relIndex.get(k).push(r); };
      relationships.forEach(r => {
        add(r.sourceExpressId, r);
        r.targetExpressIds.forEach(t => add(t, r));
      });
    }
    return relIndex.get(id) || [];
  };

  mark('total_end');
  logTiming();
  onProgress(1, 'Ready');

  // ---- Deferred secondary data -----------------------------------------------------
  const navRelations = { spaceBoundaries: new Map(), virtualBoundaries: new Map(), fills: new Map(), voids: new Map() };
  // IfcMaterial express id → thermal properties declared in the file (SI units assumed).
  const materialProps = new Map();
  let secPromise = null;
  const ensureSecondaryData = () => {
    if (secPromise) return secPromise;
    secPromise = (async () => {
      try {
        mark('sec_start');
        const psetMap = await buildLinks(W.IFCRELDEFINESBYPROPERTIES, 'RelatingPropertyDefinition');
        await yieldUI();
        const matMap = await buildLinks(W.IFCRELASSOCIATESMATERIAL, 'RelatingMaterial');
        await yieldUI();
        const classMap = await buildLinks(W.IFCRELASSOCIATESCLASSIFICATION, 'RelatingClassification');
        byId.forEach(el => {
          el._psetIds = psetMap.get(el.expressId) || [];
          el._matIds = matMap.get(el.expressId) || [];
          el._classIds = classMap.get(el.expressId) || [];
        });
        await yieldUI();

        // Navigation relations: which elements bound each space, which element fills
        // each opening, and which opening voids each host.
        const sb = new Map();
        for (const code of [W.IFCRELSPACEBOUNDARY, W.IFCRELSPACEBOUNDARY1STLEVEL, W.IFCRELSPACEBOUNDARY2NDLEVEL]) {
          for (const relId of idsOfCode(code)) {
            const rel = getLine(relId);
            const spaceId = val(rel.RelatingSpace);
            if (spaceId == null) continue;
            const elId = val(rel.RelatedBuildingElement);
            if (elId != null) {
              if (!sb.has(spaceId)) sb.set(spaceId, []);
              sb.get(spaceId).push(elId);
            }
            // A virtual boundary marks an open connection to a neighbouring space.
            if (String(val(rel.PhysicalOrVirtualBoundary) || '').toUpperCase() === 'VIRTUAL') {
              navRelations.virtualBoundaries.set(spaceId, (navRelations.virtualBoundaries.get(spaceId) || 0) + 1);
            }
          }
        }
        readMaterialProperties();
        await yieldUI();
        const fills = await relMap([W.IFCRELFILLSELEMENT], 'RelatingOpeningElement', 'RelatedBuildingElement');
        const voids = await relMap([W.IFCRELVOIDSELEMENT], 'RelatingBuildingElement', 'RelatedOpeningElement');
        sb.forEach((v, k) => navRelations.spaceBoundaries.set(k, [...new Set(v)]));
        fills.forEach((v, k) => navRelations.fills.set(k, v));
        voids.forEach((v, k) => navRelations.voids.set(k, v));
        navRelations.spaceBoundaries.forEach((els, spaceId) => pushRel('IfcRelSpaceBoundary', spaceId, els, 'Bounded by'));
        fills.forEach((els, openingId) => pushRel('IfcRelFillsElement', openingId, els, 'Filled by'));
        voids.forEach((ops, hostId) => pushRel('IfcRelVoidsElement', hostId, ops, 'Voided by'));
        relIndex = null;
        model.secondaryReady = true;
        mark('sec_end');
        onLog('ok', `Indexed properties, materials and <span class="hl">${navRelations.spaceBoundaries.size}</span> space boundary sets in ${(timing.sec_end - timing.sec_start).toFixed(0)} ms`);
      } catch (err) {
        console.warn('[IFC] Secondary data build error:', err);
        onLog('warn', `Secondary indexing failed: ${err.message || err}`);
      }
    })();
    return secPromise;
  };
  if (!opts.deferSecondary) setTimeout(ensureSecondaryData, 200);

  // ---- Lazy expand (inspector) -------------------------------------------------------
  async function expandElement(expressId) {
    const el = byId.get(expressId);
    if (!el) return null;
    if (el._expanded) return el;
    await ensureSecondaryData();
    if (el._expanded) return el;
    el._expanded = true;

    try { el.rawAttributes = computeRawAttrs(getLine(expressId)); } catch { el.rawAttributes = []; }

    for (const propDefId of el._psetIds) {
      try {
        const propDef = getLine(propDefId);
        const isQto = propDef.type === W.IFCELEMENTQUANTITY;
        const data = { name: val(propDef.Name) || '', properties: [] };
        if (isQto) {
          for (const q of asArray(propDef.Quantities)) {
            let qLine;
            try { qLine = getLine(val(q)); } catch { continue; }
            const valueKey = ['LengthValue', 'AreaValue', 'VolumeValue', 'CountValue', 'WeightValue', 'TimeValue'].find(k => qLine[k] != null);
            const unit = { LengthValue: 'm', AreaValue: 'm²', VolumeValue: 'm³', CountValue: '', WeightValue: 'kg', TimeValue: 's' }[valueKey] || '';
            data.properties.push({ name: val(qLine.Name) || '', value: valueKey ? val(qLine[valueKey]) : null, unit, type: valueKey || 'IfcQuantity' });
          }
          el.quantitySets.push(data);
        } else {
          for (const p of asArray(propDef.HasProperties)) {
            let pLine;
            try { pLine = getLine(val(p)); } catch { continue; }
            const nominal = pLine.NominalValue;
            let value = null;
            let type = 'IfcValue';
            if (nominal && typeof nominal === 'object') {
              value = nominal.value != null ? nominal.value : null;
              type = nominal.name || nominal.label || nominal.valueType || 'IfcValue';
            } else if (nominal != null) {
              value = nominal;
            } else if (pLine.EnumerationValues) {
              value = asArray(pLine.EnumerationValues).map(val).join(', ');
              type = 'IfcPropertyEnumeratedValue';
            }
            data.properties.push({ name: val(pLine.Name) || '', value, unit: null, type });
          }
          el.propertySets.push(data);
        }
      } catch { /* skip broken pset */ }
    }

    for (const matRefId of el._matIds) {
      try { el.materials.push(...extractMaterial(getLine(matRefId))); } catch { /* skip */ }
    }

    for (const refId of el._classIds) {
      try {
        const ref = getLine(refId);
        let system = 'Unknown';
        const srcId = val(ref.ReferencedSource);
        if (srcId) {
          try {
            const src = getLine(srcId);
            system = val(src.Name) || val(src.Source) || 'Unknown';
          } catch { /* keep Unknown */ }
        }
        el.classifications.push({ system, code: val(ref.Identification) || val(ref.ItemReference) || '', name: val(ref.Name) || '' });
      } catch { /* skip */ }
    }
    return el;
  }

  function close() {
    try { api.CloseModel(modelID); } catch { /* already closed */ }
  }

  // World orientation of an element's local axes (IFC project frame, Z up), from its
  // IfcLocalPlacement chain. Layer-set directions (AXIS2/AXIS3) refer to these axes.
  const axesCache = new Map();
  function elementAxes(expressId) {
    if (axesCache.has(expressId)) return axesCache.get(expressId);
    let out = null;
    try {
      const line = getLine(expressId);
      const R = placementRotation(val(line.ObjectPlacement), 0);
      if (R) out = { x: [R[0], R[3], R[6]], y: [R[1], R[4], R[7]], z: [R[2], R[5], R[8]] };
    } catch { out = null; }
    axesCache.set(expressId, out);
    return out;
  }
  function placementRotation(id, depth) {
    if (id == null || depth > 64) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const lp = getLine(id);
    if (lp.type !== W.IFCLOCALPLACEMENT) return null; // grid or linear placements: not resolved here
    const local = axis2Rotation(val(lp.RelativePlacement));
    const parent = lp.PlacementRelTo ? placementRotation(val(lp.PlacementRelTo), depth + 1) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (!local || !parent) return null;
    const out = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += parent[r * 3 + k] * local[k * 3 + c];
    return out;
  }
  function axis2Rotation(id) {
    if (id == null) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const ap = getLine(id);
    const dir = (ref, fallback) => {
      if (ref == null) return fallback;
      const r = asArray(getLine(val(ref)).DirectionRatios).map(val).map(Number);
      while (r.length < 3) r.push(0);
      const l = Math.hypot(r[0], r[1], r[2]) || 1;
      return [r[0] / l, r[1] / l, r[2] / l];
    };
    const z = dir(ap.Axis, [0, 0, 1]);
    let x = dir(ap.RefDirection, Math.abs(z[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]);
    const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
    x = [x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]];
    const lx = Math.hypot(x[0], x[1], x[2]) || 1;
    x = [x[0] / lx, x[1] / lx, x[2] / lx];
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    // Column-major axes as a row-major 3×3: columns are x, y, z.
    return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  }

  const model = {
    elements,
    byId,
    byClass,
    relationships,
    relationsOf,
    navRelations,
    project,
    site: site || { name: '—' },
    building: building || { name: '—' },
    storeys,
    schemaVersion,
    lengthUnit,
    geoRef,
    materialProps,
    fileName,
    fileSize,
    bounds: Number.isFinite(bounds.min[0]) ? bounds : null,
    stats,
    timing,
    totalEntities: elements.length + relationships.length,
    totalGeometryItems: geomByEl.size,
    secondaryReady: false,
    expandElement,
    elementAxes,
    close,
    _ensureSecondaryData: ensureSecondaryData,
  };
  return model;

  // -----------------------------------------------------------------------------------
  // Local helpers (closures over api, W, modelID)
  // -----------------------------------------------------------------------------------
  function logTiming() {
    const d = (a, b) => (timing[a] != null && timing[b] != null) ? `${(timing[b] - timing[a]).toFixed(0)} ms` : '–';
    if (typeof console.table !== 'function' || opts.quiet) return;
    console.groupCollapsed(`[BIM2BEM] IFC load timing — ${fileName}`);
    console.table({
      'OpenModel (STEP parse)': d('open_start', 'open_end'),
      'Relation indexes': d('rel_start', 'rel_end'),
      'Element records': d('elem_start', 'elem_end'),
      'StreamAllMeshes': d('stream_start', 'stream_end'),
      'Bake buffers': d('bake_start', 'bake_end'),
      'Total (critical path)': d('total_start', 'total_end'),
    });
    console.groupEnd();
  }

  async function relMap(typeCodes, parentField, childrenField) {
    const out = new Map();
    let n = 0;
    for (const code of typeCodes) {
      for (const relId of idsOfCode(code)) {
        const rel = getLine(relId);
        const pId = val(rel[parentField]);
        const kids = asArray(rel[childrenField]).map(val).filter(v => v != null);
        if (pId != null && kids.length) {
          if (!out.has(pId)) out.set(pId, []);
          out.get(pId).push(...kids);
        }
        if (++n % 1000 === 0) await yieldUI();
      }
    }
    return out;
  }

  async function buildLinks(typeCode, relatingField) {
    const out = new Map();
    let n = 0;
    for (const relId of idsOfCode(typeCode)) {
      const rel = getLine(relId);
      const ref = val(rel[relatingField]);
      if (ref == null) continue;
      for (const o of asArray(rel.RelatedObjects)) {
        const objId = val(o);
        if (!out.has(objId)) out.set(objId, []);
        out.get(objId).push(ref);
      }
      if (++n % 1500 === 0) await yieldUI();
    }
    return out;
  }

  function readLengthUnit() {
    const fallback = { name: 'METRE', scale: 1 };
    try {
      const proj = getLine(project.expressId);
      const ua = getLine(val(proj.UnitsInContext));
      for (const u of asArray(ua.Units)) {
        const unit = getLine(val(u));
        if (String(val(unit.UnitType)).toUpperCase() !== 'LENGTHUNIT') continue;
        if (unit.type === W.IFCSIUNIT) {
          const prefix = val(unit.Prefix);
          return { name: `${prefix || ''}${val(unit.Name) || 'METRE'}`, scale: prefix ? (SI_PREFIX[prefix] || 1) : 1 };
        }
        const name = String(val(unit.Name) || '').toUpperCase();
        if (name.includes('INCH')) return { name: 'INCH', scale: 0.0254 };
        if (name.includes('FOOT') || name.includes('FEET')) return { name: 'FOOT', scale: 0.3048 };
        const factor = getLine(val(unit.ConversionFactor));
        const comp = val(factor.ValueComponent);
        if (typeof comp === 'number') return { name, scale: comp };
      }
    } catch { /* fall through */ }
    return fallback;
  }

  // IfcSite reference latitude/longitude/elevation, the model context's true north,
  // and any postal address. Everything here is what the file declares; the app asks
  // the user to confirm it before using it.
  function readGeoReference() {
    const out = { latitude: null, longitude: null, elevation: null, trueNorth: null, northAngle: null, address: null, siteName: null };
    const dms = (v) => {
      const parts = asArray(v).map(val).map(Number).filter(Number.isFinite);
      if (!parts.length) return null;
      const [d, m = 0, s = 0, us = 0] = parts;
      return d + m / 60 + (s + us / 1e6) / 3600;
    };
    try {
      const siteId = idsOfCode(W.IFCSITE)[0];
      if (siteId != null) {
        const s = getLine(siteId);
        out.siteName = val(s.Name) || null;
        out.latitude = dms(s.RefLatitude);
        out.longitude = dms(s.RefLongitude);
        const el = Number(val(s.RefElevation));
        out.elevation = Number.isFinite(el) ? el * lengthUnit.scale : null;
        if (s.SiteAddress) out.address = readAddress(val(s.SiteAddress));
      }
      const bldId = idsOfCode(W.IFCBUILDING)[0];
      if (!out.address && bldId != null) {
        const b = getLine(bldId);
        if (b.BuildingAddress) out.address = readAddress(val(b.BuildingAddress));
      }
    } catch { /* keep what was read */ }
    try {
      for (const id of idsOfCode(W.IFCGEOMETRICREPRESENTATIONCONTEXT)) {
        const ctx = getLine(id);
        if (ctx.type !== W.IFCGEOMETRICREPRESENTATIONCONTEXT || ctx.TrueNorth == null) continue;
        const r = asArray(getLine(val(ctx.TrueNorth)).DirectionRatios).map(val).map(Number);
        if (r.length >= 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && Math.hypot(r[0], r[1]) > 1e-9) {
          out.trueNorth = { x: r[0], y: r[1] };
          // Angle from true north to the project +Y axis, clockwise, in degrees (EnergyPlus Building North Axis).
          out.northAngle = ((Math.atan2(-r[0], r[1]) * 180 / Math.PI) + 360) % 360;
          break;
        }
      }
    } catch { /* no true north */ }
    return out;
  }

  function readAddress(id) {
    try {
      const a = getLine(id);
      const lines = asArray(a.AddressLines).map(val).filter(Boolean);
      const addr = { street: lines.join(', ') || null, town: val(a.Town) || null, region: val(a.Region) || null, postalCode: val(a.PostalCode) || null, country: val(a.Country) || null };
      return Object.values(addr).some(Boolean) ? addr : null;
    } catch { return null; }
  }

  // Thermal properties attached to materials. IFC4: IfcMaterialProperties property sets
  // (Pset_MaterialThermal, Pset_MaterialCommon). IFC2x3: IfcThermalMaterialProperties and
  // IfcGeneralMaterialProperties. Values are taken as SI (W/(m·K), J/(kg·K), kg/m³).
  function readMaterialProperties() {
    const put = (matId, key, value, source) => {
      const v = Number(value);
      if (matId == null || !Number.isFinite(v) || v <= 0) return;
      if (!materialProps.has(matId)) materialProps.set(matId, { sources: {} });
      const rec = materialProps.get(matId);
      rec[key] = v;
      rec.sources[key] = source;
    };
    const keyOf = { ThermalConductivity: 'conductivity', SpecificHeatCapacity: 'specificHeat', MassDensity: 'density' };
    if (W.IFCMATERIALPROPERTIES != null) {
      for (const id of idsOfCode(W.IFCMATERIALPROPERTIES)) {
        try {
          const mp = getLine(id);
          const matId = val(mp.Material);
          const setName = val(mp.Name) || 'IfcMaterialProperties';
          for (const p of asArray(mp.Properties)) {
            const pl = getLine(val(p));
            const k = keyOf[val(pl.Name)];
            if (k && pl.NominalValue) put(matId, k, val(pl.NominalValue), `${setName}.${val(pl.Name)}`);
          }
        } catch { /* skip */ }
      }
    }
    if (W.IFCTHERMALMATERIALPROPERTIES != null) {
      for (const id of idsOfCode(W.IFCTHERMALMATERIALPROPERTIES)) {
        try {
          const t = getLine(id);
          put(val(t.Material), 'conductivity', val(t.ThermalConductivity), 'IfcThermalMaterialProperties.ThermalConductivity');
          put(val(t.Material), 'specificHeat', val(t.SpecificHeatCapacity), 'IfcThermalMaterialProperties.SpecificHeatCapacity');
        } catch { /* skip */ }
      }
    }
    if (W.IFCGENERALMATERIALPROPERTIES != null) {
      for (const id of idsOfCode(W.IFCGENERALMATERIALPROPERTIES)) {
        try {
          const g = getLine(id);
          put(val(g.Material), 'density', val(g.MassDensity), 'IfcGeneralMaterialProperties.MassDensity');
        } catch { /* skip */ }
      }
    }
  }

  function extractMaterial(line) {
    if (line.type === W.IFCMATERIAL) return [{ name: val(line.Name) || '(material)', materialId: line.expressID }];
    if (line.type === W.IFCMATERIALLAYERSET || line.type === W.IFCMATERIALLAYERSETUSAGE) {
      try {
        const usage = line.type === W.IFCMATERIALLAYERSETUSAGE ? line : null;
        const set = usage ? getLine(val(line.ForLayerSet)) : line;
        const layers = asArray(set.MaterialLayers).map(lh => {
          try {
            const layer = getLine(val(lh));
            const matId = layer.Material ? val(layer.Material) : null;
            const matName = matId != null ? (val(getLine(matId).Name) || '') : '';
            const thicknessM = (Number(val(layer.LayerThickness)) || 0) * lengthUnit.scale;
            return { name: matName || val(layer.Name) || 'Layer', thickness: Math.round(thicknessM * 10000) / 10, thicknessM, materialId: matId, isVentilated: val(layer.IsVentilated) };
          } catch { return null; }
        }).filter(Boolean);
        return [{
          name: val(set.LayerSetName) || 'Layer set',
          layers,
          layerSetId: set.expressID,
          usage: usage ? {
            direction: String(val(usage.LayerSetDirection) || '').toUpperCase(),
            sense: String(val(usage.DirectionSense) || '').toUpperCase(),
            offset: (Number(val(usage.OffsetFromReferenceLine)) || 0) * lengthUnit.scale,
          } : null,
        }];
      } catch { return []; }
    }
    if (line.type === W.IFCMATERIALLIST) {
      return asArray(line.Materials).map(mh => {
        try { return { name: val(getLine(val(mh)).Name) || '', materialId: val(mh) }; } catch { return { name: '?' }; }
      });
    }
    if (line.type === W.IFCMATERIALCONSTITUENTSET) {
      return asArray(line.MaterialConstituents).map(ch => {
        try {
          const c = getLine(val(ch));
          const matName = c.Material ? val(getLine(val(c.Material)).Name) : '';
          return { name: `${val(c.Name) || 'Constituent'}: ${matName || '—'}` };
        } catch { return { name: '?' }; }
      });
    }
    if (line.Name) return [{ name: val(line.Name) }];
    return [];
  }

  function computeRawAttrs(line) {
    const out = [];
    let idx = 1;
    Object.keys(line).forEach(attr => {
      if (attr === 'expressID' || attr === 'type') return;
      const v = line[attr];
      let value = null;
      let ref = false;
      if (v == null) {
        value = null;
      } else if (Array.isArray(v)) {
        const refs = v.filter(x => x && typeof x === 'object' && x.type === 5);
        value = refs.length ? `(${refs.map(x => '#' + x.value).slice(0, 6).join(', ')}${refs.length > 6 ? ', …' : ''})` : `(${v.map(val).join(', ')})`;
        ref = refs.length > 0;
      } else if (typeof v === 'object' && 'value' in v) {
        if (v.type === 5) { value = `#${v.value}`; ref = true; }
        else if (v.type === 3) value = `.${v.value}.`;
        else value = v.value;
      } else {
        value = v;
      }
      out.push({ idx: idx++, name: attr, value, ref });
    });
    return out;
  }
}

// ---------------------------------------------------------------------------
// Combine placed geometry buffers into one mesh in model coordinates.
// web-ifc vertices are [x, y, z, nx, ny, nz]; positions and normals are transformed,
// and triangle winding is flipped for mirrored placements.
// ---------------------------------------------------------------------------
function combineBuffers(buffers) {
  let totalV = 0;
  let totalI = 0;
  for (const b of buffers) {
    totalV += b.vData.length / 6;
    totalI += b.iData.length;
  }
  const positions = new Float32Array(totalV * 3);
  const normals = new Float32Array(totalV * 3);
  const indices = new Uint32Array(totalI);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vOff = 0;
  let iOff = 0;
  let rSum = 0, gSum = 0, bSum = 0, aSum = 0, cN = 0;
  for (const b of buffers) {
    const t = b.transform;
    const det = t[0] * (t[5] * t[10] - t[9] * t[6]) - t[4] * (t[1] * t[10] - t[9] * t[2]) + t[8] * (t[1] * t[6] - t[5] * t[2]);
    const vN = b.vData.length / 6;
    for (let v = 0; v < vN; v++) {
      const s = v * 6;
      const x = b.vData[s], y = b.vData[s + 1], z = b.vData[s + 2];
      const nx = b.vData[s + 3], ny = b.vData[s + 4], nz = b.vData[s + 5];
      const o = (vOff + v) * 3;
      const px = t[0] * x + t[4] * y + t[8] * z + t[12];
      const py = t[1] * x + t[5] * y + t[9] * z + t[13];
      const pz = t[2] * x + t[6] * y + t[10] * z + t[14];
      positions[o] = px; positions[o + 1] = py; positions[o + 2] = pz;
      if (px < min[0]) min[0] = px; if (px > max[0]) max[0] = px;
      if (py < min[1]) min[1] = py; if (py > max[1]) max[1] = py;
      if (pz < min[2]) min[2] = pz; if (pz > max[2]) max[2] = pz;
      let mx = t[0] * nx + t[4] * ny + t[8] * nz;
      let my = t[1] * nx + t[5] * ny + t[9] * nz;
      let mz = t[2] * nx + t[6] * ny + t[10] * nz;
      const len = Math.hypot(mx, my, mz) || 1;
      normals[o] = mx / len; normals[o + 1] = my / len; normals[o + 2] = mz / len;
    }
    const flip = det < 0;
    for (let i = 0; i < b.iData.length; i += 3) {
      indices[iOff + i] = b.iData[i] + vOff;
      indices[iOff + i + 1] = b.iData[flip ? i + 2 : i + 1] + vOff;
      indices[iOff + i + 2] = b.iData[flip ? i + 1 : i + 2] + vOff;
    }
    vOff += vN;
    iOff += b.iData.length;
    if (b.color) {
      rSum += b.color.r; gSum += b.color.g; bSum += b.color.b; aSum += b.color.a;
      cN++;
    }
  }
  const color = cN > 0 ? { r: rSum / cN, g: gSum / cN, b: bSum / cN, a: aSum / cN } : null;
  return { positions, normals, indices, color, bbox: { min, max } };
}

Object.assign(window, {
  loadRealIfc,
  parseIfcBuffer,
  createIfcRuntime,
  ensureWebIfc,
  readIfcSchema,
  isSupportedIfcSchema,
});
