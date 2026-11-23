/** Simulation, results, IEQ, environmental analysis and chart dock. */

const SCENARIO_TEMPLATES = [
  { key: 'insulation', name: 'Improved insulation', mods: { insulation: { exteriorWall: 0.1, roof: 0.1, groundFloor: 0, material: 'mineral-wool' } } },
  { key: 'glazing', name: 'Glazing upgrade', mods: { glazing: { uFactor: 0.8, shgc: 0.3, vt: 0.55 } } },
  { key: 'ventilation', name: 'Heat recovery and airtightness', mods: { ventilation: { heatRecovery: 'Sensible', sensibleEffectiveness: 0.75, infiltrationAch: 0.15 } } },
  { key: 'natvent', name: 'Natural ventilation', mods: { ventilation: { natvent: true } } },
  { key: 'operation', name: 'Setpoints 21/24 °C', mods: { operation: { heating: 21, cooling: 24 } } },
];

const HOURS_CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334].map(d => d * 24);
function hourLabel(time, i, short) {
  if (!time || i == null || i < 0 || i >= time.n) return '';
  const m = time.month[i], d = time.day[i], h = time.hour[i];
  return short ? `${MONTH_NAMES[m - 1]} ${d}` : `${MONTH_NAMES[m - 1]} ${d}, ${String(h - 1).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:00`;
}

function ScenarioEditor({ sc, onChange }) {
  const m = sc.mods;
  const set = (group, k, v) => onChange({ ...sc, mods: { ...m, [group]: { ...(m[group] || {}), [k]: v } } });
  return (
    <div className="form-grid two">
      {m.insulation && <>
        <Field label="Extra wall insulation (mm)"><NumInput value={Math.round((m.insulation.exteriorWall || 0) * 1000)} min={0} onChange={v => set('insulation', 'exteriorWall', (v || 0) / 1000)} /></Field>
        <Field label="Extra roof insulation (mm)"><NumInput value={Math.round((m.insulation.roof || 0) * 1000)} min={0} onChange={v => set('insulation', 'roof', (v || 0) / 1000)} /></Field>
        <Field label="Extra ground-floor insulation (mm)"><NumInput value={Math.round((m.insulation.groundFloor || 0) * 1000)} min={0} onChange={v => set('insulation', 'groundFloor', (v || 0) / 1000)} /></Field>
        <Field label="Insulation material"><select className="input" value={m.insulation.material} onChange={e => set('insulation', 'material', e.target.value)}>{LIBRARY_MATERIALS.filter(x => x.conductivity < 0.06).map(x => <option key={x.id} value={x.id}>{x.name} (λ {x.conductivity})</option>)}</select></Field>
      </>}
      {m.glazing && <>
        <Field label="Window U (W/m²K)"><NumInput value={m.glazing.uFactor} min={0.1} onChange={v => set('glazing', 'uFactor', v)} /></Field>
        <Field label="g (SHGC)"><NumInput value={m.glazing.shgc} min={0.01} max={0.99} onChange={v => set('glazing', 'shgc', v)} /></Field>
        <Field label="τv"><NumInput value={m.glazing.vt} min={0.01} max={0.99} onChange={v => set('glazing', 'vt', v)} /></Field>
      </>}
      {m.ventilation && <>
        {'infiltrationAch' in m.ventilation && <Field label="Infiltration (ach)"><NumInput value={m.ventilation.infiltrationAch} min={0} onChange={v => set('ventilation', 'infiltrationAch', v)} /></Field>}
        {'heatRecovery' in m.ventilation && <Field label="Heat recovery"><select className="input" value={m.ventilation.heatRecovery} onChange={e => set('ventilation', 'heatRecovery', e.target.value)}><option>None</option><option>Sensible</option><option>Enthalpy</option></select></Field>}
        {'sensibleEffectiveness' in m.ventilation && <Field label="Effectiveness"><NumInput value={m.ventilation.sensibleEffectiveness} min={0} max={1} onChange={v => set('ventilation', 'sensibleEffectiveness', v)} /></Field>}
        {'natvent' in m.ventilation && <label className="check-field"><input type="checkbox" checked={!!m.ventilation.natvent} onChange={e => set('ventilation', 'natvent', e.target.checked)} /> Natural ventilation through windows</label>}
      </>}
      {m.operation && <>
        <Field label="Heating setpoint (°C)"><NumInput value={m.operation.heating} onChange={v => set('operation', 'heating', v)} /></Field>
        <Field label="Cooling setpoint (°C)"><NumInput value={m.operation.cooling} onChange={v => set('operation', 'cooling', v)} /></Field>
      </>}
    </div>
  );
}

