// End-to-end browser test of the static site: serve the folder, drive a real Chrome/Edge,
// and walk the whole workflow on the BEM demo office: open the IFC, confirm the location
// from IfcSite, build an ERA5 weather file, convert to BEM, run EnergyPlus (WebAssembly)
// in the page, and check that results are displayed. Needs network access (Open-Meteo,
// jsDelivr for the engine unless assets/energyplus/ exists).
//
//   node tests/e2e.mjs [--browser "path/to/chrome.exe"] [--shots dir] [--headful]
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const executablePath = arg('--browser', BROWSERS.find(p => existsSync(p)));
const SHOTS = arg('--shots', null);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ifc': 'application/octet-stream', '.epw': 'text/plain', '.idd': 'text/plain', '.webmanifest': 'application/manifest+json' };

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

const errors = [];
const browser = await puppeteer.launch({ executablePath, headless: !process.argv.includes('--headful'), args: ['--window-size=1600,1000', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1600, height: 1000 } });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
const failedUrls = [];
page.on('response', r => { if (r.status() >= 400) failedUrls.push(`${r.status()} ${r.url()}`); });
if (SHOTS) await mkdir(SHOTS, { recursive: true });
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
const step = (name) => console.log(`· ${name}`);
const clickText = async (text, sel = 'button') => {
  const ok = await page.evaluate((text, sel) => {
    const el = [...document.querySelectorAll(sel)].find(b => !b.disabled && (b.textContent || '').trim().includes(text));
    if (el) { el.click(); return true; }
    return false;
  }, text, sel);
  if (!ok) throw new Error(`No enabled ${sel} with text "${text}"`);
};
const clickTitle = async (title) => { await page.click(`button[title="${title}"]`); };
const waitText = (text, timeout = 60000) => page.waitForFunction(t => document.body.innerText.includes(t), { timeout, polling: 500 }, text);

