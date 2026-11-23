// Copies the browser files BIM2BEM serves from its own origin out of node_modules,
// so the static site needs no build service or package CDN for its own code paths.
//
//   node scripts/vendor.mjs            loader, worker and geometry libraries (committed)
//   node scripts/vendor.mjs --engine   also the ~60 MB EnergyPlus WASM assets into
//                                      assets/energyplus/ (git-ignored; used by the Pages
//                                      workflow and local serving, otherwise jsDelivr)
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
// Package folders under node_modules (some packages do not export package.json).
const pkgDir = (name) => path.join(root, 'node_modules', ...name.split('/'));

const engine = pkgDir('@idfkit/engine');
const engineVersion = JSON.parse(readFileSync(path.join(engine, 'package.json'), 'utf8')).version;
const outEngine = path.join(root, 'assets/vendor', `idfkit-engine-${engineVersion}`);
rmSync(outEngine, { recursive: true, force: true });
mkdirSync(outEngine, { recursive: true });
for (const f of readdirSync(path.join(engine, 'dist'))) {
  if (!/\.js$/.test(f) || /^(node|sql)\.js$/.test(f)) continue;
  cpSync(path.join(engine, 'dist', f), path.join(outEngine, f));
}
cpSync(path.join(engine, 'LICENSE'), path.join(outEngine, 'LICENSE'));

const vendor = path.join(root, 'assets/vendor');
cpSync(path.join(pkgDir('polygon-clipping'), 'dist/polygon-clipping.umd.min.js'), path.join(vendor, 'polygon-clipping.umd.min.js'));
const lic = (dir) => readdirSync(dir).find(f => /^licen[cs]e/i.test(f));
cpSync(path.join(pkgDir('polygon-clipping'), lic(pkgDir('polygon-clipping'))), path.join(vendor, 'LICENSE-polygon-clipping'));
const earcutSrc = readFileSync(path.join(pkgDir('earcut'), 'dist/earcut.min.js'), 'utf8');
writeFileSync(path.join(vendor, 'earcut.min.js'), earcutSrc);
cpSync(path.join(pkgDir('earcut'), lic(pkgDir('earcut'))), path.join(vendor, 'LICENSE-earcut'));
console.log(`Vendored @idfkit/engine ${engineVersion}, polygon-clipping and earcut into assets/vendor/`);

if (process.argv.includes('--engine')) {
  const assets = pkgDir('@idfkit/engine-assets');
  const out = path.join(root, 'assets/energyplus');
  rmSync(out, { recursive: true, force: true });
  cpSync(path.join(assets, 'assets'), out, { recursive: true });
  cpSync(path.join(engine, 'dist/engine.worker.js'), path.join(out, 'engine.worker.js'));
  for (const f of ['LICENSE-EnergyPlus.txt', 'NOTICE', 'THIRD_PARTY_NOTICES']) if (existsSync(path.join(assets, f))) cpSync(path.join(assets, f), path.join(out, f));
  console.log(`Copied EnergyPlus engine assets into ${path.relative(root, out)}/`);
}
