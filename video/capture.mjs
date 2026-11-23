// Capture the frames for the BIM2BEM promo video: serve the site, drive Chrome/Edge through
// the whole workflow on the default demo model (Seoul Exchange Tower) and save stills,
// camera-orbit sequences and click targets to video/_work/frames (git-ignored).
//
//   node video/capture.mjs [--browser path] [--headful]
import http from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'video/_work/frames');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const executablePath = arg('--browser', BROWSERS.find(p => existsSync(p)));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ifc': 'application/octet-stream', '.epw': 'text/plain', '.idd': 'text/plain', '.webmanifest': 'application/manifest+json' };

// 1440×810 CSS px at 4/3 device scale = 1920×1080 frames with readable UI text.
const VW = 1440, VH = 810, DSF = 4 / 3;

const server = http.createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const meta = {};
const browser = await puppeteer.launch({
  executablePath, headless: !process.argv.includes('--headful'),
  args: [`--window-size=${VW},${VH}`, '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  defaultViewport: { width: VW, height: VH, deviceScaleFactor: DSF },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('bim2bem-layout-v1', JSON.stringify({ left: 344, right: 280, bottom: 260, bottomCollapsed: false })); } catch {} });
page.on('pageerror', e => console.log('  pageerror:', e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const step = s => console.log(`· ${s}`);
const waitText = (text, timeout = 60000) => page.waitForFunction(t => document.body.innerText.includes(t), { timeout, polling: 300 }, text);

// Bounding box (in output pixels) of the first element matching a finder evaluated in the page.
const box = (finder, ...args) => page.evaluate((src, args) => {
  const el = new Function('return ' + src)()(...args);
  if (!el) return null;
  el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height];
}, finder.toString(), args).then(b => b && b.map(v => Math.round(v * DSF)));
const byText = (text, sel = 'button') => [...document.querySelectorAll(sel)].find(b => !b.disabled && (b.textContent || '').trim().includes(text));
const byTitle = (title) => document.querySelector(`button[title="${title}"]`);
const byTab = (t) => [...document.querySelectorAll('.bp-tab')].find(b => b.textContent.trim().startsWith(t));

const snap = async (name, extra = {}) => {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 93 });
  meta[name] = { ...(meta[name] || {}), ...extra };
  console.log(`  [${name}]`);
};
// Snap with the click target recorded, then click it.
const snapClick = async (name, finder, ...args) => {
  const b = await box(finder, ...args);
  if (!b) throw new Error(`click target for ${name} not found`);
  await snap(name, { click: b });
  await page.evaluate((src, args) => new Function('return ' + src)()(...args).click(), finder.toString(), args);
};
// Camera orbit sequence: n frames turning dTheta radians in total.
const orbit = async (name, n, dTheta, dPhi = 0) => {
  const dir = path.join(OUT, name);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    await page.evaluate((a, b) => { const v = window.__viewer; v.orbitBy(a, b); v._render(); }, dTheta / n, dPhi / n);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 90 });
  }
  meta[name] = { seq: n };
  console.log(`  [${name}] ${n} frames`);
};
const setDisplay = async (mode) => { await page.select('.display-select select', mode); await sleep(900); };
const settle = (ms = 900) => sleep(ms);
const setDock = async (open) => {
  const label = open ? 'Expand panel' : 'Collapse panel';
  if (await page.$(`button[aria-label="${label}"]`)) { await page.click(`button[aria-label="${label}"]`); await settle(900); }
};
// Drag the dock's resize handle up by dy CSS px (the same gesture a visitor uses).
const dragDock = async (dy) => {
  const h = await page.$('.rh-bottom'); const b = await h.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y - dy * i / 10);
  await page.mouse.up(); await settle(1000);
};
const clickTab = async (t) => {
  await page.evaluate((t) => [...document.querySelectorAll('.bp-tab')].find(b => b.textContent.trim().startsWith(t))?.click(), t);
  await settle(1000);
};
const elementShot = async (name, finder) => {
  const handle = await page.evaluateHandle(finder);
  const el = handle.asElement();
  if (!el) { console.log(`  [${name}] not found`); return; }
  await el.scrollIntoView();
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  [${name}]`);
};

try {
  step('start screen');
  await page.goto(base, { waitUntil: 'networkidle2' });
  await waitText('From IFC model to building energy model');
  await settle(600);
  await snapClick('01_start', byText, 'Try the demo tower');

  step('loading the IFC');
  await page.waitForFunction(() => window.__viewer && /SeoulExchangeTower\.ifc/.test(document.querySelector('.file-chip')?.textContent || ''), { timeout: 180000 });
  await settle(2500);
  // the empty "Selection" panel adds nothing to the BIM shots
  await page.click('button[aria-label="Collapse panel"]').catch(() => {});
  await settle(1200);
  await snap('03_bim');
  await orbit('03_bim_orbit', 75, 0.9);

  step('location from IfcSite');
  await page.click('button[title="Location"]');
  await waitText('From the IFC file');
  await settle(1500);
  await snapClick('04_location', byText, 'Use these values');
  await settle(500);
  await snapClick('05_location_confirm', byText, 'Confirm location');
  await waitText('Confirmed', 30000);
  await waitText('Selected automatically', 180000);
  await waitText('Selected weather data', 20000);
  await settle(1500);
  await snap('06_weather');
  await page.evaluate(() => { const h = [...document.querySelectorAll('.left-side *')].find(e => e.children.length < 3 && /^Selected weather data/.test(e.textContent.trim())); h?.scrollIntoView({ block: 'start' }); });
  await settle(900);
  await snap('06b_weather_data');

  step('BEM conversion');
  await page.click('button[title="BEM Conversion"]');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => x.textContent.includes('Build the energy model') && !x.disabled), { timeout: 120000 });
  await settle(800);
  await snapClick('07_bem_build', byText, 'Build the energy model');
  await waitText('Energy model built', 300000);
  await settle(2000);
  await snap('08_bem_built');
  await orbit('08_bem_orbit', 75, 0.9);

  step('EnergyPlus run');
  await page.click('button[title="Energy Simulation"]');
  await waitText('Weather file (EPW)');
  await page.waitForFunction(() => [...document.querySelectorAll('.scenario button')].some(b => b.textContent.includes('Run') && !b.disabled), { timeout: 30000 });
  await settle(800);
  await snapClick('09_sim_run', () => [...document.querySelectorAll('.scenario button')].find(b => b.textContent.includes('Run')));
  const t0 = Date.now();
  const progressShots = [3000, 15000];
  for (let i = 0; i < progressShots.length; i++) {
    await sleep(progressShots[i] - (Date.now() - t0));
    if (await page.evaluate(() => /Baseline simulated|could not run|failed/.test(document.body.innerText))) break;
    await snap(`10_sim_progress_${i}`);
  }
  await page.waitForFunction(() => /Baseline simulated|could not run|failed/.test(document.body.innerText), { timeout: 1200000, polling: 1000 });
  const status = await page.evaluate(() => document.querySelector('.engine-status')?.innerText || '');
  console.log(`  engine: ${status.replace(/\s+/g, ' ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (!/finished/.test(status)) throw new Error('Simulation did not finish');
  await settle(1500);
  await snap('11_sim_done');

  step('results: model views with the dock collapsed');
  await page.click('button[title="Results"]');
  await waitText('Heating demand');
  await setDock(false);
  await settle(1500);
  await snap('12_results');
  for (const mode of ['heating', 'cooling', 'temperature', 'pmv', 'co2', 'solar']) {
    try { await setDisplay(mode); await snap(`13_display_${mode}`); } catch (e) { console.log(`  display ${mode}: ${e.message}`); }
  }
  await setDisplay('cooling');
  await orbit('19_cooling_orbit', 60, 0.5);

  step('results: charts in a tall dock');
  await setDock(true);
  await dragDock(230);
  for (const tab of ['Energy', 'Hourly loads', 'Temperature', 'Comfort', 'CO₂', 'Climate']) {
    await clickTab(tab);
    await snap(`14_dock_${tab.replace(/[^A-Za-z]+/g, '_').toLowerCase()}`);
  }
  await page.click('button[title="IEQ Analysis"]');
  await waitText('Thermal comfort (occupied hours)');
  await settle(1200);
  await snap('15_ieq');
  await page.click('button[title="Environment"]');
  await waitText('Wind rose');
  await settle(1500);
  await snap('16_env');
  await page.click('button[title="Reports"]');
  await waitText('Exports');
  await settle(1200);
  await snap('17_reports');

  step('hero assets (dark theme): chart cards, KPI tiles, clean model orbit');
  await page.click('button[title="Results"]');
  await waitText('Heating demand');
  await page.click('button[aria-label="Use dark theme"]');
  await setDisplay('heating');
  await settle(1200);
  await elementShot('hero_kpis', () => document.querySelector('.stat-grid'));
  await clickTab('Energy');
  await elementShot('hero_chart_monthly', () => [...document.querySelectorAll('figure.chart')].find(f => f.textContent.includes('Monthly thermal demand')));
  await elementShot('hero_chart_electricity', () => [...document.querySelectorAll('figure.chart')].find(f => f.textContent.includes('Monthly electricity')));
  await clickTab('Hourly loads');
  await elementShot('hero_chart_hourly', () => [...document.querySelectorAll('figure.chart')].find(f => f.textContent.includes('Hourly heating and cooling')));
  await clickTab('Climate');
  await elementShot('hero_chart_climate', () => [...document.querySelectorAll('figure.chart')].find(f => f.textContent.includes('Monthly mean dry-bulb')));
  await setDock(false);
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1.5 });
  await page.addStyleTag({ content: '.viewer-wrap > :not(canvas), .viewer-legend, .status-chip { visibility: hidden !important; }' });
  await settle(1500);
  await page.evaluate(() => { const v = window.__viewer; v.zoomIn(0.86); });
  await settle(800);
  const cv = await page.evaluate(() => { const r = document.querySelector('.viewer-wrap > canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const hdir = path.join(OUT, 'hero_orbit');
  await mkdir(hdir, { recursive: true });
  for (let i = 0; i < 130; i++) {
    await page.evaluate((a) => { const v = window.__viewer; v.orbitBy(a, 0); v._render(); }, 1.0 / 130);
    await page.screenshot({ path: path.join(hdir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92, clip: cv });
  }
  meta.hero_orbit = { seq: 130, size: [cv.width * 1.5, cv.height * 1.5] };
  console.log('  [hero_orbit] 130 frames');
} catch (err) {
  console.error('FAILED:', err.message);
  await snap('zz_failure');
  process.exitCode = 1;
}
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
await browser.close();
server.close();