function SimulationPanel({ tm, weather, setWeather, toast, location, config, setConfig, scenarios, setScenarios, runs, onRun, onRunAll, activeId, setActiveId, engineStatus, blocking, autoWeatherState }) {
  const r = config.run;
  const setRun = (patch) => setConfig(c => ({ ...c, run: { ...c.run, ...patch } }));
  const ready = tm && weather && location.confirmed && !blocking.length;
  const anyRunning = Object.values(runs).some(x => x.status === 'running');
  const fetchingWeather = autoWeatherState && autoWeatherState.state === 'running';
  return (
    <div className="flow">
      {!ready && (
        <div className="callout warn">
          <b>Not ready to simulate</b>
          <ul>{!tm && <li>Build the energy model (BEM Conversion).</li>}{!location.confirmed && <li>Confirm the building location (weather data is then fetched automatically).</li>}{location.confirmed && !weather && <li>{fetchingWeather ? 'Weather data is being fetched for the location…' : 'Upload a weather file below, or get one in the Location tab.'}</li>}{blocking.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      <EpwUpload location={location} weather={weather} setWeather={setWeather} toast={toast} />
      <SectionTitle icon={Icons.Play} title="Simulation settings" info={`EnergyPlus ${ENGINE_INFO.energyPlus}, compiled to WebAssembly (${ENGINE_INFO.loader}). The engine (~37 MB) is downloaded the first time you run, then reused.`} />
      <div className="form-grid two">
        <Field label="Start (month/day)"><div className="pair"><NumInput value={r.begin[0]} min={1} max={12} step={1} onChange={v => v && setRun({ begin: [v, r.begin[1]] })} /><NumInput value={r.begin[1]} min={1} max={31} step={1} onChange={v => v && setRun({ begin: [r.begin[0], v] })} /></div></Field>
        <Field label="End (month/day)"><div className="pair"><NumInput value={r.end[0]} min={1} max={12} step={1} onChange={v => v && setRun({ end: [v, r.end[1]] })} /><NumInput value={r.end[1]} min={1} max={31} step={1} onChange={v => v && setRun({ end: [r.end[0], v] })} /></div></Field>
        <Field label="Timesteps per hour"><select className="input" value={r.timesteps} onChange={e => setRun({ timesteps: Number(e.target.value) })}>{[1, 2, 4, 6, 10, 12].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
        <Field label="Ground heat transfer"><select className="input" value={r.ground} onChange={e => setRun({ ground: e.target.value })}><option value="kiva">Foundation:Kiva (2D)</option><option value="temps">Ground with monthly temperatures</option></select></Field>
        <Field label="Solar distribution"><select className="input" value={r.solarDistribution} onChange={e => setRun({ solarDistribution: e.target.value })}><option>FullExterior</option><option>FullInteriorAndExterior</option><option>MinimalShadowing</option></select></Field>
      </div>
      <label className="check-field"><input type="checkbox" checked={config.co2.enabled} onChange={e => setConfig(c => ({ ...c, co2: { ...c.co2, enabled: e.target.checked } }))} /> Zone CO₂ balance (outdoor {config.co2.outdoorPpm} ppm)</label>
      <label className="check-field"><input type="checkbox" checked={config.daylight.enabled} onChange={e => setConfig(c => ({ ...c, daylight: { ...c.daylight, enabled: e.target.checked } }))} /> Daylight illuminance at one reference point per zone</label>
      {config.daylight.enabled && <label className="check-field indent"><input type="checkbox" checked={config.daylight.dimming} onChange={e => setConfig(c => ({ ...c, daylight: { ...c.daylight, dimming: e.target.checked } }))} /> Dim the lights with daylight (changes lighting energy)</label>}

      <SectionTitle icon={Icons.Columns} title="Scenarios" info="Every scenario is a separate EnergyPlus run of the modified model. Differences are differences between simulations, never scaled results." />
      {scenarios.map(sc => {
        const run = runs[sc.id];
        const staleWeather = run && run.status === 'done' && weather && run.weatherAt && run.weatherAt !== weather.loadedAt;
        return (
          <div key={sc.id} className="scenario" data-active={activeId === sc.id}>
            <div className="scenario-head">
              <button type="button" className="link-btn" onClick={() => setActiveId(sc.id)}><b>{sc.name}</b></button>
              <span className={`pill pill-${!run ? 'muted' : run.status === 'done' ? 'ok' : run.status === 'failed' ? 'danger' : 'info'}`}>{!run ? 'Not run' : run.status === 'done' ? `Done · ${fmt(run.seconds, 0)} s` : run.status === 'failed' ? 'Failed' : 'Running'}</span>
              <button type="button" className="btn btn-sm" disabled={!ready || anyRunning} onClick={() => onRun(sc)}><Icons.Play size={13} /> Run</button>
              {sc.id !== 'base' && <IconButton icon={Icons.X} label="Remove scenario" size={13} className="sm" onClick={() => setScenarios(list => list.filter(x => x.id !== sc.id))} />}
            </div>
            {sc.id !== 'base' && <ScenarioEditor sc={sc} onChange={(n) => setScenarios(list => list.map(x => (x.id === sc.id ? n : x)))} />}
            {run && run.status === 'failed' && <p className="pane-note danger small">{run.error}</p>}
            {staleWeather && <p className="pane-note warn small"><Icons.Alert size={13} /> Out of date: these results used {run.weatherName}. Run again to use the current weather file.</p>}
          </div>
        );
      })}
      <div className="row-actions-inline">
        <select className="input" defaultValue="" onChange={e => { const t = SCENARIO_TEMPLATES.find(x => x.key === e.target.value); e.target.value = ''; if (t) setScenarios(list => [...list, { id: `${t.key}-${Date.now().toString(36)}`, name: t.name, mods: JSON.parse(JSON.stringify(t.mods)) }]); }}>
          <option value="">Add a scenario…</option>
          {SCENARIO_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
        </select>
        <button type="button" className="btn btn-primary btn-sm" disabled={!ready || anyRunning} onClick={onRunAll}><Icons.Play size={13} /> Run all</button>
      </div>
      {engineStatus && (
        <div className="engine-status" role="status">
          {engineStatus.busy && <span className="spinner" />}
          <div><div>{engineStatus.text}</div>{engineStatus.progress != null && <div className="load-bar"><div style={{ width: `${Math.max(2, engineStatus.progress * 100)}%` }} /></div>}</div>
        </div>
      )}
      <p className="pane-note small">Runs in a Web Worker in this browser tab; nothing is uploaded. Engine assets: {engineSource() || 'loaded on first run'}.</p>
    </div>
  );
}

function ResultsPanel({ tm, results, runs, scenarios, onSelectIds }) {
  if (!results) return <EmptyState icon={Icons.Chart} title="No results yet">Run a simulation to see energy results. Every value shown here is read from EnergyPlus output.</EmptyState>;
  const b = results.building;
  const done = scenarios.filter(s => runs[s.id] && runs[s.id].status === 'done');
  const base = runs.base && runs.base.results;
  return (
    <div className="flow">
      <SectionTitle icon={Icons.Flame} title="Thermal demand (ideal loads)" info="Heating and cooling delivered by the ideal loads systems, including outdoor-air conditioning. This is demand, not fuel or electricity." />
      <div className="stat-grid">
        <StatTile label="Heating demand" value={fmt(b.heatKWhm2, 1)} unit="kWh/m²·a" sub={`${fmt(b.heatKWh, 0)} kWh`} />
        <StatTile label="Cooling demand" value={fmt(b.coolKWhm2, 1)} unit="kWh/m²·a" sub={`${fmt(b.coolKWh, 0)} kWh`} />
        <StatTile label="Peak heating" value={fmt(b.peakHeatKW, 1)} unit="kW" sub={`hourly mean, ${hourLabel(results.time, b.peakHeatAt)}`} />
        <StatTile label="Peak cooling" value={fmt(b.peakCoolKW, 1)} unit="kW" sub={`hourly mean, ${hourLabel(results.time, b.peakCoolAt)}`} />
        <StatTile label="Lighting" value={fmt(b.lightsKWh / b.floorArea, 1)} unit="kWh/m²·a" />
        <StatTile label="Equipment" value={fmt(b.equipKWh / b.floorArea, 1)} unit="kWh/m²·a" />
      </div>
      {b.fuel ? (
        <div className="stat-grid">
          <StatTile label="Heating energy" value={fmt(b.fuel.heatingKWh / b.floorArea, 1)} unit="kWh/m²·a" sub="constant efficiency" />
          <StatTile label="Cooling energy" value={fmt(b.fuel.coolingKWh / b.floorArea, 1)} unit="kWh/m²·a" sub="constant COP" />
          <StatTile label="EUI (modelled end uses)" value={fmt(b.euiKWhm2, 1)} unit="kWh/m²·a" sub="heating, cooling, lighting, equipment; no fans or pumps" />
        </div>
      ) : <p className="pane-note small">Energy use intensity is not shown: HVAC efficiencies are not configured, and ideal-load demand is not energy use. Enable it under BEM Conversion → HVAC.</p>}
      <p className="pane-note small">Conditioned floor area {fmt(b.floorArea, 1)} m² · {results.meta.engine} · {results.meta.warnings} warnings, {results.meta.severe} severe · {results.meta.hours} hours.</p>

      {done.length > 1 && base && (
        <>
          <SectionTitle icon={Icons.Columns} title="Scenario comparison" />
          <div className="table-scroll">
            <table className="dtbl compact">
              <thead><tr><th>Scenario</th><th>Heating kWh/m²</th><th>Cooling kWh/m²</th><th>Peak H kW</th><th>Peak C kW</th></tr></thead>
              <tbody>
                {done.map(s => {
                  const rb = runs[s.id].results.building;
                  const d = (v, b0) => (s.id === 'base' ? '' : ` (${v - b0 >= 0 ? '+' : ''}${fmt(100 * (v - b0) / (b0 || 1), 0)}%)`);
                  return <tr key={s.id}><td>{s.name}</td><td className="mono">{fmt(rb.heatKWhm2, 1)}{d(rb.heatKWhm2, base.building.heatKWhm2)}</td><td className="mono">{fmt(rb.coolKWhm2, 1)}{d(rb.coolKWhm2, base.building.coolKWhm2)}</td><td className="mono">{fmt(rb.peakHeatKW, 1)}</td><td className="mono">{fmt(rb.peakCoolKW, 1)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <SectionTitle icon={Icons.Zones} title="Zones" />
      <div className="table-scroll">
        <table className="dtbl compact">
          <thead><tr><th>Zone</th><th>Heat kWh/m²</th><th>Cool kWh/m²</th><th>Peak H W/m²</th><th>Peak C W/m²</th><th>T̄ °C</th></tr></thead>
          <tbody>
            {tm.zones.map(z => {
              const r = results.zones.get(z.key);
              return <tr key={z.key} onClick={() => z.spaceIds.length && onSelectIds(z.spaceIds)}><td>{z.name}</td><td className="mono">{fmt(r.annual.heatKWhm2, 1)}</td><td className="mono">{fmt(r.annual.coolKWhm2, 1)}</td><td className="mono">{fmt(r.peaks.heatWm2, 0)}</td><td className="mono">{fmt(r.peaks.coolWm2, 0)}</td><td className="mono">{fmt(r.annual.tairMean, 1)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IeqPanel({ tm, results, ieq, config, setConfig, location, onSelectIds }) {
  const c = config.comfort;
  const setC = (patch) => setConfig(cf => ({ ...cf, comfort: { ...cf.comfort, ...patch, source: 'Entered by the user' } }));
  const months = c.winterMonths || defaultWinterMonths(location.latitude);
  return (
    <div className="flow">
      <SectionTitle icon={Icons.Thermometer} title="Thermal comfort inputs" info="PMV/PPD after ISO 7730:2005 Annex D from the simulated air temperature, mean radiant temperature and humidity, with these occupant parameters. They are not in the IFC; they are your assumptions." />
      <div className="form-grid two">
        <Field label="Relative air speed (m/s)"><NumInput value={c.airSpeed} min={0} max={1} step={0.05} onChange={v => v != null && setC({ airSpeed: v })} /></Field>
        <Field label="Metabolic rate (met)" hint={config.loadSources.activityMet}><NumInput value={config.loads.activityMet} min={0.8} max={4} step={0.1} disabled /></Field>
        <Field label="Clothing, winter (clo)"><NumInput value={c.clothingWinter} min={0} max={2} step={0.1} onChange={v => v != null && setC({ clothingWinter: v })} /></Field>
        <Field label="Clothing, summer (clo)"><NumInput value={c.clothingSummer} min={0} max={2} step={0.1} onChange={v => v != null && setC({ clothingSummer: v })} /></Field>
      </div>
      <div className="month-picks" role="group" aria-label="Months with winter clothing">
        {MONTH_NAMES.map((m, i) => <label key={m}><input type="checkbox" checked={months.includes(i + 1)} onChange={e => setC({ winterMonths: e.target.checked ? [...months, i + 1] : months.filter(x => x !== i + 1) })} />{m}</label>)}
      </div>
      <p className="pane-note small">Winter clothing in the ticked months ({c.winterMonths ? 'your choice' : `default for latitude ${location.latitude != null ? location.latitude.toFixed(1) : '—'}°`}); {c.source}.</p>
      {!results && <EmptyState icon={Icons.Thermometer} title="No simulation results">Run a simulation to evaluate indoor environmental quality.</EmptyState>}
      {results && ieq && (
        <>
          <SectionTitle icon={Icons.Thermometer} title="Thermal comfort (occupied hours)" info="ISO 7730 categories: A |PMV| < 0.2, B < 0.5, C < 0.7. Hours outside the standard's input ranges are counted separately." />
          <div className="table-scroll">
            <table className="dtbl compact">
              <thead><tr><th>Zone</th><th>Occ. h</th><th>A %</th><th>B %</th><th>C %</th><th>Out %</th><th>PPD̄ %</th><th>Top &gt; 26 h</th></tr></thead>
              <tbody>
                {tm.zones.map(z => {
                  const q = ieq.zones.get(z.key);
                  if (!q || !q.comfort.supported || !q.comfort.occupiedHours) return <tr key={z.key}><td>{z.name}</td><td colSpan={7} className="muted small">{q && q.comfort.reason ? q.comfort.reason : 'Not occupied'}</td></tr>;
                  const s = q.comfort.categoryShare;
                  return <tr key={z.key} onClick={() => z.spaceIds.length && onSelectIds(z.spaceIds)}><td>{z.name}</td><td className="mono">{q.comfort.occupiedHours}</td><td className="mono">{fmt(s.A * 100, 0)}</td><td className="mono">{fmt(s.B * 100, 0)}</td><td className="mono">{fmt(s.C * 100, 0)}</td><td className="mono">{fmt(s.out * 100, 0)}</td><td className="mono">{fmt(q.comfort.meanPpd, 1)}</td><td className="mono">{q.comfort.operative ? q.comfort.operative.hoursAbove26 : '—'}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          {ieq.adaptiveNote && <p className="pane-note small">{ieq.adaptiveNote}</p>}
          {ieq.anyAdaptive && (
            <div className="table-scroll">
              <table className="dtbl compact">
                <thead><tr><th>Zone</th><th>EN 16798 I %</th><th>II %</th><th>III %</th><th>Outside %</th><th>ASHRAE 55 80% %</th></tr></thead>
                <tbody>{tm.zones.map(z => { const a = ieq.zones.get(z.key)?.comfort.adaptive; if (!a || !a.supported) return null; return <tr key={z.key}><td>{z.name}</td><td className="mono">{fmt(a.en16798.I * 100, 0)}</td><td className="mono">{fmt(a.en16798.II * 100, 0)}</td><td className="mono">{fmt(a.en16798.III * 100, 0)}</td><td className="mono">{fmt(a.en16798.out * 100, 0)}</td><td className="mono">{fmt(a.ashrae55.within80 * 100, 0)}</td></tr>; })}</tbody>
              </table>
            </div>
          )}
          <SectionTitle icon={Icons.Co2} title="Indoor air quality" info="CO₂ from the EnergyPlus zone contaminant balance: occupant generation (EnergyPlus default 3.82×10⁻⁸ m³/s·W of activity), outdoor air and infiltration, with a constant outdoor concentration. Other pollutants (PM, VOC) are not modelled and are not estimated." />
          {config.co2.enabled ? (
            <div className="table-scroll">
              <table className="dtbl compact">
                <thead><tr><th>Zone</th><th>Mean ppm</th><th>Max ppm</th><th>&gt; 1000 ppm h</th><th>&gt; Cat II h</th><th>OA ach (occ.)</th></tr></thead>
                <tbody>{tm.zones.map(z => { const q = ieq.zones.get(z.key); const r = results.zones.get(z.key); if (!q || !q.co2.supported || !q.co2.occupiedHours) return null; return <tr key={z.key}><td>{z.name}</td><td className="mono">{fmt(q.co2.mean, 0)}</td><td className="mono">{fmt(q.co2.max, 0)}</td><td className="mono">{q.co2.hoursOver1000}</td><td className="mono">{q.co2.hoursOverCatII}</td><td className="mono">{fmt(r.annual.oaAchOccupied, 2)}</td></tr>; })}</tbody>
              </table>
              <p className="pane-note small">Category II: more than 800 ppm above outdoor (EN 16798-1:2019 Annex B default design value).</p>
            </div>
          ) : <p className="pane-note">CO₂ was not modelled in this run.</p>}
          <SectionTitle icon={Icons.Sun} title="Daylight at the reference point" info="EnergyPlus split-flux daylight illuminance at one point per zone (0.8 m above the floor at the floor's area centroid), occupied hours. Not a grid-based annual metric: spatial daylight autonomy and annual sunlight exposure (IES LM-83) need a Radiance-type calculation that is not available in the browser." />
          {config.daylight.enabled ? (
            <div className="table-scroll">
              <table className="dtbl compact">
                <thead><tr><th>Zone</th><th>≥ {config.daylight.setpointLux} lx %</th><th>UDI &lt;100 %</th><th>UDI 100–2000 %</th><th>&gt;2000 %</th><th>DGI &gt; 22 h</th></tr></thead>
                <tbody>{tm.zones.map(z => { const q = ieq.zones.get(z.key); if (!q || !q.daylight.supported) return null; const d = q.daylight; return <tr key={z.key}><td>{z.name}</td><td className="mono">{fmt(d.autonomy * 100, 0)}</td><td className="mono">{fmt(d.udi.fellShort * 100, 0)}</td><td className="mono">{fmt(d.udi.useful * 100, 0)}</td><td className="mono">{fmt(d.udi.exceeded * 100, 0)}</td><td className="mono">{d.glareHours != null ? d.glareHours : '—'}</td></tr>; })}</tbody>
              </table>
            </div>
          ) : <p className="pane-note">Daylight was not modelled in this run.</p>}
        </>
      )}
      <SectionTitle icon={Icons.Activity} title="Acoustic comfort" />
      <div className="callout"><span className="pill pill-muted">Planned</span> Reverberation time, sound insulation and background noise need acoustic material data (absorption coefficients, sound reduction indices) and an acoustic solver. Thermal properties are not a substitute, so nothing is calculated here yet.</div>
      <p className="pane-note small">BIM2BEM reports thermal comfort, indoor air quality and daylight separately. It does not combine them into one IEQ score: no weighting would be justified by these inputs.</p>
    </div>
  );
}

function EnvironmentPanel({ weather, results, location, tm }) {
  if (!weather) return <EmptyState icon={Icons.Wind} title="No weather data">Select weather data under Location to analyse the site's climate.</EmptyState>;
  const st = weather.stats;
  const h = weather.epw.header;
  return (
    <div className="flow">
      <ChartFrame title="Wind rose" subtitle={`${weather.meta.name} · all hours`} note="Frequencies from the weather file's hourly wind records (10 m). Wind statistics are not CFD: they say nothing about flow around this building." table={{ columns: ['Sector °', ...weather.rose.bins.map((b, i) => (i < weather.rose.bins.length - 1 ? `${b}–${weather.rose.bins[i + 1]}` : `≥${b}`)), 'Total %'], rows: weather.rose.freq.map((row, s) => [Math.round(s * 360 / weather.rose.sectors), ...row.map(f => fmt(f * 100, 2)), fmt(weather.rose.sectorTotals[s] * 100, 2)]) }}>
        <WindRose rose={weather.rose} />
      </ChartFrame>
      <ChartFrame title="Monthly mean wind speed" table={{ columns: ['Month', 'm/s'], rows: MONTH_NAMES.map((m, i) => [m, fmt(st.monthlyWind[i], 2)]) }}>
        <BarChart categories={MONTH_NAMES} series={[{ label: 'Wind speed', color: 'var(--series-1)', values: st.monthlyWind }]} unit="m/s" digits={1} height={180} />
      </ChartFrame>
      <ChartFrame title="Sun path" subtitle={`${h.latitude.toFixed(2)}°, ${h.longitude.toFixed(2)}°`} note="NOAA/Meeus solar position algorithm (about ±0.01°).">
        <SunPath lat={h.latitude} lon={h.longitude} tz={h.timeZone} />
      </ChartFrame>
      <ChartFrame title="Monthly global horizontal radiation" table={{ columns: ['Month', 'kWh/m²'], rows: MONTH_NAMES.map((m, i) => [m, fmt(st.monthlyGhiKWh[i], 1)]) }}>
        <BarChart categories={MONTH_NAMES} series={[{ label: 'Global horizontal', color: 'var(--series-2)', values: st.monthlyGhiKWh }]} unit="kWh/m²" height={180} />
      </ChartFrame>
      {results && tm && (() => {
        const orient = {};
        tm.surfaces.filter(s => s.bc === 'Outdoors').forEach(s => {
          const r = results.surfaces.get(s.id);
          if (!r || r.annualKWhm2 == null) return;
          const k = s.type === 'Roof' ? 'Roof' : compass(s.azimuth);
          if (!orient[k]) orient[k] = { a: 0, e: 0 };
          orient[k].a += s.area; orient[k].e += r.annualKWhm2 * s.area;
        });
        const rows = Object.entries(orient).map(([k, v]) => [k, fmt(v.a, 1), fmt(v.e / v.a, 0)]);
        const wins = [...results.windows.values()].reduce((t, w) => t + (w.annualKWh || 0), 0);
        return (
          <ChartFrame title="Incident solar radiation on exterior surfaces" subtitle="Area-weighted annual totals by orientation, from EnergyPlus (includes shading by the building itself)" table={{ columns: ['Orientation', 'Area m²', 'kWh/m²·a'], rows }}>
            <BarChart categories={rows.map(r => r[0])} series={[{ label: 'Incident solar', color: 'var(--series-2)', values: Object.values(orient).map(v => v.e / v.a) }]} unit="kWh/m²·a" height={180} />
            <p className="small muted">Solar transmitted through all windows: {fmt(wins, 0)} kWh/a.</p>
          </ChartFrame>
        );
      })()}
      <div className="callout"><span className="pill pill-muted">Not included</span> Wind pressure on surfaces and inter-zone airflow need EnergyPlus AirflowNetwork with wind pressure coefficients and crack/opening data, which this version does not configure. Detailed 3D wind flow needs a validated CFD solver and is a future module.</div>
    </div>
  );
}

/** Tabs for the bottom dock: charts linked to the active run. */
function chartDockTabs({ results, weather, tm, zoneKey, ieq, config }) {
  const tabs = [];
  if (!results) return tabs;
  const time = results.time;
  const b = results.building;
  const z = zoneKey && results.zones.get(zoneKey);
  const zone = zoneKey && tm.zoneByKey.get(zoneKey);
  const monthlyTicks = HOURS_CUM.filter(h => h < time.n);
  tabs.push({ id: 'energy', label: 'Energy', icon: Icons.Chart, render: () => (
    <div className="dock-charts">
      <ChartFrame title="Monthly thermal demand" subtitle="Ideal loads, whole building" legend={<LegendItems items={[{ label: 'Heating', color: 'var(--series-2)' }, { label: 'Cooling', color: 'var(--series-1)' }]} />} table={{ columns: ['Month', 'Heating kWh', 'Cooling kWh'], rows: MONTH_NAMES.map((m, i) => [m, fmt(b.monthlyHeatKWh[i], 0), fmt(b.monthlyCoolKWh[i], 0)]) }}>
        <BarChart categories={MONTH_NAMES} series={[{ label: 'Heating', color: 'var(--series-2)', values: b.monthlyHeatKWh }, { label: 'Cooling', color: 'var(--series-1)', values: b.monthlyCoolKWh }]} unit="kWh" />
      </ChartFrame>
      <ChartFrame title="Monthly electricity" subtitle="Lighting and equipment (zone outputs)" legend={<LegendItems items={[{ label: 'Lighting', color: 'var(--series-4)' }, { label: 'Equipment', color: 'var(--series-7)' }]} />} table={{ columns: ['Month', 'Lighting kWh', 'Equipment kWh'], rows: MONTH_NAMES.map((m, i) => [m, fmt(b.monthlyLightsKWh && b.monthlyLightsKWh[i], 0), fmt(b.monthlyEquipKWh && b.monthlyEquipKWh[i], 0)]) }}>
        <BarChart categories={MONTH_NAMES} series={[{ label: 'Lighting', color: 'var(--series-4)', values: b.monthlyLightsKWh || [] }, { label: 'Equipment', color: 'var(--series-7)', values: b.monthlyEquipKWh || [] }]} unit="kWh" />
      </ChartFrame>
    </div>
  ) });
  tabs.push({ id: 'profile', label: 'Hourly loads', icon: Icons.Activity, render: () => (
    <div className="dock-charts one">
      <ChartFrame title="Hourly heating and cooling demand" subtitle="Whole building, kWh per hour (= mean kW)" legend={<LegendItems items={[{ label: 'Heating', color: 'var(--series-2)' }, { label: 'Cooling', color: 'var(--series-1)' }]} />}>
        <LineChart series={[{ label: 'Heating', color: 'var(--series-2)', values: b.heatHourlyKWh }, { label: 'Cooling', color: 'var(--series-1)', values: b.coolHourlyKWh }]} unit="kW" xLabel={(i, s) => hourLabel(time, i, s)} xTicks={monthlyTicks} digits={2} />
      </ChartFrame>
    </div>
  ) });
  if (z && z.series.tair) tabs.push({ id: 'temp', label: 'Temperature', icon: Icons.Thermometer, render: () => (
    <div className="dock-charts one">
      <ChartFrame title={`Temperatures · ${zone.name}`} legend={<LegendItems items={[{ label: 'Operative', color: 'var(--series-2)' }, { label: 'Air', color: 'var(--series-1)' }, { label: 'Outdoor', color: 'var(--series-3)' }]} />} note={`Shaded band: setpoints ${config.setpoints.heating}–${config.setpoints.cooling} °C during occupied hours.`}>
        <LineChart series={[{ label: 'Operative', color: 'var(--series-2)', values: z.series.top }, { label: 'Air', color: 'var(--series-1)', values: z.series.tair }, ...(results.site.tout ? [{ label: 'Outdoor', color: 'var(--series-3)', values: results.site.tout }] : [])]} unit="°C" xLabel={(i, s) => hourLabel(time, i, s)} xTicks={monthlyTicks} bands={[{ from: config.setpoints.heating, to: config.setpoints.cooling }]} />
      </ChartFrame>
    </div>
  ) });
  const q = ieq && zoneKey && ieq.zones.get(zoneKey);
  if (q && q.comfort.supported) tabs.push({ id: 'pmv', label: 'Comfort', icon: Icons.Thermometer, render: () => (
    <div className="dock-charts one">
      <ChartFrame title={`PMV during occupied hours · ${zone.name}`} note="ISO 7730 PMV from simulated conditions and the IEQ occupant inputs; gaps are unoccupied hours. Band: category B (|PMV| < 0.5).">
        <LineChart series={[{ label: 'PMV', color: 'var(--series-7)', values: q.comfort.pmv }]} unit="PMV" xLabel={(i, s) => hourLabel(time, i, s)} xTicks={monthlyTicks} digits={2} bands={[{ from: -0.5, to: 0.5 }]} yMin={-2} yMax={2} />
      </ChartFrame>
    </div>
  ) });
  if (z && z.series.co2) tabs.push({ id: 'co2', label: 'CO₂', icon: Icons.Co2, render: () => (
    <div className="dock-charts one">
      <ChartFrame title={`Zone CO₂ · ${zone.name}`} note={`EnergyPlus zone contaminant balance; outdoor ${config.co2.outdoorPpm} ppm (assumed constant).`}>
        <LineChart series={[{ label: 'CO₂', color: 'var(--series-1)', values: z.series.co2 }]} unit="ppm" xLabel={(i, s) => hourLabel(time, i, s)} xTicks={monthlyTicks} digits={0} />
      </ChartFrame>
    </div>
  ) });
  if (weather) tabs.push({ id: 'climate', label: 'Climate', icon: Icons.Sun, render: () => (
    <div className="dock-charts">
      <ChartFrame title="Monthly mean dry-bulb temperature" subtitle={weather.meta.name} table={{ columns: ['Month', '°C'], rows: MONTH_NAMES.map((m, i) => [m, fmt(weather.stats.monthlyDryBulb[i], 1)]) }}>
        <BarChart categories={MONTH_NAMES} series={[{ label: 'Dry-bulb', color: 'var(--series-2)', values: weather.stats.monthlyDryBulb }]} unit="°C" digits={1} />
      </ChartFrame>
      <ChartFrame title="Wind rose"><WindRose rose={weather.rose} size={240} /></ChartFrame>
    </div>
  ) });
  return tabs;
}

/** IEQ indicators per zone for a run. */
function computeIeq(tm, results, config, location) {
  if (!tm || !results) return null;
  const winterMonths = config.comfort.winterMonths || defaultWinterMonths(location.latitude);
  const mechanicalCooling = config.hvac.cooling !== false;
  const zones = new Map();
  let anyAdaptive = false;
  tm.zones.forEach(z => {
    const r = results.zones.get(z.key);
    if (!r) return;
    const comfort = zoneComfort(r.series, results.time, { airSpeed: config.comfort.airSpeed, met: config.loads.activityMet, cloWinter: config.comfort.clothingWinter, cloSummer: config.comfort.clothingSummer, winterMonths, mechanicalCooling, siteTout: results.site.tout });
    if (comfort.adaptive && comfort.adaptive.supported) anyAdaptive = true;
    zones.set(z.key, { comfort, co2: zoneCo2(r.series, config.co2.outdoorPpm), daylight: zoneDaylight(r.series, config.daylight.setpointLux) });
  });
  return { zones, anyAdaptive, adaptiveNote: mechanicalCooling ? 'Adaptive comfort (EN 16798-1, ASHRAE 55) is not evaluated: it applies only to naturally conditioned spaces without mechanical cooling, and cooling is enabled in this model.' : null };
}

Object.assign(window, { SimulationPanel, ResultsPanel, IeqPanel, EnvironmentPanel, chartDockTabs, computeIeq, hourLabel, SCENARIO_TEMPLATES });
