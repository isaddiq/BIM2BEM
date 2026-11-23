/** BEM conversion and configuration panels. */

const ORIGIN_LABEL = {
  'ifc-layers': ['IFC layers', 'ok'],
  'ifc-uvalue': ['IFC U-value', 'ok'],
  'library-mapped': ['IFC + library', 'info'],
  reference: ['Reference', 'warn'],
  user: ['User edited', 'info'],
  ifc: ['IFC', 'ok'],
  partial: ['IFC + assumed', 'info'],
};
function OriginPill({ origin }) {
  const [label, tone] = ORIGIN_LABEL[origin] || [origin, 'muted'];
  return <span className={`pill pill-${tone}`}>{label}</span>;
}
const BC_LABEL = { Outdoors: 'Outdoors', Ground: 'Ground', Surface: 'Interzone', Adiabatic: 'Adiabatic' };

const BEM_TABS = [
  { id: 'convert', label: 'Convert', icon: 'Zap' },
  { id: 'zones', label: 'Zones', icon: 'Zones' },
  { id: 'envelope', label: 'Envelope', icon: 'Material' },
  { id: 'loads', label: 'Loads', icon: 'Activity' },
  { id: 'hvac', label: 'HVAC', icon: 'Flame' },
  { id: 'checks', label: 'Checks', icon: 'Alert' },
];

function BemPanel(props) {
  const { tm } = props;
  const [tab, setTab] = useState('convert');
  return (
    <div className="flow">
      <div className="subtabs" role="tablist">
        {BEM_TABS.map(t => { const I = Icons[t.icon]; return <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} disabled={t.id !== 'convert' && !tm} onClick={() => setTab(t.id)}><I size={14} /> {t.label}</button>; })}
      </div>
      {tab === 'convert' && <ConvertTab {...props} />}
      {tab === 'zones' && tm && <ZonesTab {...props} />}
      {tab === 'envelope' && tm && <EnvelopeTab {...props} />}
      {tab === 'loads' && tm && <LoadsTab {...props} />}
      {tab === 'hvac' && tm && <HvacTab {...props} />}
      {tab === 'checks' && tm && <ChecksTab {...props} />}
    </div>
  );
}

function ConvertTab({ model, tm, bemOptions, setBemOptions, onConvert, converting }) {
  const steps = [
    ['IFC upload', !!model], ['Semantic extraction', !!(model && model.secondaryReady)], ['Thermal geometry', !!tm], ['Thermal zoning', !!(tm && tm.zones.length)],
    ['Material assignment', !!(tm && tm.constructions.size)], ['Analytical model', !!(tm && tm.surfaces.length)], ['Validation', !!tm && !tm.issues.some(i => i.severity === 'critical')],
  ];
  const nSpaces = model ? (model.byClass.get('IfcSpace') || []).length : 0;
  return (
    <>
      <ol className="pipeline">{steps.map(([l, done], i) => <li key={l} data-done={done}><span className="mono">{i + 1}</span>{l}</li>)}</ol>
      <SectionTitle icon={Icons.Zones} title="Thermal zoning" info="IfcSpace bodies become zones. Where a file has no usable spaces, you can ask for one zone per storey built from the slab outlines; interior partitions are then not modelled." />
      <div className="radio-list">
        <label><input type="radio" checked={bemOptions.zoning === 'spaces'} onChange={() => setBemOptions(o => ({ ...o, zoning: 'spaces' }))} /> One zone per IfcSpace <span className="muted">({nSpaces} in the file)</span></label>
        <label><input type="radio" checked={bemOptions.zoning === 'storeys'} onChange={() => setBemOptions(o => ({ ...o, zoning: 'storeys' }))} /> Manual: one zone per storey from slab outlines</label>
      </div>
      <SectionTitle icon={Icons.Ruler} title="Boundary reconstruction" info="Faces of neighbouring zones that face each other within these distances become paired interzone surfaces; everything else is classified by casting rays outward through the IFC elements." />
      <div className="form-grid two">
        <Field label="Thickest wall (m)"><NumInput value={bemOptions.maxWallGap} min={0.05} max={2} onChange={v => v && setBemOptions(o => ({ ...o, maxWallGap: v }))} /></Field>
        <Field label="Thickest floor (m)"><NumInput value={bemOptions.maxSlabGap} min={0.05} max={3} onChange={v => v && setBemOptions(o => ({ ...o, maxSlabGap: v }))} /></Field>
        <Field label="Next to parts without a zone">
          <select className="input" value={bemOptions.unmodelled} onChange={e => setBemOptions(o => ({ ...o, unmodelled: e.target.value }))}>
            <option value="adiabatic">Adiabatic (no heat flow)</option>
            <option value="outdoors">Outdoors</option>
          </select>
        </Field>
      </div>
      <button type="button" className="btn btn-primary" disabled={!model || converting || !model.secondaryReady} onClick={onConvert}>{converting ? <span className="spinner" /> : <Icons.Zap size={15} />} {tm ? 'Rebuild the energy model' : 'Build the energy model'}</button>
      {model && !model.secondaryReady && <p className="pane-note small">Waiting for property indexing to finish…</p>}
      {tm && (
        <div className="stat-grid">
          <StatTile label="Zones" value={tm.stats.zones} />
          <StatTile label="Floor area" value={fmt(tm.stats.floorArea, 1)} unit="m²" />
          <StatTile label="Volume" value={fmt(tm.stats.volume, 0)} unit="m³" />
          <StatTile label="Surfaces" value={tm.stats.surfaces} sub={`${tm.stats.exterior} outdoor · ${tm.stats.ground} ground · ${tm.stats.interzonePairs} interzone pairs · ${tm.stats.adiabatic} adiabatic`} />
          <StatTile label="Windows" value={tm.stats.windows} sub={`${fmt(tm.stats.windowArea, 1)} m² · WWR ${tm.stats.exteriorWallArea ? fmt(100 * tm.stats.windowArea / (tm.stats.exteriorWallArea), 1) : '—'}%`} />
          <StatTile label="Built in" value={fmt(tm.stats.buildMs, 0)} unit="ms" />
        </div>
      )}
    </>
  );
}

