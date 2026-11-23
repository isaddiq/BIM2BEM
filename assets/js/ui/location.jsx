/**
 * Building location and weather data.
 *
 * Location: read IfcSite (to be confirmed), search an address with Nominatim
 * (OpenStreetMap; one request at a time, at most one per second, only when the user
 * submits), pick on a map, or type coordinates. The user's own position is never used.
 *
 * Weather: build an EPW for the confirmed location from Open-Meteo (ERA5) or NASA POWER,
 * load a nearby TMY3 file that EnergyPlus distributes, or upload an EPW/ZIP.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
let _lastNominatim = 0;

async function geocode(params) {
  const wait = 1100 - (Date.now() - _lastNominatim);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastNominatim = Date.now();
  const q = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '6', ...params });
  const res = await fetch(`${NOMINATIM}?${q}`, { headers: { 'Accept-Language': navigator.language || 'en' } });
  if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);
  return res.json();
}

/** Time zone (IANA) and terrain elevation for a point, from Open-Meteo (Copernicus DEM GLO-90). */
async function siteFacts(lat, lon) {
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto&forecast_days=1&hourly=temperature_2m`);
  if (!res.ok) throw new Error(`Open-Meteo returned HTTP ${res.status}`);
  const j = await res.json();
  return { timeZoneName: j.timezone, elevation: j.elevation };
}

let _leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { _leafletPromise = null; reject(new Error('Could not load the map library')); };
    document.head.appendChild(s);
  });
  return _leafletPromise;
}

function SiteMap({ lat, lon, onPick, station }) {
  const ref = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const st = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    loadLeaflet().then(L => {
      if (!live || !ref.current || map.current) return;
      const center = lat != null ? [lat, lon] : [20, 0];
      map.current = L.map(ref.current, { worldCopyJump: true }).setView(center, lat != null ? 15 : 2);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map.current);
      map.current.on('click', e => onPick(e.latlng.lat, ((e.latlng.lng + 540) % 360) - 180));
    }).catch(e => setErr(e.message));
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const L = window.L;
    if (!L || !map.current) return;
    if (lat == null) return;
    if (!marker.current) {
      marker.current = L.marker([lat, lon], { draggable: true, title: 'Building location' }).addTo(map.current);
      marker.current.on('dragend', () => { const p = marker.current.getLatLng(); onPick(p.lat, p.lng); });
    } else marker.current.setLatLng([lat, lon]);
    map.current.setView([lat, lon], Math.max(map.current.getZoom(), 14));
  }, [lat, lon, !!map.current]);
  useEffect(() => {
    const L = window.L;
    if (!L || !map.current) return;
    if (st.current) { st.current.remove(); st.current = null; }
    if (station) st.current = L.circleMarker([station.latitude, station.longitude], { radius: 7, color: '#eb6834' }).bindTooltip(`Weather data: ${station.label}`).addTo(map.current);
  }, [station && station.latitude, station && station.longitude, !!map.current]);
  return (
    <div className="site-map-wrap">
      <div ref={ref} className="site-map" aria-label="Map: click or drag the marker to set the building location" />
      {err && <p className="pane-note pad">{err}. Enter coordinates instead.</p>}
    </div>
  );
}

function Field({ label, children, hint }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
function NumInput({ value, onChange, step = 'any', min, max, disabled, ...rest }) {
  const [txt, setTxt] = useState(value == null ? '' : String(value));
  useEffect(() => { if (Number(txt) !== value) setTxt(value == null ? '' : String(value)); }, [value]);
  return <input type="number" className="input" step={step} min={min} max={max} disabled={disabled} value={txt} onChange={e => { setTxt(e.target.value); const v = e.target.value === '' ? null : Number(e.target.value); if (v === null || Number.isFinite(v)) onChange(v); }} {...rest} />;
}
function SourceTag({ children }) { return <span className="source-tag">{children}</span>; }

function LocationPanel({ model, location, setLocation, toast }) {
  const geo = model ? model.geoRef : null;
  const [addr, setAddr] = useState(() => ({ street: geo && geo.address ? geo.address.street || '' : '', city: geo && geo.address ? geo.address.town || '' : '', state: geo && geo.address ? geo.address.region || '' : '', postalcode: geo && geo.address ? geo.address.postalCode || '' : '', country: geo && geo.address ? geo.address.country || '' : '', q: '' }));
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch, source) => setLocation(l => ({ ...l, ...patch, confirmed: false, source: { ...l.source, ...(source ? Object.fromEntries(Object.keys(patch).map(k => [k, source])) : {}) } }));
  const hasIfc = geo && geo.latitude != null && geo.longitude != null;

  const search = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const params = addr.q.trim() ? { q: addr.q.trim() } : Object.fromEntries(Object.entries({ street: addr.street, city: addr.city, state: addr.state, postalcode: addr.postalcode, country: addr.country }).filter(([, v]) => v && v.trim()));
      if (!Object.keys(params).length) { toast({ kind: 'info', msg: 'Enter an address or a place to search' }); return; }
      const r = await geocode(params);
      setResults(r);
      if (!r.length) toast({ kind: 'warn', msg: 'No match found', sub: 'Try fewer fields, or click the map.' });
    } catch (err) {
      toast({ kind: 'error', msg: 'Address search failed', sub: err.message });
    } finally { setBusy(false); }
  };
  const pickResult = (r) => {
    set({ latitude: +(+r.lat).toFixed(6), longitude: +(+r.lon).toFixed(6), address: r.display_name }, 'Nominatim (OpenStreetMap) geocoding');
    setResults(null);
  };
  const confirm = async () => {
    if (location.latitude == null || location.longitude == null) return;
    setBusy(true);
    try {
      const f = await siteFacts(location.latitude, location.longitude);
      setLocation(l => ({
        ...l, confirmed: true, timeZoneName: f.timeZoneName,
        elevation: l.elevation != null ? l.elevation : f.elevation,
        source: { ...l.source, timeZoneName: 'Open-Meteo time-zone lookup', ...(l.elevation != null ? {} : { elevation: 'Open-Meteo terrain elevation (Copernicus DEM GLO-90)' }) },
      }));
      toast({ kind: 'ok', msg: 'Location confirmed', sub: `${f.timeZoneName}` });
    } catch (err) {
      setLocation(l => ({ ...l, confirmed: true, timeZoneName: l.timeZoneName || null }));
      toast({ kind: 'warn', msg: 'Confirmed without a time-zone lookup', sub: `${err.message}. Weather files built in the browser need the time zone; load an EPW instead.` });
    } finally { setBusy(false); }
  };

  return (
    <div className="flow">
      <SectionTitle icon={Icons.Building} title="From the IFC file" info="IfcSite.RefLatitude, RefLongitude and RefElevation, the model context's TrueNorth and any postal address. Authoring tools often write placeholder values (Revit's default is Boston), so confirm them." />
      {hasIfc ? (
        <div className="kv-block">
          <KV k="Latitude, longitude"><span className="mono">{geo.latitude.toFixed(5)}, {geo.longitude.toFixed(5)}</span></KV>
          <KV k="Elevation">{geo.elevation != null ? <span className="mono">{geo.elevation.toFixed(1)} m</span> : <Muted />}</KV>
          <KV k="Address">{geo.address ? Object.values(geo.address).filter(Boolean).join(', ') : <Muted />}</KV>
          <KV k="True north">{geo.northAngle != null ? <span className="mono">{geo.northAngle.toFixed(1)}° (project north east of true north)</span> : <Muted text="Not declared" />}</KV>
          <button type="button" className="btn btn-sm" onClick={() => set({ latitude: +geo.latitude.toFixed(6), longitude: +geo.longitude.toFixed(6), elevation: geo.elevation, northAngle: geo.northAngle != null ? +geo.northAngle.toFixed(2) : 0 }, 'IFC IfcSite / TrueNorth (user to verify)')}><Icons.Check size={14} /> Use these values</button>
          {Math.abs(geo.latitude - 42.3587) < 0.01 && Math.abs(geo.longitude + 71.0567) < 0.01 && <p className="pane-note warn"><Icons.Alert size={13} /> These are Revit's default coordinates (Boston). They are probably not the building's real location.</p>}
        </div>
      ) : <p className="pane-note">The IfcSite has no reference latitude/longitude{geo && geo.northAngle != null ? `; true north is ${geo.northAngle.toFixed(1)}°` : ''}. Search for the address or enter coordinates.</p>}

      <SectionTitle icon={Icons.Search} title="Find the address" info="Geocoding by Nominatim with OpenStreetMap data (© OpenStreetMap contributors, ODbL). Searches run only when you press Search, at most one per second." />
      <form className="form-grid" onSubmit={search}>
        <Field label="Search text"><input className="input" value={addr.q} placeholder="e.g. 110 Sejong-daero, Seoul" onChange={e => setAddr(a => ({ ...a, q: e.target.value }))} /></Field>
        <details className="subtle-details">
          <summary>Structured address</summary>
          <Field label="Street"><input className="input" value={addr.street} onChange={e => setAddr(a => ({ ...a, street: e.target.value }))} /></Field>
          <Field label="City"><input className="input" value={addr.city} onChange={e => setAddr(a => ({ ...a, city: e.target.value }))} /></Field>
          <Field label="State / province"><input className="input" value={addr.state} onChange={e => setAddr(a => ({ ...a, state: e.target.value }))} /></Field>
          <Field label="Postal code"><input className="input" value={addr.postalcode} onChange={e => setAddr(a => ({ ...a, postalcode: e.target.value }))} /></Field>
          <Field label="Country"><input className="input" value={addr.country} onChange={e => setAddr(a => ({ ...a, country: e.target.value }))} /></Field>
        </details>
        <button type="submit" className="btn btn-sm" disabled={busy}><Icons.Search size={14} /> Search</button>
      </form>
      {results && results.length > 0 && (
        <ul className="pick-list">
          {results.map(r => <li key={r.place_id}><button type="button" onClick={() => pickResult(r)}><span>{r.display_name}</span><span className="mono muted">{(+r.lat).toFixed(4)}, {(+r.lon).toFixed(4)}</span></button></li>)}
        </ul>
      )}

      <div className="confirm-row">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || location.latitude == null || location.longitude == null} onClick={confirm}><Icons.Check size={14} /> {location.confirmed ? 'Confirmed' : 'Confirm location'}</button>
        {location.confirmed
          ? <span className="pill pill-ok">Confirmed{location.timeZoneName ? ` · ${location.timeZoneName}` : ''}</span>
          : location.latitude != null && location.longitude != null && <span className="muted small mono">{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</span>}
      </div>

      <SectionTitle icon={Icons.MapPin} title="Coordinates and orientation" />
      <div className="form-grid two">
        <Field label="Latitude (°)"><NumInput value={location.latitude} min={-90} max={90} onChange={v => set({ latitude: v }, 'Entered by the user')} /></Field>
        <Field label="Longitude (°)"><NumInput value={location.longitude} min={-180} max={180} onChange={v => set({ longitude: v }, 'Entered by the user')} /></Field>
        <Field label="Site elevation (m)" hint={location.source.elevation}><NumInput value={location.elevation} onChange={v => set({ elevation: v }, 'Entered by the user')} /></Field>
        <Field label="North angle (°)" hint="Clockwise from true north to the model's +Y axis"><NumInput value={location.northAngle} min={-360} max={360} onChange={v => set({ northAngle: v }, 'Entered by the user')} /></Field>
        <Field label="Terrain (wind profile)">
          <select className="input" value={location.terrain} onChange={e => set({ terrain: e.target.value }, 'Chosen by the user')}>
            {['Country', 'Suburbs', 'City', 'Ocean', 'Urban'].map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <SiteMap lat={location.latitude} lon={location.longitude} onPick={(la, lo) => set({ latitude: +la.toFixed(6), longitude: +lo.toFixed(6) }, 'Picked on the map')} station={location.station} />
      <div className="provenance-list">
        {Object.entries(location.source).filter(([, v]) => v).map(([k, v]) => <div key={k}><span className="mono">{k}</span> <SourceTag>{v}</SourceTag></div>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weather selection helpers (shared by the panel and the automatic selection)

/** A bundled typical-year file is used automatically only when it is this close to the site. */
const AUTO_TMY_MAX_KM = 25;
const AUTO_TMY_MAX_DELEV_M = 100;

function nearestStations(lat, lon, n = 4) {
  if (lat == null || lon == null || !window.EP_STATIONS) return [];
  const seen = new Set();
  return window.EP_STATIONS.filter(s => { const k = s.wmo || s.name; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(s => ({ ...s, km: haversineKm(lat, lon, s.latitude, s.longitude) }))
    .sort((a, b) => a.km - b.km).slice(0, n);
}

function stationMeta(s) {
  return { provider: 'EnergyPlus weather data (NREL TMY3)', name: `${s.name} TMY3`, url: s.url, classification: 'Typical meteorological year (TMY3, NREL 2008; period of record about 1976–2005)', license: 'NREL TMY3 data distributed with EnergyPlus', resolution: `Station WMO ${s.wmo}` };
}

async function fetchStationEpw(s, signal) {
  const res = await fetch(s.url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Parse, validate and summarise an EPW text into the app's weather object. */
function weatherFromText(text, meta, location) {
  const epw = parseEpw(text);
  const validation = validateEpw(epw);
  const stats = epwStats(epw);
  const rose = windRose(epw);
  const km = location && location.latitude != null ? haversineKm(location.latitude, location.longitude, epw.header.latitude, epw.header.longitude) : null;
  return { text, epw, meta: { ...meta, latitude: epw.header.latitude, longitude: epw.header.longitude, elevation: epw.header.elevation, timeZone: epw.header.timeZone, distanceKm: km, comments: epw.comments }, validation, stats, rose, loadedAt: new Date().toISOString() };
}

/** The most recent calendar year whose reanalysis data should be complete (ERA5 lags real time by about 5 days). */
function latestCompleteYear(now = new Date()) {
  return new Date(now.getTime() - 14 * 86400000).getUTCFullYear() - 1;
}

/**
 * Choose and fetch weather data for a confirmed location without user interaction:
 *   1. a typical-year (TMY3) file distributed with EnergyPlus, if one is within
 *      AUTO_TMY_MAX_KM and AUTO_TMY_MAX_DELEV_M of the site;
 *   2. otherwise the most recent complete year from ERA5 (Open-Meteo), then the year before;
 *   3. otherwise NASA POWER for the same years.
 * The first candidate whose EPW passes validation is returned. Every attempt is recorded.
 */
async function autoWeather(location, { onStep = () => {}, signal } = {}) {
  const attempts = [];
  const requested = { latitude: location.latitude, longitude: location.longitude };
  const done = (w, reason) => ({ ...w, meta: { ...w.meta, auto: true, autoReason: reason, autoAttempts: attempts, requested } });
  const tryOne = async (label, fn) => {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onStep(label);
    try {
      const w = await fn();
      if (!w.validation.ok) { attempts.push({ label, ok: false, error: w.validation.errors[0] || 'failed validation' }); return null; }
      attempts.push({ label, ok: true });
      return w;
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      attempts.push({ label, ok: false, error: String(err.message || err).slice(0, 160) });
      return null;
    }
  };

  const st = nearestStations(location.latitude, location.longitude, 1)[0];
  const stationNear = st && st.km <= AUTO_TMY_MAX_KM && (location.elevation == null || Math.abs(st.elevation - location.elevation) <= AUTO_TMY_MAX_DELEV_M);
  if (stationNear) {
    const w = await tryOne(`Typical-year file ${st.name} (${st.km.toFixed(0)} km)`, async () => weatherFromText(await fetchStationEpw(st, signal), stationMeta(st), location));
    if (w) return done(w, `Typical-year file from ${st.name}, ${st.km.toFixed(1)} km from the site (bundled TMY3 files are used automatically within ${AUTO_TMY_MAX_KM} km and ${AUTO_TMY_MAX_DELEV_M} m elevation difference).`);
  }
  if (!location.timeZoneName) {
    throw new Error('The time zone of the location is unknown, so a weather file cannot be built. Confirm the location again while online, or upload an EPW.');
  }
  const y = latestCompleteYear();
  const why = stationNear ? 'The nearby typical-year file could not be loaded' : `No typical-year file reachable from the browser lies within ${AUTO_TMY_MAX_KM} km`;
  const sources = [['openmeteo', y], ['openmeteo', y - 1], ['nasa', y], ['nasa', y - 1]];
  for (const [provider, year] of sources) {
    const f = provider === 'openmeteo' ? epwFromOpenMeteo : epwFromNasaPower;
    const label = `${provider === 'openmeteo' ? 'ERA5 (Open-Meteo)' : 'NASA POWER'} ${year}`;
    const w = await tryOne(`Building an EPW from ${label}`, async () => {
      const r = await f({ latitude: location.latitude, longitude: location.longitude, year, timeZone: location.timeZoneName, signal });
      return weatherFromText(r.epw, { ...r.meta, name: `${r.meta.provider} ${year}` }, location);
    });
    if (w) return done(w, `${why}, so the most recent complete year available (${year}) was built from ${label.replace(/ \d+$/, '')}. This is an actual year, not a typical year.`);
  }
  const err = new Error('No weather source could be reached for this location.');
  err.attempts = attempts;
  throw err;
}

function AutoWeatherStatus({ auto, weather }) {
  if (!auto) return null;
  const s = auto.status;
  return (
    <div className="auto-weather">
      <label className="check-row small">
        <input type="checkbox" checked={auto.enabled} onChange={e => auto.setEnabled(e.target.checked)} />
        Get weather data automatically when the location is confirmed
      </label>
      {s && s.state === 'running' && (
        <div className="callout"><span className="spinner" /> <span>{s.step || 'Getting weather data for this location'}…</span> <button type="button" className="btn btn-ghost btn-sm" onClick={auto.cancel}>Cancel</button></div>
      )}
      {s && s.state === 'failed' && (
        <div className="pane-note warn small">
          <Icons.Alert size={13} /> {s.message}
          {s.attempts && s.attempts.length > 0 && <ul className="attempts">{s.attempts.map((a, i) => <li key={i}>{a.label}: {a.error}</li>)}</ul>}
          <button type="button" className="btn btn-sm" onClick={auto.retry}><Icons.Download size={14} /> Try again</button>
        </div>
      )}
      {s && s.state === 'kept' && (
        <div className="pane-note warn small"><Icons.Info size={13} /> {s.message} <button type="button" className="btn btn-sm" onClick={auto.retry}><Icons.Download size={14} /> Get weather for this location</button></div>
      )}
      {weather && weather.meta.auto && (!s || s.state === 'done') && (
        <p className="pane-note small"><Icons.Check size={13} /> Selected automatically. {weather.meta.autoReason} Any dataset below replaces it.</p>
      )}
    </div>
  );
}

/** Weather file in use, plus a manual EPW/ZIP upload (shown at the start of the Energy Simulation tab). */
function EpwUpload({ location, weather, setWeather, toast }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const fromFile = async (file) => {
    setBusy(true);
    try {
      let text, name = file.name;
      if (/\.zip$/i.test(file.name)) { const z = await epwFromZip(new Uint8Array(await file.arrayBuffer())); text = z.text; name = z.name; }
      else text = await file.text();
      const w = weatherFromText(text, { provider: 'Uploaded EPW', name, classification: 'As described in the file header', license: 'Per the file\'s source' }, location);
      setWeather(w);
      toast({ kind: w.validation.ok ? 'ok' : 'warn', msg: w.validation.ok ? 'Weather file uploaded' : 'Weather file uploaded with problems', sub: `${name} · ${w.epw.n} hours` });
    } catch (err) {
      console.error(err);
      toast({ kind: 'error', msg: 'Could not read the weather file', sub: String(err.message || err).slice(0, 160) });
    } finally { setBusy(false); }
  };
  const w = weather;
  return (
    <div className="dataset epw-upload">
      <div className="dataset-head"><b>Weather file (EPW)</b><span className="muted small">.epw or a .zip that contains one</span></div>
      {w ? (
        <div className="kv-block">
          <KV k="In use">{w.meta.name}{w.meta.auto && <span className="pill pill-muted">automatic</span>}{w.meta.provider === 'Uploaded EPW' && <span className="pill pill-muted">uploaded</span>}</KV>
          <KV k="Source">{w.meta.provider}</KV>
          {w.meta.distanceKm != null && <KV k="Distance to building"><span className="mono">{w.meta.distanceKm.toFixed(1)} km</span>{w.meta.distanceKm > 50 && <span className="pill pill-danger">far</span>}</KV>}
        </div>
      ) : (
        <p className="small muted">{location.confirmed ? 'No weather file yet.' : 'Confirm the building location to get weather data automatically.'} You can also upload your own EPW here.</p>
      )}
      {w && w.validation.errors.map((e, i) => <p key={i} className="pane-note danger small"><Icons.Alert size={13} /> {e}</p>)}
      <p className="small muted">Typical-year files for most of the world (TMYx) are published at <a href="https://climate.onebuilding.org/" target="_blank" rel="noopener noreferrer">climate.onebuilding.org</a>; that site cannot be read from a browser page, so download the station's zip there and upload it here. An uploaded file replaces the automatic choice.</p>
      <input ref={fileRef} type="file" accept=".epw,.zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) fromFile(f); }} />
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <span className="spinner" /> : <Icons.Upload size={14} />} Upload EPW or ZIP</button>
    </div>
  );
}

function WeatherPanel({ location, weather, setWeather, toast, auto }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(latestCompleteYear());
  const [busy, setBusy] = useState(null);
  const ok = location.confirmed && location.latitude != null;
  const stations = useMemo(() => (ok ? nearestStations(location.latitude, location.longitude, 4) : []), [ok, location.latitude, location.longitude]);

  const accept = (text, meta) => {
    const w = weatherFromText(text, meta, location);
    setWeather(w);
    toast({ kind: w.validation.ok ? 'ok' : 'warn', msg: w.validation.ok ? 'Weather data loaded' : 'Weather data loaded with problems', sub: `${meta.provider} · ${w.epw.n} hours` });
  };
  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (err) { console.error(err); toast({ kind: 'error', msg: 'Could not load weather data', sub: String(err.message || err).slice(0, 160) }); } finally { setBusy(null); }
  };
  const fromApi = (provider) => run(provider, async () => {
    if (!location.timeZoneName) throw new Error('The time zone of the location is unknown. Confirm the location again online.');
    const f = provider === 'openmeteo' ? epwFromOpenMeteo : epwFromNasaPower;
    const r = await f({ latitude: location.latitude, longitude: location.longitude, year, timeZone: location.timeZoneName });
    accept(r.epw, { ...r.meta, name: `${r.meta.provider} ${year}` });
  });
  const fromStation = (s) => run(s.file, async () => {
    accept(await fetchStationEpw(s), stationMeta(s));
  });

  if (!ok) return <EmptyState icon={Icons.Globe} title="Confirm the building location first">Weather datasets are chosen for the confirmed site.{auto && auto.enabled ? ' Once you confirm it, a weather file is fetched automatically; you can replace it with another dataset or an uploaded EPW.' : ' You can still upload an EPW file after confirming.'}</EmptyState>;
  const w = weather;
  return (
    <div className="flow">
      <SectionTitle icon={Icons.Globe} title="Weather for this location" info={`Automatic choice: a typical-year file distributed with EnergyPlus if one is within ${AUTO_TMY_MAX_KM} km, otherwise the most recent complete year from ERA5 (Open-Meteo), then NASA POWER. Built files are actual years (reanalysis), not typical years.`} />
      <AutoWeatherStatus auto={auto} weather={w} />
      <SectionTitle icon={Icons.Globe} title="Datasets for this location" info="All sources are public and reachable from the browser. Built files are actual years (reanalysis), not typical years; typical-year files are listed when one is nearby." />
      <div className="dataset">
        <div className="dataset-head"><b>Open-Meteo · ERA5 reanalysis</b><span className="muted small">0.25° grid (≈ 25–30 km) · hourly · CC BY 4.0</span></div>
        <p className="small muted">Builds an actual-year EPW for the nearest grid cell: temperature, dew point, humidity, pressure, wind, global, direct-normal and diffuse radiation, cloud cover. No illuminance or infrared fields (EnergyPlus derives what it needs).</p>
        <div className="dataset-actions">
          <label className="inline-field">Year <NumInput value={year} min={1950} max={thisYear - 1} step={1} onChange={v => v && setYear(v)} /></label>
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => fromApi('openmeteo')}>{busy === 'openmeteo' ? <span className="spinner" /> : <Icons.Download size={14} />} Build EPW</button>
        </div>
      </div>
      <div className="dataset">
        <div className="dataset-head"><b>NASA POWER</b><span className="muted small">MERRA-2 0.5° × 0.625°, CERES radiation 1° · hourly from 2001</span></div>
        <p className="small muted">Alternative actual-year source with measured-satellite radiation and longwave sky radiation; no cloud cover.</p>
        <div className="dataset-actions">
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => fromApi('nasa')}>{busy === 'nasa' ? <span className="spinner" /> : <Icons.Download size={14} />} Build EPW for {year}</button>
        </div>
      </div>
      {stations.length > 0 && (
        <div className="dataset">
          <div className="dataset-head"><b>Typical-year files distributed with EnergyPlus</b><span className="muted small">NREL TMY3 (United States only)</span></div>
          <table className="dtbl compact">
            <thead><tr><th>Station</th><th>Distance</th><th>Elev.</th><th /></tr></thead>
            <tbody>
              {stations.map(s => (
                <tr key={s.file}>
                  <td>{s.name}<div className="muted small mono">{s.latitude.toFixed(2)}, {s.longitude.toFixed(2)} · WMO {s.wmo}</div></td>
                  <td className="mono">{s.km.toFixed(0)} km</td>
                  <td className="mono">{s.elevation.toFixed(0)} m</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => fromStation(s)}>{busy === s.file ? <span className="spinner" /> : 'Load'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {stations[0].km > 100 && <p className="pane-note warn small"><Icons.Alert size={13} /> The nearest file is {stations[0].km.toFixed(0)} km away and does not represent this site.</p>}
        </div>
      )}
      <p className="pane-note small"><Icons.Upload size={13} /> To use your own EPW file, upload it at the top of the Energy Simulation tab.</p>

      {w && (
        <>
          <SectionTitle icon={Icons.Thermometer} title="Selected weather data" />
          <div className="kv-block">
            <KV k="Dataset">{w.meta.name}</KV>
            <KV k="Source">{w.meta.provider}</KV>
            <KV k="Type">{w.meta.classification}</KV>
            <KV k="Location in file"><span className="mono">{w.meta.latitude.toFixed(3)}, {w.meta.longitude.toFixed(3)} · {w.meta.elevation.toFixed(0)} m · UTC{w.meta.timeZone >= 0 ? '+' : ''}{w.meta.timeZone}</span></KV>
            <KV k="Distance to building">{w.meta.distanceKm != null ? <span className="mono">{w.meta.distanceKm.toFixed(1)} km</span> : <Muted />}{w.meta.distanceKm > 50 && <span className="pill pill-danger">far</span>}</KV>
            {location.elevation != null && <KV k="Elevation difference"><span className="mono">{(w.meta.elevation - location.elevation).toFixed(0)} m</span>{Math.abs(w.meta.elevation - location.elevation) > 100 && <span className="pill pill-warn">large</span>}</KV>}
            <KV k="Completeness"><span className="mono">{Math.round(Math.min(...Object.values(w.validation.completeness)) * 1000) / 10}%</span> <span className="muted small">worst core field</span></KV>
            {w.meta.license && <KV k="Licence">{w.meta.license}</KV>}
          </div>
          {w.validation.errors.map((e, i) => <p key={i} className="pane-note danger small"><Icons.Alert size={13} /> {e}</p>)}
          {w.validation.warnings.slice(0, 6).map((e, i) => <p key={i} className="pane-note warn small"><Icons.Info size={13} /> {e}</p>)}
          <div className="stat-grid">
            <StatTile label="Mean dry-bulb" value={fmt(w.stats.annualMeanDryBulb, 1)} unit="°C" />
            <StatTile label="HDD (18 °C)" value={fmt(w.stats.hdd18, 0)} unit="K·d" />
            <StatTile label="CDD (10 °C)" value={fmt(w.stats.cdd10, 0)} unit="K·d" />
            <StatTile label="99.6% heating" value={fmt(w.stats.heating996, 1)} unit="°C" sub="from this file's hours" />
            <StatTile label="0.4% cooling" value={fmt(w.stats.cooling004, 1)} unit="°C" sub="from this file's hours" />
            <StatTile label="Global horizontal" value={fmt(w.stats.annualGhiKWh, 0)} unit="kWh/m²·a" />
          </div>
          <p className="pane-note small">Thermal climate zone (ASHRAE 169-2013 Table A-3 thresholds on these degree-days): <b>{w.stats.climateZone != null ? w.stats.climateZone : '—'}</b>. The moisture regime (A/B/C) is not assessed. Design temperatures from a single year are indicative; ASHRAE values use multi-year records.</p>
        </>
      )}
    </div>
  );
}

Object.assign(window, { LocationPanel, WeatherPanel, EpwUpload, Field, NumInput, SourceTag, geocode, siteFacts, autoWeather, weatherFromText, nearestStations, latestCompleteYear, AUTO_TMY_MAX_KM });
