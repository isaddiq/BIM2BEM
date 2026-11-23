/**
 * Browser EnergyPlus engine (EnergyPlus 26.2 compiled to WebAssembly, run in a Web Worker
 * by @idfkit/engine). Nothing here loads until the first simulation is requested, so
 * opening an IFC model never downloads the ~37 MB engine binary.
 *
 * Asset location: a self-hosted copy in assets/energyplus/ when the deployment provides one
 * (window.ENGINE_LOCAL_ASSETS, set by the GitHub Pages workflow), otherwise — or if that
 * copy fails to load — the version-pinned package on jsDelivr. The loader and worker are
 * always same-origin.
 */

const ENGINE_INFO = {
  energyPlus: '26.2.0',
  loader: '@idfkit/engine 0.6.0',
  loaderUrl: 'assets/vendor/idfkit-engine-0.6.0/index.js',
  workerUrl: 'assets/vendor/idfkit-engine-0.6.0/engine.worker.js',
  localAssets: 'assets/energyplus',
  cdnAssets: 'https://cdn.jsdelivr.net/npm/@idfkit/engine-assets@26.2.0/assets',
  wasmFile: 'energyplus.js-26.2.wasm',
};

let _engine = null;          // { ep, lib, assetBaseUrl, source }
let _enginePromise = null;
let _progressSink = null;
let _consoleSink = null;

const absUrl = (rel) => new URL(rel, document.baseURI).href;

function engineAssetCandidates() {
  const cdn = { url: ENGINE_INFO.cdnAssets, source: 'jsDelivr CDN (npm @idfkit/engine-assets@26.2.0)' };
  return window.ENGINE_LOCAL_ASSETS ? [{ url: absUrl(ENGINE_INFO.localAssets), source: 'self-hosted (this site)' }, cdn] : [cdn];
}

/** Load (once) and return the engine. onStatus receives human-readable phases. */
function getEngine(onStatus = () => {}) {
  if (_engine && !_engine.ep.isDisposed) return Promise.resolve(_engine);
  if (_enginePromise) return _enginePromise;
  _enginePromise = (async () => {
    onStatus('Loading the engine loader');
    const lib = await import(absUrl(ENGINE_INFO.loaderUrl));
    let ep = null, assets = null, lastErr = null;
    for (const cand of engineAssetCandidates()) {
      onStatus(`Downloading EnergyPlus ${ENGINE_INFO.energyPlus} (WebAssembly, ~37 MB) from ${cand.source}`);
      try {
        ep = await lib.createEnergyPlus({
          assetBaseUrl: cand.url,
          workerUrl: absUrl(ENGINE_INFO.workerUrl),
          wasmFile: ENGINE_INFO.wasmFile,
          loadTimeoutMs: 240000,
          onProgress: (p) => _progressSink && _progressSink(p),
          onConsole: (line) => _consoleSink && _consoleSink(line),
          onDispose: (err) => { if (err) console.warn('EnergyPlus engine stopped:', err); _engine = null; _enginePromise = null; },
        });
        assets = cand;
        break;
      } catch (err) { lastErr = err; console.warn(`EnergyPlus assets from ${cand.source} failed:`, err); }
    }
    if (!ep) throw lastErr || new Error('The EnergyPlus engine could not be loaded');
    _engine = { ep, lib, assetBaseUrl: assets.url, source: assets.source };
    return _engine;
  })();
  _enginePromise.catch(() => { _enginePromise = null; });
  return _enginePromise;
}

/**
 * Run one simulation. Resolves with { run, seconds, engine } even when EnergyPlus reports
 * failure (check run.success); rejects only when the engine could not run at all.
 */
async function runEnergyPlus(idf, epw, { onStatus = () => {}, onProgress = () => {}, onConsole = () => {} } = {}) {
  const eng = await getEngine(onStatus);
  _progressSink = onProgress;
  _consoleSink = onConsole;
  onStatus('Running EnergyPlus');
  const t0 = performance.now();
  try {
    const run = await eng.ep.run({ idf, epw, outputs: { sql: false } });
    return { run, seconds: (performance.now() - t0) / 1000, engine: eng };
  } finally {
    _progressSink = null;
    _consoleSink = null;
  }
}

function engineLoaded() { return !!(_engine && !_engine.ep.isDisposed); }
function engineSource() { return _engine ? _engine.source : null; }

Object.assign(window, { ENGINE_INFO, getEngine, runEnergyPlus, engineLoaded, engineSource });