function ZonesTab({ tm, model, config, setConfig, onSelectIds, bemOptions, setBemOptions }) {
  const storeyName = (id) => { const s = model.byId.get(id); return s ? elementLabel(s) : '—'; };
  const surfs = (z) => z.surfaceIds.map(id => tm.surfById.get(id));
  return (
    <>
      <p className="pane-note small">Click a zone to select its IfcSpace. Unconditioned zones keep their geometry but get no loads or HVAC.</p>
      <div className="table-scroll">
        <table className="dtbl compact">
          <thead><tr><th>Zone</th><th>Storey</th><th>Area m²</th><th>Vol. m³</th><th>h m</th><th>Ext.</th><th>Int.</th><th>Cond.</th></tr></thead>
          <tbody>
            {tm.zones.map(z => {
              const ss = surfs(z);
              const cond = !(config.zoneOverrides[z.key] && config.zoneOverrides[z.key].conditioned === false);
              return (
                <tr key={z.key} onClick={() => z.spaceIds.length && onSelectIds(z.spaceIds)}>
                  <td>{z.name}{z.closure > 0.02 && <span className="pill pill-warn">open</span>}</td>
                  <td>{z.storeyId ? storeyName(z.storeyId) : '—'}</td>
                  <td className="mono">{fmt(z.floorArea, 1)}</td>
                  <td className="mono">{fmt(z.volume, 0)}</td>
                  <td className="mono">{fmt(z.ceilingHeight, 2)}</td>
                  <td className="mono">{ss.filter(s => s.bc === 'Outdoors' || s.bc === 'Ground').length}</td>
                  <td className="mono">{ss.filter(s => s.bc === 'Surface').length}</td>
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`${z.name} conditioned`} checked={cond} onChange={() => setConfig(c => ({ ...c, zoneOverrides: { ...c.zoneOverrides, [z.key]: { ...(c.zoneOverrides[z.key] || {}), conditioned: !cond } } }))} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {bemOptions.excludedSpaces.length > 0 && <p className="pane-note small">{bemOptions.excludedSpaces.length} space(s) excluded. <button type="button" className="link-btn" onClick={() => setBemOptions(o => ({ ...o, excludedSpaces: [] }))}>Include all</button> and rebuild.</p>}
    </>
  );
}

function LayerEditor({ layers, onChange }) {
  const upd = (i, k, v) => onChange(layers.map((l, j) => (j === i ? { ...l, [k]: v, source: 'Edited by the user' } : l)));
  return (
    <table className="dtbl compact layer-table">
      <thead><tr><th>Layer (outside first)</th><th>t mm</th><th>λ W/mK</th><th>ρ kg/m³</th><th>c J/kgK</th></tr></thead>
      <tbody>
        {layers.map((l, i) => (
          <tr key={i} title={l.source}>
            <td>{l.name}{l.resistance != null && <div className="muted small">R = {fmt(l.resistance, 3)} m²K/W, no mass</div>}</td>
            {l.resistance != null ? <td colSpan={4} className="muted small">{l.source}</td> : <>
              <td><NumInput value={+(l.thickness * 1000).toFixed(1)} min={0.1} onChange={v => v > 0 && upd(i, 'thickness', v / 1000)} /></td>
              <td><NumInput value={l.conductivity} min={0.001} onChange={v => v > 0 && upd(i, 'conductivity', v)} /></td>
              <td><NumInput value={l.density} min={1} onChange={v => v > 0 && upd(i, 'density', v)} /></td>
              <td><NumInput value={l.specificHeat} min={100} onChange={v => v > 0 && upd(i, 'specificHeat', v)} /></td>
            </>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EnvelopeTab({ tm, config, setConfig, bemOptions, setBemOptions, onConvert }) {
  const [open, setOpen] = useState(null);
  const cons = [...tm.constructions.values()].filter(c => !c.reversedOf);
  const [map, setMap] = useState(() => ({ ...bemOptions.materialMap }));
  const unresolved = [...tm.unresolvedMaterials.entries()];
  return (
    <>
      {unresolved.length > 0 && (
        <>
          <SectionTitle icon={Icons.Material} title="IFC materials without thermal data" info="These materials have layer thicknesses in the IFC but no conductivity, density or specific heat. Assign a library material to use the IFC layers; a name match is only a suggestion." />
          <table className="dtbl compact">
            <thead><tr><th>IFC material</th><th>Library material</th></tr></thead>
            <tbody>
              {unresolved.map(([name, u]) => (
                <tr key={name}>
                  <td>{name}{u.suggestion && !map[name] && <div className="muted small">Suggested: {libraryMaterial(u.suggestion.id).name} (name contains “{u.suggestion.matched}”)</div>}</td>
                  <td>
                    <select className="input" value={map[name] || ''} onChange={e => setMap(m => ({ ...m, [name]: e.target.value || undefined }))}>
                      <option value="">Not assigned (reference construction)</option>
                      {LIBRARY_MATERIALS.map(m => <option key={m.id} value={m.id}>{m.name} — λ {m.conductivity}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => { setBemOptions(o => ({ ...o, materialMap: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) })); setTimeout(onConvert, 0); }}><Icons.Refresh size={14} /> Apply and rebuild</button>
        </>
      )}
      <SectionTitle icon={Icons.Layers} title="Constructions" info="U-values are steady-state, ISO 6946 surface resistances (EnergyPlus computes surface heat transfer dynamically). Ground floors exclude the ground's own resistance." />
      {cons.map(c => {
        const layers = (config.constructionOverrides[c.key] && config.constructionOverrides[c.key].layers) || c.layers;
        const u = uValueOf(layers, c.rcat);
        const edited = !!config.constructionOverrides[c.key];
        return (
          <div key={c.key} className="cons-card">
            <button type="button" className="cons-head" aria-expanded={open === c.key} onClick={() => setOpen(o => (o === c.key ? null : c.key))}>
              <span className="cons-name">{c.name}</span>
              <OriginPill origin={edited ? 'user' : c.origin} />
              <span className="mono">U {fmt(u, 3)}</span>
              <span className="muted small">{c.surfaceIds.length} surf.</span>
            </button>
            {open === c.key && (
              <div className="cons-body">
                <p className="small muted">{c.note}</p>
                <LayerEditor layers={layers} onChange={(ls) => setConfig(cf => ({ ...cf, constructionOverrides: { ...cf.constructionOverrides, [c.key]: { layers: ls } } }))} />
                <div className="small muted">Heat capacity {fmt(heatCapacityOf(layers), 0)} kJ/m²K · {SURFACE_RESISTANCE_SOURCE}</div>
                {edited && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfig(cf => { const o = { ...cf.constructionOverrides }; delete o[c.key]; return { ...cf, constructionOverrides: o }; })}><Icons.Reset size={14} /> Restore</button>}
              </div>
            )}
          </div>
        );
      })}
      <SectionTitle icon={Icons.Sun} title="Glazing" info="EnergyPlus simple glazing model (WindowMaterial:SimpleGlazingSystem): whole-window U-factor, solar heat gain coefficient g and visible transmittance τv." />
      {[...tm.windowTypes.values()].map(g => {
        const o = config.glazingOverrides[g.key] || {};
        const v = { ...g, ...o };
        const upd = (k, val) => setConfig(cf => ({ ...cf, glazingOverrides: { ...cf.glazingOverrides, [g.key]: { ...(cf.glazingOverrides[g.key] || {}), [k]: val } } }));
        return (
          <div key={g.key} className="cons-card">
            <div className="cons-head static"><span className="cons-name">{g.name}</span><OriginPill origin={Object.keys(o).length ? 'user' : g.origin} /><span className="muted small">{g.subsurfaceIds.length} windows</span></div>
            <div className="form-grid three">
              <Field label="U (W/m²K)" hint={o.uFactor != null ? 'Edited' : g.provenance.uFactor}><NumInput value={v.uFactor} min={0.1} max={7} onChange={x => x > 0 && upd('uFactor', x)} /></Field>
              <Field label="g (SHGC)" hint={o.shgc != null ? 'Edited' : g.provenance.shgc}><NumInput value={v.shgc} min={0.01} max={0.99} onChange={x => x > 0 && x < 1 && upd('shgc', x)} /></Field>
              <Field label="τv" hint={o.vt != null ? 'Edited' : g.provenance.vt}><NumInput value={v.vt} min={0.01} max={0.99} onChange={x => x > 0 && x < 1 && upd('vt', x)} /></Field>
            </div>
          </div>
        );
      })}
      <details className="subtle-details">
        <summary>Material library ({LIBRARY_MATERIALS.length})</summary>
        <table className="dtbl compact">
          <thead><tr><th>Material</th><th>λ</th><th>ρ</th><th>c</th><th>Source</th></tr></thead>
          <tbody>{LIBRARY_MATERIALS.map(m => <tr key={m.id}><td>{m.name}</td><td className="mono">{m.conductivity}</td><td className="mono">{m.density}</td><td className="mono">{m.specificHeat}</td><td className="small">{m.kind === 'design' ? 'ISO 10456' : 'Assumed'}</td></tr>)}</tbody>
        </table>
      </details>
    </>
  );
}

function ProvField({ label, value, onChange, source, unit, step, min, max }) {
  return <Field label={`${label}${unit ? ` (${unit})` : ''}`} hint={source}><NumInput value={value} step={step} min={min} max={max} onChange={onChange} /></Field>;
}

function LoadsTab({ config, setConfig }) {
  const L = config.loads;
  const setLoad = (k, v, scale = 1) => v != null && setConfig(c => ({ ...c, loads: { ...c.loads, [k]: v * scale }, loadSources: { ...c.loadSources, [k]: 'Entered by the user' } }));
  const src = config.loadSources;
  return (
    <>
      <Field label="Building usage (reference values)">
        <select className="input" value={config.usage} onChange={e => { const p = USAGE_PROFILES[e.target.value]; setConfig(c => ({ ...c, usage: e.target.value, loads: pickLoads(p), loadSources: { ...p.sources, infiltrationAch: c.loadSources.infiltrationAch } })); }}>
          {Object.entries(USAGE_PROFILES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
        </select>
      </Field>
      <div className="form-grid two">
        <ProvField label="Occupancy" unit="people/100 m²" value={+(L.occupancyDensity * 100).toFixed(3)} onChange={v => setLoad('occupancyDensity', v, 0.01)} source={src.occupancyDensity} />
        <ProvField label="Activity" unit="met" value={L.activityMet} step={0.1} onChange={v => setLoad('activityMet', v)} source={src.activityMet} />
        <ProvField label="Lighting" unit="W/m²" value={L.lightingWm2} onChange={v => setLoad('lightingWm2', v)} source={src.lightingWm2} />
        <ProvField label="Equipment" unit="W/m²" value={L.equipmentWm2} onChange={v => setLoad('equipmentWm2', v)} source={src.equipmentWm2} />
        <ProvField label="Outdoor air per person" unit="L/s" value={+(L.oaPerPerson * 1000).toFixed(3)} onChange={v => setLoad('oaPerPerson', v, 0.001)} source={src.oaPerPerson} />
        <ProvField label="Outdoor air per area" unit="L/s·m²" value={+(L.oaPerArea * 1000).toFixed(3)} onChange={v => setLoad('oaPerArea', v, 0.001)} source={src.oaPerArea} />
        <ProvField label="Infiltration" unit="ach" value={config.infiltrationAch} step={0.05} onChange={v => v != null && setConfig(c => ({ ...c, infiltrationAch: v, loadSources: { ...c.loadSources, infiltrationAch: 'Entered by the user' } }))} source={src.infiltrationAch} />
      </div>
      <SectionTitle icon={Icons.Activity} title="Schedule and setpoints" />
      <div className="form-grid two">
        <ProvField label="Occupied from" unit="h" value={config.schedule.weekdayStart} min={0} max={23} step={0.5} onChange={v => v != null && setConfig(c => ({ ...c, schedule: { ...c.schedule, weekdayStart: v, source: 'Entered by the user' } }))} />
        <ProvField label="Occupied until" unit="h" value={config.schedule.weekdayEnd} min={1} max={24} step={0.5} onChange={v => v != null && setConfig(c => ({ ...c, schedule: { ...c.schedule, weekdayEnd: v, source: 'Entered by the user' } }))} />
        <ProvField label="Heating setpoint" unit="°C" value={config.setpoints.heating} onChange={v => v != null && setConfig(c => ({ ...c, setpoints: { ...c.setpoints, heating: v, source: 'Entered by the user' } }))} />
        <ProvField label="Cooling setpoint" unit="°C" value={config.setpoints.cooling} onChange={v => v != null && setConfig(c => ({ ...c, setpoints: { ...c.setpoints, cooling: v, source: 'Entered by the user' } }))} />
        <ProvField label="Heating setback" unit="°C" value={config.setpoints.heatingSetback} onChange={v => v != null && setConfig(c => ({ ...c, setpoints: { ...c.setpoints, heatingSetback: v } }))} />
        <ProvField label="Cooling setback" unit="°C" value={config.setpoints.coolingSetback} onChange={v => v != null && setConfig(c => ({ ...c, setpoints: { ...c.setpoints, coolingSetback: v } }))} />
      </div>
      <label className="check-field"><input type="checkbox" checked={config.schedule.saturday} onChange={e => setConfig(c => ({ ...c, schedule: { ...c.schedule, saturday: e.target.checked } }))} /> Also occupied on Saturday mornings</label>
      <p className="pane-note small">{config.schedule.source}. {config.setpoints.source}.</p>
      {config.setpoints.cooling <= config.setpoints.heating && <p className="pane-note danger small"><Icons.Alert size={13} /> The cooling setpoint must be above the heating setpoint.</p>}
    </>
  );
}

function HvacTab({ config, setConfig }) {
  const h = config.hvac;
  const setH = (patch) => setConfig(c => ({ ...c, hvac: { ...c.hvac, ...patch } }));
  const setF = (patch) => setConfig(c => ({ ...c, hvac: { ...c.hvac, fuel: { ...c.hvac.fuel, ...patch } } }));
  const nv = config.natvent;
  return (
    <>
      <p className="pane-note small">Each conditioned zone has an EnergyPlus <span className="mono">ZoneHVAC:IdealLoadsAirSystem</span>: it supplies exactly the heating and cooling needed to hold the setpoints, plus the outdoor air. Its results are <b>thermal demand</b>, not fuel or electricity.</p>
      <label className="check-field"><input type="checkbox" checked={h.cooling !== false} onChange={e => setH({ cooling: e.target.checked })} /> Mechanical cooling available</label>
      <div className="form-grid two">
        <Field label="Heat recovery">
          <select className="input" value={h.heatRecovery} onChange={e => setH({ heatRecovery: e.target.value })}><option>None</option><option>Sensible</option><option>Enthalpy</option></select>
        </Field>
        {h.heatRecovery !== 'None' && <ProvField label="Sensible effectiveness" value={h.sensibleEffectiveness} step={0.05} min={0} max={1} onChange={v => v != null && setH({ sensibleEffectiveness: v })} />}
        <Field label="Economizer">
          <select className="input" value={h.economizer} onChange={e => setH({ economizer: e.target.value })}><option>NoEconomizer</option><option>DifferentialDryBulb</option><option>DifferentialEnthalpy</option></select>
        </Field>
      </div>
      <SectionTitle icon={Icons.Zap} title="HVAC energy (simplified)" info="EnergyPlus divides the ideal loads by a constant efficiency (heating) or COP (cooling) per fuel. This is a first estimate of delivered energy, not a detailed system model: part-load behaviour, fans, pumps and distribution losses are not modelled." />
      <label className="check-field"><input type="checkbox" checked={h.fuel.enabled} onChange={e => setF({ enabled: e.target.checked })} /> Report heating and cooling energy with constant efficiencies</label>
      {h.fuel.enabled && (
        <div className="form-grid two">
          <Field label="Heating fuel"><select className="input" value={h.fuel.heatingFuel} onChange={e => setF({ heatingFuel: e.target.value })}>{['NaturalGas', 'Electricity', 'DistrictHeatingWater', 'FuelOilNo2', 'Propane'].map(x => <option key={x}>{x}</option>)}</select></Field>
          <ProvField label={h.fuel.heatingFuel === 'Electricity' ? 'Heating COP' : 'Heating efficiency'} value={h.fuel.heatingEfficiency} step={0.05} min={0.1} max={8} onChange={v => v > 0 && setF({ heatingEfficiency: v })} source="Entered by the user" />
          <Field label="Cooling fuel"><select className="input" value={h.fuel.coolingFuel} onChange={e => setF({ coolingFuel: e.target.value })}>{['Electricity', 'DistrictCooling'].map(x => <option key={x}>{x}</option>)}</select></Field>
          <ProvField label="Cooling COP" value={h.fuel.coolingCop} step={0.1} min={0.5} max={10} onChange={v => v > 0 && setF({ coolingCop: v })} source="Entered by the user" />
        </div>
      )}
      <SectionTitle icon={Icons.Wind} title="Natural ventilation" info="EnergyPlus ZoneVentilation:WindandStackOpenArea: airflow through an opening area driven by wind speed and indoor-outdoor temperature difference, during occupied hours inside the temperature limits. A single-zone model; not AirflowNetwork and not CFD." />
      <label className="check-field"><input type="checkbox" checked={nv.enabled} onChange={e => setConfig(c => ({ ...c, natvent: { ...c.natvent, enabled: e.target.checked } }))} /> Open windows when conditions allow</label>
      {nv.enabled && (
        <div className="form-grid two">
          <ProvField label="Openable share of window area" value={nv.openingFraction} step={0.05} min={0.01} max={1} onChange={v => v && setConfig(c => ({ ...c, natvent: { ...c.natvent, openingFraction: v } }))} />
          <ProvField label="Open above indoor" unit="°C" value={nv.minIndoor} onChange={v => v != null && setConfig(c => ({ ...c, natvent: { ...c.natvent, minIndoor: v } }))} />
          <ProvField label="Outdoor between (min)" unit="°C" value={nv.minOutdoor} onChange={v => v != null && setConfig(c => ({ ...c, natvent: { ...c.natvent, minOutdoor: v } }))} />
          <ProvField label="Outdoor between (max)" unit="°C" value={nv.maxOutdoor} onChange={v => v != null && setConfig(c => ({ ...c, natvent: { ...c.natvent, maxOutdoor: v } }))} />
        </div>
      )}
    </>
  );
}

const SEV_ORDER = ['critical', 'warning', 'assumption', 'verified'];
const SEV_LABEL = { critical: 'Critical errors', warning: 'Warnings', assumption: 'Accepted assumptions', verified: 'Verified' };

/** Every finding about the model, weather, location and configuration. */
function collectIssues({ tm, compose, weather, location, config }) {
  const out = [];
  if (tm) tm.issues.forEach(i => out.push({ ...i, area: 'Geometry and constructions' }));
  if (compose) compose.issues.forEach(i => out.push({ severity: i.severity === 'critical' ? 'critical' : 'warning', message: i.message, area: 'EnergyPlus schema' }));
  if (!location || !location.confirmed) out.push({ severity: 'critical', message: 'The building location has not been confirmed.', area: 'Location' });
  if (!weather) out.push({ severity: 'critical', message: 'No weather file is selected.', area: 'Weather' });
  else {
    weather.validation.errors.forEach(e => out.push({ severity: 'critical', message: e, area: 'Weather' }));
    weather.validation.warnings.forEach(e => out.push({ severity: 'warning', message: e, area: 'Weather' }));
    if (weather.meta.distanceKm > 50) out.push({ severity: 'warning', message: `The weather data is ${weather.meta.distanceKm.toFixed(0)} km from the building.`, area: 'Weather' });
    if (weather.validation.ok) out.push({ severity: 'verified', message: `Weather file structure, hour sequence and value ranges checked (${weather.epw.n} hours).`, area: 'Weather' });
  }
  if (config) {
    if (config.setpoints.cooling <= config.setpoints.heating) out.push({ severity: 'critical', message: 'Cooling setpoint is not above the heating setpoint.', area: 'HVAC' });
    out.push({ severity: 'assumption', message: `Internal loads: ${config.loadSources.lightingWm2}; ${config.loadSources.equipmentWm2}.`, area: 'Loads' });
    out.push({ severity: 'assumption', message: `Occupancy schedule: ${config.schedule.source}.`, area: 'Loads' });
    out.push({ severity: 'assumption', message: `Infiltration ${config.infiltrationAch} ach: ${config.loadSources.infiltrationAch}.`, area: 'Loads' });
    out.push({ severity: 'assumption', message: 'HVAC is an ideal loads air system per zone: thermal demand only, no equipment or distribution losses.', area: 'HVAC' });
    if (config.run.ground === 'kiva') out.push({ severity: 'assumption', message: 'Ground contact modelled with Foundation:Kiva as an uninsulated slab-on-grade foundation edge; soil properties are EnergyPlus defaults.', area: 'Ground' });
  }
  if (compose && !compose.issues.some(i => i.severity === 'critical')) out.push({ severity: 'verified', message: `IDF checked against the EnergyPlus ${EP_SCHEMA.version} schema (field names, types, ranges and choices): no errors.`, area: 'EnergyPlus schema' });
  return out;
}

function IssueList({ issues, onSelectIds }) {
  return SEV_ORDER.map(sev => {
    const list = issues.filter(i => i.severity === sev);
    if (!list.length) return null;
    return (
      <section key={sev} className="issue-group" data-severity={sev}>
        <h4>{SEV_LABEL[sev]} <span className="tab-count">{list.length}</span></h4>
        {list.map((i, k) => (
          <div key={k} className="check" data-severity={sev === 'critical' ? 'error' : sev === 'warning' ? 'warn' : sev === 'verified' ? 'pass' : 'info'}>
            <span className="check-badge">{sev === 'verified' ? <Icons.Check size={13} /> : sev === 'assumption' ? <Icons.Info size={13} /> : <Icons.Alert size={13} />}</span>
            <div className="check-main"><div>{i.message}</div><div className="sub">{i.area}</div></div>
            {i.ids && i.ids.length > 0 && onSelectIds && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelectIds(i.ids)}>Select {i.ids.length}</button>}
          </div>
        ))}
      </section>
    );
  });
}

function ChecksTab({ tm, compose, weather, location, config, onSelectIds }) {
  const issues = collectIssues({ tm, compose, weather, location, config });
  const origins = {};
  tm.surfaces.forEach(s => { const o = tm.constructions.get(s.constructionKey).origin; origins[o] = (origins[o] || 0) + s.area; });
  return (
    <>
      <IssueList issues={issues} onSelectIds={onSelectIds} />
      <SectionTitle icon={Icons.Relationship} title="Where the envelope data comes from" />
      <table className="dtbl compact">
        <thead><tr><th>Origin</th><th>Surface area m²</th></tr></thead>
        <tbody>{Object.entries(origins).map(([o, a]) => <tr key={o}><td><OriginPill origin={o} /></td><td className="mono">{fmt(a, 1)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

/** Inspector section: what the selected IFC element (or analytical surface) became in the energy model. */
function BemInspectorSection({ el, tm, results, surfaceId, onSelectSurface, open, onToggle }) {
  if (!tm) return null;
  const m = el ? tm.mapping.get(el.expressId) : null;
  const surfIds = surfaceId ? [surfaceId] : (m ? m.surfaces : []);
  const subIds = m ? m.subsurfaces : [];
  const zoneKeys = m ? m.zones : [];
  if (!surfIds.length && !subIds.length && !zoneKeys.length) {
    return <Section title="Energy model" open={open} onToggle={onToggle} accent><p className="pane-note">This element does not bound any thermal zone in the energy model.</p></Section>;
  }
  return (
    <Section title="Energy model" open={open} onToggle={onToggle} accent>
      {zoneKeys.map(k => {
        const z = tm.zoneByKey.get(k);
        const r = results && results.zones.get(k);
        return (
          <div key={k} className="kv-group">
            <KV k="Thermal zone"><b>{z.name}</b></KV>
            <KV k="Floor area"><span className="mono">{fmt(z.floorArea, 2)} m²</span></KV>
            <KV k="Volume"><span className="mono">{fmt(z.volume, 1)} m³</span></KV>
            <KV k="Height"><span className="mono">{fmt(z.ceilingHeight, 2)} m</span></KV>
            <KV k="Surfaces">{z.surfaceIds.length} ({z.surfaceIds.filter(id => tm.surfById.get(id).bc === 'Outdoors').length} outdoor)</KV>
            {r && r.annual.heatKWhm2 != null && <KV k="Heating demand"><span className="mono">{fmt(r.annual.heatKWhm2, 1)} kWh/m²·a</span></KV>}
            {r && r.annual.coolKWhm2 != null && <KV k="Cooling demand"><span className="mono">{fmt(r.annual.coolKWhm2, 1)} kWh/m²·a</span></KV>}
            {r && r.peaks.heatWm2 != null && <KV k="Peak heating"><span className="mono">{fmt(r.peaks.heatWm2, 1)} W/m²</span></KV>}
            {r && r.annual.tairMean != null && <KV k="Mean air temperature"><span className="mono">{fmt(r.annual.tairMean, 1)} °C</span></KV>}
            {r && r.annual.co2Max != null && <KV k="Peak CO₂"><span className="mono">{fmt(r.annual.co2Max, 0)} ppm</span></KV>}
            {r && r.annual.oaAchOccupied != null && <KV k="Outdoor air (occupied)"><span className="mono">{fmt(r.annual.oaAchOccupied, 2)} ach</span></KV>}
            <Provenance step="Zone">From {z.source} {z.globalIds.join(', ')}.</Provenance>
          </div>
        );
      })}
      {surfIds.map(id => {
        const s = tm.surfById.get(id);
        if (!s) return null;
        const c = tm.constructions.get(s.constructionKey);
        const sr = results && results.surfaces.get(id);
        return (
          <div key={id} className="kv-group">
            <KV k="Surface"><button type="button" className="link-btn" onClick={() => onSelectSurface && onSelectSurface(id)}>{s.name}</button></KV>
            <KV k="Type · boundary">{s.type} · {BC_LABEL[s.bc]}{s.partner ? ` (pairs with ${tm.surfById.get(s.partner).name})` : ''}</KV>
            <KV k="Area"><span className="mono">{fmt(s.area, 2)} m²</span></KV>
            <KV k="Tilt · azimuth"><span className="mono">{fmt(s.tilt, 0)}° · {fmt(s.azimuth, 0)}° ({compass(s.azimuth)})</span></KV>
            <KV k="Construction">{c.name} <OriginPill origin={c.origin} /></KV>
            <KV k="U-value"><span className="mono">{fmt(c.uValue, 3)} W/m²K</span></KV>
            {sr && sr.annualKWhm2 != null && <KV k="Incident solar"><span className="mono">{fmt(sr.annualKWhm2, 0)} kWh/m²·a</span></KV>}
            <Provenance step="Boundary">{s.provenance.boundary}.</Provenance>
          </div>
        );
      })}
      {subIds.map(id => {
        const w = tm.subsurfaces.find(x => x.id === id);
        const g = w.type === 'Window' ? tm.windowTypes.get(w.constructionKey) : tm.constructions.get(w.constructionKey);
        const wr = results && results.windows.get(id);
        return (
          <div key={id} className="kv-group">
            <KV k={w.type}>{w.name}</KV>
            <KV k="Area"><span className="mono">{fmt(w.area, 2)} m²</span></KV>
            <KV k="Host surface">{tm.surfById.get(w.hostId).name}</KV>
            {w.type === 'Window' ? <KV k="U · g · τv"><span className="mono">{fmt(g.uFactor, 2)} · {fmt(g.shgc, 2)} · {fmt(g.vt, 2)}</span></KV> : <KV k="U-value"><span className="mono">{fmt(g.uValue, 2)}</span></KV>}
            {wr && wr.annualKWh != null && <KV k="Transmitted solar"><span className="mono">{fmt(wr.annualKWh, 0)} kWh/a</span></KV>}
            <Provenance step="Opening">{w.provenance.geometry}.</Provenance>
          </div>
        );
      })}
    </Section>
  );
}

Object.assign(window, { BemPanel, BemInspectorSection, collectIssues, IssueList, OriginPill, BC_LABEL, SEV_LABEL });
