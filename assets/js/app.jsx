/** BIM2BEM — application shell. */

const APP_NAME = 'BIM2BEM';
// Sample models. Bundled files ship with the site; remote ones are fetched from their
// public source only when a visitor opens them.
const SAMPLES = [
  {
    id: 'bem-demo-office',
    name: 'BEM demo office',
    file: 'BEMDemoOffice.ifc',
    url: 'assets/ifc/BEMDemoOffice.ifc',
    size: '70 KB',
    facts: '2 storeys, 8 rooms, layered constructions with thermal properties, glazing data, site and true north',
    credit: 'Reference model generated for BIM2BEM (IFC4), MIT licence',
    creditUrl: 'https://github.com/isaddiq/BIM2BEM/blob/main/scripts/make_sample_bem_office.py',
    bundled: true,
    downloadable: true,
  },
  {
    id: 'research-centre',
    name: 'Research centre',
    file: 'ResearchCentre.ifc',
    url: 'assets/ifc/ResearchCentre.ifc',
    size: '0.8 MB',
    facts: '4 storeys, 56 rooms, 51 windows; no thermal data (reference constructions apply)',
    credit: 'Sample model (IFC4), MIT licence',
    creditUrl: 'https://github.com/isaddiq/BIM2BEM/blob/main/LICENSE',
    bundled: true,
    downloadable: true,
  },
  {
    id: 'large-building',
    name: 'Office blocks',
    file: 'LargeBuilding.ifc',
    url: 'assets/ifc/LargeBuilding.ifc',
    size: '1.3 MB',
    facts: 'Revit export (IFC2x3), 8 rooms, declared window and door U-values',
    credit: 'BIM Whale samples by André Wisén, MIT licence',
    creditUrl: 'https://github.com/andrewisen/bim-whale-ifc-samples',
    bundled: true,
  },
];
const SOURCE_REPO_URL = 'https://github.com/isaddiq/BIM2BEM';
const AUTHOR_URL = 'https://isaddiq.github.io/';

const SLAB_CLASSES = ['IfcSlab', 'IfcSlabStandardCase', 'IfcSlabElementedCase', 'IfcCovering', 'IfcRoof'];
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------------------
// Viewer state reducer
// ---------------------------------------------------------------------------
function viewerStateReducer(state, action) {
  switch (action.type) {
    case 'select': {
      const ids = action.ids || [];
      if (action.multi) {
        const ns = new Set(state.selectedIds);
        ids.forEach(id => { ns.has(id) ? ns.delete(id) : ns.add(id); });
        return { ...state, selectedIds: ns };
      }
      return { ...state, selectedIds: new Set(ids) };
    }
    case 'clear-selection':
      return state.selectedIds.size ? { ...state, selectedIds: new Set() } : state;
    case 'toggle-hide': {
      const ns = new Set(state.hiddenIds);
      const allHidden = action.ids.length > 0 && action.ids.every(id => ns.has(id));
      action.ids.forEach(id => { allHidden ? ns.delete(id) : ns.add(id); });
      return { ...state, hiddenIds: ns };
    }
    case 'show-all':
      return { ...state, hiddenIds: new Set(), isolatedIds: new Set() };
    case 'isolate': {
      const ns = new Set(action.ids);
      if (!action.force && state.isolatedIds.size === ns.size && [...ns].every(i => state.isolatedIds.has(i))) {
        return { ...state, isolatedIds: new Set() };
      }
      return { ...state, isolatedIds: ns };
    }
    case 'set-color': {
      const m = new Map(state.colorOverrides);
      if (action.color) m.set(action.id, action.color); else m.delete(action.id);
      return { ...state, colorOverrides: m };
    }
    case 'set-opacity-many': {
      const m = new Map(state.opacityOverrides);
      (action.ids || []).forEach(id => { if (action.opacity != null) m.set(id, action.opacity); else m.delete(id); });
      return { ...state, opacityOverrides: m };
    }
    case 'set-query':
      return { ...state, queryResults: action.ids, queryMatchText: action.match || {} };
    case 'clear-query':
      return { ...state, queryResults: [], queryMatchText: {} };
    case 'save-view': {
      const view = {
        id: uid(),
        name: action.name || `View ${state.savedViews.length + 1}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        camera: action.camera,
        hiddenIds: [...state.hiddenIds],
        isolatedIds: [...state.isolatedIds],
      };
      return { ...state, savedViews: [...state.savedViews, view] };
    }
    case 'restore-view':
      return { ...state, hiddenIds: new Set(action.view.hiddenIds), isolatedIds: new Set(action.view.isolatedIds) };
    case 'delete-view':
      return { ...state, savedViews: state.savedViews.filter(v => v.id !== action.id) };
    case 'save-set':
      return { ...state, selectionSets: [...state.selectionSets, { id: uid(), name: action.name || `Set ${state.selectionSets.length + 1}`, ids: [...state.selectedIds] }] };
    case 'restore-set': {
      const s = state.selectionSets.find(x => x.id === action.id);
      return s ? { ...state, selectedIds: new Set(s.ids) } : state;
    }
    case 'delete-set':
      return { ...state, selectionSets: state.selectionSets.filter(s => s.id !== action.id) };
    case 'add-anno':
      return { ...state, annotations: [...state.annotations, action.anno] };
    case 'delete-anno':
      return { ...state, annotations: state.annotations.filter(a => a.id !== action.id) };
    case 'update-anno':
      return { ...state, annotations: state.annotations.map(a => (a.id === action.id ? { ...a, ...action.patch } : a)) };
    case 'add-measure':
      return { ...state, measurements: [...state.measurements, action.measure] };
    case 'delete-measure':
      return { ...state, measurements: state.measurements.filter(m => m.id !== action.id) };
    case 'clear-measures':
      return { ...state, measurements: [] };
    case 'reset':
      return initialViewerState();
    default:
      return state;
  }
}

function initialViewerState() {
  return {
    selectedIds: new Set(),
    hiddenIds: new Set(),
    isolatedIds: new Set(),
    colorOverrides: new Map(),
    opacityOverrides: new Map(),
    queryResults: [],
    queryMatchText: {},
    savedViews: [],
    selectionSets: [],
    annotations: [],
    measurements: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers (per-viewer conveniences only)
// ---------------------------------------------------------------------------
const STORAGE = { layout: 'bim2bem-layout-v1', theme: 'bim2bem-theme', layoutMode: 'bim2bem-view-layout', autoWeather: 'bim2bem-auto-weather' };
const DEFAULT_LAYOUT = { left: 344, right: 360, bottom: 260, bottomCollapsed: false };

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function initialLayout() {
  try {
    const p = JSON.parse(readStorage(STORAGE.layout) || 'null');
    if (!p) return DEFAULT_LAYOUT;
    return {
      left: clamp(Number(p.left) || DEFAULT_LAYOUT.left, 240, 520),
      right: clamp(Number(p.right) || DEFAULT_LAYOUT.right, 280, 620),
      bottom: clamp(Number(p.bottom) || DEFAULT_LAYOUT.bottom, 120, 480),
      bottomCollapsed: !!p.bottomCollapsed,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function initialTheme() {
  const saved = readStorage(STORAGE.theme);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function runQuery(model, q) {
  const query = q.trim();
  if (!query) return { ids: [], match: {} };
  const lower = query.toLowerCase();
  const ids = [];
  const matchText = {};
  const colon = query.indexOf(':');
  const key = colon > 0 && colon < query.length - 1 ? query.slice(0, colon).trim().toLowerCase() : null;
  const val = key ? query.slice(colon + 1).trim().toLowerCase() : null;
  const exprMatch = /^[#@](\d+)$/.exec(query);
  const findProp = (sets, suffix) => {
    for (const ps of sets) for (const p of ps.properties) {
      if (p.name.toLowerCase() === key && String(p.value).toLowerCase().includes(val)) return `${ps.name}.${p.name} = ${p.value}${suffix}`;
    }
    return null;
  };
  model.elements.forEach(el => {
    if (el.isType) return;
    let m = null;
    if (exprMatch) {
      if (String(el.expressId) === exprMatch[1]) m = `Express ID #${el.expressId}`;
    } else if (key) {
      m = findProp(el.propertySets, '') || findProp(el.quantitySets, '');
      const t = !m && el.typeExpressId ? model.byId.get(el.typeExpressId) : null;
      if (t) m = findProp(t.propertySets, ' (type)');
    } else if (el.ifcClass.toLowerCase().includes(lower)) m = `Class ${el.ifcClass}`;
    else if ((el.name || '').toLowerCase().includes(lower)) m = `Name ${el.name}`;
    else if ((el.longName || '').toLowerCase().includes(lower)) m = `Long name ${el.longName}`;
    else if ((el.globalId || '').toLowerCase().includes(lower)) m = `GlobalId ${el.globalId}`;
    else if ((el.objectType || '').toLowerCase().includes(lower)) m = `Object type ${el.objectType}`;
    else if ((el.tag || '').toLowerCase().includes(lower)) m = `Tag ${el.tag}`;
    else if (el.storey && (el.storey.name || '').toLowerCase().includes(lower)) m = `Storey ${el.storey.name}`;
    else if (el.materials.some(x => x.name.toLowerCase().includes(lower))) m = `Material ${el.materials.find(x => x.name.toLowerCase().includes(lower)).name}`;
    else if (el.classifications.some(c => (c.code + ' ' + c.name).toLowerCase().includes(lower))) m = 'Classification';
    if (m) { ids.push(el.expressId); matchText[el.expressId] = m; }
  });
  return { ids, match: matchText };
}

const SEARCH_EXAMPLES = [
  ['IfcDoor', 'every element of a class'],
  ['Bedroom', 'names, long names, tags'],
  ['#1234', 'an express ID'],
  ['IsExternal:true', 'a property value (inspected elements)'],
];

// ---------------------------------------------------------------------------
// Brand and workflow navigation
// ---------------------------------------------------------------------------
function BrandMark({ size = 30 }) {
  return <img className="brand-mark" src="assets/logos/bim2bem-icon.png" width={size} height={size} alt="" aria-hidden="true" />;
}

const WORKSPACES = [
  { id: 'bim', label: 'BIM Model', icon: 'Cube' },
  { id: 'location', label: 'Location', icon: 'MapPin' },
  { id: 'bem', label: 'BEM Conversion', icon: 'Zap' },
  { id: 'sim', label: 'Energy Simulation', icon: 'Play' },
  { id: 'ieq', label: 'IEQ Analysis', icon: 'Thermometer' },
  { id: 'env', label: 'Environment', icon: 'Wind' },
  { id: 'results', label: 'Results', icon: 'Chart' },
  { id: 'reports', label: 'Reports', icon: 'Report' },
];

