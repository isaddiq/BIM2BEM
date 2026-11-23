(() => {
  const MET_W_PER_M2 = 58.15;
  const DUBOIS_AREA = 1.8;
  const USAGE_PROFILES = {
    office: {
      label: "Office",
      occupancyDensity: 0.05,
      // people/m² (5 per 100 m²)
      oaPerPerson: 25e-4,
      // m³/s·person (2.5 L/s)
      oaPerArea: 3e-4,
      // m³/s·m² (0.3 L/s·m²)
      lightingWm2: 8,
      equipmentWm2: 10,
      activityMet: 1.2,
      sources: {
        occupancyDensity: "ASHRAE 62.1-2019 Table 6.2.2.1, office space default occupant density",
        oaPerPerson: "ASHRAE 62.1-2019 Table 6.2.2.1, office space Rp",
        oaPerArea: "ASHRAE 62.1-2019 Table 6.2.2.1, office space Ra",
        lightingWm2: "Assumption (BIM2BEM default; enter the design lighting power density)",
        equipmentWm2: "Assumption (BIM2BEM default; enter the design plug load)",
        activityMet: "ISO 7730:2005 Table B.1, sedentary activity (office): 70 W/m\xB2 = 1.2 met"
      }
    },
    residential: {
      label: "Residential",
      occupancyDensity: 0.03,
      oaPerPerson: 25e-4,
      oaPerArea: 3e-4,
      lightingWm2: 5,
      equipmentWm2: 5,
      activityMet: 1,
      sources: {
        occupancyDensity: "Assumption (BIM2BEM default; enter the design occupancy)",
        oaPerPerson: "Assumption (follows ASHRAE 62.1 office Rp; dwellings use ASHRAE 62.2 or national rules)",
        oaPerArea: "Assumption (follows ASHRAE 62.1 office Ra)",
        lightingWm2: "Assumption (BIM2BEM default)",
        equipmentWm2: "Assumption (BIM2BEM default)",
        activityMet: "ISO 7730:2005 Table B.1, seated relaxed: 58 W/m\xB2 = 1.0 met"
      }
    },
    education: {
      label: "Classroom",
      occupancyDensity: 0.25,
      oaPerPerson: 5e-3,
      oaPerArea: 6e-4,
      lightingWm2: 8,
      equipmentWm2: 5,
      activityMet: 1.2,
      sources: {
        occupancyDensity: "ASHRAE 62.1-2019 Table 6.2.2.1, classrooms (ages 9+) default occupant density",
        oaPerPerson: "ASHRAE 62.1-2019 Table 6.2.2.1, classrooms (ages 9+) Rp",
        oaPerArea: "ASHRAE 62.1-2019 Table 6.2.2.1, classrooms Ra",
        lightingWm2: "Assumption (BIM2BEM default)",
        equipmentWm2: "Assumption (BIM2BEM default)",
        activityMet: "ISO 7730:2005 Table B.1, sedentary activity: 1.2 met"
      }
    }
  };
  function defaultConfig() {
    return {
      site: { name: "Building site", latitude: null, longitude: null, elevation: null, timeZone: null, northAngle: 0, terrain: "City", source: {} },
      run: { begin: [1, 1], end: [12, 31], timesteps: 4, ground: "kiva", solarDistribution: "FullExterior", year: null },
      usage: "office",
      loads: { ...pickLoads(USAGE_PROFILES.office) },
      loadSources: { ...USAGE_PROFILES.office.sources, infiltrationAch: "Assumption (no airtightness test result entered)" },
      infiltrationAch: 0.3,
      schedule: { weekdayStart: 8, weekdayEnd: 18, saturday: false, source: "Assumption: occupied 08:00\u201318:00 on weekdays" },
      setpoints: { heating: 20, cooling: 26, heatingSetback: 16, coolingSetback: 30, source: "EN 16798-1:2019 Table B.4, category II office (20 \xB0C / 26 \xB0C); setbacks are assumptions" },
      hvac: {
        cooling: true,
        heatRecovery: "None",
        sensibleEffectiveness: 0.7,
        economizer: "NoEconomizer",
        fuel: { enabled: false, heatingFuel: "NaturalGas", heatingEfficiency: 0.9, coolingFuel: "Electricity", coolingCop: 3 }
      },
      natvent: { enabled: false, openingFraction: 0.25, minIndoor: 22, maxOutdoor: 26, minOutdoor: 12, maxWind: 15 },
      comfort: { clothingWinter: 1, clothingSummer: 0.5, airSpeed: 0.1, source: "ISO 7730 conventions: 1.0 clo winter, 0.5 clo summer; 0.1 m/s still air" },
      co2: { enabled: true, outdoorPpm: 420, source: "Assumed constant outdoor CO\u2082 of 420 ppm (global mean background, NOAA GML, 2023\u20132024)" },
      daylight: { enabled: true, setpointLux: 300, height: 0.8, dimming: false, source: "One reference point per zone at 0.8 m (EnergyPlus split-flux method); 300 lx task target (EN 12464-1 general office reading is 500 lx; 300 lx is the common daylight-autonomy threshold)" },
      zoneOverrides: {},
      // zoneKey → { conditioned: false, usage }
      constructionOverrides: {},
      // constructionKey → { layers }
      glazingOverrides: {}
      // windowType key → { uFactor, shgc, vt }
    };
  }
  function pickLoads(p) {
    return { occupancyDensity: p.occupancyDensity, oaPerPerson: p.oaPerPerson, oaPerArea: p.oaPerArea, lightingWm2: p.lightingWm2, equipmentWm2: p.equipmentWm2, activityMet: p.activityMet };
  }
  function applyScenario(config, tm, scenario) {
    const c = JSON.parse(JSON.stringify(config));
    const cons = new Map([...tm.constructions].map(([k, v]) => [k, { ...v, layers: config.constructionOverrides[k] && config.constructionOverrides[k].layers || v.layers }]));
    const glz = new Map([...tm.windowTypes].map(([k, v]) => [k, { ...v, ...config.glazingOverrides[k] || {} }]));
    const mods = scenario && scenario.mods || {};
    if (mods.insulation) {
      const mat = libraryMaterial(mods.insulation.material || "mineral-wool");
      cons.forEach((con, k) => {
        const add = mods.insulation[con.category];
        if (!(add > 0) || con.reversedOf) return;
        const layer = { name: `${mat.name} (scenario +${Math.round(add * 1e3)} mm)`, thickness: add, conductivity: mat.conductivity, density: mat.density, specificHeat: mat.specificHeat, source: `Scenario: ${mat.source}` };
        con.layers = [layer, ...con.layers];
        con.scenarioEdited = true;
      });
      cons.forEach((con) => {
        if (con.reversedOf && cons.get(con.reversedOf).scenarioEdited) con.layers = cons.get(con.reversedOf).layers.slice().reverse();
      });
    }
    if (mods.glazing) glz.forEach((g) => Object.assign(g, Object.fromEntries(Object.entries(mods.glazing).filter(([, v]) => v != null && v !== ""))));
    if (mods.ventilation) {
      const v = mods.ventilation;
      if (v.oaPerPerson != null) c.loads.oaPerPerson = v.oaPerPerson;
      if (v.oaPerArea != null) c.loads.oaPerArea = v.oaPerArea;
      if (v.infiltrationAch != null) c.infiltrationAch = v.infiltrationAch;
      if (v.heatRecovery) c.hvac.heatRecovery = v.heatRecovery;
      if (v.sensibleEffectiveness != null) c.hvac.sensibleEffectiveness = v.sensibleEffectiveness;
      if (v.natvent != null) c.natvent.enabled = !!v.natvent;
    }
    if (mods.operation) {
      const o = mods.operation;
      ["heating", "cooling", "heatingSetback", "coolingSetback"].forEach((k) => {
        if (o[k] != null) c.setpoints[k] = o[k];
      });
      ["weekdayStart", "weekdayEnd"].forEach((k) => {
        if (o[k] != null) c.schedule[k] = o[k];
      });
    }
    return { config: c, constructions: cons, glazing: glz };
  }
  function hhmm(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  function compactSchedule(sched, on, off) {
    const f = [];
    f.push("Through: 12/31", "For: Weekdays SummerDesignDay WinterDesignDay");
    if (sched.weekdayStart > 0) f.push(`Until: ${hhmm(sched.weekdayStart)}`, String(off));
    f.push(`Until: ${hhmm(sched.weekdayEnd)}`, String(on));
    if (sched.weekdayEnd < 24) f.push("Until: 24:00", String(off));
    if (sched.saturday) {
      f.push("For: Saturday");
      if (sched.weekdayStart > 0) f.push(`Until: ${hhmm(sched.weekdayStart)}`, String(off));
      f.push(`Until: ${hhmm(Math.min(sched.weekdayEnd, 14))}`, String(on), "Until: 24:00", String(off));
      f.push("For: AllOtherDays", "Until: 24:00", String(off));
    } else {
      f.push("For: AllOtherDays", "Until: 24:00", String(off));
    }
    return f.map((x) => ({ field: x }));
  }
  function exposedPerimeter(floor, zoneSurfaces) {
    const walls = zoneSurfaces.filter((s) => s.type === "Wall" && (s.bc === "Outdoors" || s.bc === "Ground"));
    let exposed = 0;
    const V = floor.vertices;
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      let covered = [];
      walls.forEach((w) => {
        const bottom = w.vertices.filter((p) => Math.abs(p[2] - w.minZ) < 0.02);
        if (bottom.length < 2) return;
        const off = (p) => Math.abs((p[0] - a[0]) * dir[1] - (p[1] - a[1]) * dir[0]);
        if (bottom.some((p) => off(p) > 0.05) || Math.abs(bottom[0][2] - a[2]) > 0.1) return;
        const ts = bottom.map((p) => (p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1]);
        covered.push([Math.max(0, Math.min(...ts)), Math.min(L, Math.max(...ts))]);
      });
      covered = covered.filter((c) => c[1] > c[0]).sort((x, y) => x[0] - y[0]);
      let len = 0, cur = null;
      covered.forEach((c) => {
        if (!cur || c[0] > cur[1]) {
          if (cur) len += cur[1] - cur[0];
          cur = c.slice();
        } else cur[1] = Math.max(cur[1], c[1]);
      });
      if (cur) len += cur[1] - cur[0];
      exposed += len;
    }
    return exposed;
  }
  const ZONE_OUTPUTS = [
    "Zone Mean Air Temperature",
    "Zone Operative Temperature",
    "Zone Mean Radiant Temperature",
    "Zone Air Relative Humidity",
    "Zone People Occupant Count",
    "Zone Ideal Loads Supply Air Total Heating Energy",
    "Zone Ideal Loads Supply Air Total Cooling Energy",
    "Zone Ideal Loads Zone Sensible Heating Energy",
    "Zone Ideal Loads Zone Sensible Cooling Energy",
    "Zone Ideal Loads Outdoor Air Standard Density Volume Flow Rate",
    "Zone Infiltration Standard Density Volume Flow Rate",
    "Enclosure Windows Total Transmitted Solar Radiation Energy",
    "Zone Lights Electricity Energy",
    "Zone Electric Equipment Electricity Energy"
  ];
  function composeIdf(tm, baseConfig, scenario = null, meta = {}) {
    const { config, constructions, glazing } = applyScenario(baseConfig, tm, scenario);
    const m = new IdfModel();
    const issues = [];
    const name = makeNamer();
    const zoneName = /* @__PURE__ */ new Map();
    const objectZone = /* @__PURE__ */ new Map();
    const conds = new Set(tm.zones.filter((z) => !(config.zoneOverrides[z.key] && config.zoneOverrides[z.key].conditioned === false)).map((z) => z.key));
    m.add("Version", null, { version_identifier: (window.EP_SCHEMA.version || "26.2.0").split(".").slice(0, 2).join(".") });
    m.add("SimulationControl", null, { do_zone_sizing_calculation: "No", do_system_sizing_calculation: "No", do_plant_sizing_calculation: "No", run_simulation_for_sizing_periods: "No", run_simulation_for_weather_file_run_periods: "Yes" });
    m.add("Building", name(meta.buildingName || "Building"), { north_axis: +(config.site.northAngle || 0).toFixed(3), terrain: config.site.terrain || "City", loads_convergence_tolerance_value: 0.04, temperature_convergence_tolerance_value: 0.4, solar_distribution: config.run.solarDistribution || "FullExterior", maximum_number_of_warmup_days: 25, minimum_number_of_warmup_days: 6 });
    m.add("Timestep", null, { number_of_timesteps_per_hour: config.run.timesteps || 4 });
    if (config.site.latitude != null && config.site.longitude != null) {
      m.add("Site:Location", name(config.site.name || "Site"), { latitude: +config.site.latitude.toFixed(4), longitude: +config.site.longitude.toFixed(4), time_zone: config.site.timeZone != null ? config.site.timeZone : 0, elevation: config.site.elevation != null ? +config.site.elevation.toFixed(1) : 0 });
    }
    const rp = { begin_month: config.run.begin[0], begin_day_of_month: config.run.begin[1], end_month: config.run.end[0], end_day_of_month: config.run.end[1], use_weather_file_holidays_and_special_days: "No", use_weather_file_daylight_saving_period: "No" };
    if (config.run.year) {
      rp.begin_year = config.run.year;
      rp.end_year = config.run.year;
    }
    m.add("RunPeriod", "Run period", rp);
    m.add("GlobalGeometryRules", null, { starting_vertex_position: "UpperLeftCorner", vertex_entry_direction: "Counterclockwise", coordinate_system: "World" });
    m.add("ShadowCalculation", null, { shading_calculation_method: "PolygonClipping", shading_calculation_update_frequency_method: "Periodic", shading_calculation_update_frequency: 20, maximum_figures_in_shadow_overlap_calculations: 15e3 });
    m.add("SurfaceConvectionAlgorithm:Inside", null, { algorithm: "TARP" });
    m.add("SurfaceConvectionAlgorithm:Outside", null, { algorithm: "DOE-2" });
    m.add("HeatBalanceAlgorithm", null, { algorithm: "ConductionTransferFunction" });
    if (config.co2.enabled) m.add("ZoneAirContaminantBalance", null, { carbon_dioxide_concentration: "Yes", outdoor_carbon_dioxide_schedule_name: "Outdoor CO2" });
    m.add("ScheduleTypeLimits", "Fraction", { lower_limit_value: 0, upper_limit_value: 1, numeric_type: "Continuous" });
    m.add("ScheduleTypeLimits", "Any Number", {});
    m.add("ScheduleTypeLimits", "Control Type", { lower_limit_value: 0, upper_limit_value: 4, numeric_type: "Discrete" });
    m.add("Schedule:Constant", "Always On", { schedule_type_limits_name: "Fraction", hourly_value: 1 });
    m.add("Schedule:Constant", "Always Off", { schedule_type_limits_name: "Fraction", hourly_value: 0 });
    m.add("Schedule:Constant", "Dual Setpoint Control", { schedule_type_limits_name: "Control Type", hourly_value: 4 });
    m.add("Schedule:Constant", "Activity Level", { schedule_type_limits_name: "Any Number", hourly_value: +(config.loads.activityMet * MET_W_PER_M2 * DUBOIS_AREA).toFixed(1) });
    if (config.co2.enabled) m.add("Schedule:Constant", "Outdoor CO2", { schedule_type_limits_name: "Any Number", hourly_value: config.co2.outdoorPpm });
    const sch = config.schedule;
    m.add("Schedule:Compact", "Occupancy", { schedule_type_limits_name: "Fraction", data: compactSchedule(sch, 1, 0) });
    m.add("Schedule:Compact", "Lighting", { schedule_type_limits_name: "Fraction", data: compactSchedule(sch, 1, 0.05) });
    m.add("Schedule:Compact", "Equipment", { schedule_type_limits_name: "Fraction", data: compactSchedule(sch, 1, 0.2) });
    m.add("Schedule:Compact", "Heating Setpoint", { schedule_type_limits_name: "Any Number", data: compactSchedule(sch, config.setpoints.heating, config.setpoints.heatingSetback) });
    m.add("Schedule:Compact", "Cooling Setpoint", { schedule_type_limits_name: "Any Number", data: compactSchedule(sch, config.setpoints.cooling, config.setpoints.coolingSetback) });
    m.add("Schedule:Compact", "Outdoor Air", { schedule_type_limits_name: "Fraction", data: compactSchedule({ ...sch, weekdayStart: Math.max(0, sch.weekdayStart - 1) }, 1, 0) });
    const materialName = /* @__PURE__ */ new Map();
    const matFor = (l) => {
      const key = JSON.stringify([l.name, l.thickness, l.conductivity, l.density, l.specificHeat, l.resistance]);
      if (materialName.has(key)) return materialName.get(key);
      const n = name(`${l.name}${l.thickness ? ` ${Math.round(l.thickness * 1e3)}mm` : ""}`, "Material");
      if (l.resistance != null) m.add("Material:NoMass", n, { roughness: "MediumRough", thermal_resistance: Math.max(1e-3, +l.resistance.toFixed(5)) });
      else m.add("Material", n, { roughness: "MediumRough", thickness: +l.thickness.toFixed(5), conductivity: l.conductivity, density: l.density, specific_heat: l.specificHeat });
      materialName.set(key, n);
      return n;
    };
    const consName = /* @__PURE__ */ new Map();
    constructions.forEach((c, key) => {
      const layers = c.layers.filter((l) => l.resistance != null && l.resistance > 0 || l.thickness > 0 && l.conductivity > 0);
      if (!layers.length) {
        issues.push({ severity: "critical", message: `Construction ${c.name} has no valid layers.` });
        return;
      }
      if (layers.length > 10) issues.push({ severity: "critical", message: `Construction ${c.name} has ${layers.length} layers; EnergyPlus allows 10.` });
      const n = name(c.name, "Construction");
      const f = {};
      layers.slice(0, 10).forEach((l, i) => {
        f[i === 0 ? "outside_layer" : `layer_${i + 1}`] = matFor(l);
      });
      m.add("Construction", n, f);
      consName.set(key, n);
    });
    const glzName = /* @__PURE__ */ new Map();
    glazing.forEach((g, key) => {
      const mn = name(`${g.name} glass`);
      m.add("WindowMaterial:SimpleGlazingSystem", mn, { u_factor: +g.uFactor.toFixed(4), solar_heat_gain_coefficient: +g.shgc.toFixed(4), visible_transmittance: +g.vt.toFixed(4) });
      const cn = name(g.name);
      m.add("Construction", cn, { outside_layer: mn });
      glzName.set(key, cn);
    });
    const groundFloors = tm.surfaces.filter((s) => s.bc === "Ground" && s.type === "Floor");
    const groundWalls = tm.surfaces.filter((s) => s.bc === "Ground" && s.type !== "Floor");
    const useKiva = config.run.ground === "kiva" && groundFloors.length > 0;
    if (useKiva) {
      m.add("Foundation:Kiva:Settings", null, {});
      m.add("Foundation:Kiva", "Slab on grade", { wall_height_above_grade: 0, wall_depth_below_slab: 0 });
    } else if (groundFloors.length || groundWalls.length) {
      const gt = config.run.groundTemps || Array(12).fill(18);
      const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      m.add("Site:GroundTemperature:BuildingSurface", null, Object.fromEntries(months.map((mo, i) => [`${mo}_ground_temperature`, gt[i]])));
    }
    const surfName = /* @__PURE__ */ new Map();
    tm.zones.forEach((z) => zoneName.set(z.key, name(z.name, "Zone")));
    tm.surfaces.forEach((s) => surfName.set(s.id, name(s.name, "Surface")));
    tm.zones.forEach((z) => {
      const zn = zoneName.get(z.key);
      m.add("Zone", zn, { volume: +z.volume.toFixed(3), floor_area: +z.floorArea.toFixed(3), ceiling_height: +z.ceilingHeight.toFixed(3), part_of_total_floor_area: conds.has(z.key) ? "Yes" : "No" });
    });
    tm.surfaces.forEach((s) => {
      const sn = surfName.get(s.id);
      const f = {
        surface_type: s.type === "Ceiling" && s.bc !== "Outdoors" ? "Ceiling" : s.type,
        construction_name: consName.get(s.constructionKey),
        zone_name: zoneName.get(s.zoneKey),
        vertices: s.vertices
      };
      if (s.bc === "Surface") {
        f.outside_boundary_condition = "Surface";
        f.outside_boundary_condition_object = surfName.get(s.partner);
      } else if (s.bc === "Ground" && s.type === "Floor" && useKiva) {
        f.outside_boundary_condition = "Foundation";
        f.outside_boundary_condition_object = "Slab on grade";
      } else f.outside_boundary_condition = s.bc;
      const exposed = f.outside_boundary_condition === "Outdoors";
      f.sun_exposure = exposed ? "SunExposed" : "NoSun";
      f.wind_exposure = exposed ? "WindExposed" : "NoWind";
      m.add("BuildingSurface:Detailed", sn, f);
      if (useKiva && s.bc === "Ground" && s.type === "Floor") {
        const zs = tm.zoneByKey.get(s.zoneKey).surfaceIds.map((id) => tm.surfById.get(id));
        m.add("SurfaceProperty:ExposedFoundationPerimeter", null, { surface_name: sn, exposed_perimeter_calculation_method: "TotalExposedPerimeter", total_exposed_perimeter: +Math.max(0, exposedPerimeter(s, zs)).toFixed(3) });
      }
    });
    const subName = /* @__PURE__ */ new Map();
    tm.subsurfaces.forEach((w) => {
      const n = name(w.name, "Opening");
      subName.set(w.id, n);
      m.add("FenestrationSurface:Detailed", n, {
        surface_type: w.type === "Door" ? "Door" : "Window",
        construction_name: w.type === "Window" ? glzName.get(w.constructionKey) : consName.get(w.constructionKey),
        building_surface_name: surfName.get(w.hostId),
        vertices: w.vertices
      });
    });
    const L = config.loads;
    tm.zones.forEach((z) => {
      const zn = zoneName.get(z.key);
      if (!conds.has(z.key)) return;
      m.add("People", name(`${zn} People`), {
        zone_or_zonelist_or_space_or_spacelist_name: zn,
        number_of_people_schedule_name: "Occupancy",
        number_of_people_calculation_method: "People/Area",
        people_per_floor_area: L.occupancyDensity,
        fraction_radiant: 0.3,
        activity_level_schedule_name: "Activity Level"
      });
      m.add("Lights", name(`${zn} Lights`), { zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: "Lighting", design_level_calculation_method: "Watts/Area", watts_per_floor_area: L.lightingWm2, fraction_radiant: 0.42, fraction_visible: 0.18, end_use_subcategory: "General" });
      m.add("ElectricEquipment", name(`${zn} Equipment`), { zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: "Equipment", design_level_calculation_method: "Watts/Area", watts_per_floor_area: L.equipmentWm2, fraction_radiant: 0.5, end_use_subcategory: "General" });
      if (config.infiltrationAch > 0) m.add("ZoneInfiltration:DesignFlowRate", name(`${zn} Infiltration`), { zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: "Always On", design_flow_rate_calculation_method: "AirChanges/Hour", air_changes_per_hour: config.infiltrationAch });
      const oa = name(`${zn} Outdoor Air`);
      m.add("DesignSpecification:OutdoorAir", oa, { outdoor_air_method: "Sum", outdoor_air_flow_per_person: L.oaPerPerson, outdoor_air_flow_per_zone_floor_area: L.oaPerArea, outdoor_air_schedule_name: "Outdoor Air" });
      const ideal = name(`${zn} Ideal Loads`);
      objectZone.set(ideal, z.key);
      const h = config.hvac;
      const il = {
        zone_supply_air_node_name: `${zn} Supply Inlet`,
        design_specification_outdoor_air_object_name: oa,
        heat_recovery_type: h.heatRecovery,
        sensible_heat_recovery_effectiveness: h.heatRecovery === "None" ? void 0 : h.sensibleEffectiveness,
        outdoor_air_economizer_type: h.economizer,
        dehumidification_control_type: "None",
        humidification_control_type: "None",
        cooling_availability_schedule_name: h.cooling === false ? "Always Off" : void 0
      };
      if (h.fuel && h.fuel.enabled) {
        il.heating_fuel_type = h.fuel.heatingFuel;
        il.heating_fuel_efficiency_schedule_name = "Heating Efficiency";
        il.cooling_fuel_type = h.fuel.coolingFuel;
        il.cooling_fuel_efficiency_schedule_name = "Cooling COP";
      }
      m.add("ZoneHVAC:IdealLoadsAirSystem", ideal, il);
      m.add("ZoneHVAC:EquipmentList", name(`${zn} Equipment List`), { load_distribution_scheme: "SequentialLoad", equipment: [{ zone_equipment_object_type: "ZoneHVAC:IdealLoadsAirSystem", zone_equipment_name: ideal, zone_equipment_cooling_sequence: 1, zone_equipment_heating_or_no_load_sequence: 1 }] });
      m.add("ZoneHVAC:EquipmentConnections", null, { zone_name: zn, zone_conditioning_equipment_list_name: `${zn} Equipment List`, zone_air_inlet_node_or_nodelist_name: `${zn} Supply Inlet`, zone_air_node_name: `${zn} Air Node`, zone_return_air_node_or_nodelist_name: `${zn} Return Outlet` });
      const tsp = name(`${zn} Setpoints`);
      m.add("ThermostatSetpoint:DualSetpoint", tsp, { heating_setpoint_temperature_schedule_name: "Heating Setpoint", cooling_setpoint_temperature_schedule_name: "Cooling Setpoint" });
      m.add("ZoneControl:Thermostat", name(`${zn} Thermostat`), { zone_or_zonelist_name: zn, control_type_schedule_name: "Dual Setpoint Control", control_1_object_type: "ThermostatSetpoint:DualSetpoint", control_1_name: tsp });
      if (config.natvent.enabled) {
        const winArea = z.surfaceIds.map((id) => tm.surfById.get(id)).flatMap((s) => s.subsurfaceIds).map((id) => tm.subsurfaces.find((w) => w.id === id)).filter((w) => w && w.type === "Window").reduce((t, w) => t + w.area, 0);
        if (winArea > 0) {
          const nv = config.natvent;
          m.add("ZoneVentilation:WindandStackOpenArea", name(`${zn} Window Opening`), {
            zone_or_space_name: zn,
            opening_area: +(winArea * nv.openingFraction).toFixed(3),
            opening_area_fraction_schedule_name: "Occupancy",
            opening_effectiveness: "Autocalculate",
            effective_angle: 0,
            height_difference: 0,
            discharge_coefficient_for_opening: "Autocalculate",
            minimum_indoor_temperature: nv.minIndoor,
            maximum_indoor_temperature: 100,
            delta_temperature: 1,
            minimum_outdoor_temperature: nv.minOutdoor,
            maximum_outdoor_temperature: nv.maxOutdoor,
            maximum_wind_speed: nv.maxWind
          });
        }
      }
      if (config.daylight.enabled) {
        const floors = z.surfaceIds.map((id) => tm.surfById.get(id)).filter((s) => s.type === "Floor").sort((a, b) => b.area - a.area);
        if (floors[0]) {
          const fl = floors[0];
          const c = polyCentroid3(fl.vertices);
          const b = planeBasis([0, 0, 1]);
          const ring = fl.vertices.map((p) => to2D(p, [0, 0, 0], b));
          if (pointInRing(to2D(c, [0, 0, 0], b), ring)) {
            const rp2 = name(`${zn} Daylight Point`);
            const dlc = name(`${zn} Daylighting`);
            objectZone.set(dlc, z.key);
            m.add("Daylighting:ReferencePoint", rp2, { zone_or_space_name: zn, x_coordinate_of_reference_point: +c[0].toFixed(3), y_coordinate_of_reference_point: +c[1].toFixed(3), z_coordinate_of_reference_point: +(c[2] + config.daylight.height).toFixed(3) });
            m.add("Daylighting:Controls", dlc, {
              zone_or_space_name: zn,
              daylighting_method: "SplitFlux",
              lighting_control_type: "Continuous",
              minimum_input_power_fraction_for_continuous_or_continuousoff_dimming_control: 0.3,
              minimum_light_output_fraction_for_continuous_or_continuousoff_dimming_control: 0.2,
              glare_calculation_daylighting_reference_point_name: rp2,
              glare_calculation_azimuth_angle_of_view_direction_clockwise_from_zone_y_axis: 0,
              maximum_allowable_discomfort_glare_index: 22,
              control_data: [{ daylighting_reference_point_name: rp2, fraction_of_lights_controlled_by_reference_point: config.daylight.dimming ? 1 : 0, illuminance_setpoint_at_reference_point: config.daylight.setpointLux }]
            });
          }
        }
      }
    });
    if (config.hvac.fuel && config.hvac.fuel.enabled) {
      m.add("Schedule:Constant", "Heating Efficiency", { schedule_type_limits_name: "Any Number", hourly_value: config.hvac.fuel.heatingEfficiency });
      m.add("Schedule:Constant", "Cooling COP", { schedule_type_limits_name: "Any Number", hourly_value: config.hvac.fuel.coolingCop });
    }
    const hourly = ZONE_OUTPUTS.slice();
    if (config.co2.enabled) hourly.push("Zone Air CO2 Concentration");
    if (config.daylight.enabled) hourly.push("Daylighting Reference Point 1 Illuminance", "Daylighting Reference Point 1 Glare Index");
    if (config.natvent.enabled) hourly.push("Zone Ventilation Standard Density Volume Flow Rate");
    if (config.hvac.fuel && config.hvac.fuel.enabled) hourly.push("Zone Ideal Loads Supply Air Total Heating Fuel Energy", "Zone Ideal Loads Supply Air Total Cooling Fuel Energy");
    hourly.forEach((v) => m.add("Output:Variable", null, { key_value: "*", variable_name: v, reporting_frequency: "Hourly" }));
    ["Site Outdoor Air Drybulb Temperature", "Site Outdoor Air Relative Humidity", "Site Wind Speed", "Site Wind Direction", "Site Direct Solar Radiation Rate per Area", "Site Diffuse Solar Radiation Rate per Area", "Site Solar Altitude Angle", "Site Solar Azimuth Angle"].forEach((v) => m.add("Output:Variable", null, { key_value: "Environment", variable_name: v, reporting_frequency: "Hourly" }));
    ["Surface Outside Face Incident Solar Radiation Rate per Area", "Surface Inside Face Temperature", "Surface Window Transmitted Solar Radiation Energy"].forEach((v) => m.add("Output:Variable", null, { key_value: "*", variable_name: v, reporting_frequency: "Monthly" }));
    m.add("Output:VariableDictionary", null, { key_field: "IDF" });
    m.add("Output:Table:SummaryReports", null, { reports: [{ report_name: "AllSummary" }] });
    m.add("OutputControl:Table:Style", null, { column_separator: "HTML", unit_conversion: "None" });
    const schemaIssues = m.validate();
    const header = [
      `Generated by BIM2BEM from ${meta.fileName || "an IFC model"} on ${(/* @__PURE__ */ new Date()).toISOString()}`,
      `EnergyPlus ${window.EP_SCHEMA.version} (browser build via @idfkit/engine)`,
      `Scenario: ${scenario ? scenario.name : "Baseline"}`,
      `Zones ${tm.zones.length}, surfaces ${tm.surfaces.length}, openings ${tm.subsurfaces.length}`,
      "Geometry: EnergyPlus world coordinates; the IFC model was shifted so the lowest zone floor is at z = 0"
    ];
    return {
      idf: m.toIDF(header),
      model: m,
      names: { zone: zoneName, surface: surfName, subsurface: subName, objectZone },
      issues: [...issues, ...schemaIssues.map((i) => ({ severity: "critical", message: `${i.type}${i.name ? ` "${i.name}"` : ""}: ${i.field ? `${i.field} ` : ""}${i.message}` }))],
      config,
      conditioned: conds,
      ground: useKiva ? "Foundation:Kiva (2D ground heat transfer, slab on grade, no foundation insulation)" : groundFloors.length ? `Ground with monthly under-slab temperatures (${config.run.groundTemps ? "user values" : "18 \xB0C EnergyPlus default, an assumption"})` : "No ground contact"
    };
  }
  Object.assign(window, { USAGE_PROFILES, defaultConfig, applyScenario, composeIdf, exposedPerimeter, ZONE_OUTPUTS, MET_W_PER_M2, DUBOIS_AREA, pickLoads });
})();
