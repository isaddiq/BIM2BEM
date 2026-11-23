(() => {
  const SAMPLES = [
    {
      id: "bem-demo-office",
      name: "BEM demo office",
      file: "BEMDemoOffice.ifc",
      url: "assets/ifc/BEMDemoOffice.ifc",
      size: "70 KB",
      facts: "2 storeys, 8 rooms, layered constructions with thermal properties, glazing data, site and true north",
      credit: "Reference model generated for BIM2BEM (IFC4), MIT licence",
      creditUrl: "https://github.com/isaddiq/BIM2BEM/blob/main/scripts/make_sample_bem_office.py",
      bundled: true,
      downloadable: true
    },
    {
      id: "research-centre",
      name: "Research centre",
      file: "ResearchCentre.ifc",
      url: "assets/ifc/ResearchCentre.ifc",
      size: "0.8 MB",
      facts: "4 storeys, 56 rooms, 51 windows; no thermal data (reference constructions apply)",
      credit: "Sample model (IFC4), MIT licence",
      creditUrl: "https://github.com/isaddiq/BIM2BEM/blob/main/LICENSE",
      bundled: true,
      downloadable: true
    },
    {
      id: "large-building",
      name: "Office blocks",
      file: "LargeBuilding.ifc",
      url: "assets/ifc/LargeBuilding.ifc",
      size: "1.3 MB",
      facts: "Revit export (IFC2x3), 8 rooms, declared window and door U-values",
      credit: "BIM Whale samples by Andr\xE9 Wis\xE9n, MIT licence",
      creditUrl: "https://github.com/andrewisen/bim-whale-ifc-samples",
      bundled: true
    }
  ];
  const SOURCE_REPO_URL = "https://github.com/isaddiq/BIM2BEM";
  const AUTHOR_URL = "https://isaddiq.github.io/";
  const SLAB_CLASSES = ["IfcSlab", "IfcSlabStandardCase", "IfcSlabElementedCase", "IfcCovering", "IfcRoof"];
  const uid = () => Math.random().toString(36).slice(2, 9);
  function viewerStateReducer(state, action) {
    switch (action.type) {
      case "select": {
        const ids = action.ids || [];
        if (action.multi) {
          const ns = new Set(state.selectedIds);
          ids.forEach((id) => {
            ns.has(id) ? ns.delete(id) : ns.add(id);
          });
          return { ...state, selectedIds: ns };
        }
        return { ...state, selectedIds: new Set(ids) };
      }
      case "clear-selection":
        return state.selectedIds.size ? { ...state, selectedIds: /* @__PURE__ */ new Set() } : state;
      case "toggle-hide": {
        const ns = new Set(state.hiddenIds);
        const allHidden = action.ids.length > 0 && action.ids.every((id) => ns.has(id));
        action.ids.forEach((id) => {
          allHidden ? ns.delete(id) : ns.add(id);
        });
        return { ...state, hiddenIds: ns };
      }
      case "show-all":
        return { ...state, hiddenIds: /* @__PURE__ */ new Set(), isolatedIds: /* @__PURE__ */ new Set() };
      case "isolate": {
        const ns = new Set(action.ids);
        if (!action.force && state.isolatedIds.size === ns.size && [...ns].every((i) => state.isolatedIds.has(i))) {
          return { ...state, isolatedIds: /* @__PURE__ */ new Set() };
        }
        return { ...state, isolatedIds: ns };
      }
      case "set-color": {
        const m = new Map(state.colorOverrides);
        if (action.color) m.set(action.id, action.color);
        else m.delete(action.id);
        return { ...state, colorOverrides: m };
      }
      case "set-opacity-many": {
        const m = new Map(state.opacityOverrides);
        (action.ids || []).forEach((id) => {
          if (action.opacity != null) m.set(id, action.opacity);
          else m.delete(id);
        });
        return { ...state, opacityOverrides: m };
      }
      case "set-query":
        return { ...state, queryResults: action.ids, queryMatchText: action.match || {} };
      case "clear-query":
        return { ...state, queryResults: [], queryMatchText: {} };
      case "save-view": {
        const view = {
          id: uid(),
          name: action.name || `View ${state.savedViews.length + 1}`,
          timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          camera: action.camera,
          hiddenIds: [...state.hiddenIds],
          isolatedIds: [...state.isolatedIds]
        };
        return { ...state, savedViews: [...state.savedViews, view] };
      }
      case "restore-view":
        return { ...state, hiddenIds: new Set(action.view.hiddenIds), isolatedIds: new Set(action.view.isolatedIds) };
      case "delete-view":
        return { ...state, savedViews: state.savedViews.filter((v) => v.id !== action.id) };
      case "save-set":
        return { ...state, selectionSets: [...state.selectionSets, { id: uid(), name: action.name || `Set ${state.selectionSets.length + 1}`, ids: [...state.selectedIds] }] };
      case "restore-set": {
        const s = state.selectionSets.find((x) => x.id === action.id);
        return s ? { ...state, selectedIds: new Set(s.ids) } : state;
      }
      case "delete-set":
        return { ...state, selectionSets: state.selectionSets.filter((s) => s.id !== action.id) };
      case "add-anno":
        return { ...state, annotations: [...state.annotations, action.anno] };
      case "delete-anno":
        return { ...state, annotations: state.annotations.filter((a) => a.id !== action.id) };
      case "update-anno":
        return { ...state, annotations: state.annotations.map((a) => a.id === action.id ? { ...a, ...action.patch } : a) };
      case "add-measure":
        return { ...state, measurements: [...state.measurements, action.measure] };
      case "delete-measure":
        return { ...state, measurements: state.measurements.filter((m) => m.id !== action.id) };
      case "clear-measures":
        return { ...state, measurements: [] };
      case "reset":
        return initialViewerState();
      default:
        return state;
    }
  }
  function initialViewerState() {
    return {
      selectedIds: /* @__PURE__ */ new Set(),
      hiddenIds: /* @__PURE__ */ new Set(),
      isolatedIds: /* @__PURE__ */ new Set(),
      colorOverrides: /* @__PURE__ */ new Map(),
      opacityOverrides: /* @__PURE__ */ new Map(),
      queryResults: [],
      queryMatchText: {},
      savedViews: [],
      selectionSets: [],
      annotations: [],
      measurements: []
    };
  }
  const STORAGE = { layout: "bim2bem-layout-v1", theme: "bim2bem-theme", layoutMode: "bim2bem-view-layout", autoWeather: "bim2bem-auto-weather" };
  const DEFAULT_LAYOUT = { left: 344, right: 360, bottom: 260, bottomCollapsed: false };
  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
    }
  }
  function initialLayout() {
    try {
      const p = JSON.parse(readStorage(STORAGE.layout) || "null");
      if (!p) return DEFAULT_LAYOUT;
      return {
        left: clamp(Number(p.left) || DEFAULT_LAYOUT.left, 240, 520),
        right: clamp(Number(p.right) || DEFAULT_LAYOUT.right, 280, 620),
        bottom: clamp(Number(p.bottom) || DEFAULT_LAYOUT.bottom, 120, 480),
        bottomCollapsed: !!p.bottomCollapsed
      };
    } catch (e) {
      return DEFAULT_LAYOUT;
    }
  }
  function initialTheme() {
    const saved = readStorage(STORAGE.theme);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function runQuery(model, q) {
    const query = q.trim();
    if (!query) return { ids: [], match: {} };
    const lower = query.toLowerCase();
    const ids = [];
    const matchText = {};
    const colon = query.indexOf(":");
    const key = colon > 0 && colon < query.length - 1 ? query.slice(0, colon).trim().toLowerCase() : null;
    const val = key ? query.slice(colon + 1).trim().toLowerCase() : null;
    const exprMatch = /^[#@](\d+)$/.exec(query);
    const findProp = (sets, suffix) => {
      for (const ps of sets) for (const p of ps.properties) {
        if (p.name.toLowerCase() === key && String(p.value).toLowerCase().includes(val)) return `${ps.name}.${p.name} = ${p.value}${suffix}`;
      }
      return null;
    };
    model.elements.forEach((el) => {
      if (el.isType) return;
      let m = null;
      if (exprMatch) {
        if (String(el.expressId) === exprMatch[1]) m = `Express ID #${el.expressId}`;
      } else if (key) {
        m = findProp(el.propertySets, "") || findProp(el.quantitySets, "");
        const t = !m && el.typeExpressId ? model.byId.get(el.typeExpressId) : null;
        if (t) m = findProp(t.propertySets, " (type)");
      } else if (el.ifcClass.toLowerCase().includes(lower)) m = `Class ${el.ifcClass}`;
      else if ((el.name || "").toLowerCase().includes(lower)) m = `Name ${el.name}`;
      else if ((el.longName || "").toLowerCase().includes(lower)) m = `Long name ${el.longName}`;
      else if ((el.globalId || "").toLowerCase().includes(lower)) m = `GlobalId ${el.globalId}`;
      else if ((el.objectType || "").toLowerCase().includes(lower)) m = `Object type ${el.objectType}`;
      else if ((el.tag || "").toLowerCase().includes(lower)) m = `Tag ${el.tag}`;
      else if (el.storey && (el.storey.name || "").toLowerCase().includes(lower)) m = `Storey ${el.storey.name}`;
      else if (el.materials.some((x) => x.name.toLowerCase().includes(lower))) m = `Material ${el.materials.find((x) => x.name.toLowerCase().includes(lower)).name}`;
      else if (el.classifications.some((c) => (c.code + " " + c.name).toLowerCase().includes(lower))) m = "Classification";
      if (m) {
        ids.push(el.expressId);
        matchText[el.expressId] = m;
      }
    });
    return { ids, match: matchText };
  }
  const SEARCH_EXAMPLES = [
    ["IfcDoor", "every element of a class"],
    ["Bedroom", "names, long names, tags"],
    ["#1234", "an express ID"],
    ["IsExternal:true", "a property value (inspected elements)"]
  ];
  function BrandMark({ size = 30 }) {
    return /* @__PURE__ */ React.createElement("img", { className: "brand-mark", src: "assets/logos/bim2bem-icon.png", width: size, height: size, alt: "", "aria-hidden": "true" });
  }
  const WORKSPACES = [
    { id: "bim", label: "BIM Model", icon: "Cube" },
    { id: "location", label: "Location", icon: "MapPin" },
    { id: "bem", label: "BEM Conversion", icon: "Zap" },
    { id: "sim", label: "Energy Simulation", icon: "Play" },
    { id: "ieq", label: "IEQ Analysis", icon: "Thermometer" },
    { id: "env", label: "Environment", icon: "Wind" },
    { id: "results", label: "Results", icon: "Chart" },
    { id: "reports", label: "Reports", icon: "Report" }
  ];
  function WorkspaceSwitch({ value, onChange, disabled, status }) {
    return /* @__PURE__ */ React.createElement("nav", { className: "ws-switch", "aria-label": "Workflow" }, WORKSPACES.map((w) => {
      const Icon = Icons[w.icon];
      return /* @__PURE__ */ React.createElement("button", { key: w.id, type: "button", className: "ws-btn", "aria-current": value === w.id ? "page" : void 0, disabled: disabled && w.id !== "bim", title: w.label, onClick: () => onChange(w.id) }, /* @__PURE__ */ React.createElement("span", { className: "ws-icon" }, /* @__PURE__ */ React.createElement(Icon, { size: 15 })), /* @__PURE__ */ React.createElement("span", { className: "ws-label" }, w.label), status[w.id] && /* @__PURE__ */ React.createElement("span", { className: "ws-dot", "data-state": status[w.id], "aria-label": status[w.id] }));
    }));
  }
  function TopBar({ model, workspace, onWorkspace, onUpload, onLoadSample, onClose, onSearch, onOpenHelp, theme, onToggleTheme, searchRef, onHome, status }) {
    const [q, setQ] = useState("");
    const [focused, setFocused] = useState(false);
    const [menu, setMenu] = useState(false);
    const menuRef = useRef(null);
    useEffect(() => {
      if (!menu) return;
      const close = (e) => {
        var _a;
        if (!((_a = menuRef.current) == null ? void 0 : _a.contains(e.target))) setMenu(false);
      };
      const esc = (e) => {
        if (e.key === "Escape") setMenu(false);
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", esc);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", esc);
      };
    }, [menu]);
    const submit = (value) => {
      setQ(value);
      onSearch(value);
    };
    return /* @__PURE__ */ React.createElement("header", { className: "topbar" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "brand", onClick: onHome, "aria-label": "BIM2BEM start page", title: "Start page" }, /* @__PURE__ */ React.createElement(BrandMark, null), /* @__PURE__ */ React.createElement("span", { className: "brand-name" }, "BIM", /* @__PURE__ */ React.createElement("span", { className: "brand-two" }, "2"), "BEM")), /* @__PURE__ */ React.createElement(WorkspaceSwitch, { value: workspace, onChange: onWorkspace, disabled: !model, status }), /* @__PURE__ */ React.createElement("div", { className: "topbar-spacer" }), model && /* @__PURE__ */ React.createElement("div", { className: "file-chip", title: `${model.fileName} \xB7 ${formatSize(model.fileSize)}` }, /* @__PURE__ */ React.createElement(Icons.Building, { size: 15 }), /* @__PURE__ */ React.createElement("span", { className: "file-name" }, model.fileName), /* @__PURE__ */ React.createElement("span", { className: "file-meta mono" }, model.schemaVersion), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Close model", size: 13, className: "sm", onClick: onClose })), /* @__PURE__ */ React.createElement("div", { className: "search", "data-disabled": !model }, /* @__PURE__ */ React.createElement(Icons.Search, { size: 15 }), /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: searchRef,
        type: "search",
        "aria-label": "Search the model",
        placeholder: "Search the model\u2026",
        value: q,
        disabled: !model,
        onFocus: () => setFocused(true),
        onBlur: () => setTimeout(() => setFocused(false), 150),
        onChange: (e) => setQ(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") onSearch(q);
          if (e.key === "Escape") {
            setQ("");
            onSearch("");
            e.currentTarget.blur();
          }
        }
      }
    ), q ? /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Clear search", size: 13, className: "sm", onClick: () => submit("") }) : /* @__PURE__ */ React.createElement("kbd", null, "Ctrl K"), focused && !q && model && /* @__PURE__ */ React.createElement("div", { className: "search-hints", role: "listbox", "aria-label": "Search examples" }, SEARCH_EXAMPLES.map(([ex, what]) => /* @__PURE__ */ React.createElement("button", { key: ex, type: "button", role: "option", onMouseDown: (e) => {
      e.preventDefault();
      submit(ex);
    } }, /* @__PURE__ */ React.createElement("code", null, ex), /* @__PURE__ */ React.createElement("span", null, what))))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary", onClick: onUpload }, /* @__PURE__ */ React.createElement(Icons.Upload, { size: 15 }), " Open IFC"), /* @__PURE__ */ React.createElement("div", { className: "topbar-tools" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Activity, label: "Visitor statistics", "aria-controls": "vc-popover", onClick: () => {
      var _a;
      return (_a = document.getElementById("vc-popover")) == null ? void 0 : _a.classList.toggle("vc-open");
    } }), /* @__PURE__ */ React.createElement(IconButton, { icon: theme === "dark" ? Icons.Sun : Icons.Moon, label: theme === "dark" ? "Use light theme" : "Use dark theme", onClick: onToggleTheme }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Help, label: "Shortcuts and help", shortcut: "?", onClick: onOpenHelp }), /* @__PURE__ */ React.createElement("div", { className: "menu-anchor", ref: menuRef }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.More, label: "More", "aria-haspopup": "menu", "aria-expanded": menu, onClick: () => setMenu((v) => !v) }), menu && /* @__PURE__ */ React.createElement("div", { className: "menu", role: "menu" }, SAMPLES.map((smp) => /* @__PURE__ */ React.createElement("button", { key: smp.id, type: "button", role: "menuitem", onClick: () => {
      setMenu(false);
      onLoadSample(smp);
    } }, /* @__PURE__ */ React.createElement(Icons.Cube, { size: 15 }), " Open sample: ", smp.name)), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("a", { role: "menuitem", href: SOURCE_REPO_URL, target: "_blank", rel: "noopener noreferrer" }, /* @__PURE__ */ React.createElement(Icons.Github, { size: 15 }), " Source code ", /* @__PURE__ */ React.createElement(Icons.External, { size: 12, className: "trail" })), /* @__PURE__ */ React.createElement("a", { role: "menuitem", href: AUTHOR_URL, target: "_blank", rel: "noopener noreferrer" }, /* @__PURE__ */ React.createElement(Icons.Globe, { size: 15 }), " Author ", /* @__PURE__ */ React.createElement(Icons.External, { size: 12, className: "trail" }))))));
  }
  function NavCubeHost({ viewerRef, ready, theme }) {
    const hostRef = useRef(null);
    const cubeRef = useRef(null);
    useEffect(() => {
      if (!ready || !viewerRef.current || !hostRef.current) return;
      cubeRef.current = new NavCube(hostRef.current, viewerRef.current, { theme });
      return () => {
        cubeRef.current && cubeRef.current.dispose();
        cubeRef.current = null;
      };
    }, [ready]);
    useEffect(() => {
      cubeRef.current && cubeRef.current.setTheme(theme);
    }, [theme]);
    const v = viewerRef.current;
    return /* @__PURE__ */ React.createElement("div", { className: "navcube" }, /* @__PURE__ */ React.createElement("div", { className: "navcube-host", ref: hostRef }), /* @__PURE__ */ React.createElement("div", { className: "navcube-actions" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Home, label: "Fit model, isometric view", size: 15, onClick: () => v == null ? void 0 : v.frameAll({ resetView: true }) }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.PlanCut, label: "Top view", size: 15, onClick: () => v == null ? void 0 : v.setCameraPreset("top") }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Plus, label: "Zoom in", size: 15, onClick: () => v == null ? void 0 : v.zoomIn() }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Minus, label: "Zoom out", size: 15, onClick: () => v == null ? void 0 : v.zoomOut() })));
  }
  function SectionBoxControls({ box, bounds, onChange, onReset, onClose }) {
    const size = { x: Math.max(bounds.xMax - bounds.xMin, 1e-3), y: Math.max(bounds.yMax - bounds.yMin, 1e-3), z: Math.max(bounds.zMax - bounds.zMin, 1e-3) };
    const sides = [
      { k: "left", label: "Left", axis: "x", edge: "min", opp: "right" },
      { k: "right", label: "Right", axis: "x", edge: "max", opp: "left" },
      { k: "bottom", label: "Bottom", axis: "y", edge: "min", opp: "top" },
      { k: "top", label: "Top", axis: "y", edge: "max", opp: "bottom" },
      { k: "back", label: "Back", axis: "z", edge: "min", opp: "front" },
      { k: "front", label: "Front", axis: "z", edge: "max", opp: "back" }
    ];
    const cut = (s) => (s.edge === "min" ? box[`${s.axis}Min`] - bounds[`${s.axis}Min`] : bounds[`${s.axis}Max`] - box[`${s.axis}Max`]) / size[s.axis];
    const update = (s, raw) => {
      const opp = sides.find((o) => o.k === s.opp);
      const c = clamp((parseFloat(raw) || 0) / 100, 0, Math.max(0, 0.96 - cut(opp)));
      const next = { ...box };
      if (s.edge === "min") next[`${s.axis}Min`] = bounds[`${s.axis}Min`] + size[s.axis] * c;
      else next[`${s.axis}Max`] = bounds[`${s.axis}Max`] - size[s.axis] * c;
      onChange(next);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "hud-card section-card" }, /* @__PURE__ */ React.createElement("div", { className: "hud-card-head" }, /* @__PURE__ */ React.createElement("span", null, "Section box"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: onReset }, "Reset"), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Close section box", size: 13, className: "sm", onClick: onClose })), /* @__PURE__ */ React.createElement("p", { className: "hud-hint" }, "Drag a face of the box in the view, or trim each side here."), sides.map((s) => {
      const pct = Math.round(cut(s) * 100);
      return /* @__PURE__ */ React.createElement("label", { className: "slider-row", key: s.k }, /* @__PURE__ */ React.createElement("span", null, s.label), /* @__PURE__ */ React.createElement("input", { type: "range", min: "0", max: "95", step: "1", value: pct, onChange: (e) => update(s, e.target.value) }), /* @__PURE__ */ React.createElement("span", { className: "mono" }, pct, "%"));
    }));
  }
  function DisplayControls({ mode, setMode, available, hourly, hour, setHour, time }) {
    const groups = [...new Set(DISPLAY_MODES.map((m) => m.group))];
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "quick-select display-select" }, /* @__PURE__ */ React.createElement(Icons.Paint, { size: 15 }), /* @__PURE__ */ React.createElement("select", { "aria-label": "Display", value: mode, onChange: (e) => setMode(e.target.value) }, groups.map((g) => /* @__PURE__ */ React.createElement("optgroup", { key: g, label: g }, DISPLAY_MODES.filter((m) => m.group === g).map((m) => /* @__PURE__ */ React.createElement("option", { key: m.id, value: m.id, disabled: !available(m) }, m.label)))))), hourly && time && /* @__PURE__ */ React.createElement("label", { className: "hour-slider", title: `Hour of the simulation: ${hourLabel(time, hour)}` }, /* @__PURE__ */ React.createElement("input", { type: "range", min: "0", max: time.n - 1, step: "1", value: hour, onChange: (e) => setHour(Number(e.target.value)), "aria-label": "Simulation hour", "aria-valuetext": hourLabel(time, hour) }), /* @__PURE__ */ React.createElement("span", { className: "mono" }, hourLabel(time, hour, true), " ", String(time.hour[hour] - 1).padStart(2, "0"), "\u2013", String(time.hour[hour]).padStart(2, "0"), " h")));
  }
  function ViewerCanvas(props) {
    var _a;
    const {
      model,
      viewerRef,
      viewerState,
      dispatch,
      toast,
      theme,
      viewMode,
      setViewMode,
      showEdges,
      setShowEdges,
      showAxes,
      setShowAxes,
      showSpaces,
      setShowSpaces,
      explode,
      setExplode,
      sectionEnabled,
      toggleSection,
      sectionBox,
      setSectionBox,
      measureMode,
      toggleMeasure,
      annoMode,
      toggleAnno,
      levelId,
      onLevelChange,
      planCut,
      togglePlanCut,
      slabsTransparent,
      onToggleSlabs,
      onFocusGroup,
      onResetFilters,
      onPickEvent,
      onContextEvent,
      hint,
      layout,
      layoutSwitch,
      planElement,
      display,
      displayControls,
      analysisColors,
      analysisOpacity,
      analysisSpaces,
      overlay
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
      const v2 = new ThreeViewer(hostRef.current);
      viewerRef.current = v2;
      window.__viewer = v2;
      const offs = [
        v2.on("pick", (e) => handlers.current.onPickEvent(e)),
        v2.on("context", (e) => handlers.current.onContextEvent(e)),
        v2.on("hover", (e) => setHover(e.expressId != null && e.x != null ? e : null)),
        v2.on("measure", (m) => {
          handlers.current.dispatch({ type: "add-measure", measure: { id: m.id, a: m.a.toArray(), b: m.b.toArray(), distance: m.distance, dx: m.dx, dy: m.dy, dz: m.dz } });
          handlers.current.toast({ kind: "ok", msg: `Measured ${m.distance.toFixed(3)} m`, sub: "Listed under Markup" });
        }),
        v2.on("sectionBox", ({ box }) => setSectionBox(box)),
        v2.on("anno", (e) => {
          handlers.current.dispatch({ type: "add-anno", anno: { id: uid(), position: e.position.toArray(), elementId: e.elementId, title: "New issue", description: "", status: "open", priority: "medium", timestamp: (/* @__PURE__ */ new Date()).toLocaleString() } });
          handlers.current.toast({ kind: "info", msg: "Issue pinned", sub: "Edit it under Markup" });
        }),
        v2.on("camera", () => {
          if (hasLabels.current) setFrame((f) => (f + 1) % 1e6);
        })
      ];
      setReady(true);
      return () => {
        offs.forEach((off) => off());
        v2.dispose();
        viewerRef.current = null;
        window.__viewer = null;
      };
    }, []);
    useEffect(() => {
      const v2 = viewerRef.current;
      if (!v2) return;
      if (!model) {
        v2.clearModel();
        setModelBounds(null);
        return;
      }
      let cancelled = false;
      setModelBounds(null);
      v2.loadModel(model).then(() => {
        if (!cancelled) setModelBounds(v2.getModelBounds());
      });
      return () => {
        cancelled = true;
      };
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
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setSelection(viewerState.selectedIds);
    }, [viewerState.selectedIds, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setHidden(viewerState.hiddenIds);
    }, [viewerState.hiddenIds, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setIsolated(viewerState.isolatedIds);
    }, [viewerState.isolatedIds, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setColorOverrides(colors);
    }, [colors, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setOpacityOverrides(opacities);
    }, [opacities, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setViewMode(viewMode);
    }, [viewMode, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setShowEdges(showEdges);
    }, [showEdges, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setShowAxes(showAxes);
    }, [showAxes]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setSpacesVisible(showSpaces || !!analysisSpaces);
    }, [showSpaces, analysisSpaces, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setExplode(explode);
    }, [explode, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setSectionBox(sectionEnabled, sectionBox, modelBounds);
    }, [sectionEnabled, sectionBox, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setPlanCut(planCut);
    }, [planCut, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setMeasureMode(measureMode);
    }, [measureMode]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setAnnotationMode(annoMode);
    }, [annoMode]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setTheme(theme);
    }, [theme]);
    useEffect(() => {
      const v2 = viewerRef.current;
      if (!v2) return;
      if (overlay && modelBounds) v2.setOverlay("bem", overlay, { pickable: true });
      else v2.removeOverlay("bem");
    }, [overlay, modelBounds]);
    const v = viewerRef.current;
    const project = (arr) => v ? v.worldToScreen(new THREE.Vector3().fromArray(arr)) : { behind: true };
    const hoverEl = hover && model && !hover.overlay ? model.byId.get(hover.expressId) : null;
    const hostRect = (_a = hostRef.current) == null ? void 0 : _a.getBoundingClientRect();
    const toolHint = measureMode ? "Click two points to measure. Esc to stop." : annoMode ? "Click an element to pin an issue. Esc to stop." : planCut.enabled ? "Plan cut: geometry above the level is hidden." : null;
    const sel = viewerState.selectedIds.size > 0;
    return /* @__PURE__ */ React.createElement("div", { className: "viewer-region", "data-layout": model ? layout : "3d" }, /* @__PURE__ */ React.createElement("div", { className: "viewer-wrap", ref: hostRef }, model && /* @__PURE__ */ React.createElement("div", { className: "hud" }, /* @__PURE__ */ React.createElement("div", { className: "viewbar", role: "toolbar", "aria-label": "View" }, /* @__PURE__ */ React.createElement("label", { className: "quick-select" }, /* @__PURE__ */ React.createElement(Icons.Layers, { size: 15 }), /* @__PURE__ */ React.createElement("select", { "aria-label": "Level", value: levelId, onChange: (e) => onLevelChange(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "All levels"), model.storeys.map((s) => /* @__PURE__ */ React.createElement("option", { key: s.expressId, value: s.expressId }, s.name || s.longName || `Storey #${s.expressId}`)))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "chip-btn", "aria-pressed": planCut.enabled, disabled: levelId === "all", title: levelId === "all" ? "Choose a level to cut a floor plan" : "Cut the model 1.2 m above the floor", onClick: togglePlanCut }, /* @__PURE__ */ React.createElement(Icons.PlanCut, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "Cut")), /* @__PURE__ */ React.createElement("span", { className: "quick-sep" }), displayControls, /* @__PURE__ */ React.createElement("span", { className: "quick-sep" }), layoutSwitch), /* @__PURE__ */ React.createElement(NavCubeHost, { viewerRef, ready, theme }), (toolHint || hint || display && display.unavailable) && /* @__PURE__ */ React.createElement("div", { className: "status-chip", role: "status" }, /* @__PURE__ */ React.createElement("span", { className: "dot", "data-tone": display && display.unavailable ? "warn" : "accent" }), toolHint || display && display.unavailable || hint), display && display.legend && /* @__PURE__ */ React.createElement(DisplayLegend, { legend: display.legend, theme }), sectionEnabled && modelBounds && sectionBox && /* @__PURE__ */ React.createElement(SectionBoxControls, { box: sectionBox, bounds: modelBounds, onChange: setSectionBox, onReset: () => setSectionBox({ ...modelBounds }), onClose: toggleSection }), viewerState.measurements.map((m) => {
      const mid = m.a.map((x, i) => (x + m.b[i]) / 2);
      const s = project(mid);
      return s.behind ? null : /* @__PURE__ */ React.createElement("div", { key: m.id, className: "measure-label mono", style: { left: s.x, top: s.y } }, m.distance.toFixed(2), " m");
    }), viewerState.annotations.map((a, i) => {
      const s = project(a.position);
      return s.behind ? null : /* @__PURE__ */ React.createElement("button", { key: a.id, type: "button", className: "anno-pin", "data-status": a.status, style: { left: s.x, top: s.y }, title: a.title, onClick: () => a.elementId != null && dispatch({ type: "select", ids: [a.elementId] }) }, /* @__PURE__ */ React.createElement("span", null, i + 1));
    }), hoverEl && hostRect && !measureMode && !annoMode && /* @__PURE__ */ React.createElement("div", { className: "hover-tip", style: { left: hover.x - hostRect.left + 14, top: hover.y - hostRect.top + 16 } }, /* @__PURE__ */ React.createElement("span", { className: "mono tip-class" }, hoverEl.ifcClass), /* @__PURE__ */ React.createElement("span", { className: "tip-name" }, elementLabel(hoverEl))), /* @__PURE__ */ React.createElement("div", { className: "dock", role: "toolbar", "aria-label": "View tools" }, /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Home, label: "Fit model", onClick: () => v == null ? void 0 : v.frameAll() }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Focus, label: "Zoom to selection", shortcut: "F", disabled: !sel, onClick: () => v == null ? void 0 : v.frameElements([...viewerState.selectedIds]) })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Eye, label: "Show everything", shortcut: "A", onClick: () => dispatch({ type: "show-all" }) }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.EyeOff, label: "Hide selection", shortcut: "H", disabled: !sel, onClick: () => dispatch({ type: "toggle-hide", ids: [...viewerState.selectedIds] }) }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Isolate, label: "Isolate selection", shortcut: "I", disabled: !sel, onClick: () => dispatch({ type: "isolate", ids: [...viewerState.selectedIds] }) })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Section, label: "Section box", shortcut: "S", active: sectionEnabled, onClick: toggleSection }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Ruler, label: "Measure distance", shortcut: "M", active: measureMode, onClick: toggleMeasure }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Pin, label: "Pin an issue", shortcut: "P", active: annoMode, onClick: toggleAnno })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement("div", { className: "seg", role: "group", "aria-label": "Display mode" }, /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": viewMode === "shaded", title: "Shaded", onClick: () => setViewMode("shaded") }, /* @__PURE__ */ React.createElement(Icons.Shaded, { size: 16 }), /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "Shaded")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": viewMode === "xray", title: "X-ray (X)", onClick: () => setViewMode("xray") }, /* @__PURE__ */ React.createElement(Icons.Xray, { size: 16 }), /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "X-ray")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": viewMode === "wireframe", title: "Wireframe (W)", onClick: () => setViewMode("wireframe") }, /* @__PURE__ */ React.createElement(Icons.Wireframe, { size: 16 }), /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "Wireframe"))), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Edges, label: "Edge lines", shortcut: "E", active: showEdges, onClick: () => setShowEdges((x) => !x) })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(
      LayersPopover,
      {
        model,
        viewerState,
        dispatch,
        showSpaces,
        setShowSpaces,
        slabsTransparent,
        onToggleSlabs,
        onFocusGroup,
        onResetFilters,
        explode,
        setExplode,
        showAxes,
        setShowAxes
      }
    ), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Camera, label: "Save a screenshot", onClick: () => {
      const url = v.screenshot();
      const a = document.createElement("a");
      a.href = url;
      a.download = `${model.fileName.replace(/\.[^.]+$/, "")}-view.png`;
      a.click();
      toast({ kind: "ok", msg: "Screenshot saved" });
    } }))))), model && layout !== "3d" && planElement);
  }
  function LayersPopover({ model, viewerState, dispatch, showSpaces, setShowSpaces, slabsTransparent, onToggleSlabs, onFocusGroup, onResetFilters, explode, setExplode, showAxes, setShowAxes }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const close = useCallback(() => setOpen(false), []);
    const groups = useMemo(() => {
      const byGroup = /* @__PURE__ */ new Map();
      model.byClass.forEach((ids, cls) => {
        if (cls === "IfcSpace") return;
        const g = classGroupOf(cls);
        const withGeo = ids.filter((id) => {
          const el = model.byId.get(id);
          return el && !el.isType && el.geometry;
        });
        if (!withGeo.length) return;
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(...withGeo);
      });
      return CLASS_GROUPS.filter((g) => byGroup.has(g.id)).map((g) => ({ id: g.id, name: g.name, ids: byGroup.get(g.id) }));
    }, [model]);
    const hidden = viewerState.hiddenIds;
    const groupHidden = (g) => g.ids.length > 0 && g.ids.every((id) => hidden.has(id));
    const anyGroupHidden = groups.some(groupHidden);
    const active = showSpaces || slabsTransparent || explode > 0 || anyGroupHidden;
    return /* @__PURE__ */ React.createElement("div", { className: "menu-anchor" }, /* @__PURE__ */ React.createElement("button", { ref, type: "button", className: "icon-btn dock-layers", "data-active": active ? "true" : void 0, "aria-expanded": open, "aria-label": "Layers and filters", title: "Layers and filters", onClick: () => setOpen((o) => !o) }, /* @__PURE__ */ React.createElement(Icons.Layers, { size: 16 })), /* @__PURE__ */ React.createElement(FloatingPanel, { anchorRef: ref, open, onClose: close, placement: "corner", className: "menu layers-pop", label: "Layers and filters" }, /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, "Show"), /* @__PURE__ */ React.createElement("label", { className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: showSpaces, onChange: () => setShowSpaces((x) => !x) }), " Room volumes"), /* @__PURE__ */ React.createElement("label", { className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: slabsTransparent, onChange: onToggleSlabs }), " See-through slabs and roofs"), /* @__PURE__ */ React.createElement("label", { className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: showAxes, onChange: () => setShowAxes((x) => !x) }), " Axes"), groups.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, "Filter by category"), groups.map((g) => /* @__PURE__ */ React.createElement("label", { key: g.id, className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !groupHidden(g), onChange: () => dispatch({ type: "toggle-hide", ids: g.ids }) }), /* @__PURE__ */ React.createElement("span", { className: "menu-check-label" }, g.name), /* @__PURE__ */ React.createElement("span", { className: "mono muted trail" }, g.ids.length.toLocaleString())))), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, "Isolate"), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: () => {
      onFocusGroup("structure");
      setOpen(false);
    } }, /* @__PURE__ */ React.createElement(Icons.Building, { size: 15 }), " Structure"), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: () => {
      onFocusGroup("mep");
      setOpen(false);
    } }, /* @__PURE__ */ React.createElement(Icons.Activity, { size: 15 }), " MEP"), model.storeys.length > 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("label", { className: "slider-row menu-slider" }, /* @__PURE__ */ React.createElement("span", null, "Explode levels"), /* @__PURE__ */ React.createElement("input", { type: "range", min: "0", max: "1", step: "0.01", value: explode, onChange: (e) => setExplode(parseFloat(e.target.value)) }), /* @__PURE__ */ React.createElement("span", { className: "mono" }, Math.round(explode * 100), "%"))), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: () => {
      onResetFilters();
      setOpen(false);
    } }, /* @__PURE__ */ React.createElement(Icons.Reset, { size: 15 }), " Reset view filters")));
  }
  function LayoutSwitch({ layout, setLayout }) {
    return /* @__PURE__ */ React.createElement("div", { className: "seg layout-seg", role: "group", "aria-label": "Layout" }, /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": layout === "3d", title: "3D model only", onClick: () => setLayout("3d") }, /* @__PURE__ */ React.createElement(Icons.Cube, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "3D")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": layout === "split", title: "3D model and 2D floor plan side by side", onClick: () => setLayout("split") }, /* @__PURE__ */ React.createElement(Icons.Columns, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "3D + 2D")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": layout === "plan", title: "2D floor plan only", onClick: () => setLayout("plan") }, /* @__PURE__ */ React.createElement(Icons.Plan, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "2D")));
  }
  function LoadingOverlay({ fileName, progress, phase, log }) {
    const recent = log.slice(-5);
    return /* @__PURE__ */ React.createElement("div", { className: "load-overlay", role: "status", "aria-live": "polite" }, /* @__PURE__ */ React.createElement("div", { className: "load-card" }, /* @__PURE__ */ React.createElement("div", { className: "load-head" }, /* @__PURE__ */ React.createElement("span", { className: "spinner" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", null, "Opening ", fileName), /* @__PURE__ */ React.createElement("div", { className: "sub" }, phase || "Starting")), /* @__PURE__ */ React.createElement("span", { className: "mono load-pct" }, Math.round(progress * 100), "%")), /* @__PURE__ */ React.createElement("div", { className: "load-bar" }, /* @__PURE__ */ React.createElement("div", { style: { width: `${Math.max(2, progress * 100)}%` } })), /* @__PURE__ */ React.createElement("ul", { className: "load-log" }, recent.map((l, i) => /* @__PURE__ */ React.createElement("li", { key: i, className: l.level, dangerouslySetInnerHTML: { __html: l.msg } })))));
  }
  function HelpPanel({ onClose }) {
    const groups = [
      ["Camera", [["Left drag", "Orbit"], ["Right drag, Shift + drag", "Pan"], ["Wheel", "Zoom toward the cursor"], ["Double-click", "Zoom to element"], ["1 to 6", "Iso, top, front, back, left, right"], ["F", "Zoom to selection"]]],
      ["Selection", [["Click", "Select"], ["Ctrl + click", "Add to selection"], ["H / I / A", "Hide, isolate, show all"], ["Esc", "Stop the tool, then clear selection"], ["Right-click", "Context menu"]]],
      ["Tools", [["S", "Section box"], ["M", "Measure"], ["P", "Pin an issue"], ["E", "Edge lines"], ["X / W", "X-ray, wireframe"], ["Ctrl + K", "Search"], ["O", "Open a file"]]]
    ];
    return /* @__PURE__ */ React.createElement(Modal, { title: "Shortcuts and controls", onClose }, /* @__PURE__ */ React.createElement("div", { className: "help-grid" }, groups.map(([title, rows]) => /* @__PURE__ */ React.createElement("div", { key: title }, /* @__PURE__ */ React.createElement("h4", null, title), rows.map(([k, l]) => /* @__PURE__ */ React.createElement("div", { key: k, className: "help-row" }, /* @__PURE__ */ React.createElement("span", null, l), /* @__PURE__ */ React.createElement("kbd", null, k)))))), /* @__PURE__ */ React.createElement("p", { className: "pane-note" }, "On touch screens, drag with one finger to orbit and pinch with two to zoom and pan."));
  }
  function ToastContainer({ toasts, onDismiss }) {
    return /* @__PURE__ */ React.createElement("div", { className: "toasts", "aria-live": "polite" }, toasts.map((t) => /* @__PURE__ */ React.createElement("div", { key: t.id, className: "toast", "data-kind": t.kind || "info" }, /* @__PURE__ */ React.createElement("span", { className: "toast-ic" }, t.kind === "ok" ? /* @__PURE__ */ React.createElement(Icons.Check, { size: 14 }) : t.kind === "info" ? /* @__PURE__ */ React.createElement(Icons.Info, { size: 14 }) : /* @__PURE__ */ React.createElement(Icons.Alert, { size: 14 })), /* @__PURE__ */ React.createElement("div", { className: "toast-msg" }, /* @__PURE__ */ React.createElement("div", null, t.msg), t.sub && /* @__PURE__ */ React.createElement("div", { className: "sub" }, t.sub)), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Dismiss", size: 12, className: "sm", onClick: () => onDismiss(t.id) }))));
  }
  const useLayoutEffectSafe = React.useLayoutEffect;
  function StartScreen({ onUpload, onLoadFile, onLoadSample, currentModel, onResume }) {
    const [over, setOver] = useState(false);
    const steps = [
      ["Cube", "IFC model", "Open IFC2x3, IFC4 or IFC4.3 and explore it in 3D and on floor plans."],
      ["MapPin", "Location", "Confirm the site from IfcSite or an address; get open weather data for it."],
      ["Zap", "BEM conversion", "Zones, surfaces, openings and constructions from the IFC, each traceable."],
      ["Play", "EnergyPlus", "Real EnergyPlus 26.2 runs in your browser through WebAssembly."],
      ["Thermometer", "IEQ", "PMV/PPD, CO\u2082 and daylight at a reference point from the simulation."],
      ["Report", "Report", "Scenario comparison, IDF/epJSON, mappings, results and a printable report."]
    ];
    return /* @__PURE__ */ React.createElement("div", { className: "start", onDragOver: (e) => {
      e.preventDefault();
      setOver(true);
    }, onDragLeave: (e) => {
      if (e.currentTarget === e.target) setOver(false);
    }, onDrop: (e) => {
      var _a, _b;
      e.preventDefault();
      setOver(false);
      const file = (_b = (_a = e.dataTransfer) == null ? void 0 : _a.files) == null ? void 0 : _b[0];
      if (file) onLoadFile(file, "Dropped");
    } }, /* @__PURE__ */ React.createElement("div", { className: "start-inner" }, currentModel && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn resume-btn", onClick: onResume }, /* @__PURE__ */ React.createElement(Icons.ChevronRight, { size: 15, style: { transform: "rotate(180deg)" } }), " Back to ", currentModel.fileName), /* @__PURE__ */ React.createElement("div", { className: "start-top single" }, /* @__PURE__ */ React.createElement("section", { className: "start-hero" }, /* @__PURE__ */ React.createElement("h1", null, "From IFC model to building energy model."), /* @__PURE__ */ React.createElement("p", null, "BIM2BEM converts a building information model into an EnergyPlus model, runs the simulation in your browser with location-specific weather data, and evaluates energy demand and indoor environmental quality. Every input says where it came from: the IFC file, your entries, an open dataset or a documented assumption. Files never leave your machine."), /* @__PURE__ */ React.createElement("div", { className: "start-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary btn-lg", onClick: onUpload }, /* @__PURE__ */ React.createElement(Icons.Upload, { size: 16 }), " Open an IFC file"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-lg", onClick: () => onLoadSample(SAMPLES[0]) }, /* @__PURE__ */ React.createElement(Icons.Cube, { size: 16 }), " Try the BEM demo office")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "dropzone", "data-over": over, onClick: onUpload }, /* @__PURE__ */ React.createElement(Icons.Upload, { size: 18 }), /* @__PURE__ */ React.createElement("span", null, "Drop a ", /* @__PURE__ */ React.createElement("code", null, ".ifc"), " file anywhere on this page"), /* @__PURE__ */ React.createElement("span", { className: "muted" }, "Parsed locally with web-ifc; simulated locally with EnergyPlus (WebAssembly)")))), /* @__PURE__ */ React.createElement("ol", { className: "start-steps", "aria-label": "Workflow" }, steps.map(([icon, t, d], i) => {
      const I = Icons[icon];
      return /* @__PURE__ */ React.createElement("li", { key: t }, /* @__PURE__ */ React.createElement("span", { className: "step-n mono" }, i + 1), /* @__PURE__ */ React.createElement(I, { size: 18 }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, t), /* @__PURE__ */ React.createElement("p", null, d)));
    })), /* @__PURE__ */ React.createElement("section", { className: "start-samples", "aria-label": "Sample models" }, /* @__PURE__ */ React.createElement("h2", null, "Sample models"), /* @__PURE__ */ React.createElement("div", { className: "sample-grid" }, SAMPLES.map((smp) => /* @__PURE__ */ React.createElement("article", { key: smp.id, className: "sample-card" }, /* @__PURE__ */ React.createElement("div", { className: "sample-head" }, /* @__PURE__ */ React.createElement(Icons.Building, { size: 18 }), /* @__PURE__ */ React.createElement("h3", null, smp.name), /* @__PURE__ */ React.createElement("span", { className: "mono muted" }, smp.size)), /* @__PURE__ */ React.createElement("p", null, smp.facts), /* @__PURE__ */ React.createElement("p", { className: "sample-credit" }, /* @__PURE__ */ React.createElement("a", { href: smp.creditUrl, target: "_blank", rel: "noopener noreferrer" }, smp.credit)), /* @__PURE__ */ React.createElement("div", { className: "sample-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", onClick: () => onLoadSample(smp) }, "Open"), smp.downloadable && /* @__PURE__ */ React.createElement("a", { className: "btn btn-sm btn-ghost", href: smp.url, download: smp.file }, /* @__PURE__ */ React.createElement(Icons.Download, { size: 14 }), " Download .ifc")))))), /* @__PURE__ */ React.createElement("section", { className: "start-scope", "aria-label": "Scope" }, /* @__PURE__ */ React.createElement("h2", null, "What is calculated, and what is not"), /* @__PURE__ */ React.createElement("div", { className: "scope-grid" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", null, /* @__PURE__ */ React.createElement(Icons.Check, { size: 15 }), " Calculated"), /* @__PURE__ */ React.createElement("ul", null, /* @__PURE__ */ React.createElement("li", null, "Heating and cooling demand, peaks, zone temperatures (EnergyPlus ideal loads)"), /* @__PURE__ */ React.createElement("li", null, "Lighting and equipment electricity; HVAC energy with constant efficiencies when you enter them"), /* @__PURE__ */ React.createElement("li", null, "PMV/PPD (ISO 7730), adaptive comfort for free-running buildings, operative temperature"), /* @__PURE__ */ React.createElement("li", null, "Zone CO\u2082 balance, outdoor-air and infiltration rates"), /* @__PURE__ */ React.createElement("li", null, "Daylight illuminance at one point per zone (split flux)"), /* @__PURE__ */ React.createElement("li", null, "Wind rose, sun path, incident solar radiation on surfaces, natural ventilation (wind and stack)"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", null, /* @__PURE__ */ React.createElement(Icons.Info, { size: 15 }), " Not calculated"), /* @__PURE__ */ React.createElement("ul", null, /* @__PURE__ */ React.createElement("li", null, "Annual grid daylight metrics (sDA, ASE) \u2014 need a Radiance-class engine"), /* @__PURE__ */ React.createElement("li", null, "AirflowNetwork pressures and interzone airflow; CFD"), /* @__PURE__ */ React.createElement("li", null, "Particulates and VOCs"), /* @__PURE__ */ React.createElement("li", null, "Acoustics (planned)"), /* @__PURE__ */ React.createElement("li", null, "Detailed HVAC plant and distribution")))))));
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
      const close = (e) => {
        var _a;
        if (!((_a = ref.current) == null ? void 0 : _a.contains(e.target))) onClose();
      };
      const esc = (e) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", esc);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", esc);
      };
    }, [menu]);
    if (!menu) return null;
    const ids = menu.ids;
    const first = model.byId.get(ids[0]);
    const run = (fn) => () => {
      fn();
      onClose();
    };
    return /* @__PURE__ */ React.createElement("div", { className: "menu ctx-menu", role: "menu", ref, style: { left: (pos || menu).x, top: (pos || menu).y } }, /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, ids.length > 1 ? plural(ids.length, "element") : elementLabel(first)), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => onZoomTo(ids)) }, /* @__PURE__ */ React.createElement(Icons.Focus, { size: 15 }), " Zoom to ", /* @__PURE__ */ React.createElement("kbd", null, "F")), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "isolate", ids })) }, /* @__PURE__ */ React.createElement(Icons.Isolate, { size: 15 }), " Isolate ", /* @__PURE__ */ React.createElement("kbd", null, "I")), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "toggle-hide", ids })) }, /* @__PURE__ */ React.createElement(Icons.EyeOff, { size: 15 }), " Hide ", /* @__PURE__ */ React.createElement("kbd", null, "H")), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "show-all" })) }, /* @__PURE__ */ React.createElement(Icons.Eye, { size: 15 }), " Show everything ", /* @__PURE__ */ React.createElement("kbd", null, "A")), first && /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "select", ids: model.byClass.get(first.ifcClass) || [] })) }, /* @__PURE__ */ React.createElement(Icons.Classes, { size: 15 }), " Select all ", first.ifcClass.replace(/^Ifc/, "")), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), first && first.globalId && /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => {
      var _a;
      (_a = navigator.clipboard) == null ? void 0 : _a.writeText(first.globalId);
      toast({ kind: "ok", msg: "GlobalId copied" });
    }) }, /* @__PURE__ */ React.createElement(Icons.Copy, { size: 15 }), " Copy GlobalId"), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => exportJSON(ids.map((id) => model.byId.get(id)).filter(Boolean), toast)) }, /* @__PURE__ */ React.createElement(Icons.Download, { size: 15 }), " Export as JSON"));
  }
  function SidePane({ title, children }) {
    return /* @__PURE__ */ React.createElement("aside", { className: "side left-side wide", "aria-label": title }, /* @__PURE__ */ React.createElement("div", { className: "side-body" }, /* @__PURE__ */ React.createElement("div", { className: "pane-title" }, /* @__PURE__ */ React.createElement("h2", null, title)), /* @__PURE__ */ React.createElement("div", { className: "side-scroll pad" }, children)));
  }
  const EMPTY_LOCATION = { latitude: null, longitude: null, elevation: null, northAngle: 0, terrain: "City", address: null, timeZoneName: null, confirmed: false, source: {} };
  function App() {
    var _a;
    const [theme, setTheme] = useState(initialTheme);
    const [model, setModel] = useState(null);
    const [secondaryReady, setSecondaryReady] = useState(false);
    const [loading, setLoading] = useState(null);
    const [workspace, setWorkspace] = useState("bim");
    const [modal, setModal] = useState(null);
    const [viewMode, setViewMode] = useState("shaded");
    const [showEdges, setShowEdges] = useState(false);
    const [showAxes, setShowAxes] = useState(true);
    const [showSpaces, setShowSpaces] = useState(false);
    const [explode, setExplode] = useState(0);
    const [sectionEnabled, setSectionEnabled] = useState(false);
    const [sectionBox, setSectionBox] = useState(null);
    const [measureMode, setMeasureMode] = useState(false);
    const [annoMode, setAnnoMode] = useState(false);
    const [levelId, setLevelId] = useState("all");
    const [planCut, setPlanCut] = useState({ enabled: false, y: 0 });
    const [slabsTransparent, setSlabsTransparent] = useState(false);
    const [log, setLog] = useState([]);
    const [toasts, setToasts] = useState([]);
    const [contextMenu, setContextMenu] = useState(null);
    const [layout, setLayout] = useState(initialLayout);
    const [viewLayout, setViewLayoutState] = useState(() => ["3d", "split", "plan"].includes(readStorage(STORAGE.layoutMode)) ? readStorage(STORAGE.layoutMode) : "3d");
    const [planLevel, setPlanLevel] = useState(null);
    const [leftTab, setLeftTab] = useState("spatial");
    const [showHome, setShowHome] = useState(false);
    const [location, setLocation] = useState(EMPTY_LOCATION);
    const [weather, setWeather] = useState(null);
    const [bemOptions, setBemOptions] = useState(() => ({ ...BEM_DEFAULTS }));
    const [tm, setTm] = useState(null);
    const [converting, setConverting] = useState(false);
    const [config, setConfig] = useState(defaultConfig);
    const [scenarios, setScenarios] = useState([{ id: "base", name: "Baseline", mods: {} }]);
    const [runs, setRuns] = useState({});
    const [activeId, setActiveId] = useState("base");
    const [engineStatus, setEngineStatus] = useState(null);
    const [displayMode, setDisplayMode] = useState("bim");
    const [hour, setHour] = useState(4380);
    const [surfaceId, setSurfaceId] = useState(null);
    const [dockFocus, setDockFocus] = useState(null);
    const [viewerState, dispatch] = useReducer(viewerStateReducer, void 0, initialViewerState);
    const fileInputRef = useRef(null);
    const viewerRef = useRef(null);
    const bodyRef = useRef(null);
    const searchRef = useRef(null);
    const modelRef = useRef(null);
    modelRef.current = model;
    useEffect(() => {
      document.documentElement.setAttribute("data-theme", theme);
      writeStorage(STORAGE.theme, theme);
    }, [theme]);
    useEffect(() => {
      writeStorage(STORAGE.layout, JSON.stringify(layout));
    }, [layout]);
    useEffect(() => {
      const warm = () => {
        var _a2;
        (_a2 = window.ensureWebIfc) == null ? void 0 : _a2.call(window).catch(() => {
        });
      };
      if (typeof requestIdleCallback !== "undefined") {
        const h2 = requestIdleCallback(warm, { timeout: 2500 });
        return () => cancelIdleCallback(h2);
      }
      const h = setTimeout(warm, 300);
      return () => clearTimeout(h);
    }, []);
    const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
    const toast = useCallback((t) => {
      const id = uid();
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismissToast(id), t.kind === "error" ? 8e3 : 3600);
    }, [dismissToast]);
    const addLog = useCallback((level, msg) => setLog((l) => [...l, { time: (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour12: false }), level, msg }]), []);
    const building = useMemo(() => {
      if (!model || !secondaryReady) return null;
      try {
        return buildBuildingGraph(model);
      } catch (err) {
        console.error(err);
        return null;
      }
    }, [model, secondaryReady]);
    const resetSession = useCallback(() => {
      var _a2;
      dispatch({ type: "reset" });
      setSecondaryReady(false);
      setLevelId("all");
      setPlanCut({ enabled: false, y: 0 });
      setSlabsTransparent(false);
      setShowSpaces(false);
      setExplode(0);
      setSectionEnabled(false);
      setSectionBox(null);
      setMeasureMode(false);
      setAnnoMode(false);
      setModal(null);
      setContextMenu(null);
      setPlanLevel(null);
      setLocation(EMPTY_LOCATION);
      setWeather(null);
      setTm(null);
      setBemOptions({ ...BEM_DEFAULTS });
      setConfig(defaultConfig());
      setScenarios([{ id: "base", name: "Baseline", mods: {} }]);
      setRuns({});
      setActiveId("base");
      setEngineStatus(null);
      setDisplayMode("bim");
      setSurfaceId(null);
      (_a2 = viewerRef.current) == null ? void 0 : _a2.clearMeasurements();
    }, []);
    const loadIfcFile = useCallback(async (file, source = "Opened") => {
      var _a2, _b;
      if (!file) return;
      if (!/\.ifc$/i.test(file.name)) {
        toast({ kind: "error", msg: `${file.name} is not an .ifc file`, sub: "Choose a STEP-encoded .ifc file (IFC2x3, IFC4 or IFC4.3)." });
        return;
      }
      (_b = (_a2 = modelRef.current) == null ? void 0 : _a2.close) == null ? void 0 : _b.call(_a2);
      setModel(null);
      resetSession();
      setLog([]);
      setLoading({ fileName: file.name, progress: 0.01, phase: "Starting" });
      addLog("info", `${source} <span class="hl">${file.name}</span> (${formatSize(file.size)})`);
      try {
        const schema = await window.readIfcSchema(file);
        if (schema && !window.isSupportedIfcSchema(schema)) throw new Error(`Schema ${schema} is not supported. Use IFC2X3, IFC4 or IFC4X3.`);
        const m = await window.loadRealIfc(file, { onProgress: (p, phase) => setLoading((l) => l ? { ...l, progress: p, phase: phase || l.phase } : l), onLog: addLog });
        try {
          m.fileSha256 = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
        } catch (e) {
          m.fileSha256 = null;
        }
        setModel(m);
        setShowHome(false);
        setLoading(null);
        setWorkspace("bim");
        toast({ kind: "ok", msg: `Opened ${file.name}`, sub: `${plural(m.elements.length, "element")}, ${m.schemaVersion}` });
        m._ensureSecondaryData().then(() => {
          if (modelRef.current === m) setSecondaryReady(true);
        });
        const g = m.geoRef || {};
        if (g.northAngle != null) setLocation((l) => ({ ...l, northAngle: +g.northAngle.toFixed(2), source: { ...l.source, northAngle: "IFC TrueNorth" } }));
      } catch (err) {
        console.error(err);
        addLog("error", `Could not open the file: ${err.message || err}`);
        setLoading(null);
        toast({ kind: "error", msg: `Could not open ${file.name}`, sub: String(err.message || err).slice(0, 140) });
      }
    }, [addLog, toast, resetSession]);
    const loadSample = useCallback(async (sample = SAMPLES[0]) => {
      try {
        if (!sample.bundled) setLoading({ fileName: sample.file, progress: 0.01, phase: "Downloading from the source" });
        const res = await fetch(sample.url);
        if (!res.ok) throw new Error(`The sample returned HTTP ${res.status}`);
        const blob = await res.blob();
        await loadIfcFile(new File([blob], sample.file, { type: "application/octet-stream" }), `Opened sample \u201C${sample.name}\u201D`);
      } catch (err) {
        setLoading(null);
        toast({ kind: "error", msg: `Could not open \u201C${sample.name}\u201D`, sub: "Serve the site over HTTP (not file://) and try again." });
      }
    }, [loadIfcFile, toast]);
    const onUpload = useCallback(() => {
      var _a2;
      return (_a2 = fileInputRef.current) == null ? void 0 : _a2.click();
    }, []);
    const onCloseModel = useCallback(() => {
      var _a2, _b;
      (_b = (_a2 = modelRef.current) == null ? void 0 : _a2.close) == null ? void 0 : _b.call(_a2);
      setModel(null);
      resetSession();
      setLog([]);
      setWorkspace("bim");
    }, [resetSession]);
    useEffect(() => {
      const over = (e) => {
        var _a2, _b;
        if ((_b = (_a2 = e.dataTransfer) == null ? void 0 : _a2.types) == null ? void 0 : _b.includes("Files")) e.preventDefault();
      };
      const drop = (e) => {
        var _a2, _b;
        if (!((_b = (_a2 = e.dataTransfer) == null ? void 0 : _a2.files) == null ? void 0 : _b.length)) return;
        const f = e.dataTransfer.files[0];
        if (!/\.ifc$/i.test(f.name)) return;
        e.preventDefault();
        loadIfcFile(f, "Dropped");
      };
      window.addEventListener("dragover", over);
      window.addEventListener("drop", drop);
      return () => {
        window.removeEventListener("dragover", over);
        window.removeEventListener("drop", drop);
      };
    }, [loadIfcFile]);
    const onConvert = useCallback(async () => {
      if (!model) return;
      setConverting(true);
      await new Promise((r) => setTimeout(r, 30));
      try {
        const t = await buildThermalModel(model, { ...bemOptions, northAngle: location.northAngle });
        setTm(t);
        setRuns({});
        addLog(t.zones.length ? "ok" : "warn", `Energy model: <span class="hl">${t.stats.zones}</span> zones, <span class="hl">${t.stats.surfaces}</span> surfaces, ${t.stats.windows} windows in ${t.stats.buildMs.toFixed(0)} ms`);
        toast({ kind: t.zones.length ? "ok" : "warn", msg: t.zones.length ? "Energy model built" : "No thermal zones", sub: t.zones.length ? `${t.stats.zones} zones, ${t.stats.surfaces} surfaces, ${t.stats.interzonePairs} interzone pairs` : "See Checks for what is missing." });
        if (t.zones.length && displayMode === "bim") setDisplayMode("bem");
      } catch (err) {
        console.error(err);
        toast({ kind: "error", msg: "Conversion failed", sub: String(err.message || err).slice(0, 160) });
      } finally {
        setConverting(false);
      }
    }, [model, bemOptions, location.northAngle, toast, addLog, displayMode]);
    const [autoWxEnabled, setAutoWxEnabledState] = useState(() => readStorage(STORAGE.autoWeather) !== "off");
    const setAutoWxEnabled = useCallback((on) => {
      setAutoWxEnabledState(on);
      writeStorage(STORAGE.autoWeather, on ? "on" : "off");
    }, []);
    const [autoWx, setAutoWx] = useState(null);
    const [autoWxNonce, setAutoWxNonce] = useState(0);
    const autoWxCtl = useRef(null);
    const autoWxForced = useRef(false);
    const weatherRef = useRef(weather);
    weatherRef.current = weather;
    const cancelAutoWeather = useCallback(() => {
      if (autoWxCtl.current) {
        autoWxCtl.current.abort();
        autoWxCtl.current = null;
      }
      setAutoWx((s) => s && s.state === "running" ? null : s);
    }, []);
    const setWeatherManual = useCallback((w) => {
      cancelAutoWeather();
      setAutoWx(null);
      setWeather(w);
    }, [cancelAutoWeather]);
    const retryAutoWeather = useCallback(() => {
      autoWxForced.current = true;
      setAutoWxNonce((n) => n + 1);
    }, []);
    useEffect(() => {
      const forced = autoWxForced.current;
      autoWxForced.current = false;
      if (!location.confirmed) {
        setAutoWx(null);
        return void 0;
      }
      if (!(autoWxEnabled || forced) || location.latitude == null || location.longitude == null) return void 0;
      const cur = weatherRef.current;
      if (cur && !forced) {
        if (cur.meta.auto && cur.meta.requested && haversineKm(cur.meta.requested.latitude, cur.meta.requested.longitude, location.latitude, location.longitude) < 0.5) return void 0;
        if (!cur.meta.auto) {
          const km = haversineKm(cur.meta.latitude, cur.meta.longitude, location.latitude, location.longitude);
          if (km > 50) setAutoWx({ state: "kept", message: `The weather file you selected (${cur.meta.name}) is ${km.toFixed(0)} km from the confirmed location. It was kept because you chose it.` });
          return void 0;
        }
      }
      const ctl = new AbortController();
      autoWxCtl.current = ctl;
      setAutoWx({ state: "running", step: "Getting weather data for this location" });
      autoWeather(location, { signal: ctl.signal, onStep: (step) => {
        if (!ctl.signal.aborted) setAutoWx({ state: "running", step });
      } }).then((w) => {
        if (ctl.signal.aborted) return;
        setWeather(w);
        setAutoWx({ state: "done" });
        addLog("info", `Weather selected automatically: <span class="hl">${w.meta.name}</span>`);
        toast({ kind: w.validation.ok ? "ok" : "warn", msg: "Weather data selected automatically", sub: `${w.meta.name} \xB7 ${w.meta.distanceKm != null ? `${w.meta.distanceKm.toFixed(1)} km from the site` : ""}` });
      }).catch((err) => {
        if (ctl.signal.aborted || err && err.name === "AbortError") return;
        console.warn(err);
        setAutoWx({ state: "failed", message: String(err.message || err), attempts: err.attempts || [] });
        toast({ kind: "warn", msg: "Could not get weather data automatically", sub: "Choose a dataset in the Location tab or upload an EPW in Energy Simulation." });
      }).finally(() => {
        if (autoWxCtl.current === ctl) autoWxCtl.current = null;
      });
      return () => {
        ctl.abort();
        setAutoWx((s) => s && s.state === "running" ? null : s);
      };
    }, [autoWxEnabled, autoWxNonce, location.confirmed, location.latitude, location.longitude, location.timeZoneName]);
    const autoWxProps = { enabled: autoWxEnabled, setEnabled: setAutoWxEnabled, status: autoWx, cancel: cancelAutoWeather, retry: retryAutoWeather };
    const runConfig = useCallback(() => {
      const c = JSON.parse(JSON.stringify(config));
      c.site = { ...c.site, name: weather ? weather.meta.name : "Site", latitude: weather ? weather.epw.header.latitude : location.latitude, longitude: weather ? weather.epw.header.longitude : location.longitude, timeZone: weather ? weather.epw.header.timeZone : 0, elevation: weather ? weather.epw.header.elevation : location.elevation, northAngle: location.northAngle || 0, terrain: location.terrain };
      c.run = { ...c.run, year: weather && weather.meta.year ? weather.meta.year : null };
      return c;
    }, [config, weather, location]);
    const compose = useMemo(() => {
      if (!tm || !tm.zones.length) return null;
      try {
        return composeIdf(tm, runConfig(), null, { fileName: model && model.fileName, buildingName: model && model.building && model.building.name });
      } catch (err) {
        return { issues: [{ severity: "critical", message: String(err.message || err) }] };
      }
    }, [tm, runConfig, model]);
    const issues = useMemo(() => collectIssues({ tm, compose, weather, location, config }), [tm, compose, weather, location, config]);
    const blocking = issues.filter((i) => i.severity === "critical").map((i) => i.message);
    const runScenario = useCallback(async (sc) => {
      if (!tm || !weather) return;
      setRuns((r) => ({ ...r, [sc.id]: { status: "running" } }));
      setEngineStatus({ busy: true, text: engineLoaded() ? "Preparing the model" : "Loading EnergyPlus\u2026" });
      try {
        const out = composeIdf(tm, runConfig(), sc.id === "base" ? null : sc, { fileName: model.fileName, buildingName: model.building && model.building.name });
        const crit = out.issues.filter((i) => i.severity === "critical");
        if (crit.length) throw new Error(`The model failed schema validation: ${crit[0].message}`);
        const { run, seconds } = await runEnergyPlus(out.idf, weather.text, {
          onStatus: (text) => setEngineStatus({ busy: true, text }),
          onProgress: (p) => setEngineStatus({ busy: true, text: `${sc.name}: ${p.phase}${p.message ? ` \xB7 ${p.message}` : ""}`, progress: Math.max(0, Math.min(1, (p.progress || 0) / 100)) })
        });
        const errEntries = (run.err && run.err.entries || []).filter((e) => e.severity !== "info").map((e) => ({ severity: e.severity, message: e.message, count: e.count || 1 }));
        if (run.cancelled) throw new Error("The run was cancelled.");
        if (!run.success) {
          const msg = run.fatalError || (run.crash ? `${run.crash.type}: ${run.crash.message}` : "EnergyPlus did not finish");
          setRuns((r) => ({ ...r, [sc.id]: { status: "failed", error: msg, errEntries, idf: out.idf } }));
          setEngineStatus({ busy: false, text: `${sc.name} failed: ${msg}` });
          toast({ kind: "error", msg: `${sc.name}: EnergyPlus failed`, sub: msg.slice(0, 160) });
          return;
        }
        const results2 = parseResults(run, tm, out.names, { conditioned: out.conditioned, runSeconds: seconds, scenario: sc.name });
        setRuns((r) => ({ ...r, [sc.id]: { status: "done", results: results2, idf: out.idf, epjson: out.model.toEpJSON(), html: run.html || null, errEntries, seconds, ground: out.ground, weatherAt: weather.loadedAt, weatherName: weather.meta.name } }));
        setActiveId(sc.id);
        setEngineStatus({ busy: false, text: `${sc.name}: finished in ${seconds.toFixed(0)} s \xB7 ${results2.meta.warnings} warnings, ${results2.meta.severe} severe` });
        addLog("ok", `EnergyPlus ${ENGINE_INFO.energyPlus}: <span class="hl">${sc.name}</span> in ${seconds.toFixed(1)} s (${results2.meta.warnings} warnings, ${results2.meta.severe} severe)`);
        toast({ kind: "ok", msg: `${sc.name} simulated`, sub: `Heating ${fmt(results2.building.heatKWhm2, 1)} \xB7 cooling ${fmt(results2.building.coolKWhm2, 1)} kWh/m\xB2\xB7a` });
        setDockFocus("energy");
      } catch (err) {
        console.error(err);
        setRuns((r) => ({ ...r, [sc.id]: { status: "failed", error: String(err.message || err) } }));
        setEngineStatus({ busy: false, text: `${sc.name} could not run: ${err.message || err}` });
        toast({ kind: "error", msg: `${sc.name} could not run`, sub: String(err.message || err).slice(0, 160) });
      }
    }, [tm, weather, runConfig, model, toast, addLog]);
    const runAll = useCallback(async () => {
      for (const sc of scenarios) await runScenario(sc);
    }, [scenarios, runScenario]);
    const active = runs[activeId] && runs[activeId].status === "done" ? runs[activeId] : null;
    const results = active ? active.results : null;
    useEffect(() => {
      if (results) setHour(results.building.peakCoolAt || 0);
    }, [results]);
    const ieq = useMemo(() => computeIeq(tm, results, config, location), [tm, results, config.comfort, config.loads.activityMet, config.hvac.cooling, config.co2.outdoorPpm, config.daylight.setpointLux, location.latitude]);
    const display = useMemo(() => displayFor(displayMode, { tm, results, ieq, hour: Math.min(hour, results ? results.time.n - 1 : hour), theme, config }), [displayMode, tm, results, ieq, hour, theme, config]);
    const analysisLayer = useMemo(() => {
      if (!model || !display || display.unavailable) return {};
      const opacity = /* @__PURE__ */ new Map();
      if (display.zoneColors) {
        model.elements.forEach((e) => {
          if (e.geometry && e.ifcClass !== "IfcSpace") opacity.set(e.expressId, 0.07);
        });
        display.zoneColors.forEach((_, id) => opacity.set(id, 0.88));
        return { colors: display.zoneColors, opacity, spaces: true };
      }
      if (display.surfaceColor) {
        model.elements.forEach((e) => {
          if (e.geometry) opacity.set(e.expressId, 0.05);
        });
        return { opacity, overlay: buildBemOverlay(tm, display.surfaceColor, { selectedId: surfaceId }) };
      }
      return {};
    }, [display, model, tm, surfaceId]);
    const modeAvailable = useCallback((m) => {
      if (!m.needs) return true;
      if (m.needs === "tm") return !!(tm && tm.zones.length);
      if (!results) return false;
      if (m.needs === "co2") return tm.zones.some((z) => {
        var _a2;
        return (_a2 = results.zones.get(z.key)) == null ? void 0 : _a2.series.co2;
      });
      if (m.needs === "daylight") return tm.zones.some((z) => {
        var _a2;
        return (_a2 = results.zones.get(z.key)) == null ? void 0 : _a2.series.lux;
      });
      return true;
    }, [tm, results]);
    useEffect(() => {
      const m = DISPLAY_MODES.find((x) => x.id === displayMode);
      if (m && !modeAvailable(m)) setDisplayMode(tm ? "bem" : "bim");
    }, [modeAvailable]);
    const hourly = (DISPLAY_MODES.find((m) => m.id === displayMode) || {}).hourly;
    const onPick = useCallback((id, e) => dispatch({ type: "select", ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }), []);
    const onZoomTo = useCallback((ids) => {
      var _a2;
      return (_a2 = viewerRef.current) == null ? void 0 : _a2.frameElements(ids);
    }, []);
    const selectAndShow = useCallback((ids) => {
      var _a2;
      dispatch({ type: "select", ids });
      const geo = ids.filter((id) => {
        var _a3, _b;
        return (_b = (_a3 = modelRef.current) == null ? void 0 : _a3.byId.get(id)) == null ? void 0 : _b.geometry;
      });
      if (geo.length) (_a2 = viewerRef.current) == null ? void 0 : _a2.frameElements(geo);
    }, []);
    const onPickEvent = useCallback((e) => {
      if (e.overlay === "bem" && tm) {
        const s = tm.surfById.get(e.expressId);
        if (!s) return;
        setSurfaceId(s.id);
        const src = s.sourceIds.find((id) => {
          var _a2;
          return /^Ifc(Wall|Slab|Roof|Covering|CurtainWall|Plate)/.test(((_a2 = model.byId.get(id)) == null ? void 0 : _a2.ifcClass) || "");
        }) || s.spaceId;
        if (src != null) dispatch({ type: "select", ids: [src] });
        return;
      }
      setSurfaceId(null);
      if (e.expressId == null) {
        if (!e.multi) dispatch({ type: "clear-selection" });
        return;
      }
      dispatch({ type: "select", ids: [e.expressId], multi: e.multi });
    }, [tm, model]);
    const onContext = useCallback((e, id) => {
      if (e.preventDefault) e.preventDefault();
      if (!modelRef.current) return;
      let ids = [...viewerState.selectedIds];
      if (id != null && !viewerState.selectedIds.has(id)) {
        ids = [id];
        dispatch({ type: "select", ids });
      }
      if (!ids.length) return;
      setContextMenu({ x: e.clientX, y: e.clientY, ids });
    }, [viewerState.selectedIds]);
    const onContextEvent = useCallback((e) => {
      if (e.expressId == null || e.overlay) return;
      onContext({ clientX: e.x, clientY: e.y }, e.expressId);
    }, [onContext]);
    const selectedZone = useMemo(() => {
      var _a2;
      if (!tm) return null;
      const ids = [...viewerState.selectedIds];
      for (let i = ids.length - 1; i >= 0; i--) {
        const m = tm.mapping.get(ids[i]);
        if (m && m.zones.length) return m.zones[0];
        if (m && m.surfaces.length) return tm.surfById.get(m.surfaces[0]).zoneKey;
      }
      if (surfaceId) return (_a2 = tm.surfById.get(surfaceId)) == null ? void 0 : _a2.zoneKey;
      return tm.zones[0] ? tm.zones[0].key : null;
    }, [tm, viewerState.selectedIds, surfaceId]);
    const toggleSection = useCallback(() => {
      setSectionEnabled((on) => {
        var _a2;
        if (!on) {
          const b = (_a2 = viewerRef.current) == null ? void 0 : _a2.getModelBounds();
          if (b) setSectionBox({ ...b });
        }
        return !on;
      });
    }, []);
    const toggleMeasure = useCallback(() => setMeasureMode((on) => {
      if (!on) setAnnoMode(false);
      return !on;
    }), []);
    const toggleAnno = useCallback(() => setAnnoMode((on) => {
      if (!on) setMeasureMode(false);
      return !on;
    }), []);
    const levelFloorY = useCallback((id) => {
      const lv = building == null ? void 0 : building.levels.find((l) => l.id === Number(id));
      if (lv && lv.floorY != null) return lv.floorY;
      const els = model ? model.elements.filter((e) => e.storey && e.storey.expressId === Number(id) && e.bbox) : [];
      return els.length ? Math.min(...els.map((e) => e.bbox.min[1])) : 0;
    }, [building, model]);
    const onLevelChange = useCallback((id, { frame = true } = {}) => {
      var _a2, _b;
      setLevelId(id);
      if (!model) return;
      if (id === "all") {
        dispatch({ type: "isolate", ids: [], force: true });
        setPlanCut((p) => ({ ...p, enabled: false }));
        (_a2 = viewerRef.current) == null ? void 0 : _a2.frameAll();
        return;
      }
      const sid = Number(id);
      const ids = model.elements.filter((el) => el.storey && el.storey.expressId === sid).map((el) => el.expressId);
      if (!ids.length) {
        toast({ kind: "warn", msg: "This level contains no elements" });
        return;
      }
      dispatch({ type: "isolate", ids, force: true });
      setPlanCut((p) => p.enabled ? { enabled: true, y: levelFloorY(sid) + 1.2 } : p);
      if (frame) (_b = viewerRef.current) == null ? void 0 : _b.frameElements(ids.filter((i) => model.byId.get(i).geometry));
    }, [model, toast, levelFloorY]);
    const togglePlanCut = useCallback(() => {
      if (levelId === "all") return;
      setPlanCut((p) => {
        var _a2;
        const next = { enabled: !p.enabled, y: levelFloorY(levelId) + 1.2 };
        if (next.enabled) (_a2 = viewerRef.current) == null ? void 0 : _a2.setCameraPreset("top");
        return next;
      });
    }, [levelId, levelFloorY]);
    const onToggleSlabs = useCallback(() => {
      if (!model) return;
      const ids = SLAB_CLASSES.flatMap((c) => model.byClass.get(c) || []);
      setSlabsTransparent((on) => {
        dispatch({ type: "set-opacity-many", ids, opacity: on ? null : 0.15 });
        return !on;
      });
    }, [model]);
    const onFocusGroup = useCallback((group) => {
      var _a2;
      if (!model) return;
      const ids = [];
      model.byClass.forEach((list, cls) => {
        if (classGroupOf(cls) === group) ids.push(...list.filter((id) => model.byId.get(id).geometry));
      });
      const label = group === "mep" ? "MEP" : "Structure";
      if (!ids.length) {
        toast({ kind: "warn", msg: `No ${label} elements in this model` });
        return;
      }
      dispatch({ type: "isolate", ids, force: true });
      (_a2 = viewerRef.current) == null ? void 0 : _a2.frameElements(ids);
      toast({ kind: "info", msg: `Isolated ${label}`, sub: plural(ids.length, "element") });
    }, [model, toast]);
    const onResetFilters = useCallback(() => {
      var _a2;
      if (!model) return;
      setLevelId("all");
      setPlanCut({ enabled: false, y: 0 });
      if (slabsTransparent) {
        dispatch({ type: "set-opacity-many", ids: SLAB_CLASSES.flatMap((c) => model.byClass.get(c) || []), opacity: null });
        setSlabsTransparent(false);
      }
      dispatch({ type: "show-all" });
      setExplode(0);
      (_a2 = viewerRef.current) == null ? void 0 : _a2.frameAll();
    }, [model, slabsTransparent]);
    const onSaveView = useCallback(() => {
      var _a2;
      dispatch({ type: "save-view", camera: (_a2 = viewerRef.current) == null ? void 0 : _a2.getCameraState() });
      toast({ kind: "ok", msg: "View saved" });
    }, [toast]);
    const onRestoreView = useCallback((view) => {
      var _a2;
      dispatch({ type: "restore-view", view });
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setCameraState(view.camera);
    }, []);
    const onWorkspace = useCallback((w) => {
      setShowHome(false);
      setWorkspace(w);
    }, []);
    const onSearch = useCallback((q) => {
      if (!model) return;
      if (!q || !q.trim()) {
        dispatch({ type: "clear-query" });
        return;
      }
      const { ids, match } = runQuery(model, q);
      dispatch({ type: "set-query", ids, match });
      if (layout.bottomCollapsed) setLayout((l) => ({ ...l, bottomCollapsed: false }));
      setDockFocus("query");
      if (!ids.length) toast({ kind: "warn", msg: `No matches for \u201C${q}\u201D` });
    }, [model, toast, layout.bottomCollapsed]);
    useEffect(() => {
      const handler = (e) => {
        var _a2, _b, _c;
        const tag = (_a2 = document.activeElement) == null ? void 0 : _a2.tagName;
        const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ((_b = document.activeElement) == null ? void 0 : _b.isContentEditable);
        if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "f")) {
          if (model) {
            e.preventDefault();
            (_c = searchRef.current) == null ? void 0 : _c.focus();
          }
          return;
        }
        if (typing || e.ctrlKey || e.metaKey || e.altKey || modal) return;
        const sel = [...viewerState.selectedIds];
        const v = viewerRef.current;
        switch (e.key) {
          case "Escape":
            if (contextMenu) setContextMenu(null);
            else if (measureMode || annoMode) {
              setMeasureMode(false);
              setAnnoMode(false);
            } else {
              dispatch({ type: "clear-selection" });
              setSurfaceId(null);
            }
            return;
          case "?":
            setModal("help");
            return;
          case "o":
          case "O":
            onUpload();
            return;
          default:
            break;
        }
        if (!model) return;
        switch (e.key.toLowerCase()) {
          case "f":
            if (sel.length) onZoomTo(sel);
            break;
          case "h":
            if (sel.length) dispatch({ type: "toggle-hide", ids: sel });
            break;
          case "i":
            if (sel.length) dispatch({ type: "isolate", ids: sel });
            break;
          case "a":
            dispatch({ type: "show-all" });
            break;
          case "m":
            toggleMeasure();
            break;
          case "p":
            toggleAnno();
            break;
          case "s":
            toggleSection();
            break;
          case "e":
            setShowEdges((x) => !x);
            break;
          case "x":
            setViewMode((m) => m === "xray" ? "shaded" : "xray");
            break;
          case "w":
            setViewMode((m) => m === "wireframe" ? "shaded" : "wireframe");
            break;
          case "1":
            v == null ? void 0 : v.setCameraPreset("iso");
            break;
          case "2":
            v == null ? void 0 : v.setCameraPreset("top");
            break;
          case "3":
            v == null ? void 0 : v.setCameraPreset("front");
            break;
          case "4":
            v == null ? void 0 : v.setCameraPreset("back");
            break;
          case "5":
            v == null ? void 0 : v.setCameraPreset("left");
            break;
          case "6":
            v == null ? void 0 : v.setCameraPreset("right");
            break;
          default:
            break;
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [model, modal, contextMenu, measureMode, annoMode, viewerState.selectedIds, onZoomTo, onUpload, toggleMeasure, toggleAnno, toggleSection]);
    const startResize = useCallback((edge, e) => {
      if (!model) return;
      e.preventDefault();
      const body = bodyRef.current;
      const rect = body.getBoundingClientRect();
      const start = { ...layout };
      const sx = e.clientX, sy = e.clientY;
      let latest = start;
      document.body.classList.add("is-resizing");
      const move = (ev) => {
        var _a2;
        const next = { ...start };
        if (edge === "left") next.left = clamp(start.left + ev.clientX - sx, 240, Math.max(240, rect.width - start.right - 420));
        if (edge === "right") next.right = clamp(start.right - (ev.clientX - sx), 280, Math.max(280, rect.width - start.left - 420));
        if (edge === "bottom") next.bottom = clamp(start.bottom - (ev.clientY - sy), 120, Math.min(560, rect.height - 200));
        latest = next;
        body.style.setProperty("--left-w", `${next.left}px`);
        body.style.setProperty("--right-w", `${next.right}px`);
        body.style.setProperty("--bottom-h", `${next.bottom}px`);
        (_a2 = viewerRef.current) == null ? void 0 : _a2.scheduleResize();
      };
      const up = () => {
        document.body.classList.remove("is-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setLayout(latest);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }, [model, layout]);
    const toggleBottom = useCallback(() => {
      setLayout((l) => ({ ...l, bottomCollapsed: !l.bottomCollapsed }));
      setTimeout(() => {
        var _a2;
        return (_a2 = viewerRef.current) == null ? void 0 : _a2.scheduleResize();
      }, 0);
    }, []);
    const setViewLayout = useCallback((l) => {
      setViewLayoutState(l);
      writeStorage(STORAGE.layoutMode, l);
      setTimeout(() => {
        var _a2;
        return (_a2 = viewerRef.current) == null ? void 0 : _a2.scheduleResize();
      }, 0);
    }, []);
    const layoutSwitch = /* @__PURE__ */ React.createElement(LayoutSwitch, { layout: viewLayout, setLayout: setViewLayout });
    const planLevelId = levelId !== "all" ? Number(levelId) : planLevel != null ? planLevel : building ? (building.levels.find((l) => l.spaceIds.length) || building.levels[0] || {}).id : null;
    const planElement = model ? /* @__PURE__ */ React.createElement(
      PlanView,
      {
        model,
        building,
        levelId: planLevelId,
        theme,
        onLevelChange: (id) => {
          setPlanLevel(Number(id));
          if (levelId !== "all") onLevelChange(String(id), { frame: false });
        },
        onSelectElement: (id, e) => id == null ? dispatch({ type: "clear-selection" }) : dispatch({ type: "select", ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }),
        layoutSwitch: viewLayout === "plan" ? layoutSwitch : null,
        selectedIds: viewerState.selectedIds,
        roomColors: analysisLayer.colors && display && display.zoneColors ? display.zoneColors : null,
        legend: display && display.legend ? display.legend.title : null
      }
    ) : null;
    const status = {
      location: location.confirmed ? weather ? "done" : "partial" : null,
      bem: tm ? tm.issues.some((i) => i.severity === "critical") ? "error" : "done" : null,
      sim: runs.base ? runs.base.status === "done" ? "done" : runs.base.status === "failed" ? "error" : "partial" : null
    };
    const chartTabs = useMemo(() => chartDockTabs({ results, weather, tm, zoneKey: selectedZone, ieq, config }), [results, weather, tm, selectedZone, ieq, config.setpoints, config.co2]);
    const dockTabs = !tm ? chartTabs : [...chartTabs, { id: "validation", label: "Validation", icon: Icons.Alert, count: issues.filter((i) => i.severity === "critical" || i.severity === "warning").length, render: () => /* @__PURE__ */ React.createElement("div", { className: "pad" }, /* @__PURE__ */ React.createElement(IssueList, { issues, onSelectIds: selectAndShow })) }];
    const bemProps = { model, tm, bemOptions, setBemOptions, onConvert, converting, config, setConfig, onSelectIds: selectAndShow, compose, weather, location };
    const sidebar = workspace === "bim" || !model ? /* @__PURE__ */ React.createElement(LeftSidebar, { model, viewerState, dispatch, onPick, onZoomTo, onContext, onSaveView, onRestoreView, tab: leftTab, setTab: setLeftTab }) : workspace === "location" ? /* @__PURE__ */ React.createElement(SidePane, { title: "Building location and climate" }, /* @__PURE__ */ React.createElement(LocationPanel, { model, location, setLocation, toast }), /* @__PURE__ */ React.createElement(WeatherPanel, { location, weather, setWeather: setWeatherManual, toast, auto: autoWxProps })) : workspace === "bem" ? /* @__PURE__ */ React.createElement(SidePane, { title: "BIM-to-BEM conversion" }, /* @__PURE__ */ React.createElement(BemPanel, { ...bemProps })) : workspace === "sim" ? /* @__PURE__ */ React.createElement(SidePane, { title: "Energy simulation" }, /* @__PURE__ */ React.createElement(SimulationPanel, { tm, weather, setWeather: setWeatherManual, toast, autoWeatherState: autoWx, location, config, setConfig, scenarios, setScenarios, runs, onRun: runScenario, onRunAll: runAll, activeId, setActiveId, engineStatus, blocking })) : workspace === "ieq" ? /* @__PURE__ */ React.createElement(SidePane, { title: "Indoor environmental quality" }, /* @__PURE__ */ React.createElement(IeqPanel, { tm, results, ieq, config, setConfig, location, onSelectIds: selectAndShow })) : workspace === "env" ? /* @__PURE__ */ React.createElement(SidePane, { title: "Solar, wind and climate" }, /* @__PURE__ */ React.createElement(EnvironmentPanel, { weather, results, location, tm })) : workspace === "results" ? /* @__PURE__ */ React.createElement(SidePane, { title: `Results${results ? ` \xB7 ${((_a = scenarios.find((s) => s.id === activeId)) == null ? void 0 : _a.name) || ""}` : ""}` }, /* @__PURE__ */ React.createElement(ResultsPanel, { tm, results, runs, scenarios, onSelectIds: selectAndShow })) : /* @__PURE__ */ React.createElement(SidePane, { title: "Reports and exports" }, /* @__PURE__ */ React.createElement(ReportsPanel, { model, location, weather, tm, config, runs, scenarios, activeId, ieq, issues, toast }));
    const bodyStyle = { "--left-w": `${workspace === "bim" ? layout.left : Math.max(layout.left, 400)}px`, "--right-w": `${layout.right}px`, "--bottom-h": layout.bottomCollapsed ? "40px" : `${layout.bottom}px` };
    return /* @__PURE__ */ React.createElement("div", { className: "app", "data-has-model": !!model }, /* @__PURE__ */ React.createElement(
      TopBar,
      {
        model,
        workspace,
        onWorkspace,
        onUpload,
        onLoadSample: loadSample,
        onClose: onCloseModel,
        onSearch,
        onHome: () => setShowHome(true),
        onOpenHelp: () => setModal("help"),
        theme,
        onToggleTheme: () => setTheme((t) => t === "dark" ? "light" : "dark"),
        searchRef,
        status
      }
    ), /* @__PURE__ */ React.createElement("input", { ref: fileInputRef, type: "file", accept: ".ifc", hidden: true, onChange: async (e) => {
      var _a2;
      const f = (_a2 = e.target.files) == null ? void 0 : _a2[0];
      e.target.value = "";
      await loadIfcFile(f);
    } }), /* @__PURE__ */ React.createElement("div", { className: "app-body", ref: bodyRef, style: bodyStyle, "data-collapsed": layout.bottomCollapsed }, model && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "resize-handle rh-left", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize left panel", onPointerDown: (e) => startResize("left", e) }), /* @__PURE__ */ React.createElement("div", { className: "resize-handle rh-right", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize inspector", onPointerDown: (e) => startResize("right", e) }), !layout.bottomCollapsed && /* @__PURE__ */ React.createElement("div", { className: "resize-handle rh-bottom", role: "separator", "aria-orientation": "horizontal", "aria-label": "Resize bottom panel", onPointerDown: (e) => startResize("bottom", e), onDoubleClick: () => setLayout((l) => ({ ...l, bottom: DEFAULT_LAYOUT.bottom })) })), sidebar, /* @__PURE__ */ React.createElement(
      ViewerCanvas,
      {
        model,
        viewerRef,
        viewerState,
        dispatch,
        toast,
        theme,
        viewMode,
        setViewMode,
        showEdges,
        setShowEdges,
        showAxes,
        setShowAxes,
        showSpaces,
        setShowSpaces,
        explode,
        setExplode,
        sectionEnabled,
        toggleSection,
        sectionBox,
        setSectionBox,
        measureMode,
        toggleMeasure,
        annoMode,
        toggleAnno,
        levelId,
        onLevelChange,
        planCut,
        togglePlanCut,
        slabsTransparent,
        onToggleSlabs,
        onFocusGroup,
        onResetFilters,
        onPickEvent,
        onContextEvent,
        layout: viewLayout,
        layoutSwitch,
        planElement,
        display,
        analysisColors: analysisLayer.colors,
        analysisOpacity: analysisLayer.opacity,
        analysisSpaces: analysisLayer.spaces,
        overlay: analysisLayer.overlay,
        displayControls: /* @__PURE__ */ React.createElement(DisplayControls, { mode: displayMode, setMode: setDisplayMode, available: modeAvailable, hourly, hour, setHour, time: results && results.time }),
        hint: displayMode === "bem" ? "Click an analytical surface to trace it to its zone and IFC elements." : null
      }
    ), /* @__PURE__ */ React.createElement(
      Inspector,
      {
        model,
        viewerState,
        dispatch,
        onZoomTo,
        toast,
        onSelect: (id) => dispatch({ type: "select", ids: [id] }),
        renderExtra: (el, open, toggle) => /* @__PURE__ */ React.createElement(BemInspectorSection, { el, tm, results, surfaceId: surfaceId && tm && tm.surfById.get(surfaceId) && (tm.surfById.get(surfaceId).sourceIds.includes(el.expressId) || tm.surfById.get(surfaceId).spaceId === el.expressId) ? surfaceId : null, onSelectSurface: setSurfaceId, open, onToggle: toggle })
      }
    ), /* @__PURE__ */ React.createElement(
      BottomPanel,
      {
        model,
        viewerState,
        dispatch,
        log,
        onPick,
        onZoomTo,
        toast,
        collapsed: layout.bottomCollapsed,
        onToggleCollapsed: toggleBottom,
        viewerRef,
        secondaryReady,
        extraTabs: dockTabs,
        focusTab: dockFocus
      }
    ), (!model || showHome) && !loading && /* @__PURE__ */ React.createElement(StartScreen, { onUpload, onLoadFile: loadIfcFile, onLoadSample: loadSample, currentModel: model, onResume: () => setShowHome(false) }), loading && /* @__PURE__ */ React.createElement(LoadingOverlay, { fileName: loading.fileName, progress: loading.progress, phase: loading.phase, log })), modal === "help" && /* @__PURE__ */ React.createElement(HelpPanel, { onClose: () => setModal(null) }), model && /* @__PURE__ */ React.createElement(ContextMenu, { menu: contextMenu, onClose: () => setContextMenu(null), dispatch, onZoomTo, model, toast }), /* @__PURE__ */ React.createElement(ToastContainer, { toasts, onDismiss: dismissToast }));
  }
  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(/* @__PURE__ */ React.createElement(App, null));
})();