let failed = false;
try {
  step('open the site');
  await page.goto(base, { waitUntil: 'networkidle2' });
  await waitText('From IFC model to building energy model');
  await shot('01-start');

  step('open the BEM demo office');
  await page.evaluate(() => [...document.querySelectorAll('.sample-card')].find(c => c.querySelector('h3')?.textContent.trim() === 'BEM demo office').querySelector('button').click());
  await page.waitForFunction(() => window.__viewer && document.querySelector('.file-chip'), { timeout: 90000 });
  await waitText('Opened BEMDemoOffice.ifc');
  await new Promise(r => setTimeout(r, 1500));
  await shot('02-bim');

  step('confirm the location from IfcSite');
  await clickTitle('Location');
  await waitText('From the IFC file');
  await clickText('Use these values');
  await clickText('Confirm location');
  await waitText('Confirmed', 30000);

  step('weather is fetched automatically after confirming');
  await waitText('Selected automatically', 120000);
  const autoText = await page.evaluate(() => document.querySelector('.auto-weather')?.innerText || '');
  console.log('  auto:', autoText.replace(/\s+/g, ' ').slice(0, 240));
  if (!/ERA5|NASA POWER|Typical-year/.test(autoText)) throw new Error('Automatic weather selection did not report its source');
  await waitText('Selected weather data', 10000);
  await shot('03-location');
  const weatherText = await page.evaluate(() => document.querySelector('.stat-grid')?.innerText || '');
  console.log('  weather:', weatherText.replace(/\s+/g, ' ').slice(0, 200));

  step('convert IFC to BEM');
  await clickTitle('BEM Conversion');
  await clickText('Build the energy model');
  await waitText('Energy model built', 60000);
  await new Promise(r => setTimeout(r, 800));
  await shot('04-bem');
  const bemText = await page.evaluate(() => document.querySelector('.stat-grid')?.innerText || '');
  console.log('  bem:', bemText.replace(/\s+/g, ' ').slice(0, 200));

  step('run EnergyPlus in the browser');
  await clickTitle('Energy Simulation');
  await waitText('Weather file (EPW)');
  if (!(await page.evaluate(() => /automatic/.test(document.querySelector('.epw-upload')?.innerText || '')))) throw new Error('Simulation tab does not show the automatic weather file');
  await page.waitForFunction(() => [...document.querySelectorAll('.scenario button')].some(b => b.textContent.includes('Run') && !b.disabled), { timeout: 20000 });
  const t0 = Date.now();
  await page.evaluate(() => [...document.querySelectorAll('.scenario button')].find(b => b.textContent.includes('Run')).click());
  await page.waitForFunction(() => /Baseline simulated|could not run|failed/.test(document.body.innerText), { timeout: 600000, polling: 1000 });
  const status = await page.evaluate(() => document.querySelector('.engine-status')?.innerText || '');
  console.log(`  engine: ${status.replace(/\s+/g, ' ')} (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
  if (!/finished/.test(status)) throw new Error(`Simulation did not finish: ${status}`);
  await shot('05-sim');

  step('results, IEQ, environment and display modes');
  await clickTitle('Results');
  await waitText('Heating demand');
  const res = await page.evaluate(() => document.querySelector('.stat-grid')?.innerText || '');
  console.log('  results:', res.replace(/\s+/g, ' ').slice(0, 260));
  await shot('06-results');
  for (const mode of ['heating', 'temperature', 'pmv', 'co2', 'solar', 'bem']) {
    await page.select('.display-select select', mode);
    await new Promise(r => setTimeout(r, 600));
    const legend = await page.evaluate(() => document.querySelector('.viewer-legend')?.innerText || document.querySelector('.status-chip')?.innerText || '');
    console.log(`  display ${mode}: ${legend.replace(/\s+/g, ' ').slice(0, 90)}`);
    if (mode === 'heating' || mode === 'pmv') await shot(`07-display-${mode}`);
  }
  await clickTitle('IEQ Analysis');
  await waitText('Thermal comfort (occupied hours)');
  await shot('08-ieq');
  await clickTitle('Environment');
  await waitText('Wind rose');
  await shot('09-env');
  await clickTitle('Reports');
  await waitText('Exports');
  await shot('10-reports');
  for (const tab of ['Energy', 'Hourly loads', 'Temperature', 'Comfort', 'CO₂', 'Climate', 'Validation']) {
    await page.evaluate((t) => [...document.querySelectorAll('.bp-tab')].find(b => b.textContent.trim().startsWith(t))?.click(), tab);
    await new Promise(r => setTimeout(r, 400));
  }
  await shot('11-dock-validation');

  step('printable report contains only completed sections');
  await clickTitle('Reports');
  const popup = new Promise(res => browser.once('targetcreated', t => res(t)));
  await clickText('Print / save as PDF');
  const reportPage = await (await popup).page();
  await reportPage.waitForFunction(() => document.body && document.body.innerText.includes('Building performance report'), { timeout: 15000 });
  const sections = await reportPage.evaluate(() => [...document.querySelectorAll('h2')].map(h => h.textContent));
  console.log(`  report sections: ${sections.join(' | ')}`);
  if (!sections.some(s => /Energy performance/.test(s)) || sections.some(s => /Scenario comparison/.test(s))) throw new Error('Report sections do not match the completed analyses');
  await reportPage.close();

  step('upload an EPW in the Energy Simulation tab');
  await clickTitle('Energy Simulation');
  const input = await page.waitForSelector('.epw-upload input[type=file]');
  await input.uploadFile(path.join(ROOT, 'tests/fixtures/USA_IL_Chicago-OHare.Intl.AP.725300_TMY3.epw'));
  await page.waitForFunction(() => /Uploaded EPW/.test(document.querySelector('.epw-upload .kv-block')?.innerText || ''), { timeout: 20000 });
  console.log('  upload:', (await page.evaluate(() => document.querySelector('.epw-upload .kv-block')?.innerText || '')).replace(/\s+/g, ' ').slice(0, 160));
  await shot('11b-sim-upload');

  step('automatic weather falls back to NASA POWER when Open-Meteo is unreachable');
  const fb = await page.evaluate(async () => {
    const real = window.fetch;
    window.fetch = (url, opts) => (/open-meteo\.com/.test(String(url)) ? Promise.reject(new TypeError('blocked for test')) : real(url, opts));
    try {
      const w = await window.autoWeather({ latitude: 37.5663, longitude: 126.9779, elevation: 38, timeZoneName: 'Asia/Seoul' });
      return { name: w.meta.name, ok: w.validation.ok, attempts: w.meta.autoAttempts.map(a => `${a.label}: ${a.ok ? 'ok' : a.error}`) };
    } catch (e) { return { error: e.message, attempts: (e.attempts || []).map(a => `${a.label}: ${a.error}`) }; } finally { window.fetch = real; }
  });
  console.log('  fallback:', JSON.stringify(fb).slice(0, 400));
  if (fb.error || !/NASA POWER/.test(fb.name) || !fb.ok) throw new Error('Automatic weather did not fall back to NASA POWER');

  step('2D plan coloured by zone results, dark theme');
  await page.select('.display-select select', 'heating');
  await page.evaluate(() => [...document.querySelectorAll('.layout-seg button')].find(b => b.textContent.includes('3D + 2D')).click());
  await new Promise(r => setTimeout(r, 1200));
  await page.click('button[aria-label="Use dark theme"]');
  await new Promise(r => setTimeout(r, 800));
  await shot('12-plan-dark');
  await page.click('button[aria-label="Use light theme"]');
  await page.evaluate(() => [...document.querySelectorAll('.layout-seg button')].find(b => b.textContent.trim() === '3D').click());

  step('Revit sample: conversion and checks in the UI');
  await page.click('button[aria-label="More"]');
  await clickText('Open sample: Office blocks');
  await waitText('Opened LargeBuilding.ifc', 90000);
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Build the energy model')); return true; }, { timeout: 5000 });
  await clickTitle('BEM Conversion');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => x.textContent.includes('Build the energy model') && !x.disabled), { timeout: 60000 });
  await clickText('Build the energy model');
  await waitText('Energy model built', 60000);
  await clickText('Envelope', '.subtabs button');
  await waitText('IFC materials without thermal data');
  await clickText('Checks', '.subtabs button');
  await waitText('Accepted assumptions');
  await shot('13-revit-checks');

  step('space boundaries: IfcRelSpaceBoundary2ndLevel as zone surfaces, then reconstruction');
  await page.click('button[aria-label="More"]');
  await clickText('Open sample: BEM demo office with space boundaries');
  await waitText('Opened BEMDemoOffice-SB.ifc', 90000);
  await clickTitle('BEM Conversion');
  await clickText('Convert', '.subtabs button');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => x.textContent.includes('Build the energy model') && !x.disabled), { timeout: 60000 });
  await clickText('Build the energy model');
  await waitText('Energy model built', 60000);
  await new Promise(r => setTimeout(r, 500));
  const sbStats = await page.evaluate(() => document.querySelector('.stat-grid')?.innerText.replace(/\s+/g, ' ') || '');
  console.log('  ifc boundaries:', sbStats.slice(0, 260));
  if (!/Surface source 8 \/ 8/.test(sbStats) || !/12 pairs from CorrespondingBoundary/.test(sbStats) || !/467\.3/.test(sbStats)) throw new Error('Zone surfaces were not taken from the IFC space boundaries');
  await shot('14-sb-convert');
  await clickText('Checks', '.subtabs button');
  await waitText("use the file's IfcRelSpaceBoundary2ndLevel geometry");
  await clickText('Convert', '.subtabs button');
  await page.evaluate(() => [...document.querySelectorAll('[data-testid=boundary-source] label')].find(l => l.textContent.includes('Reconstruct from IfcSpace bodies')).querySelector('input').click());
  await clickText('Rebuild the energy model');
  await page.waitForFunction(() => /Surface source Reconstructed/.test(document.querySelector('.stat-grid')?.innerText.replace(/\s+/g, ' ') || ''), { timeout: 60000 });
  const recStats = await page.evaluate(() => document.querySelector('.stat-grid')?.innerText.replace(/\s+/g, ' ') || '');
  console.log('  reconstructed:', recStats.slice(0, 260));
  if (!/467\.3/.test(recStats) || !/12 interzone pairs/.test(recStats)) throw new Error('Reconstructed model differs from the IFC-boundary model');
} catch (err) {
  failed = true;
  console.error('FAILED:', err.message);
  await shot('zz-failure');
}
await browser.close();
server.close();
if (failedUrls.length) { console.log('HTTP errors:'); failedUrls.forEach(u => console.log('  ', u)); }
const relevant = errors.filter(e => !/favicon|flagcounter|tile\.openstreetmap/i.test(e));
if (relevant.length) { console.log('Browser errors:'); relevant.slice(0, 20).forEach(e => console.log('  ', e)); }
console.log(failed || relevant.length ? 'E2E: FAIL' : 'E2E: PASS');
process.exit(failed || relevant.length ? 1 : 0);