function WorkspaceSwitch({ value, onChange, disabled, status }) {
  return (
    <nav className="ws-switch" aria-label="Workflow">
      {WORKSPACES.map(w => {
        const Icon = Icons[w.icon];
        return (
          <button key={w.id} type="button" className="ws-btn" aria-current={value === w.id ? 'page' : undefined} disabled={disabled && w.id !== 'bim'} title={w.label} onClick={() => onChange(w.id)}>
            <span className="ws-icon"><Icon size={15} /></span>
            <span className="ws-label">{w.label}</span>
            {status[w.id] && <span className="ws-dot" data-state={status[w.id]} aria-label={status[w.id]} />}
          </button>
        );
      })}
    </nav>
  );
}

function TopBar({ model, workspace, onWorkspace, onUpload, onLoadSample, onClose, onSearch, onOpenHelp, theme, onToggleTheme, searchRef, onHome, status }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [menu]);
  const submit = (value) => { setQ(value); onSearch(value); };
  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onHome} aria-label="BIM2BEM start page" title="Start page">
        <BrandMark />
        <span className="brand-name">BIM<span className="brand-two">2</span>BEM</span>
      </button>
      <WorkspaceSwitch value={workspace} onChange={onWorkspace} disabled={!model} status={status} />
      <div className="topbar-spacer" />
      {model && (
        <div className="file-chip" title={`${model.fileName} · ${formatSize(model.fileSize)}`}>
          <Icons.Building size={15} />
          <span className="file-name">{model.fileName}</span>
          <span className="file-meta mono">{model.schemaVersion}</span>
          <IconButton icon={Icons.X} label="Close model" size={13} className="sm" onClick={onClose} />
        </div>
      )}
      <div className="search" data-disabled={!model}>
        <Icons.Search size={15} />
        <input ref={searchRef} type="search" aria-label="Search the model" placeholder="Search the model…" value={q} disabled={!model}
          onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 150)} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSearch(q); if (e.key === 'Escape') { setQ(''); onSearch(''); e.currentTarget.blur(); } }} />
        {q ? <IconButton icon={Icons.X} label="Clear search" size={13} className="sm" onClick={() => submit('')} /> : <kbd>Ctrl K</kbd>}
        {focused && !q && model && (
          <div className="search-hints" role="listbox" aria-label="Search examples">
            {SEARCH_EXAMPLES.map(([ex, what]) => <button key={ex} type="button" role="option" onMouseDown={e => { e.preventDefault(); submit(ex); }}><code>{ex}</code><span>{what}</span></button>)}
          </div>
        )}
      </div>
      <button type="button" className="btn btn-primary" onClick={onUpload}><Icons.Upload size={15} /> Open IFC</button>
      <div className="topbar-tools">
        <IconButton icon={Icons.Activity} label="Visitor statistics" aria-controls="vc-popover" onClick={() => document.getElementById('vc-popover')?.classList.toggle('vc-open')} />
        <IconButton icon={theme === 'dark' ? Icons.Sun : Icons.Moon} label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={onToggleTheme} />
        <IconButton icon={Icons.Help} label="Shortcuts and help" shortcut="?" onClick={onOpenHelp} />
        <div className="menu-anchor" ref={menuRef}>
          <IconButton icon={Icons.More} label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(v => !v)} />
          {menu && (
            <div className="menu" role="menu">
              {SAMPLES.map(smp => <button key={smp.id} type="button" role="menuitem" onClick={() => { setMenu(false); onLoadSample(smp); }}><Icons.Cube size={15} /> Open sample: {smp.name}</button>)}
              <div className="menu-sep" />
              <a role="menuitem" href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer"><Icons.Github size={15} /> Source code <Icons.External size={12} className="trail" /></a>
              <a role="menuitem" href={AUTHOR_URL} target="_blank" rel="noopener noreferrer"><Icons.Globe size={15} /> Author <Icons.External size={12} className="trail" /></a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Navigation cube (viewer/viewcube.jsx) with quick camera actions.
// ---------------------------------------------------------------------------
function NavCubeHost({ viewerRef, ready, theme }) {
  const hostRef = useRef(null);
  const cubeRef = useRef(null);
  useEffect(() => {
    if (!ready || !viewerRef.current || !hostRef.current) return;
    cubeRef.current = new NavCube(hostRef.current, viewerRef.current, { theme });
    return () => { cubeRef.current && cubeRef.current.dispose(); cubeRef.current = null; };
  }, [ready]);
  useEffect(() => { cubeRef.current && cubeRef.current.setTheme(theme); }, [theme]);
  const v = viewerRef.current;
  return (
    <div className="navcube">
      <div className="navcube-host" ref={hostRef} />
      <div className="navcube-actions">
        <IconButton icon={Icons.Home} label="Fit model, isometric view" size={15} onClick={() => v?.frameAll({ resetView: true })} />
        <IconButton icon={Icons.PlanCut} label="Top view" size={15} onClick={() => v?.setCameraPreset('top')} />
        <IconButton icon={Icons.Plus} label="Zoom in" size={15} onClick={() => v?.zoomIn()} />
        <IconButton icon={Icons.Minus} label="Zoom out" size={15} onClick={() => v?.zoomOut()} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section box controls
// ---------------------------------------------------------------------------
function SectionBoxControls({ box, bounds, onChange, onReset, onClose }) {
  const size = { x: Math.max(bounds.xMax - bounds.xMin, 0.001), y: Math.max(bounds.yMax - bounds.yMin, 0.001), z: Math.max(bounds.zMax - bounds.zMin, 0.001) };
  const sides = [
    { k: 'left', label: 'Left', axis: 'x', edge: 'min', opp: 'right' },
    { k: 'right', label: 'Right', axis: 'x', edge: 'max', opp: 'left' },
    { k: 'bottom', label: 'Bottom', axis: 'y', edge: 'min', opp: 'top' },
    { k: 'top', label: 'Top', axis: 'y', edge: 'max', opp: 'bottom' },
    { k: 'back', label: 'Back', axis: 'z', edge: 'min', opp: 'front' },
    { k: 'front', label: 'Front', axis: 'z', edge: 'max', opp: 'back' },
  ];
  const cut = (s) => (s.edge === 'min' ? (box[`${s.axis}Min`] - bounds[`${s.axis}Min`]) : (bounds[`${s.axis}Max`] - box[`${s.axis}Max`])) / size[s.axis];
  const update = (s, raw) => {
    const opp = sides.find(o => o.k === s.opp);
    const c = clamp((parseFloat(raw) || 0) / 100, 0, Math.max(0, 0.96 - cut(opp)));
    const next = { ...box };
    if (s.edge === 'min') next[`${s.axis}Min`] = bounds[`${s.axis}Min`] + size[s.axis] * c;
    else next[`${s.axis}Max`] = bounds[`${s.axis}Max`] - size[s.axis] * c;
    onChange(next);
  };
  return (
    <div className="hud-card section-card">
      <div className="hud-card-head">
        <span>Section box</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>Reset</button>
        <IconButton icon={Icons.X} label="Close section box" size={13} className="sm" onClick={onClose} />
      </div>
      <p className="hud-hint">Drag a face of the box in the view, or trim each side here.</p>
      {sides.map(s => {
        const pct = Math.round(cut(s) * 100);
        return (
          <label className="slider-row" key={s.k}>
            <span>{s.label}</span>
            <input type="range" min="0" max="95" step="1" value={pct} onChange={e => update(s, e.target.value)} />
            <span className="mono">{pct}%</span>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer canvas + HUD
// ---------------------------------------------------------------------------
function DisplayControls({ mode, setMode, available, hourly, hour, setHour, time }) {
  const groups = [...new Set(DISPLAY_MODES.map(m => m.group))];
  return (
    <>
      <label className="quick-select display-select">
        <Icons.Paint size={15} />
        <select aria-label="Display" value={mode} onChange={e => setMode(e.target.value)}>
          {groups.map(g => (
            <optgroup key={g} label={g}>
              {DISPLAY_MODES.filter(m => m.group === g).map(m => <option key={m.id} value={m.id} disabled={!available(m)}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {hourly && time && (
        <label className="hour-slider" title={`Hour of the simulation: ${hourLabel(time, hour)}`}>
          <input type="range" min="0" max={time.n - 1} step="1" value={hour} onChange={e => setHour(Number(e.target.value))} aria-label="Simulation hour" aria-valuetext={hourLabel(time, hour)} />
          <span className="mono">{hourLabel(time, hour, true)} {String(time.hour[hour] - 1).padStart(2, '0')}–{String(time.hour[hour]).padStart(2, '0')} h</span>
        </label>
      )}
    </>
  );
}

function ViewerCanvas(props) {
  const {
    model, viewerRef, viewerState, dispatch, toast, theme,
    viewMode, setViewMode, showEdges, setShowEdges, showAxes, setShowAxes, showSpaces, setShowSpaces,
    explode, setExplode, sectionEnabled, toggleSection, sectionBox, setSectionBox,
    measureMode, toggleMeasure, annoMode, toggleAnno,
    levelId, onLevelChange, planCut, togglePlanCut, slabsTransparent, onToggleSlabs, onFocusGroup, onResetFilters,
    onPickEvent, onContextEvent, hint, layout, layoutSwitch, planElement,
    display, displayControls, analysisColors, analysisOpacity, analysisSpaces, overlay,
  } = props;
  const hostRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [modelBounds, setModelBounds] = useState(null);
  const [hover, setHover] = useState(null);
  const [, setFrame] = useState(0);
  const handlers = useRef({});
  handlers.current = { onPickEvent, onContextEvent, dispatch, toast };
  const hasLabels = useRef(false);
  hasLabels.current = viewerState.annotations.length + viewerState.measurements.length > 0;

  useEffect(() => {
    const v = new ThreeViewer(hostRef.current);
    viewerRef.current = v;
    window.__viewer = v;
    const offs = [
      v.on('pick', e => handlers.current.onPickEvent(e)),
      v.on('context', e => handlers.current.onContextEvent(e)),
      v.on('hover', e => setHover(e.expressId != null && e.x != null ? e : null)),
      v.on('measure', m => {
        handlers.current.dispatch({ type: 'add-measure', measure: { id: m.id, a: m.a.toArray(), b: m.b.toArray(), distance: m.distance, dx: m.dx, dy: m.dy, dz: m.dz } });
        handlers.current.toast({ kind: 'ok', msg: `Measured ${m.distance.toFixed(3)} m`, sub: 'Listed under Markup' });
      }),
      v.on('sectionBox', ({ box }) => setSectionBox(box)),
      v.on('anno', e => {
        handlers.current.dispatch({ type: 'add-anno', anno: { id: uid(), position: e.position.toArray(), elementId: e.elementId, title: 'New issue', description: '', status: 'open', priority: 'medium', timestamp: new Date().toLocaleString() } });
        handlers.current.toast({ kind: 'info', msg: 'Issue pinned', sub: 'Edit it under Markup' });
      }),
      v.on('camera', () => { if (hasLabels.current) setFrame(f => (f + 1) % 1e6); }),
    ];
    setReady(true);
    return () => { offs.forEach(off => off()); v.dispose(); viewerRef.current = null; window.__viewer = null; };
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!model) { v.clearModel(); setModelBounds(null); return; }
    let cancelled = false;
    setModelBounds(null);
    v.loadModel(model).then(() => { if (!cancelled) setModelBounds(v.getModelBounds()); });
    return () => { cancelled = true; };
  }, [model]);

  const colors = useMemo(() => {
    if (!analysisColors) return viewerState.colorOverrides;
    const m = new Map(viewerState.colorOverrides);
    analysisColors.forEach((c, id) => m.set(id, c));
    return m;
  }, [viewerState.colorOverrides, analysisColors]);
  const opacities = useMemo(() => {
    if (!analysisOpacity) return viewerState.opacityOverrides;
    const m = new Map(analysisOpacity);
    viewerState.opacityOverrides.forEach((o, id) => m.set(id, o));
    return m;
  }, [viewerState.opacityOverrides, analysisOpacity]);

  useEffect(() => { viewerRef.current?.setSelection(viewerState.selectedIds); }, [viewerState.selectedIds, modelBounds]);
  useEffect(() => { viewerRef.current?.setHidden(viewerState.hiddenIds); }, [viewerState.hiddenIds, modelBounds]);
  useEffect(() => { viewerRef.current?.setIsolated(viewerState.isolatedIds); }, [viewerState.isolatedIds, modelBounds]);
  useEffect(() => { viewerRef.current?.setColorOverrides(colors); }, [colors, modelBounds]);
  useEffect(() => { viewerRef.current?.setOpacityOverrides(opacities); }, [opacities, modelBounds]);
  useEffect(() => { viewerRef.current?.setViewMode(viewMode); }, [viewMode, modelBounds]);
  useEffect(() => { viewerRef.current?.setShowEdges(showEdges); }, [showEdges, modelBounds]);
  useEffect(() => { viewerRef.current?.setShowAxes(showAxes); }, [showAxes]);
  useEffect(() => { viewerRef.current?.setSpacesVisible(showSpaces || !!analysisSpaces); }, [showSpaces, analysisSpaces, modelBounds]);
  useEffect(() => { viewerRef.current?.setExplode(explode); }, [explode, modelBounds]);
  useEffect(() => { viewerRef.current?.setSectionBox(sectionEnabled, sectionBox, modelBounds); }, [sectionEnabled, sectionBox, modelBounds]);
  useEffect(() => { viewerRef.current?.setPlanCut(planCut); }, [planCut, modelBounds]);
  useEffect(() => { viewerRef.current?.setMeasureMode(measureMode); }, [measureMode]);
  useEffect(() => { viewerRef.current?.setAnnotationMode(annoMode); }, [annoMode]);
  useEffect(() => { viewerRef.current?.setTheme(theme); }, [theme]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (overlay && modelBounds) v.setOverlay('bem', overlay, { pickable: true });
    else v.removeOverlay('bem');
  }, [overlay, modelBounds]);

  const v = viewerRef.current;
  const project = (arr) => (v ? v.worldToScreen(new THREE.Vector3().fromArray(arr)) : { behind: true });
  const hoverEl = hover && model && !hover.overlay ? model.byId.get(hover.expressId) : null;
  const hostRect = hostRef.current?.getBoundingClientRect();
  const toolHint = measureMode ? 'Click two points to measure. Esc to stop.' : annoMode ? 'Click an element to pin an issue. Esc to stop.' : planCut.enabled ? 'Plan cut: geometry above the level is hidden.' : null;
  const sel = viewerState.selectedIds.size > 0;

  return (
    <div className="viewer-region" data-layout={model ? layout : '3d'}>
      <div className="viewer-wrap" ref={hostRef}>
        {model && (
          <div className="hud">
            <div className="viewbar" role="toolbar" aria-label="View">
              <label className="quick-select">
                <Icons.Layers size={15} />
                <select aria-label="Level" value={levelId} onChange={e => onLevelChange(e.target.value)}>
                  <option value="all">All levels</option>
                  {model.storeys.map(s => <option key={s.expressId} value={s.expressId}>{s.name || s.longName || `Storey #${s.expressId}`}</option>)}
                </select>
              </label>
              <button type="button" className="chip-btn" aria-pressed={planCut.enabled} disabled={levelId === 'all'} title={levelId === 'all' ? 'Choose a level to cut a floor plan' : 'Cut the model 1.2 m above the floor'} onClick={togglePlanCut}><Icons.PlanCut size={15} /><span>Cut</span></button>
              <span className="quick-sep" />
              {displayControls}
              <span className="quick-sep" />
              {layoutSwitch}
            </div>

            <NavCubeHost viewerRef={viewerRef} ready={ready} theme={theme} />

            {(toolHint || hint || (display && display.unavailable)) && (
              <div className="status-chip" role="status">
                <span className="dot" data-tone={display && display.unavailable ? 'warn' : 'accent'} />
                {toolHint || (display && display.unavailable) || hint}
              </div>
            )}
            {display && display.legend && <DisplayLegend legend={display.legend} theme={theme} />}

            {sectionEnabled && modelBounds && sectionBox && (
              <SectionBoxControls box={sectionBox} bounds={modelBounds} onChange={setSectionBox} onReset={() => setSectionBox({ ...modelBounds })} onClose={toggleSection} />
            )}

            {viewerState.measurements.map(m => {
              const mid = m.a.map((x, i) => (x + m.b[i]) / 2);
              const s = project(mid);
              return s.behind ? null : <div key={m.id} className="measure-label mono" style={{ left: s.x, top: s.y }}>{m.distance.toFixed(2)} m</div>;
            })}
            {viewerState.annotations.map((a, i) => {
              const s = project(a.position);
              return s.behind ? null : (
                <button key={a.id} type="button" className="anno-pin" data-status={a.status} style={{ left: s.x, top: s.y }} title={a.title} onClick={() => a.elementId != null && dispatch({ type: 'select', ids: [a.elementId] })}><span>{i + 1}</span></button>
              );
            })}
            {hoverEl && hostRect && !measureMode && !annoMode && (
              <div className="hover-tip" style={{ left: hover.x - hostRect.left + 14, top: hover.y - hostRect.top + 16 }}>
                <span className="mono tip-class">{hoverEl.ifcClass}</span>
                <span className="tip-name">{elementLabel(hoverEl)}</span>
              </div>
            )}

            <div className="dock" role="toolbar" aria-label="View tools">
              <div className="dock-group">
                <IconButton icon={Icons.Home} label="Fit model" onClick={() => v?.frameAll()} />
                <IconButton icon={Icons.Focus} label="Zoom to selection" shortcut="F" disabled={!sel} onClick={() => v?.frameElements([...viewerState.selectedIds])} />
              </div>
              <div className="dock-group">
                <IconButton icon={Icons.Eye} label="Show everything" shortcut="A" onClick={() => dispatch({ type: 'show-all' })} />
                <IconButton icon={Icons.EyeOff} label="Hide selection" shortcut="H" disabled={!sel} onClick={() => dispatch({ type: 'toggle-hide', ids: [...viewerState.selectedIds] })} />
                <IconButton icon={Icons.Isolate} label="Isolate selection" shortcut="I" disabled={!sel} onClick={() => dispatch({ type: 'isolate', ids: [...viewerState.selectedIds] })} />
              </div>
              <div className="dock-group">
                <IconButton icon={Icons.Section} label="Section box" shortcut="S" active={sectionEnabled} onClick={toggleSection} />
                <IconButton icon={Icons.Ruler} label="Measure distance" shortcut="M" active={measureMode} onClick={toggleMeasure} />
                <IconButton icon={Icons.Pin} label="Pin an issue" shortcut="P" active={annoMode} onClick={toggleAnno} />
              </div>
              <div className="dock-group">
                <div className="seg" role="group" aria-label="Display mode">
                  <button type="button" aria-pressed={viewMode === 'shaded'} title="Shaded" onClick={() => setViewMode('shaded')}><Icons.Shaded size={16} /><span className="sr-only">Shaded</span></button>
                  <button type="button" aria-pressed={viewMode === 'xray'} title="X-ray (X)" onClick={() => setViewMode('xray')}><Icons.Xray size={16} /><span className="sr-only">X-ray</span></button>
                  <button type="button" aria-pressed={viewMode === 'wireframe'} title="Wireframe (W)" onClick={() => setViewMode('wireframe')}><Icons.Wireframe size={16} /><span className="sr-only">Wireframe</span></button>
                </div>
                <IconButton icon={Icons.Edges} label="Edge lines" shortcut="E" active={showEdges} onClick={() => setShowEdges(x => !x)} />
              </div>
              <div className="dock-group">
                <LayersPopover model={model} viewerState={viewerState} dispatch={dispatch} showSpaces={showSpaces} setShowSpaces={setShowSpaces} slabsTransparent={slabsTransparent} onToggleSlabs={onToggleSlabs}
                  onFocusGroup={onFocusGroup} onResetFilters={onResetFilters} explode={explode} setExplode={setExplode} showAxes={showAxes} setShowAxes={setShowAxes} />
                <IconButton icon={Icons.Camera} label="Save a screenshot" onClick={() => {
                  const url = v.screenshot();
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${model.fileName.replace(/\.[^.]+$/, '')}-view.png`;
                  a.click();
                  toast({ kind: 'ok', msg: 'Screenshot saved' });
                }} />
              </div>
            </div>
          </div>
        )}
      </div>
      {model && layout !== '3d' && planElement}
    </div>
  );
}

// Filters and scene options that do not need to be on screen all the time.
function LayersPopover({ model, viewerState, dispatch, showSpaces, setShowSpaces, slabsTransparent, onToggleSlabs, onFocusGroup, onResetFilters, explode, setExplode, showAxes, setShowAxes }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  // Elements with geometry per category, for the show/hide filter.
  const groups = useMemo(() => {
    const byGroup = new Map();
    model.byClass.forEach((ids, cls) => {
      if (cls === 'IfcSpace') return; // room volumes have their own switch above
      const g = classGroupOf(cls);
      const withGeo = ids.filter(id => { const el = model.byId.get(id); return el && !el.isType && el.geometry; });
      if (!withGeo.length) return;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(...withGeo);
    });
    return CLASS_GROUPS.filter(g => byGroup.has(g.id)).map(g => ({ id: g.id, name: g.name, ids: byGroup.get(g.id) }));
  }, [model]);
  const hidden = viewerState.hiddenIds;
  const groupHidden = (g) => g.ids.length > 0 && g.ids.every(id => hidden.has(id));
  const anyGroupHidden = groups.some(groupHidden);
  const active = showSpaces || slabsTransparent || explode > 0 || anyGroupHidden;
  return (
    <div className="menu-anchor">
      <button ref={ref} type="button" className="icon-btn dock-layers" data-active={active ? 'true' : undefined} aria-expanded={open} aria-label="Layers and filters" title="Layers and filters" onClick={() => setOpen(o => !o)}>
        <Icons.Layers size={16} />
      </button>
      <FloatingPanel anchorRef={ref} open={open} onClose={close} placement="corner" className="menu layers-pop" label="Layers and filters">
        <div className="menu-title">Show</div>
        <label className="check-field menu-check"><input type="checkbox" checked={showSpaces} onChange={() => setShowSpaces(x => !x)} /> Room volumes</label>
        <label className="check-field menu-check"><input type="checkbox" checked={slabsTransparent} onChange={onToggleSlabs} /> See-through slabs and roofs</label>
        <label className="check-field menu-check"><input type="checkbox" checked={showAxes} onChange={() => setShowAxes(x => !x)} /> Axes</label>
        {groups.length > 0 && (
          <>
            <div className="menu-sep" />
            <div className="menu-title">Filter by category</div>
            {groups.map(g => (
              <label key={g.id} className="check-field menu-check">
                <input type="checkbox" checked={!groupHidden(g)} onChange={() => dispatch({ type: 'toggle-hide', ids: g.ids })} />
                <span className="menu-check-label">{g.name}</span>
                <span className="mono muted trail">{g.ids.length.toLocaleString()}</span>
              </label>
            ))}
          </>
        )}
        <div className="menu-sep" />
        <div className="menu-title">Isolate</div>
        <button type="button" role="menuitem" onClick={() => { onFocusGroup('structure'); setOpen(false); }}><Icons.Building size={15} /> Structure</button>
        <button type="button" role="menuitem" onClick={() => { onFocusGroup('mep'); setOpen(false); }}><Icons.Activity size={15} /> MEP</button>
        {model.storeys.length > 1 && (
          <>
            <div className="menu-sep" />
            <label className="slider-row menu-slider">
              <span>Explode levels</span>
              <input type="range" min="0" max="1" step="0.01" value={explode} onChange={e => setExplode(parseFloat(e.target.value))} />
              <span className="mono">{Math.round(explode * 100)}%</span>
            </label>
          </>
        )}
        <div className="menu-sep" />
        <button type="button" role="menuitem" onClick={() => { onResetFilters(); setOpen(false); }}><Icons.Reset size={15} /> Reset view filters</button>
      </FloatingPanel>
    </div>
  );
}

// 3D / 3D + 2D / 2D layout switch, shared by the 3D view bar and the plan toolbar.
function LayoutSwitch({ layout, setLayout }) {
  return (
    <div className="seg layout-seg" role="group" aria-label="Layout">
      <button type="button" aria-pressed={layout === '3d'} title="3D model only" onClick={() => setLayout('3d')}><Icons.Cube size={15} /><span>3D</span></button>
      <button type="button" aria-pressed={layout === 'split'} title="3D model and 2D floor plan side by side" onClick={() => setLayout('split')}><Icons.Columns size={15} /><span>3D + 2D</span></button>
      <button type="button" aria-pressed={layout === 'plan'} title="2D floor plan only" onClick={() => setLayout('plan')}><Icons.Plan size={15} /><span>2D</span></button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------
function LoadingOverlay({ fileName, progress, phase, log }) {
  const recent = log.slice(-5);
  return (
    <div className="load-overlay" role="status" aria-live="polite">
      <div className="load-card">
        <div className="load-head">
          <span className="spinner" />
          <div>
            <h3>Opening {fileName}</h3>
            <div className="sub">{phase || 'Starting'}</div>
          </div>
          <span className="mono load-pct">{Math.round(progress * 100)}%</span>
        </div>
        <div className="load-bar"><div style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
        <ul className="load-log">
          {recent.map((l, i) => <li key={i} className={l.level} dangerouslySetInnerHTML={{ __html: l.msg }} />)}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function HelpPanel({ onClose }) {
  const groups = [
    ['Camera', [['Left drag', 'Orbit'], ['Right drag, Shift + drag', 'Pan'], ['Wheel', 'Zoom toward the cursor'], ['Double-click', 'Zoom to element'], ['1 to 6', 'Iso, top, front, back, left, right'], ['F', 'Zoom to selection']]],
    ['Selection', [['Click', 'Select'], ['Ctrl + click', 'Add to selection'], ['H / I / A', 'Hide, isolate, show all'], ['Esc', 'Stop the tool, then clear selection'], ['Right-click', 'Context menu']]],
    ['Tools', [['S', 'Section box'], ['M', 'Measure'], ['P', 'Pin an issue'], ['E', 'Edge lines'], ['X / W', 'X-ray, wireframe'], ['Ctrl + K', 'Search'], ['O', 'Open a file']]],
  ];
  return (
    <Modal title="Shortcuts and controls" onClose={onClose}>
      <div className="help-grid">
        {groups.map(([title, rows]) => (
          <div key={title}>
            <h4>{title}</h4>
            {rows.map(([k, l]) => <div key={k} className="help-row"><span>{l}</span><kbd>{k}</kbd></div>)}
          </div>
        ))}
      </div>
      <p className="pane-note">On touch screens, drag with one finger to orbit and pinch with two to zoom and pan.</p>
    </Modal>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className="toast" data-kind={t.kind || 'info'}>
          <span className="toast-ic">{t.kind === 'ok' ? <Icons.Check size={14} /> : t.kind === 'info' ? <Icons.Info size={14} /> : <Icons.Alert size={14} />}</span>
          <div className="toast-msg"><div>{t.msg}</div>{t.sub && <div className="sub">{t.sub}</div>}</div>
          <IconButton icon={Icons.X} label="Dismiss" size={12} className="sm" onClick={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

// useLayoutEffect without the SSR warning concerns (always client-side here).
const useLayoutEffectSafe = React.useLayoutEffect;

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
function StartScreen({ onUpload, onLoadFile, onLoadSample, currentModel, onResume }) {
  const [over, setOver] = useState(false);
  const steps = [
    ['Cube', 'IFC model', 'Open IFC2x3, IFC4 or IFC4.3 and explore it in 3D and on floor plans.'],
    ['MapPin', 'Location', 'Confirm the site from IfcSite or an address; get open weather data for it.'],
    ['Zap', 'BEM conversion', 'Zones, surfaces, openings and constructions from the IFC, each traceable.'],
    ['Play', 'EnergyPlus', 'Real EnergyPlus 26.2 runs in your browser through WebAssembly.'],
    ['Thermometer', 'IEQ', 'PMV/PPD, CO₂ and daylight at a reference point from the simulation.'],
    ['Report', 'Report', 'Scenario comparison, IDF/epJSON, mappings, results and a printable report.'],
  ];
  return (
    <div className="start" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={e => { if (e.currentTarget === e.target) setOver(false); }} onDrop={e => {
      e.preventDefault(); setOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) onLoadFile(file, 'Dropped');
    }}>
      <div className="start-inner">
        {currentModel && <button type="button" className="btn resume-btn" onClick={onResume}><Icons.ChevronRight size={15} style={{ transform: 'rotate(180deg)' }} /> Back to {currentModel.fileName}</button>}
        <div className="start-top single">
          <section className="start-hero">
            <h1>From IFC model to building energy model.</h1>
            <p>BIM2BEM converts a building information model into an EnergyPlus model, runs the simulation in your browser with location-specific weather data, and evaluates energy demand and indoor environmental quality. Every input says where it came from: the IFC file, your entries, an open dataset or a documented assumption. Files never leave your machine.</p>
            <div className="start-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={onUpload}><Icons.Upload size={16} /> Open an IFC file</button>
              <button type="button" className="btn btn-lg" onClick={() => onLoadSample(SAMPLES[0])}><Icons.Cube size={16} /> Try the BEM demo office</button>
            </div>
            <button type="button" className="dropzone" data-over={over} onClick={onUpload}>
              <Icons.Upload size={18} />
              <span>Drop a <code>.ifc</code> file anywhere on this page</span>
              <span className="muted">Parsed locally with web-ifc; simulated locally with EnergyPlus (WebAssembly)</span>
            </button>
          </section>
        </div>
        <ol className="start-steps" aria-label="Workflow">
          {steps.map(([icon, t, d], i) => { const I = Icons[icon]; return <li key={t}><span className="step-n mono">{i + 1}</span><I size={18} /><div><b>{t}</b><p>{d}</p></div></li>; })}
        </ol>
        <section className="start-samples" aria-label="Sample models">
          <h2>Sample models</h2>
          <div className="sample-grid">
            {SAMPLES.map(smp => (
              <article key={smp.id} className="sample-card">
                <div className="sample-head"><Icons.Building size={18} /><h3>{smp.name}</h3><span className="mono muted">{smp.size}</span></div>
                <p>{smp.facts}</p>
                <p className="sample-credit"><a href={smp.creditUrl} target="_blank" rel="noopener noreferrer">{smp.credit}</a></p>
                <div className="sample-actions">
                  <button type="button" className="btn btn-sm" onClick={() => onLoadSample(smp)}>Open</button>
                  {smp.downloadable && <a className="btn btn-sm btn-ghost" href={smp.url} download={smp.file}><Icons.Download size={14} /> Download .ifc</a>}
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="start-scope" aria-label="Scope">
          <h2>What is calculated, and what is not</h2>
          <div className="scope-grid">
            <div><h3><Icons.Check size={15} /> Calculated</h3><ul><li>Heating and cooling demand, peaks, zone temperatures (EnergyPlus ideal loads)</li><li>Lighting and equipment electricity; HVAC energy with constant efficiencies when you enter them</li><li>PMV/PPD (ISO 7730), adaptive comfort for free-running buildings, operative temperature</li><li>Zone CO₂ balance, outdoor-air and infiltration rates</li><li>Daylight illuminance at one point per zone (split flux)</li><li>Wind rose, sun path, incident solar radiation on surfaces, natural ventilation (wind and stack)</li></ul></div>
            <div><h3><Icons.Info size={15} /> Not calculated</h3><ul><li>Annual grid daylight metrics (sDA, ASE) — need a Radiance-class engine</li><li>AirflowNetwork pressures and interzone airflow; CFD</li><li>Particulates and VOCs</li><li>Acoustics (planned)</li><li>Detailed HVAC plant and distribution</li></ul></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ContextMenu({ menu, onClose, dispatch, onZoomTo, model, toast }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffectSafe(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [menu]);
  if (!menu) return null;
  const ids = menu.ids;
  const first = model.byId.get(ids[0]);
  const run = (fn) => () => { fn(); onClose(); };
  return (
    <div className="menu ctx-menu" role="menu" ref={ref} style={{ left: (pos || menu).x, top: (pos || menu).y }}>
      <div className="menu-title">{ids.length > 1 ? plural(ids.length, 'element') : elementLabel(first)}</div>
      <button type="button" role="menuitem" onClick={run(() => onZoomTo(ids))}><Icons.Focus size={15} /> Zoom to <kbd>F</kbd></button>
      <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'isolate', ids }))}><Icons.Isolate size={15} /> Isolate <kbd>I</kbd></button>
      <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'toggle-hide', ids }))}><Icons.EyeOff size={15} /> Hide <kbd>H</kbd></button>
      <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'show-all' }))}><Icons.Eye size={15} /> Show everything <kbd>A</kbd></button>
      {first && <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'select', ids: model.byClass.get(first.ifcClass) || [] }))}><Icons.Classes size={15} /> Select all {first.ifcClass.replace(/^Ifc/, '')}</button>}
      <div className="menu-sep" />
      {first && first.globalId && <button type="button" role="menuitem" onClick={run(() => { navigator.clipboard?.writeText(first.globalId); toast({ kind: 'ok', msg: 'GlobalId copied' }); })}><Icons.Copy size={15} /> Copy GlobalId</button>}
      <button type="button" role="menuitem" onClick={run(() => exportJSON(ids.map(id => model.byId.get(id)).filter(Boolean), toast))}><Icons.Download size={15} /> Export as JSON</button>
    </div>
  );
}

function SidePane({ title, children }) {
  return (
    <aside className="side left-side wide" aria-label={title}>
      <div className="side-body">
        <div className="pane-title"><h2>{title}</h2></div>
        <div className="side-scroll pad">{children}</div>
      </div>
    </aside>
  );
}

const EMPTY_LOCATION = { latitude: null, longitude: null, elevation: null, northAngle: 0, terrain: 'City', address: null, timeZoneName: null, confirmed: false, source: {} };

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [model, setModel] = useState(null);
  const [secondaryReady, setSecondaryReady] = useState(false);
  const [loading, setLoading] = useState(null);
  const [workspace, setWorkspace] = useState('bim');
  const [modal, setModal] = useState(null);
  const [viewMode, setViewMode] = useState('shaded');
  const [showEdges, setShowEdges] = useState(false);
  const [showAxes, setShowAxes] = useState(true);
  const [showSpaces, setShowSpaces] = useState(false);
  const [explode, setExplode] = useState(0);
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionBox, setSectionBox] = useState(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [annoMode, setAnnoMode] = useState(false);
  const [levelId, setLevelId] = useState('all');
  const [planCut, setPlanCut] = useState({ enabled: false, y: 0 });
  const [slabsTransparent, setSlabsTransparent] = useState(false);
  const [log, setLog] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [layout, setLayout] = useState(initialLayout);
  const [viewLayout, setViewLayoutState] = useState(() => (['3d', 'split', 'plan'].includes(readStorage(STORAGE.layoutMode)) ? readStorage(STORAGE.layoutMode) : '3d'));
  const [planLevel, setPlanLevel] = useState(null);
  const [leftTab, setLeftTab] = useState('spatial');
  const [showHome, setShowHome] = useState(false);
  // BEM workflow state
  const [location, setLocation] = useState(EMPTY_LOCATION);
  const [weather, setWeather] = useState(null);
  const [bemOptions, setBemOptions] = useState(() => ({ ...BEM_DEFAULTS }));
  const [tm, setTm] = useState(null);
  const [converting, setConverting] = useState(false);
  const [config, setConfig] = useState(defaultConfig);
  const [scenarios, setScenarios] = useState([{ id: 'base', name: 'Baseline', mods: {} }]);
  const [runs, setRuns] = useState({});
  const [activeId, setActiveId] = useState('base');
  const [engineStatus, setEngineStatus] = useState(null);
  const [displayMode, setDisplayMode] = useState('bim');
  const [hour, setHour] = useState(4380);
  const [surfaceId, setSurfaceId] = useState(null);
  const [dockFocus, setDockFocus] = useState(null);
  const [viewerState, dispatch] = useReducer(viewerStateReducer, undefined, initialViewerState);
  const fileInputRef = useRef(null);
  const viewerRef = useRef(null);
  const bodyRef = useRef(null);
  const searchRef = useRef(null);
  const modelRef = useRef(null);
  modelRef.current = model;

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); writeStorage(STORAGE.theme, theme); }, [theme]);
  useEffect(() => { writeStorage(STORAGE.layout, JSON.stringify(layout)); }, [layout]);
  useEffect(() => {
    const warm = () => { window.ensureWebIfc?.().catch(() => {}); };
    if (typeof requestIdleCallback !== 'undefined') { const h = requestIdleCallback(warm, { timeout: 2500 }); return () => cancelIdleCallback(h); }
    const h = setTimeout(warm, 300);
    return () => clearTimeout(h);
  }, []);

  const dismissToast = useCallback((id) => setToasts(ts => ts.filter(x => x.id !== id)), []);
  const toast = useCallback((t) => {
    const id = uid();
    setToasts(ts => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => dismissToast(id), t.kind === 'error' ? 8000 : 3600);
  }, [dismissToast]);
  const addLog = useCallback((level, msg) => setLog(l => [...l, { time: new Date().toLocaleTimeString([], { hour12: false }), level, msg }]), []);

  const building = useMemo(() => {
    if (!model || !secondaryReady) return null;
    try { return buildBuildingGraph(model); } catch (err) { console.error(err); return null; }
  }, [model, secondaryReady]);

  const resetSession = useCallback(() => {
    dispatch({ type: 'reset' });
    setSecondaryReady(false);
    setLevelId('all'); setPlanCut({ enabled: false, y: 0 }); setSlabsTransparent(false); setShowSpaces(false); setExplode(0);
    setSectionEnabled(false); setSectionBox(null); setMeasureMode(false); setAnnoMode(false); setModal(null); setContextMenu(null); setPlanLevel(null);
    setLocation(EMPTY_LOCATION); setWeather(null); setTm(null); setBemOptions({ ...BEM_DEFAULTS }); setConfig(defaultConfig());
    setScenarios([{ id: 'base', name: 'Baseline', mods: {} }]); setRuns({}); setActiveId('base'); setEngineStatus(null); setDisplayMode('bim'); setSurfaceId(null);
    viewerRef.current?.clearMeasurements();
  }, []);

  const loadIfcFile = useCallback(async (file, source = 'Opened') => {
    if (!file) return;
    if (!/\.ifc$/i.test(file.name)) { toast({ kind: 'error', msg: `${file.name} is not an .ifc file`, sub: 'Choose a STEP-encoded .ifc file (IFC2x3, IFC4 or IFC4.3).' }); return; }
    modelRef.current?.close?.();
    setModel(null);
    resetSession();
    setLog([]);
    setLoading({ fileName: file.name, progress: 0.01, phase: 'Starting' });
    addLog('info', `${source} <span class="hl">${file.name}</span> (${formatSize(file.size)})`);
    try {
      const schema = await window.readIfcSchema(file);
      if (schema && !window.isSupportedIfcSchema(schema)) throw new Error(`Schema ${schema} is not supported. Use IFC2X3, IFC4 or IFC4X3.`);
      const m = await window.loadRealIfc(file, { onProgress: (p, phase) => setLoading(l => (l ? { ...l, progress: p, phase: phase || l.phase } : l)), onLog: addLog });
      try { m.fileSha256 = await sha256Hex(new Uint8Array(await file.arrayBuffer())); } catch { m.fileSha256 = null; }
      setModel(m);
      setShowHome(false);
      setLoading(null);
      setWorkspace('bim');
      toast({ kind: 'ok', msg: `Opened ${file.name}`, sub: `${plural(m.elements.length, 'element')}, ${m.schemaVersion}` });
      m._ensureSecondaryData().then(() => { if (modelRef.current === m) setSecondaryReady(true); });
      const g = m.geoRef || {};
      if (g.northAngle != null) setLocation(l => ({ ...l, northAngle: +g.northAngle.toFixed(2), source: { ...l.source, northAngle: 'IFC TrueNorth' } }));
    } catch (err) {
      console.error(err);
      addLog('error', `Could not open the file: ${err.message || err}`);
      setLoading(null);
      toast({ kind: 'error', msg: `Could not open ${file.name}`, sub: String(err.message || err).slice(0, 140) });
    }
  }, [addLog, toast, resetSession]);

  const loadSample = useCallback(async (sample = SAMPLES[0]) => {
    try {
      if (!sample.bundled) setLoading({ fileName: sample.file, progress: 0.01, phase: 'Downloading from the source' });
      const res = await fetch(sample.url);
      if (!res.ok) throw new Error(`The sample returned HTTP ${res.status}`);
      const blob = await res.blob();
      await loadIfcFile(new File([blob], sample.file, { type: 'application/octet-stream' }), `Opened sample “${sample.name}”`);
    } catch (err) {
      setLoading(null);
      toast({ kind: 'error', msg: `Could not open “${sample.name}”`, sub: 'Serve the site over HTTP (not file://) and try again.' });
    }
  }, [loadIfcFile, toast]);

  const onUpload = useCallback(() => fileInputRef.current?.click(), []);
  const onCloseModel = useCallback(() => { modelRef.current?.close?.(); setModel(null); resetSession(); setLog([]); setWorkspace('bim'); }, [resetSession]);

  useEffect(() => {
    const over = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    const drop = (e) => {
      if (!e.dataTransfer?.files?.length) return;
      const f = e.dataTransfer.files[0];
      if (!/\.ifc$/i.test(f.name)) return; // EPW uploads are handled by their own control
      e.preventDefault();
      loadIfcFile(f, 'Dropped');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [loadIfcFile]);

  // ---- BEM conversion -----------------------------------------------------------------------------
  const onConvert = useCallback(async () => {
    if (!model) return;
    setConverting(true);
    await new Promise(r => setTimeout(r, 30));
    try {
      const t = await buildThermalModel(model, { ...bemOptions, northAngle: location.northAngle });
      setTm(t);
      setRuns({});
      addLog(t.zones.length ? 'ok' : 'warn', `Energy model: <span class="hl">${t.stats.zones}</span> zones, <span class="hl">${t.stats.surfaces}</span> surfaces, ${t.stats.windows} windows in ${t.stats.buildMs.toFixed(0)} ms`);
      toast({ kind: t.zones.length ? 'ok' : 'warn', msg: t.zones.length ? 'Energy model built' : 'No thermal zones', sub: t.zones.length ? `${t.stats.zones} zones, ${t.stats.surfaces} surfaces, ${t.stats.interzonePairs} interzone pairs` : 'See Checks for what is missing.' });
      if (t.zones.length && displayMode === 'bim') setDisplayMode('bem');
    } catch (err) {
      console.error(err);
      toast({ kind: 'error', msg: 'Conversion failed', sub: String(err.message || err).slice(0, 160) });
    } finally { setConverting(false); }
  }, [model, bemOptions, location.northAngle, toast, addLog, displayMode]);

  // Automatic weather: once the location is confirmed, fetch a weather file for it (see autoWeather).
  // A file the user chose (dataset button or upload) is never replaced automatically.
  const [autoWxEnabled, setAutoWxEnabledState] = useState(() => readStorage(STORAGE.autoWeather) !== 'off');
  const setAutoWxEnabled = useCallback((on) => { setAutoWxEnabledState(on); writeStorage(STORAGE.autoWeather, on ? 'on' : 'off'); }, []);
  const [autoWx, setAutoWx] = useState(null);
  const [autoWxNonce, setAutoWxNonce] = useState(0);
  const autoWxCtl = useRef(null);
  const autoWxForced = useRef(false);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const cancelAutoWeather = useCallback(() => {
    if (autoWxCtl.current) { autoWxCtl.current.abort(); autoWxCtl.current = null; }
    setAutoWx(s => (s && s.state === 'running' ? null : s));
  }, []);
  const setWeatherManual = useCallback((w) => { cancelAutoWeather(); setAutoWx(null); setWeather(w); }, [cancelAutoWeather]);
  const retryAutoWeather = useCallback(() => { autoWxForced.current = true; setAutoWxNonce(n => n + 1); }, []);
  useEffect(() => {
    const forced = autoWxForced.current;
    autoWxForced.current = false;
    if (!location.confirmed) { setAutoWx(null); return undefined; }
    if (!(autoWxEnabled || forced) || location.latitude == null || location.longitude == null) return undefined;
    const cur = weatherRef.current;
    if (cur && !forced) {
      if (cur.meta.auto && cur.meta.requested && haversineKm(cur.meta.requested.latitude, cur.meta.requested.longitude, location.latitude, location.longitude) < 0.5) return undefined;
      if (!cur.meta.auto) {
        const km = haversineKm(cur.meta.latitude, cur.meta.longitude, location.latitude, location.longitude);
        if (km > 50) setAutoWx({ state: 'kept', message: `The weather file you selected (${cur.meta.name}) is ${km.toFixed(0)} km from the confirmed location. It was kept because you chose it.` });
        return undefined;
      }
    }
    const ctl = new AbortController();
    autoWxCtl.current = ctl;
    setAutoWx({ state: 'running', step: 'Getting weather data for this location' });
    autoWeather(location, { signal: ctl.signal, onStep: (step) => { if (!ctl.signal.aborted) setAutoWx({ state: 'running', step }); } })
      .then((w) => {
        if (ctl.signal.aborted) return;
        setWeather(w);
        setAutoWx({ state: 'done' });
        addLog('info', `Weather selected automatically: <span class="hl">${w.meta.name}</span>`);
        toast({ kind: w.validation.ok ? 'ok' : 'warn', msg: 'Weather data selected automatically', sub: `${w.meta.name} · ${w.meta.distanceKm != null ? `${w.meta.distanceKm.toFixed(1)} km from the site` : ''}` });
      })
      .catch((err) => {
        if (ctl.signal.aborted || (err && err.name === 'AbortError')) return;
        console.warn(err);
        setAutoWx({ state: 'failed', message: String(err.message || err), attempts: err.attempts || [] });
        toast({ kind: 'warn', msg: 'Could not get weather data automatically', sub: 'Choose a dataset in the Location tab or upload an EPW in Energy Simulation.' });
      })
      .finally(() => { if (autoWxCtl.current === ctl) autoWxCtl.current = null; });
    return () => { ctl.abort(); setAutoWx(s => (s && s.state === 'running' ? null : s)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWxEnabled, autoWxNonce, location.confirmed, location.latitude, location.longitude, location.timeZoneName]);
  const autoWxProps = { enabled: autoWxEnabled, setEnabled: setAutoWxEnabled, status: autoWx, cancel: cancelAutoWeather, retry: retryAutoWeather };

  // Configuration seen by EnergyPlus: the site comes from the weather file (EnergyPlus uses it for weather run periods).
  const runConfig = useCallback(() => {
    const c = JSON.parse(JSON.stringify(config));
    c.site = { ...c.site, name: weather ? weather.meta.name : 'Site', latitude: weather ? weather.epw.header.latitude : location.latitude, longitude: weather ? weather.epw.header.longitude : location.longitude, timeZone: weather ? weather.epw.header.timeZone : 0, elevation: weather ? weather.epw.header.elevation : location.elevation, northAngle: location.northAngle || 0, terrain: location.terrain };
    c.run = { ...c.run, year: weather && weather.meta.year ? weather.meta.year : null };
    return c;
  }, [config, weather, location]);

  const compose = useMemo(() => {
    if (!tm || !tm.zones.length) return null;
    try { return composeIdf(tm, runConfig(), null, { fileName: model && model.fileName, buildingName: model && model.building && model.building.name }); } catch (err) { return { issues: [{ severity: 'critical', message: String(err.message || err) }] }; }
  }, [tm, runConfig, model]);

  const issues = useMemo(() => collectIssues({ tm, compose, weather, location, config }), [tm, compose, weather, location, config]);
  const blocking = issues.filter(i => i.severity === 'critical').map(i => i.message);

  const runScenario = useCallback(async (sc) => {
    if (!tm || !weather) return;
    setRuns(r => ({ ...r, [sc.id]: { status: 'running' } }));
    setEngineStatus({ busy: true, text: engineLoaded() ? 'Preparing the model' : 'Loading EnergyPlus…' });
    try {
      const out = composeIdf(tm, runConfig(), sc.id === 'base' ? null : sc, { fileName: model.fileName, buildingName: model.building && model.building.name });
      const crit = out.issues.filter(i => i.severity === 'critical');
      if (crit.length) throw new Error(`The model failed schema validation: ${crit[0].message}`);
      const { run, seconds } = await runEnergyPlus(out.idf, weather.text, {
        onStatus: (text) => setEngineStatus({ busy: true, text }),
        onProgress: (p) => setEngineStatus({ busy: true, text: `${sc.name}: ${p.phase}${p.message ? ` · ${p.message}` : ''}`, progress: Math.max(0, Math.min(1, (p.progress || 0) / 100)) }),
      });
      const errEntries = ((run.err && run.err.entries) || []).filter(e => e.severity !== 'info').map(e => ({ severity: e.severity, message: e.message, count: e.count || 1 }));
      if (run.cancelled) throw new Error('The run was cancelled.');
      if (!run.success) {
        const msg = run.fatalError || (run.crash ? `${run.crash.type}: ${run.crash.message}` : 'EnergyPlus did not finish');
        setRuns(r => ({ ...r, [sc.id]: { status: 'failed', error: msg, errEntries, idf: out.idf } }));
        setEngineStatus({ busy: false, text: `${sc.name} failed: ${msg}` });
        toast({ kind: 'error', msg: `${sc.name}: EnergyPlus failed`, sub: msg.slice(0, 160) });
        return;
      }
      const results = parseResults(run, tm, out.names, { conditioned: out.conditioned, runSeconds: seconds, scenario: sc.name });
      setRuns(r => ({ ...r, [sc.id]: { status: 'done', results, idf: out.idf, epjson: out.model.toEpJSON(), html: run.html || null, errEntries, seconds, ground: out.ground, weatherAt: weather.loadedAt, weatherName: weather.meta.name } }));
      setActiveId(sc.id);
      setEngineStatus({ busy: false, text: `${sc.name}: finished in ${seconds.toFixed(0)} s · ${results.meta.warnings} warnings, ${results.meta.severe} severe` });
      addLog('ok', `EnergyPlus ${ENGINE_INFO.energyPlus}: <span class="hl">${sc.name}</span> in ${seconds.toFixed(1)} s (${results.meta.warnings} warnings, ${results.meta.severe} severe)`);
      toast({ kind: 'ok', msg: `${sc.name} simulated`, sub: `Heating ${fmt(results.building.heatKWhm2, 1)} · cooling ${fmt(results.building.coolKWhm2, 1)} kWh/m²·a` });
      setDockFocus('energy');
    } catch (err) {
      console.error(err);
      setRuns(r => ({ ...r, [sc.id]: { status: 'failed', error: String(err.message || err) } }));
      setEngineStatus({ busy: false, text: `${sc.name} could not run: ${err.message || err}` });
      toast({ kind: 'error', msg: `${sc.name} could not run`, sub: String(err.message || err).slice(0, 160) });
    }
  }, [tm, weather, runConfig, model, toast, addLog]);
  const runAll = useCallback(async () => { for (const sc of scenarios) await runScenario(sc); }, [scenarios, runScenario]);

  const active = runs[activeId] && runs[activeId].status === 'done' ? runs[activeId] : null;
  const results = active ? active.results : null;
  // Hourly views open on the hour of peak cooling, a time worth looking at.
  useEffect(() => { if (results) setHour(results.building.peakCoolAt || 0); }, [results]);
  const ieq = useMemo(() => computeIeq(tm, results, config, location), [tm, results, config.comfort, config.loads.activityMet, config.hvac.cooling, config.co2.outdoorPpm, config.daylight.setpointLux, location.latitude]);

  // ---- Display -------------------------------------------------------------------------------------
  const display = useMemo(() => displayFor(displayMode, { tm, results, ieq, hour: Math.min(hour, results ? results.time.n - 1 : hour), theme, config }), [displayMode, tm, results, ieq, hour, theme, config]);
  const analysisLayer = useMemo(() => {
    if (!model || !display || display.unavailable) return {};
    const opacity = new Map();
    if (display.zoneColors) {
      model.elements.forEach(e => { if (e.geometry && e.ifcClass !== 'IfcSpace') opacity.set(e.expressId, 0.07); });
      display.zoneColors.forEach((_, id) => opacity.set(id, 0.88));
      return { colors: display.zoneColors, opacity, spaces: true };
    }
    if (display.surfaceColor) {
      model.elements.forEach(e => { if (e.geometry) opacity.set(e.expressId, 0.05); });
      return { opacity, overlay: buildBemOverlay(tm, display.surfaceColor, { selectedId: surfaceId }) };
    }
    return {};
  }, [display, model, tm, surfaceId]);
  const modeAvailable = useCallback((m) => {
    if (!m.needs) return true;
    if (m.needs === 'tm') return !!(tm && tm.zones.length);
    if (!results) return false;
    if (m.needs === 'co2') return tm.zones.some(z => results.zones.get(z.key)?.series.co2);
    if (m.needs === 'daylight') return tm.zones.some(z => results.zones.get(z.key)?.series.lux);
    return true;
  }, [tm, results]);
  useEffect(() => { const m = DISPLAY_MODES.find(x => x.id === displayMode); if (m && !modeAvailable(m)) setDisplayMode(tm ? 'bem' : 'bim'); }, [modeAvailable]);
  const hourly = (DISPLAY_MODES.find(m => m.id === displayMode) || {}).hourly;

  // ---- Selection -----------------------------------------------------------------------------------------
  const onPick = useCallback((id, e) => dispatch({ type: 'select', ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }), []);
  const onZoomTo = useCallback((ids) => viewerRef.current?.frameElements(ids), []);
  const selectAndShow = useCallback((ids) => {
    dispatch({ type: 'select', ids });
    const geo = ids.filter(id => modelRef.current?.byId.get(id)?.geometry);
    if (geo.length) viewerRef.current?.frameElements(geo);
  }, []);
  const onPickEvent = useCallback((e) => {
    if (e.overlay === 'bem' && tm) {
      const s = tm.surfById.get(e.expressId);
      if (!s) return;
      setSurfaceId(s.id);
      const src = s.sourceIds.find(id => /^Ifc(Wall|Slab|Roof|Covering|CurtainWall|Plate)/.test(model.byId.get(id)?.ifcClass || '')) || s.spaceId;
      if (src != null) dispatch({ type: 'select', ids: [src] });
      return;
    }
    setSurfaceId(null);
    if (e.expressId == null) { if (!e.multi) dispatch({ type: 'clear-selection' }); return; }
    dispatch({ type: 'select', ids: [e.expressId], multi: e.multi });
  }, [tm, model]);
  const onContext = useCallback((e, id) => {
    if (e.preventDefault) e.preventDefault();
    if (!modelRef.current) return;
    let ids = [...viewerState.selectedIds];
    if (id != null && !viewerState.selectedIds.has(id)) { ids = [id]; dispatch({ type: 'select', ids }); }
    if (!ids.length) return;
    setContextMenu({ x: e.clientX, y: e.clientY, ids });
  }, [viewerState.selectedIds]);
  const onContextEvent = useCallback((e) => { if (e.expressId == null || e.overlay) return; onContext({ clientX: e.x, clientY: e.y }, e.expressId); }, [onContext]);

  // Zone of the current selection (for charts).
  const selectedZone = useMemo(() => {
    if (!tm) return null;
    const ids = [...viewerState.selectedIds];
    for (let i = ids.length - 1; i >= 0; i--) { const m = tm.mapping.get(ids[i]); if (m && m.zones.length) return m.zones[0]; if (m && m.surfaces.length) return tm.surfById.get(m.surfaces[0]).zoneKey; }
    if (surfaceId) return tm.surfById.get(surfaceId)?.zoneKey;
    return tm.zones[0] ? tm.zones[0].key : null;
  }, [tm, viewerState.selectedIds, surfaceId]);

  // ---- Tools ------------------------------------------------------------------------------------
  const toggleSection = useCallback(() => {
    setSectionEnabled(on => { if (!on) { const b = viewerRef.current?.getModelBounds(); if (b) setSectionBox({ ...b }); } return !on; });
  }, []);
  const toggleMeasure = useCallback(() => setMeasureMode(on => { if (!on) setAnnoMode(false); return !on; }), []);
  const toggleAnno = useCallback(() => setAnnoMode(on => { if (!on) setMeasureMode(false); return !on; }), []);
  const levelFloorY = useCallback((id) => {
    const lv = building?.levels.find(l => l.id === Number(id));
    if (lv && lv.floorY != null) return lv.floorY;
    const els = model ? model.elements.filter(e => e.storey && e.storey.expressId === Number(id) && e.bbox) : [];
    return els.length ? Math.min(...els.map(e => e.bbox.min[1])) : 0;
  }, [building, model]);
  const onLevelChange = useCallback((id, { frame = true } = {}) => {
    setLevelId(id);
    if (!model) return;
    if (id === 'all') { dispatch({ type: 'isolate', ids: [], force: true }); setPlanCut(p => ({ ...p, enabled: false })); viewerRef.current?.frameAll(); return; }
    const sid = Number(id);
    const ids = model.elements.filter(el => el.storey && el.storey.expressId === sid).map(el => el.expressId);
    if (!ids.length) { toast({ kind: 'warn', msg: 'This level contains no elements' }); return; }
    dispatch({ type: 'isolate', ids, force: true });
    setPlanCut(p => (p.enabled ? { enabled: true, y: levelFloorY(sid) + 1.2 } : p));
    if (frame) viewerRef.current?.frameElements(ids.filter(i => model.byId.get(i).geometry));
  }, [model, toast, levelFloorY]);
  const togglePlanCut = useCallback(() => {
    if (levelId === 'all') return;
    setPlanCut(p => { const next = { enabled: !p.enabled, y: levelFloorY(levelId) + 1.2 }; if (next.enabled) viewerRef.current?.setCameraPreset('top'); return next; });
  }, [levelId, levelFloorY]);
  const onToggleSlabs = useCallback(() => {
    if (!model) return;
    const ids = SLAB_CLASSES.flatMap(c => model.byClass.get(c) || []);
    setSlabsTransparent(on => { dispatch({ type: 'set-opacity-many', ids, opacity: on ? null : 0.15 }); return !on; });
  }, [model]);
  const onFocusGroup = useCallback((group) => {
    if (!model) return;
    const ids = [];
    model.byClass.forEach((list, cls) => { if (classGroupOf(cls) === group) ids.push(...list.filter(id => model.byId.get(id).geometry)); });
    const label = group === 'mep' ? 'MEP' : 'Structure';
    if (!ids.length) { toast({ kind: 'warn', msg: `No ${label} elements in this model` }); return; }
    dispatch({ type: 'isolate', ids, force: true });
    viewerRef.current?.frameElements(ids);
    toast({ kind: 'info', msg: `Isolated ${label}`, sub: plural(ids.length, 'element') });
  }, [model, toast]);
  const onResetFilters = useCallback(() => {
    if (!model) return;
    setLevelId('all'); setPlanCut({ enabled: false, y: 0 });
    if (slabsTransparent) { dispatch({ type: 'set-opacity-many', ids: SLAB_CLASSES.flatMap(c => model.byClass.get(c) || []), opacity: null }); setSlabsTransparent(false); }
    dispatch({ type: 'show-all' }); setExplode(0); viewerRef.current?.frameAll();
  }, [model, slabsTransparent]);
  const onSaveView = useCallback(() => { dispatch({ type: 'save-view', camera: viewerRef.current?.getCameraState() }); toast({ kind: 'ok', msg: 'View saved' }); }, [toast]);
  const onRestoreView = useCallback((view) => { dispatch({ type: 'restore-view', view }); viewerRef.current?.setCameraState(view.camera); }, []);
  const onWorkspace = useCallback((w) => { setShowHome(false); setWorkspace(w); }, []);

  const onSearch = useCallback((q) => {
    if (!model) return;
    if (!q || !q.trim()) { dispatch({ type: 'clear-query' }); return; }
    const { ids, match } = runQuery(model, q);
    dispatch({ type: 'set-query', ids, match });
    if (layout.bottomCollapsed) setLayout(l => ({ ...l, bottomCollapsed: false }));
    setDockFocus('query');
    if (!ids.length) toast({ kind: 'warn', msg: `No matches for “${q}”` });
  }, [model, toast, layout.bottomCollapsed]);

  // ---- Keyboard ---------------------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) { if (model) { e.preventDefault(); searchRef.current?.focus(); } return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || modal) return;
      const sel = [...viewerState.selectedIds];
      const v = viewerRef.current;
      switch (e.key) {
        case 'Escape':
          if (contextMenu) setContextMenu(null);
          else if (measureMode || annoMode) { setMeasureMode(false); setAnnoMode(false); }
          else { dispatch({ type: 'clear-selection' }); setSurfaceId(null); }
          return;
        case '?': setModal('help'); return;
        case 'o': case 'O': onUpload(); return;
        default: break;
      }
      if (!model) return;
      switch (e.key.toLowerCase()) {
        case 'f': if (sel.length) onZoomTo(sel); break;
        case 'h': if (sel.length) dispatch({ type: 'toggle-hide', ids: sel }); break;
        case 'i': if (sel.length) dispatch({ type: 'isolate', ids: sel }); break;
        case 'a': dispatch({ type: 'show-all' }); break;
        case 'm': toggleMeasure(); break;
        case 'p': toggleAnno(); break;
        case 's': toggleSection(); break;
        case 'e': setShowEdges(x => !x); break;
        case 'x': setViewMode(m => (m === 'xray' ? 'shaded' : 'xray')); break;
        case 'w': setViewMode(m => (m === 'wireframe' ? 'shaded' : 'wireframe')); break;
        case '1': v?.setCameraPreset('iso'); break;
        case '2': v?.setCameraPreset('top'); break;
        case '3': v?.setCameraPreset('front'); break;
        case '4': v?.setCameraPreset('back'); break;
        case '5': v?.setCameraPreset('left'); break;
        case '6': v?.setCameraPreset('right'); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [model, modal, contextMenu, measureMode, annoMode, viewerState.selectedIds, onZoomTo, onUpload, toggleMeasure, toggleAnno, toggleSection]);

  // ---- Panel resizing -----------------------------------------------------------------------------------
  const startResize = useCallback((edge, e) => {
    if (!model) return;
    e.preventDefault();
    const body = bodyRef.current;
    const rect = body.getBoundingClientRect();
    const start = { ...layout };
    const sx = e.clientX, sy = e.clientY;
    let latest = start;
    document.body.classList.add('is-resizing');
    const move = (ev) => {
      const next = { ...start };
      if (edge === 'left') next.left = clamp(start.left + ev.clientX - sx, 240, Math.max(240, rect.width - start.right - 420));
      if (edge === 'right') next.right = clamp(start.right - (ev.clientX - sx), 280, Math.max(280, rect.width - start.left - 420));
      if (edge === 'bottom') next.bottom = clamp(start.bottom - (ev.clientY - sy), 120, Math.min(560, rect.height - 200));
      latest = next;
      body.style.setProperty('--left-w', `${next.left}px`);
      body.style.setProperty('--right-w', `${next.right}px`);
      body.style.setProperty('--bottom-h', `${next.bottom}px`);
      viewerRef.current?.scheduleResize();
    };
    const up = () => { document.body.classList.remove('is-resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setLayout(latest); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [model, layout]);
  const toggleBottom = useCallback(() => { setLayout(l => ({ ...l, bottomCollapsed: !l.bottomCollapsed })); setTimeout(() => viewerRef.current?.scheduleResize(), 0); }, []);
  const setViewLayout = useCallback((l) => { setViewLayoutState(l); writeStorage(STORAGE.layoutMode, l); setTimeout(() => viewerRef.current?.scheduleResize(), 0); }, []);
  const layoutSwitch = <LayoutSwitch layout={viewLayout} setLayout={setViewLayout} />;

  const planLevelId = levelId !== 'all' ? Number(levelId) : (planLevel != null ? planLevel : (building ? ((building.levels.find(l => l.spaceIds.length) || building.levels[0] || {}).id) : null));
  const planElement = model ? (
    <PlanView model={model} building={building} levelId={planLevelId} theme={theme}
      onLevelChange={(id) => { setPlanLevel(Number(id)); if (levelId !== 'all') onLevelChange(String(id), { frame: false }); }}
      onSelectElement={(id, e) => (id == null ? dispatch({ type: 'clear-selection' }) : dispatch({ type: 'select', ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }))}
      layoutSwitch={viewLayout === 'plan' ? layoutSwitch : null} selectedIds={viewerState.selectedIds}
      roomColors={analysisLayer.colors && display && display.zoneColors ? display.zoneColors : null}
      legend={display && display.legend ? display.legend.title : null} />
  ) : null;

  const status = {
    location: location.confirmed ? (weather ? 'done' : 'partial') : null,
    bem: tm ? (tm.issues.some(i => i.severity === 'critical') ? 'error' : 'done') : null,
    sim: runs.base ? (runs.base.status === 'done' ? 'done' : runs.base.status === 'failed' ? 'error' : 'partial') : null,
  };
  const chartTabs = useMemo(() => chartDockTabs({ results, weather, tm, zoneKey: selectedZone, ieq, config }), [results, weather, tm, selectedZone, ieq, config.setpoints, config.co2]);
  const dockTabs = !tm ? chartTabs : [...chartTabs, { id: 'validation', label: 'Validation', icon: Icons.Alert, count: issues.filter(i => i.severity === 'critical' || i.severity === 'warning').length, render: () => <div className="pad"><IssueList issues={issues} onSelectIds={selectAndShow} /></div> }];

  const bemProps = { model, tm, bemOptions, setBemOptions, onConvert, converting, config, setConfig, onSelectIds: selectAndShow, compose, weather, location };
  const sidebar = workspace === 'bim' || !model ? (
    <LeftSidebar model={model} viewerState={viewerState} dispatch={dispatch} onPick={onPick} onZoomTo={onZoomTo} onContext={onContext} onSaveView={onSaveView} onRestoreView={onRestoreView} tab={leftTab} setTab={setLeftTab} />
  ) : workspace === 'location' ? (
    <SidePane title="Building location and climate"><LocationPanel model={model} location={location} setLocation={setLocation} toast={toast} /><WeatherPanel location={location} weather={weather} setWeather={setWeatherManual} toast={toast} auto={autoWxProps} /></SidePane>
  ) : workspace === 'bem' ? (
    <SidePane title="BIM-to-BEM conversion"><BemPanel {...bemProps} /></SidePane>
  ) : workspace === 'sim' ? (
    <SidePane title="Energy simulation"><SimulationPanel tm={tm} weather={weather} setWeather={setWeatherManual} toast={toast} autoWeatherState={autoWx} location={location} config={config} setConfig={setConfig} scenarios={scenarios} setScenarios={setScenarios} runs={runs} onRun={runScenario} onRunAll={runAll} activeId={activeId} setActiveId={setActiveId} engineStatus={engineStatus} blocking={blocking} /></SidePane>
  ) : workspace === 'ieq' ? (
    <SidePane title="Indoor environmental quality"><IeqPanel tm={tm} results={results} ieq={ieq} config={config} setConfig={setConfig} location={location} onSelectIds={selectAndShow} /></SidePane>
  ) : workspace === 'env' ? (
    <SidePane title="Solar, wind and climate"><EnvironmentPanel weather={weather} results={results} location={location} tm={tm} /></SidePane>
  ) : workspace === 'results' ? (
    <SidePane title={`Results${results ? ` · ${scenarios.find(s => s.id === activeId)?.name || ''}` : ''}`}><ResultsPanel tm={tm} results={results} runs={runs} scenarios={scenarios} onSelectIds={selectAndShow} /></SidePane>
  ) : (
    <SidePane title="Reports and exports"><ReportsPanel model={model} location={location} weather={weather} tm={tm} config={config} runs={runs} scenarios={scenarios} activeId={activeId} ieq={ieq} issues={issues} toast={toast} /></SidePane>
  );

  const bodyStyle = { '--left-w': `${workspace === 'bim' ? layout.left : Math.max(layout.left, 400)}px`, '--right-w': `${layout.right}px`, '--bottom-h': layout.bottomCollapsed ? '40px' : `${layout.bottom}px` };

  return (
    <div className="app" data-has-model={!!model}>
      <TopBar model={model} workspace={workspace} onWorkspace={onWorkspace} onUpload={onUpload} onLoadSample={loadSample} onClose={onCloseModel} onSearch={onSearch}
        onHome={() => setShowHome(true)} onOpenHelp={() => setModal('help')} theme={theme} onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))} searchRef={searchRef} status={status} />
      <input ref={fileInputRef} type="file" accept=".ifc" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; await loadIfcFile(f); }} />

      <div className="app-body" ref={bodyRef} style={bodyStyle} data-collapsed={layout.bottomCollapsed}>
        {model && (
          <>
            <div className="resize-handle rh-left" role="separator" aria-orientation="vertical" aria-label="Resize left panel" onPointerDown={e => startResize('left', e)} />
            <div className="resize-handle rh-right" role="separator" aria-orientation="vertical" aria-label="Resize inspector" onPointerDown={e => startResize('right', e)} />
            {!layout.bottomCollapsed && <div className="resize-handle rh-bottom" role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel" onPointerDown={e => startResize('bottom', e)} onDoubleClick={() => setLayout(l => ({ ...l, bottom: DEFAULT_LAYOUT.bottom }))} />}
          </>
        )}
        {sidebar}
        <ViewerCanvas
          model={model} viewerRef={viewerRef} viewerState={viewerState} dispatch={dispatch} toast={toast} theme={theme}
          viewMode={viewMode} setViewMode={setViewMode} showEdges={showEdges} setShowEdges={setShowEdges}
          showAxes={showAxes} setShowAxes={setShowAxes} showSpaces={showSpaces} setShowSpaces={setShowSpaces}
          explode={explode} setExplode={setExplode}
          sectionEnabled={sectionEnabled} toggleSection={toggleSection} sectionBox={sectionBox} setSectionBox={setSectionBox}
          measureMode={measureMode} toggleMeasure={toggleMeasure} annoMode={annoMode} toggleAnno={toggleAnno}
          levelId={levelId} onLevelChange={onLevelChange} planCut={planCut} togglePlanCut={togglePlanCut}
          slabsTransparent={slabsTransparent} onToggleSlabs={onToggleSlabs} onFocusGroup={onFocusGroup} onResetFilters={onResetFilters}
          onPickEvent={onPickEvent} onContextEvent={onContextEvent}
          layout={viewLayout} layoutSwitch={layoutSwitch} planElement={planElement}
          display={display} analysisColors={analysisLayer.colors} analysisOpacity={analysisLayer.opacity} analysisSpaces={analysisLayer.spaces} overlay={analysisLayer.overlay}
          displayControls={<DisplayControls mode={displayMode} setMode={setDisplayMode} available={modeAvailable} hourly={hourly} hour={hour} setHour={setHour} time={results && results.time} />}
          hint={displayMode === 'bem' ? 'Click an analytical surface to trace it to its zone and IFC elements.' : null}
        />
        <Inspector model={model} viewerState={viewerState} dispatch={dispatch} onZoomTo={onZoomTo} toast={toast} onSelect={(id) => dispatch({ type: 'select', ids: [id] })}
          renderExtra={(el, open, toggle) => <BemInspectorSection el={el} tm={tm} results={results} surfaceId={surfaceId && tm && tm.surfById.get(surfaceId) && (tm.surfById.get(surfaceId).sourceIds.includes(el.expressId) || tm.surfById.get(surfaceId).spaceId === el.expressId) ? surfaceId : null} onSelectSurface={setSurfaceId} open={open} onToggle={toggle} />} />
        <BottomPanel model={model} viewerState={viewerState} dispatch={dispatch} log={log} onPick={onPick} onZoomTo={onZoomTo} toast={toast}
          collapsed={layout.bottomCollapsed} onToggleCollapsed={toggleBottom} viewerRef={viewerRef} secondaryReady={secondaryReady} extraTabs={dockTabs} focusTab={dockFocus} />
        {(!model || showHome) && !loading && <StartScreen onUpload={onUpload} onLoadFile={loadIfcFile} onLoadSample={loadSample} currentModel={model} onResume={() => setShowHome(false)} />}
        {loading && <LoadingOverlay fileName={loading.fileName} progress={loading.progress} phase={loading.phase} log={log} />}
      </div>

      {modal === 'help' && <HelpPanel onClose={() => setModal(null)} />}
      {model && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} dispatch={dispatch} onZoomTo={onZoomTo} model={model} toast={toast} />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
