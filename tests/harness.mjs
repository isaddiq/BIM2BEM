// Loads BIM2BEM's compiled browser modules into Node so the same code paths the
// site runs can be tested: IFC parsing (web-ifc 0.0.35, as bundled on the site),
// BIM→BEM conversion, IDF writing, weather, comfort and the EnergyPlus engine.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.polygonClipping = require('polygon-clipping');
globalThis.earcut = require('earcut').default || require('earcut');

const CORE = ['schema', 'ifcloader', 'geom', 'materials', 'idf', 'weather', 'comfort', 'bem', 'epmodel', 'results'];
const load = (rel) => vm.runInThisContext(readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
load('assets/js/data/ep-schema.js');
for (const m of CORE) {
  const rel = `assets/js/compiled/core/${m}.js`;
  try { load(rel); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

let runtime = null;
export async function ifcRuntime() {
  if (runtime) return runtime;
  // web-ifc's Emscripten glue picks browser mode when `window` and `fetch` exist;
  // hide both while it initialises so it reads the WASM from disk.
  const saved = { window: globalThis.window, fetch: globalThis.fetch, log: console.log };
  delete globalThis.window;
  globalThis.fetch = undefined;
  console.log = () => {};
  let WebIFC, api;
  try {
    WebIFC = require('web-ifc');
    api = new WebIFC.IfcAPI();
    api.SetWasmPath(path.join(ROOT, 'node_modules/web-ifc/') + path.sep, true);
    await api.Init();
  } finally {
    globalThis.window = saved.window;
    globalThis.fetch = saved.fetch;
    console.log = saved.log;
  }
  const typesMap = {};
  Object.entries(WebIFC).forEach(([k, v]) => { if (/^IFC[A-Z0-9]+$/.test(k) && typeof v === 'number') typesMap[v] = k; });
  runtime = globalThis.createIfcRuntime(api, typesMap);
  return runtime;
}

/** Parse an IFC file with the site's parser and wait for secondary data. */
export async function loadIfc(rel) {
  const rt = await ifcRuntime();
  const buf = new Uint8Array(readFileSync(path.join(ROOT, rel)));
  const model = await globalThis.parseIfcBuffer(rt, buf, { fileName: path.basename(rel), quiet: true, deferSecondary: true });
  await model._ensureSecondaryData();
  return model;
}

export function readText(rel) { return readFileSync(path.join(ROOT, rel), 'utf8'); }

let engine = null;
export async function energyPlus() {
  if (engine) return engine;
  const { createEnergyPlus } = await import('@idfkit/engine/node');
  engine = await createEnergyPlus();
  return engine;
}
export function disposeEngine() { if (engine) { engine.dispose(); engine = null; } }
