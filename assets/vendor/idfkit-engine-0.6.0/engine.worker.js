"use strict";
(() => {
  // src/parsers/columns.ts
  var INITIAL_CAPACITY = 64;
  var GrowableArray = class {
    constructor(Ctor) {
      this.Ctor = Ctor;
      this.array = new Ctor(INITIAL_CAPACITY);
    }
    Ctor;
    array;
    length = 0;
    push(value) {
      if (this.length === this.array.length) {
        const grown = new this.Ctor(this.array.length * 2);
        grown.set(this.array);
        this.array = grown;
      }
      this.array[this.length++] = value;
    }
    finish() {
      return this.array.slice(0, this.length);
    }
  };
  var TimestampTableBuilder = class {
    month = new GrowableArray(Uint8Array);
    day = new GrowableArray(Uint8Array);
    hour = new GrowableArray(Uint8Array);
    minute = new GrowableArray(Uint8Array);
    dayOfSimulation = new GrowableArray(Uint32Array);
    environmentIndex = new GrowableArray(Uint32Array);
    get length() {
      return this.month.length;
    }
    /** Append a row and return its index. */
    push(timestamp) {
      this.month.push(timestamp.month);
      this.day.push(timestamp.day);
      this.hour.push(timestamp.hour);
      this.minute.push(timestamp.minute);
      this.dayOfSimulation.push(timestamp.dayOfSimulation);
      this.environmentIndex.push(timestamp.environmentIndex);
      return this.month.length - 1;
    }
    finish() {
      return {
        length: this.length,
        month: this.month.finish(),
        day: this.day.finish(),
        hour: this.hour.finish(),
        minute: this.minute.finish(),
        dayOfSimulation: this.dayOfSimulation.finish(),
        environmentIndex: this.environmentIndex.finish()
      };
    }
  };
  var SeriesBuilder = class {
    values = new GrowableArray(Float64Array);
    timeIndex = new GrowableArray(Uint32Array);
    get length() {
      return this.values.length;
    }
    push(value, row) {
      this.values.push(value);
      this.timeIndex.push(row);
    }
    finish() {
      return { values: this.values.finish(), timeIndex: this.timeIndex.finish() };
    }
  };
  function seriesBuffers(series) {
    const buffers = /* @__PURE__ */ new Set();
    const tables = /* @__PURE__ */ new Set();
    for (const s of series) {
      buffers.add(s.values.buffer);
      buffers.add(s.timeIndex.buffer);
      tables.add(s.timestamps);
    }
    for (const t of tables) {
      for (const column of [t.month, t.day, t.hour, t.minute, t.dayOfSimulation, t.environmentIndex]) {
        buffers.add(column.buffer);
      }
    }
    return [...buffers];
  }

  // src/parsers/esoParser.ts
  function parseReportFrequency(freqComment) {
    const token = (freqComment ?? "").trim().toLowerCase();
    if (token.startsWith("each")) return "timestep";
    if (token.startsWith("timestep")) return "timestep";
    if (token.startsWith("hourly")) return "hourly";
    if (token.startsWith("daily")) return "daily";
    if (token.startsWith("monthly")) return "monthly";
    if (token.startsWith("runperiod") || token.startsWith("run period")) return "runperiod";
    if (token.startsWith("annual")) return "annual";
    if (token.startsWith("environment")) return "environment";
    return "timestep";
  }
  function parseVariableDefinition(line) {
    const parts = line.split(",");
    if (parts.length < 4) return null;
    const id = parseInt(parts[0] ?? "", 10);
    const numValues = parseInt(parts[1] ?? "", 10);
    if (isNaN(id) || isNaN(numValues)) return null;
    const keyValue = (parts[2] ?? "").trim();
    const remainingRaw = parts.slice(3).join(",").trim();
    const bangIndex = remainingRaw.indexOf("!");
    const freqComment = bangIndex >= 0 ? remainingRaw.slice(bangIndex + 1) : void 0;
    const remaining = (bangIndex >= 0 ? remainingRaw.slice(0, bangIndex) : remainingRaw).trim();
    const unitsMatch = remaining.match(/\[([^\]]*)\]/);
    const units = unitsMatch?.[1] ?? "";
    const variableName = remaining.replace(/\s*\[[^\]]*\]/, "").trim();
    return {
      id,
      numValues,
      keyValue,
      variableName,
      units,
      reportFrequency: parseReportFrequency(freqComment)
    };
  }
  function parseEnvironmentLine(parts) {
    return {
      title: parts[1]?.trim() || "Unknown",
      latitude: parseFloat(parts[2] ?? "") || 0,
      longitude: parseFloat(parts[3] ?? "") || 0,
      timeZone: parseFloat(parts[4] ?? "") || 0,
      elevation: parseFloat(parts[5] ?? "") || 0
    };
  }
  function parseTimestampLine(parts, environmentIndex) {
    return {
      dayOfSimulation: parseInt(parts[1] ?? "", 10) || 1,
      month: parseInt(parts[2] ?? "", 10) || 1,
      day: parseInt(parts[3] ?? "", 10) || 1,
      hour: parseInt(parts[5] ?? "", 10) || 0,
      minute: Math.round(parseFloat(parts[6] ?? "") || 0),
      environmentIndex
    };
  }
  function parseDailyLine(parts, environmentIndex) {
    return {
      dayOfSimulation: parseInt(parts[1] ?? "", 10) || 1,
      month: parseInt(parts[2] ?? "", 10) || 1,
      day: parseInt(parts[3] ?? "", 10) || 1,
      hour: 0,
      minute: 0,
      environmentIndex
    };
  }
  function parseMonthlyLine(parts, environmentIndex) {
    return {
      dayOfSimulation: parseInt(parts[1] ?? "", 10) || 1,
      month: parseInt(parts[2] ?? "", 10) || 1,
      day: 1,
      hour: 0,
      minute: 0,
      environmentIndex
    };
  }
  function parseRunPeriodLine(parts, environmentIndex) {
    return {
      dayOfSimulation: parseInt(parts[1] ?? "", 10) || 1,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      environmentIndex
    };
  }
  var ESOBuilder = class {
    programVersion = "";
    variables = /* @__PURE__ */ new Map();
    environments = [];
    series = /* @__PURE__ */ new Map();
    timestamps = new TimestampTableBuilder();
    inDataDictionary = true;
    currentTimestamp = null;
    currentRow = -1;
    environmentIndex = 0;
    finished = false;
    valueCount = 0;
    /** Process one line. Returns false at "End of Data". */
    processLine(rawLine) {
      if (this.finished) return false;
      const line = rawLine.trim();
      if (!line) return true;
      const comma = line.indexOf(",");
      const firstField = parseInt(comma >= 0 ? line.slice(0, comma) : line, 10);
      if (!this.inDataDictionary && firstField > 5) {
        if (comma < 0) return true;
        const value = parseFloat(line.slice(comma + 1));
        if (!isNaN(value) && this.currentTimestamp) {
          const series = this.series.get(firstField);
          if (series) {
            if (this.currentRow < 0) this.currentRow = this.timestamps.push(this.currentTimestamp);
            series.push(value, this.currentRow);
            this.valueCount++;
          }
        }
        return true;
      }
      if (line.startsWith("Program Version,")) {
        this.programVersion = line.substring("Program Version,".length).trim();
        return true;
      }
      if (line === "End of Data Dictionary") {
        this.inDataDictionary = false;
        return true;
      }
      if (line === "End of Data") {
        this.finished = true;
        return false;
      }
      const parts = line.split(",");
      if (this.inDataDictionary) {
        if (firstField > 5) {
          const variable = parseVariableDefinition(line);
          if (variable) {
            this.variables.set(variable.id, variable);
            this.series.set(variable.id, new SeriesBuilder());
          }
        }
        return true;
      }
      if (firstField === 1) {
        this.environments.push(parseEnvironmentLine(parts));
        this.environmentIndex = this.environments.length - 1;
        return true;
      }
      let timestamp = null;
      if (firstField === 2) timestamp = parseTimestampLine(parts, this.environmentIndex);
      else if (firstField === 3) timestamp = parseDailyLine(parts, this.environmentIndex);
      else if (firstField === 4) timestamp = parseMonthlyLine(parts, this.environmentIndex);
      else if (firstField === 5) timestamp = parseRunPeriodLine(parts, this.environmentIndex);
      if (timestamp) {
        this.currentTimestamp = timestamp;
        this.currentRow = -1;
      }
      return true;
    }
    /**
     * Build the result. Copies every column out to its exact length, so it can
     * be called mid-stream for a snapshot, at that price.
     *
     * With `release`, the timestamp table's and each series' growable buffers
     * are dropped as soon as they are copied, so the final build peaks at one
     * series' slack rather than holding every builder alongside every finished
     * copy. The builder is spent afterwards.
     */
    build(release = false) {
      const timestamps = this.timestamps.finish();
      if (release) this.timestamps = new TimestampTableBuilder();
      const timeSeries = /* @__PURE__ */ new Map();
      for (const [id, builder] of this.series) {
        const variable = this.variables.get(id);
        if (!variable) continue;
        timeSeries.set(id, { variableId: id, variable, ...builder.finish(), timestamps });
        if (release) this.series.delete(id);
      }
      if (release) this.finished = true;
      return {
        programVersion: this.programVersion,
        variables: new Map(this.variables),
        environments: [...this.environments],
        timestamps,
        timeSeries
      };
    }
  };
  function parseESO(content) {
    const builder = new ESOBuilder();
    let start = 0;
    while (start < content.length) {
      let end = content.indexOf("\n", start);
      if (end < 0) end = content.length;
      if (!builder.processLine(content.slice(start, end))) break;
      start = end + 1;
    }
    return builder.build(true);
  }

  // src/parsers/errParser.ts
  var SEVERITY_PATTERNS = {
    warning: /\*\*\s*Warning\s*\*\*/i,
    severe: /\*\*\s*Severe\s*\*\*/i,
    fatal: /\*\*\s*Fatal\s*\*\*/i
  };
  var CONTEXT_PATTERN = /^\s*\*\*\s*~~~\s*\*\*/;
  var SUCCESS_PATTERN = /EnergyPlus Completed Successfully/i;
  var TERMINATED_PATTERN = /EnergyPlus Terminated/i;
  function extractSeverity(line) {
    if (SEVERITY_PATTERNS.fatal.test(line)) return "fatal";
    if (SEVERITY_PATTERNS.severe.test(line)) return "severe";
    if (SEVERITY_PATTERNS.warning.test(line)) return "warning";
    return null;
  }
  function extractMessage(line, severity) {
    let message = line;
    switch (severity) {
      case "warning":
        message = message.replace(/\*\*\s*Warning\s*\*\*\s*/i, "");
        break;
      case "severe":
        message = message.replace(/\*\*\s*Severe\s*\*\*\s*/i, "");
        break;
      case "fatal":
        message = message.replace(/\*\*\s*Fatal\s*\*\*\s*/i, "");
        break;
    }
    return message.trim();
  }
  function extractContext(line) {
    return line.replace(CONTEXT_PATTERN, "").trim();
  }
  function parseERR(content) {
    const lines = content.split("\n");
    const entries = [];
    let currentEntry = null;
    let simulationSuccessful = false;
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      if (SUCCESS_PATTERN.test(trimmedLine)) {
        simulationSuccessful = true;
        continue;
      }
      if (TERMINATED_PATTERN.test(trimmedLine)) {
        simulationSuccessful = false;
        continue;
      }
      if (CONTEXT_PATTERN.test(trimmedLine)) {
        if (currentEntry) {
          const contextText = extractContext(trimmedLine);
          if (contextText) {
            currentEntry.context.push(contextText);
          }
        }
        continue;
      }
      const severity = extractSeverity(trimmedLine);
      if (severity) {
        if (currentEntry) {
          entries.push(currentEntry);
        }
        currentEntry = {
          severity,
          message: extractMessage(trimmedLine, severity),
          context: []
        };
      }
    }
    if (currentEntry) {
      entries.push(currentEntry);
    }
    let warningCount = 0;
    let severeCount = 0;
    let fatalCount = 0;
    for (const entry of entries) {
      switch (entry.severity) {
        case "warning":
          warningCount++;
          break;
        case "severe":
          severeCount++;
          break;
        case "fatal":
          fatalCount++;
          break;
      }
    }
    if (fatalCount > 0) {
      simulationSuccessful = false;
    }
    return {
      entries,
      warningCount,
      severeCount,
      fatalCount,
      simulationSuccessful
    };
  }

  // src/classicScript.ts
  function isBlockedEval(error) {
    return error instanceof EvalError || error instanceof Error && error.name === "EvalError";
  }
  function compileClassicScript(scriptText, epilogue = "") {
    try {
      return new Function(epilogue ? `${scriptText}
${epilogue}` : scriptText);
    } catch (error) {
      if (isBlockedEval(error)) return null;
      throw error;
    }
  }
  function importClassicScript(url) {
    const importScripts = globalThis.importScripts;
    if (typeof importScripts !== "function") {
      throw new Error(
        `The Content-Security-Policy refused to evaluate ${url}, and outside a worker it cannot be loaded any other way. Allow script-src 'unsafe-eval', or run this inside the engine worker (createEnergyPlus does).`
      );
    }
    importScripts.call(globalThis, url);
  }
  function loadClassicFactory(scriptText, factoryName, fallbackUrl) {
    const fn = compileClassicScript(scriptText, `return ${factoryName};`);
    if (fn) return fn();
    importClassicScript(fallbackUrl);
    const factory = globalThis[factoryName];
    if (typeof factory !== "function") {
      throw new Error(`${fallbackUrl} loaded but did not define ${factoryName}`);
    }
    return factory;
  }

  // src/expandobjects/fortranWasm.ts
  var moduleFactory = null;
  var factoryLoadPromise = null;
  var factoryLoadError = null;
  var iddContentCache = null;
  var cachedBaseUrl = null;
  function invalidateCacheIfBaseChanged(assetBaseUrl) {
    if (cachedBaseUrl !== null && cachedBaseUrl !== assetBaseUrl) {
      moduleFactory = null;
      factoryLoadPromise = null;
      factoryLoadError = null;
      iddContentCache = null;
    }
    cachedBaseUrl = assetBaseUrl;
  }
  async function isWasmAvailable(options) {
    try {
      const [wasmResponse, jsResponse] = await Promise.all([
        fetch(`${options.assetBaseUrl}/expandobjects.wasm`, { method: "HEAD" }),
        fetch(`${options.assetBaseUrl}/expandobjects.js`, { method: "HEAD" })
      ]);
      return wasmResponse.ok && jsResponse.ok;
    } catch {
      return false;
    }
  }
  async function loadExpandObjectsWasm(options) {
    invalidateCacheIfBaseChanged(options.assetBaseUrl);
    if (factoryLoadPromise) {
      return factoryLoadPromise;
    }
    factoryLoadPromise = (async () => {
      try {
        const available = await isWasmAvailable(options);
        if (!available) {
          factoryLoadError = `ExpandObjects WASM files were not found at ${options.assetBaseUrl}. Check that assetBaseUrl points at a complete engine asset directory.`;
          return false;
        }
        const jsUrl = `${options.assetBaseUrl}/expandobjects.js`;
        const response = await fetch(jsUrl, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error(`Failed to fetch expandobjects.js: ${String(response.status)}`);
        }
        const scriptText = await response.text();
        moduleFactory = loadClassicFactory(scriptText, "createExpandObjectsModule", jsUrl);
        return true;
      } catch (error) {
        factoryLoadError = error instanceof Error ? error.message : String(error);
        return false;
      }
    })();
    const loaded = await factoryLoadPromise;
    if (!loaded) {
      factoryLoadPromise = null;
    }
    return loaded;
  }
  async function createFreshModule(assetBaseUrl) {
    if (!moduleFactory) {
      throw new Error("Module factory not loaded - call loadExpandObjectsWasm() first");
    }
    return moduleFactory({
      noInitialRun: true,
      locateFile: (path) => {
        if (path.endsWith(".wasm")) {
          return `${assetBaseUrl}/expandobjects.wasm`;
        }
        return `${assetBaseUrl}/${path}`;
      },
      print: () => {
      },
      printErr: () => {
      }
    });
  }
  function containsHVACTemplates(idfContent) {
    return /HVACTemplate:/i.test(idfContent);
  }
  function needsExpansion(idfContent) {
    return containsHVACTemplates(idfContent) || /GroundHeatTransfer:/i.test(idfContent);
  }
  function countTemplates(idfContent) {
    const templateRegex = /^\s*(HVACTemplate:[A-Za-z:]+)/gim;
    const types = /* @__PURE__ */ new Set();
    let count = 0;
    let match;
    while ((match = templateRegex.exec(idfContent)) !== null) {
      count++;
      if (match[1]) {
        types.add(match[1]);
      }
    }
    return { count, types: Array.from(types) };
  }
  function countObjects(idfContent) {
    let count = 0;
    for (const line of idfContent.split("\n")) {
      const withoutComment = line.split("!")[0] ?? "";
      for (const char of withoutComment) {
        if (char === ";") count++;
      }
    }
    return count;
  }
  function readOptionalFile(module, path) {
    try {
      const text = module.FS.readFile(path, { encoding: "utf8" });
      return text.trim().length > 0 ? text : void 0;
    } catch {
      return void 0;
    }
  }
  async function expandObjects(idfContent, options) {
    const stats = {
      templatesFound: 0,
      templatesExpanded: 0,
      objectsCreated: 0,
      templateTypes: []
    };
    if (!needsExpansion(idfContent)) {
      return {
        success: true,
        expandedIDF: idfContent,
        errors: [],
        warnings: [],
        stats
      };
    }
    const { count, types } = countTemplates(idfContent);
    stats.templatesFound = count;
    stats.templateTypes = types;
    const loaded = await loadExpandObjectsWasm(options);
    if (!loaded || !moduleFactory) {
      return {
        success: false,
        expandedIDF: idfContent,
        errors: [
          {
            message: factoryLoadError || "ExpandObjects WASM module not available"
          }
        ],
        warnings: [
          "HVACTemplate objects cannot be expanded without the preprocessor.",
          `Check that expandobjects.wasm and expandobjects.js exist at ${options.assetBaseUrl}.`
        ],
        stats
      };
    }
    try {
      if (!iddContentCache) {
        const iddResponse = await fetch(`${options.assetBaseUrl}/Energy+.idd`, {
          credentials: "same-origin"
        });
        if (!iddResponse.ok) {
          return {
            success: false,
            expandedIDF: idfContent,
            errors: [{ message: `Failed to fetch Energy+.idd: ${String(iddResponse.status)}` }],
            warnings: [],
            stats
          };
        }
        iddContentCache = await iddResponse.text();
      }
      const wasmModule2 = await createFreshModule(options.assetBaseUrl);
      wasmModule2.FS.writeFile("/Energy+.idd", iddContentCache);
      wasmModule2.FS.writeFile("/in.idf", idfContent);
      const exitCode = wasmModule2.callMain(["/in.idf", "/expanded.idf"]);
      if (exitCode !== 0) {
        return {
          success: false,
          expandedIDF: idfContent,
          errors: [
            {
              message: `ExpandObjects exited with code ${String(exitCode)}`
            }
          ],
          warnings: [],
          stats
        };
      }
      const expandedIDF = wasmModule2.FS.readFile("/expanded.idf", {
        encoding: "utf8"
      });
      const groundHeatTransfer = {};
      const slabInput = readOptionalFile(wasmModule2, "/GHTIn.idf");
      if (slabInput) groundHeatTransfer.slabInput = slabInput;
      const basementInput = readOptionalFile(wasmModule2, "/BasementGHTIn.idf");
      if (basementInput) groundHeatTransfer.basementInput = basementInput;
      const { count: expandedCount } = countTemplates(expandedIDF);
      stats.templatesExpanded = stats.templatesFound - expandedCount;
      stats.objectsCreated = Math.max(0, countObjects(expandedIDF) - countObjects(idfContent));
      return {
        success: true,
        expandedIDF,
        errors: [],
        warnings: [],
        stats,
        groundHeatTransfer
      };
    } catch (error) {
      return {
        success: false,
        expandedIDF: idfContent,
        errors: [
          {
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        warnings: [],
        stats
      };
    }
  }

  // src/groundheat/basement.ts
  var moduleFactory2 = null;
  var factoryLoadPromise2 = null;
  var factoryLoadError2 = null;
  var iddCache = null;
  var cachedBaseUrl2 = null;
  function invalidateCacheIfBaseChanged2(assetBaseUrl) {
    if (cachedBaseUrl2 !== null && cachedBaseUrl2 !== assetBaseUrl) {
      moduleFactory2 = null;
      factoryLoadPromise2 = null;
      factoryLoadError2 = null;
      iddCache = null;
    }
    cachedBaseUrl2 = assetBaseUrl;
  }
  async function loadBasementWasm(options) {
    invalidateCacheIfBaseChanged2(options.assetBaseUrl);
    if (factoryLoadPromise2) return factoryLoadPromise2;
    factoryLoadPromise2 = (async () => {
      try {
        const response = await fetch(`${options.assetBaseUrl}/basement.js`, {
          credentials: "same-origin"
        });
        if (!response.ok) {
          factoryLoadError2 = `Basement WASM not found at ${options.assetBaseUrl} (${String(response.status)}). Basement ground heat transfer models need basement.wasm, basement.js and BasementGHT.idd in the asset set.`;
          return false;
        }
        const scriptText = await response.text();
        moduleFactory2 = loadClassicFactory(
          scriptText,
          "createBasementModule",
          `${options.assetBaseUrl}/basement.js`
        );
        return true;
      } catch (error) {
        factoryLoadError2 = error instanceof Error ? error.message : String(error);
        return false;
      }
    })();
    const loaded = await factoryLoadPromise2;
    if (!loaded) factoryLoadPromise2 = null;
    return loaded;
  }
  function parseMonthlyTemperatures(csv) {
    const rows = [];
    for (const line of csv.split("\n").slice(2)) {
      if (!line.trim()) continue;
      const fields = line.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
      if (fields.length < 9) continue;
      const month = Number.parseInt(fields[0] ?? "", 10);
      if (!Number.isFinite(month) || month < 1 || month > 12) continue;
      const values = [fields[2], fields[4], fields[6], fields[8]].map((f) => Number.parseFloat(f ?? ""));
      if (!values.every((v) => Number.isFinite(v))) continue;
      rows.push({
        month,
        wall: values[0],
        floor: values[1],
        upperWall: values[2],
        lowerWall: values[3]
      });
    }
    return rows.length > 0 ? rows : void 0;
  }
  async function runBasement(basementInput, epw, options) {
    const loaded = await loadBasementWasm(options);
    if (!loaded || !moduleFactory2) {
      return {
        success: false,
        objects: "",
        errors: [factoryLoadError2 ?? "Basement preprocessor is not available"]
      };
    }
    try {
      if (!iddCache) {
        const res = await fetch(`${options.assetBaseUrl}/BasementGHT.idd`, {
          credentials: "same-origin"
        });
        if (!res.ok) {
          return {
            success: false,
            objects: "",
            errors: [`Failed to fetch BasementGHT.idd: ${String(res.status)}`]
          };
        }
        iddCache = await res.text();
      }
      const module = await moduleFactory2({
        noInitialRun: true,
        locateFile: (path) => path.endsWith(".wasm") ? `${options.assetBaseUrl}/basement.wasm` : `${options.assetBaseUrl}/${path}`,
        print: () => void 0,
        printErr: () => void 0
      });
      module.FS.writeFile("/BasementGHT.idd", iddCache);
      module.FS.writeFile("/BasementGHTIn.idf", basementInput);
      module.FS.writeFile("/in.epw", epw);
      module.callMain([]);
      let objects;
      try {
        objects = module.FS.readFile("/EPObjects.TXT", { encoding: "utf8" });
      } catch {
        let errorLog;
        try {
          errorLog = module.FS.readFile("/eplusout.err", { encoding: "utf8" });
        } catch {
        }
        return {
          success: false,
          objects: "",
          ...errorLog ? { errorLog } : {},
          errors: ["Basement produced no EPObjects.TXT; the ground temperatures were not computed"]
        };
      }
      if (!/SurfaceProperty:OtherSideCoefficients/i.test(objects)) {
        return {
          success: false,
          objects: "",
          errors: [
            "Basement output contains no OtherSideCoefficients objects, so the expanded model's ground-contact surfaces would reference undefined names"
          ]
        };
      }
      let monthly;
      try {
        const csv = module.FS.readFile("/MonthlyResults.csv", { encoding: "utf8" });
        monthly = parseMonthlyTemperatures(csv);
      } catch {
      }
      return {
        success: true,
        objects,
        errors: [],
        ...monthly ? { monthlyTemperatures: monthly } : {}
      };
    } catch (error) {
      return {
        success: false,
        objects: "",
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  // src/groundheat/slab.ts
  var moduleFactory3 = null;
  var factoryLoadPromise3 = null;
  var factoryLoadError3 = null;
  var iddCache2 = null;
  var cachedBaseUrl3 = null;
  function invalidateCacheIfBaseChanged3(assetBaseUrl) {
    if (cachedBaseUrl3 !== null && cachedBaseUrl3 !== assetBaseUrl) {
      moduleFactory3 = null;
      factoryLoadPromise3 = null;
      factoryLoadError3 = null;
      iddCache2 = null;
    }
    cachedBaseUrl3 = assetBaseUrl;
  }
  async function loadSlabWasm(options) {
    invalidateCacheIfBaseChanged3(options.assetBaseUrl);
    if (factoryLoadPromise3) return factoryLoadPromise3;
    factoryLoadPromise3 = (async () => {
      try {
        const response = await fetch(`${options.assetBaseUrl}/slab.js`, {
          credentials: "same-origin"
        });
        if (!response.ok) {
          factoryLoadError3 = `Slab WASM not found at ${options.assetBaseUrl} (${String(response.status)}). Ground heat transfer models need slab.wasm, slab.js and SlabGHT.idd in the asset set.`;
          return false;
        }
        const scriptText = await response.text();
        moduleFactory3 = loadClassicFactory(
          scriptText,
          "createSlabModule",
          `${options.assetBaseUrl}/slab.js`
        );
        return true;
      } catch (error) {
        factoryLoadError3 = error instanceof Error ? error.message : String(error);
        return false;
      }
    })();
    const loaded = await factoryLoadPromise3;
    if (!loaded) factoryLoadPromise3 = null;
    return loaded;
  }
  function parseMonthlyTemperatures2(report) {
    const rows = [];
    for (const line of report.split("\n")) {
      const m = /^!\s+(\d{1,2})\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s/.exec(line);
      if (!m) continue;
      const month = Number.parseInt(m[1] ?? "", 10);
      if (!Number.isFinite(month) || month < 1 || month > 12) continue;
      rows.push({
        month,
        average: Number.parseFloat(m[2] ?? ""),
        perimeter: Number.parseFloat(m[3] ?? ""),
        core: Number.parseFloat(m[4] ?? "")
      });
    }
    return rows.length > 0 ? rows : void 0;
  }
  async function runSlab(slabInput, epw, options) {
    const loaded = await loadSlabWasm(options);
    if (!loaded || !moduleFactory3) {
      return {
        success: false,
        objects: "",
        errors: [factoryLoadError3 ?? "Slab preprocessor is not available"]
      };
    }
    try {
      if (!iddCache2) {
        const res = await fetch(`${options.assetBaseUrl}/SlabGHT.idd`, {
          credentials: "same-origin"
        });
        if (!res.ok) {
          return {
            success: false,
            objects: "",
            errors: [`Failed to fetch SlabGHT.idd: ${String(res.status)}`]
          };
        }
        iddCache2 = await res.text();
      }
      const module = await moduleFactory3({
        noInitialRun: true,
        locateFile: (path) => path.endsWith(".wasm") ? `${options.assetBaseUrl}/slab.wasm` : `${options.assetBaseUrl}/${path}`,
        print: () => void 0,
        printErr: () => void 0
      });
      module.FS.writeFile("/SlabGHT.idd", iddCache2);
      module.FS.writeFile("/GHTIn.idf", slabInput);
      module.FS.writeFile("/in.epw", epw);
      module.callMain([]);
      let report;
      try {
        report = module.FS.readFile("/SLABSurfaceTemps.TXT", { encoding: "utf8" });
      } catch {
        let errorLog;
        try {
          errorLog = module.FS.readFile("/eplusout.err", { encoding: "utf8" });
        } catch {
        }
        return {
          success: false,
          objects: "",
          ...errorLog ? { errorLog } : {},
          errors: ["Slab produced no SLABSurfaceTemps.TXT; the ground temperatures were not computed"]
        };
      }
      if (!/SurfaceProperty:OtherSideCoefficients/i.test(report)) {
        return {
          success: false,
          objects: "",
          errors: [
            "Slab output contains no OtherSideCoefficients objects, so the expanded model's ground-contact surfaces would reference undefined names"
          ]
        };
      }
      const monthly = parseMonthlyTemperatures2(report);
      return {
        success: true,
        objects: report,
        errors: [],
        ...monthly ? { monthlyTemperatures: monthly } : {}
      };
    } catch (error) {
      return {
        success: false,
        objects: "",
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  // src/staging.ts
  function stagedPathFor(key) {
    return `/${key}`;
  }
  function resolveModelPath(raw) {
    const trimmed = raw.trim();
    if (trimmed === "") return { unstageable: "empty" };
    if (trimmed.includes("\\") || /^[A-Za-z]:/.test(trimmed)) {
      return { unstageable: "windows" };
    }
    if (trimmed.startsWith("/")) return { unstageable: "absolute" };
    const segments = [];
    for (const segment of trimmed.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") return { unstageable: "escapes" };
      segments.push(segment);
    }
    if (segments.length === 0) return { unstageable: "empty" };
    return { path: `/${segments.join("/")}` };
  }

  // src/idf/lexer.ts
  function lex(text, options = {}) {
    const objects = [];
    const report = options.onDiagnostic;
    const length = text.length;
    let chunks = [];
    let values = [];
    let index = 0;
    let line = 1;
    let fieldStart = 0;
    let objectLine = 1;
    let objectStarted = false;
    const endField = (end) => {
      chunks.push(text.slice(fieldStart, end));
      const value = chunks.join("").trim();
      chunks = [];
      return value;
    };
    while (index < length) {
      const char = text[index];
      if (char === "!") {
        chunks.push(text.slice(fieldStart, index));
        const newline = text.indexOf("\n", index);
        if (newline === -1) {
          index = length;
          fieldStart = length;
          break;
        }
        index = newline + 1;
        fieldStart = index;
        line += 1;
        if (!objectStarted && chunks.join("").trim() === "") {
          chunks = [];
          objectLine = line;
        }
        continue;
      }
      if (char === ",") {
        values.push(endField(index));
        objectStarted = true;
        index += 1;
        fieldStart = index;
        continue;
      }
      if (char === ";") {
        values.push(endField(index));
        index += 1;
        fieldStart = index;
        const typeName = values.shift() ?? "";
        if (typeName === "") {
          report?.({ message: "Object with no type name", line: objectLine });
        } else {
          objects.push({ typeName, values, line: objectLine });
        }
        values = [];
        objectStarted = false;
        objectLine = line;
        continue;
      }
      if (char === "\n") {
        line += 1;
        if (!objectStarted && chunks.join("").trim() === "" && text.slice(fieldStart, index).trim() === "") {
          chunks = [];
          fieldStart = index + 1;
          objectLine = line;
        }
      }
      index += 1;
    }
    const trailing = (chunks.join("") + text.slice(fieldStart, length)).trim();
    if (trailing !== "" || values.length > 0) {
      report?.({
        message: `Unterminated object near "${trailing.slice(0, 40) || values[0]}" (missing ";")`,
        line: objectLine
      });
    }
    return objects;
  }

  // src/idf/externalFiles.ts
  var FILE_FIELDS = {
    "schedule:file": { field: "file_name", index: 2, nameIndex: 0 },
    // The name field IS the file: this object is a singleton with no name.
    "schedule:file:shading": { field: "file_name", index: 0 },
    "table:lookup": { field: "external_file_name", index: 7, nameIndex: 0 },
    "table:independentvariable": { field: "external_file_name", index: 7, nameIndex: 0 },
    "chiller:electric:ashrae205": { field: "representation_file_name", index: 1, nameIndex: 0 },
    "coil:dx:ashrae205:performance": { field: "representation_file_name", index: 1, nameIndex: 0 },
    "construction:windowdatafile": { field: "file_name", index: 1, nameIndex: 0 }
  };
  function detectExternalFileReferences(idf) {
    const references = [];
    for (const object of lex(idf)) {
      const spec = FILE_FIELDS[object.typeName.trim().toLowerCase()];
      if (!spec) continue;
      const path = object.values[spec.index]?.trim();
      if (!path) continue;
      const name = spec.nameIndex === void 0 ? void 0 : object.values[spec.nameIndex]?.trim() || void 0;
      references.push({
        objectType: canonicalType(object.typeName),
        ...name ? { objectName: name } : {},
        field: spec.field,
        path,
        line: object.line
      });
    }
    return references;
  }
  function canonicalType(written) {
    const key = written.trim().toLowerCase();
    return CANONICAL_NAMES[key] ?? written.trim();
  }
  var CANONICAL_NAMES = {
    "schedule:file": "Schedule:File",
    "schedule:file:shading": "Schedule:File:Shading",
    "table:lookup": "Table:Lookup",
    "table:independentvariable": "Table:IndependentVariable",
    "chiller:electric:ashrae205": "Chiller:Electric:ASHRAE205",
    "coil:dx:ashrae205:performance": "Coil:DX:ASHRAE205:Performance",
    "construction:windowdatafile": "Construction:WindowDataFile"
  };

  // src/idf/missingFiles.ts
  function findMissingFiles(idf, stagedKeys, enginePaths = []) {
    const staged = /* @__PURE__ */ new Set([...stagedKeys.map(stagedPathFor), ...enginePaths]);
    const byLowerCase = /* @__PURE__ */ new Map();
    for (const path of staged) byLowerCase.set(path.toLowerCase(), path);
    const missing = [];
    for (const reference of detectExternalFileReferences(idf)) {
      const resolved = resolveModelPath(reference.path);
      if ("unstageable" in resolved) {
        missing.push({ reference, reason: resolved.unstageable });
        continue;
      }
      if (staged.has(resolved.path)) continue;
      const nearMiss = byLowerCase.get(resolved.path.toLowerCase());
      missing.push(
        nearMiss ? { reference, reason: "case", suggestion: nearMiss } : { reference, reason: "missing" }
      );
    }
    return missing;
  }
  function describeMissingFiles(missing) {
    const lines = missing.map((entry) => `  ${describeOne(entry)}`);
    return `This model reads ${missing.length === 1 ? "a file" : "files"} that ${missing.length === 1 ? "was" : "were"} not supplied:
${lines.join("\n")}
Pass the file contents to run({ idf, files }), keyed by the path the model names.`;
  }
  function describeOne({ reference, reason, suggestion }) {
    const where = `${identify(reference)} (line ${String(reference.line)}) names ${reference.field} "${reference.path}"`;
    switch (reason) {
      case "case":
        return `${where}, but files has "${(suggestion ?? "").replace(/^\//, "")}". The simulation filesystem is case-sensitive.`;
      case "absolute":
        return `${where}, an absolute path. Staged files are relative to the model, so make it relative.`;
      case "windows":
        return `${where}, a Windows path. Use forward slashes; a backslash is not a separator here.`;
      case "escapes":
        return `${where}, which points outside the model's directory. Staged files cannot go there.`;
      case "empty":
        return `${where}, which is empty.`;
      default:
        return `${where}.`;
    }
  }
  function identify(reference) {
    return reference.objectName ? `${reference.objectType} "${reference.objectName}"` : reference.objectType;
  }

  // src/outputs.ts
  var OUTPUT_NAMES = [
    "eso",
    "mtr",
    "rdd",
    "mdd",
    "csv",
    "html",
    "sql"
  ];
  var DEFAULT_OUTPUT_SELECTION = {
    eso: true,
    mtr: true,
    rdd: true,
    mdd: true,
    csv: true,
    html: true,
    sql: true
  };
  function resolveOutputSelection(selection) {
    if (!selection) return { ...DEFAULT_OUTPUT_SELECTION };
    const resolved = { ...DEFAULT_OUTPUT_SELECTION };
    for (const name of OUTPUT_NAMES) {
      const value = selection[name];
      if (value !== void 0) resolved[name] = value;
    }
    return resolved;
  }
  function omittedOutputs(resolved) {
    return OUTPUT_NAMES.filter((name) => !resolved[name]);
  }

  // src/worker/wasmException.ts
  var HEADER_BYTES = 24;
  var TYPE_FIELD = 4;
  var TYPE_NAME_FIELD = 4;
  var MESSAGE_FIELDS = [4, 8, 12, 16, 20];
  var MAX_MESSAGE_BYTES = 1024;
  var MAX_NAME_BYTES = 256;
  var MIN_MESSAGE_LENGTH = 4;
  var LOWEST_PLAUSIBLE_POINTER = 1024;
  function readCString(heap, pointer, maxBytes) {
    if (!Number.isInteger(pointer) || pointer < LOWEST_PLAUSIBLE_POINTER) return null;
    if (pointer >= heap.length) return null;
    let text = "";
    const end = Math.min(pointer + maxBytes, heap.length);
    for (let at = pointer; at < end; at++) {
      const byte = heap[at];
      if (byte === void 0) return null;
      if (byte === 0) return text;
      if (byte !== 9 && byte !== 10 && (byte < 32 || byte > 126)) return null;
      text += String.fromCharCode(byte);
    }
    return null;
  }
  function demangleTypeName(mangled) {
    const nested = mangled.startsWith("N");
    let rest = nested ? mangled.slice(1) : mangled;
    const parts = [];
    if (rest.startsWith("St")) {
      parts.push("std");
      rest = rest.slice(2);
    }
    while (rest.length > 0 && rest !== "E") {
      const length = /^\d+/.exec(rest);
      if (!length?.[0]) return mangled;
      const digits = length[0];
      const size = Number.parseInt(digits, 10);
      const name = rest.slice(digits.length, digits.length + size);
      if (name.length !== size) return mangled;
      parts.push(name);
      rest = rest.slice(digits.length + size);
    }
    if (rest !== (nested ? "E" : "")) return mangled;
    if (parts.length === 0) return mangled;
    return parts.join("::");
  }
  function fromExceptionHelper(raw) {
    if (typeof raw === "string" && raw !== "") return { type: null, message: raw };
    if (!Array.isArray(raw)) return null;
    const [type, message] = raw;
    const decoded = {
      type: typeof type === "string" && type !== "" ? demangleTypeName(type) : null,
      message: typeof message === "string" && message !== "" ? message : null
    };
    return decoded.type !== null || decoded.message !== null ? decoded : null;
  }
  function isWasmException(thrown) {
    const Exception = globalThis.WebAssembly?.Exception;
    return typeof Exception === "function" && thrown instanceof Exception;
  }
  function decodeException(module, thrown) {
    if (typeof module.getExceptionMessage === "function") {
      try {
        const decoded = fromExceptionHelper(module.getExceptionMessage(thrown));
        if (decoded) return decoded;
      } catch {
      }
    }
    if (isWasmException(thrown)) return { type: "WebAssembly.Exception", message: null };
    if (typeof thrown !== "number" || !Number.isInteger(thrown)) return null;
    const pointer = thrown >>> 0;
    if (pointer <= HEADER_BYTES) return null;
    const bytes = module.HEAPU8;
    const words = module.HEAPU32;
    if (!bytes || !words) return null;
    const lastField = MESSAGE_FIELDS[MESSAGE_FIELDS.length - 1] ?? 0;
    if (pointer + lastField + 4 > bytes.length) return null;
    const typeInfo = words[pointer - HEADER_BYTES + TYPE_FIELD >>> 2];
    const mangled = typeInfo === void 0 || typeInfo === 0 ? null : readCString(bytes, (words[(typeInfo >>> 0) + TYPE_NAME_FIELD >>> 2] ?? 0) >>> 0, MAX_NAME_BYTES);
    let message = null;
    for (const field of MESSAGE_FIELDS) {
      const candidate = words[pointer + field >>> 2];
      if (candidate === void 0) break;
      const text = readCString(bytes, candidate >>> 0, MAX_MESSAGE_BYTES);
      if (text !== null && text.length >= MIN_MESSAGE_LENGTH) {
        message = text;
        break;
      }
    }
    if (mangled === null && message === null) return null;
    return { type: mangled === null ? null : demangleTypeName(mangled), message };
  }
  function formatException(decoded) {
    if (decoded.type && decoded.message) return `${decoded.type}: ${decoded.message}`;
    if (decoded.message) return decoded.message;
    if (decoded.type) return `${decoded.type} (no message recovered)`;
    return null;
  }
  function describeThrown(module, thrown) {
    const decoded = decodeException(module, thrown);
    const described = decoded ? formatException(decoded) : null;
    if (decoded && described) return { text: described, crash: decoded };
    if (thrown instanceof Error) return { text: thrown.message, crash: null };
    if (thrown && typeof thrown === "object") {
      const message = thrown.message;
      if (typeof message === "string" && message !== "") return { text: message, crash: null };
    }
    return { text: String(thrown), crash: null };
  }

  // src/protocol.ts
  var DEFAULT_WASM_FILE = "energyplus.js-26.2.wasm";
  var CANCEL_SLOT_ACKNOWLEDGED = 1;

  // src/worker/engineWorker.ts
  var config = null;
  var wasmModule = null;
  var isRunning = false;
  var shouldCancel = false;
  var cancelFlags = null;
  var runConsole = [];
  var stagedPaths = [];
  function send(message, transfer = []) {
    self.postMessage(message, transfer);
  }
  function sendConsole(text) {
    runConsole.push(text);
    send({ type: "console", text });
  }
  function sendProgress(phase, progress, message) {
    const update = { phase, progress, message, timestamp: Date.now() };
    send({ type: "progress", update });
  }
  function requireConfig() {
    if (!config) {
      throw new Error("Engine worker used before init.");
    }
    return config;
  }
  function stageProcCmdline(module, args) {
    for (const dir of ["/proc", "/proc/self"]) {
      try {
        module.FS.mkdir(dir);
      } catch {
      }
    }
    module.FS.writeFile("/proc/self/cmdline", `energyplus\0${args.join("\0")}\0`);
  }
  function assetUrl(...segments) {
    return `${requireConfig().assetBaseUrl}/${segments.join("/")}`;
  }
  async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Timed out after ${String(timeoutMs)}ms fetching ${url}`);
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }
  function detectProgress(line) {
    if (line.includes("Initializing New Environment Parameters")) {
      return { phase: "initializing", progress: 5 };
    }
    if (line.includes("Warming up")) {
      return { phase: "warmup", progress: 12 };
    }
    if (line.includes("Starting Simulation at")) {
      return { phase: "simulation", progress: 30 };
    }
    const coverage = /Updating Coverage of Annual Simulation at\s+([\d.]+)%/.exec(line);
    if (coverage?.[1]) {
      const pct = Number.parseFloat(coverage[1]);
      if (Number.isFinite(pct)) {
        return { phase: "simulation", progress: 30 + pct / 100 * 60 };
      }
    }
    if (line.includes("Writing tabular output file results")) {
      return { phase: "postprocess", progress: 95 };
    }
    if (line.includes("EnergyPlus Completed Successfully")) {
      return { phase: "complete", progress: 100 };
    }
    return null;
  }
  function emitConsoleWithProgress(text) {
    sendConsole(text);
    const detected = detectProgress(text);
    if (detected) {
      sendProgress(detected.phase, Math.round(detected.progress), text.trim());
    }
  }
  function createMockRequire() {
    const mockPath = {
      isAbsolute: (p) => p.startsWith("/"),
      normalize: (p) => {
        const parts = p.split("/").filter((part, i) => part !== "." && (part !== "" || i === 0));
        const result = [];
        for (const part of parts) {
          if (part === "..") result.pop();
          else result.push(part);
        }
        return result.join("/") || "/";
      },
      dirname: (p) => {
        const lastSlash = p.lastIndexOf("/");
        return lastSlash > 0 ? p.substring(0, lastSlash) : "/";
      },
      basename: (p) => {
        const lastSlash = p.lastIndexOf("/");
        return lastSlash >= 0 ? p.substring(lastSlash + 1) : p;
      },
      join: (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
      join2: (a, b) => `${a}/${b}`.replace(/\/+/g, "/"),
      posix: {
        resolve: (...paths) => mockPath.normalize(paths.filter(Boolean).join("/")),
        relative: (from, to) => {
          const fromParts = from.split("/").filter(Boolean);
          const toParts = to.split("/").filter(Boolean);
          let i = 0;
          while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
          const upCount = fromParts.length - i;
          return [...Array(upCount).fill(".."), ...toParts.slice(i)].join("/") || ".";
        }
      }
    };
    const mockFs = {
      readFileSync: () => {
        throw new Error("readFileSync not available in browser");
      },
      writeFileSync: () => {
        throw new Error("writeFileSync not available in browser");
      },
      existsSync: () => false,
      mkdirSync: () => {
      },
      readdirSync: () => [],
      statSync: () => ({ isDirectory: () => false, isFile: () => true }),
      lstatSync: () => ({ mode: 420, isSymbolicLink: () => false }),
      openSync: () => 0,
      closeSync: () => {
      },
      readSync: () => 0,
      writeSync: () => 0,
      fstatSync: () => ({ size: 0, mode: 420 }),
      unlinkSync: () => {
      },
      rmdirSync: () => {
      },
      renameSync: () => {
      },
      chmodSync: () => {
      },
      chownSync: () => {
      },
      utimesSync: () => {
      },
      truncateSync: () => {
      },
      ftruncateSync: () => {
      },
      fchmodSync: () => {
      },
      futimesSync: () => {
      },
      fchownSync: () => {
      },
      symlinkSync: () => {
      },
      readlinkSync: () => "",
      statfsSync: () => ({ bsize: 4096, blocks: 0, bfree: 0, bavail: 0 })
    };
    return (moduleName) => {
      switch (moduleName) {
        case "path":
          return mockPath;
        case "fs":
          return mockFs;
        case "crypto":
          return { randomFillSync: (view) => crypto.getRandomValues(view) };
        default:
          return {};
      }
    };
  }
  function setupNodeMocks() {
    const g = self;
    if (!g["process"]) {
      g["process"] = {
        platform: "browser",
        cwd: () => "/",
        chdir: () => {
        },
        argv: ["energyplus"],
        env: {},
        versions: {},
        stdin: { fd: 0 },
        stdout: { fd: 1 },
        stderr: { fd: 2 },
        binding: () => ({ fs: {} }),
        exitCode: 0
      };
    }
    if (!g["Buffer"]) {
      g["Buffer"] = {
        alloc: (size) => new Uint8Array(size),
        from: (data) => new Uint8Array(data)
      };
    }
    if (!g["__filename"]) g["__filename"] = "/energyplus.js";
    if (!g["__dirname"]) g["__dirname"] = "/";
  }
  async function loadScriptInWorker(url, useNodeMocks) {
    const response = await fetchWithTimeout(
      url,
      { credentials: "same-origin" },
      requireConfig().loadTimeoutMs
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch script: ${String(response.status)} ${response.statusText}`);
    }
    const scriptText = await response.text();
    if (useNodeMocks) {
      setupNodeMocks();
      self["require"] = createMockRequire();
    }
    const g = globalThis;
    g["Module"] = self["Module"];
    if (!g["global"]) g["global"] = g;
    g["global"]["Module"] = g["Module"];
    const fn = compileClassicScript(scriptText);
    if (!fn) {
      importClassicScript(url);
      sendConsole(`Loaded ${url} with importScripts: the Content-Security-Policy forbids eval`);
      return;
    }
    try {
      fn.call(self);
      self["Module"] = g["Module"];
    } catch {
      const globalEval = eval;
      globalEval(scriptText);
    }
  }
  function describeWasmFetchFailure(wasmUrl, status) {
    const base = `Failed to fetch the engine binary (HTTP ${String(status)}): ${wasmUrl}`;
    if (status !== 404) return base;
    return `${base}
No such file. wasmFile defaults to "${DEFAULT_WASM_FILE}", which only the 26.2 asset package contains -- pass the \`wasmFile\` export of the asset package you are pointing assetBaseUrl at: import { assetBaseUrl, wasmFile } from '@idfkit/engine-assets'.`;
  }
  async function loadWasmWithConfig(jsUrl, wasmUrl, useNodeMocks, timeoutMs) {
    let compiledModule = null;
    let compilationError = null;
    try {
      const wasmResponse = await fetchWithTimeout(
        wasmUrl,
        { credentials: "same-origin" },
        timeoutMs
      );
      if (!wasmResponse.ok) {
        throw new Error(describeWasmFetchFailure(wasmUrl, wasmResponse.status));
      }
      const wasmBytes = await wasmResponse.arrayBuffer();
      compiledModule = await WebAssembly.compile(wasmBytes);
    } catch (err) {
      compilationError = err instanceof Error ? err : new Error(String(err));
      sendConsole(`WASM pre-compilation failed: ${compilationError.message}`);
    }
    return new Promise((resolve, reject) => {
      if (compilationError) {
        reject(compilationError);
        return;
      }
      let resolved = false;
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        const moduleObj = globalThis["Module"];
        const hasCallMain = Boolean(moduleObj && typeof moduleObj["callMain"] === "function");
        reject(
          new Error(
            `WASM loading timed out after ${String(timeoutMs)}ms (hasCallMain=${String(hasCallMain)})`
          )
        );
      }, timeoutMs);
      const moduleConfig = {
        locateFile: (path) => path.endsWith(".wasm") ? wasmUrl : assetUrl(path),
        print: (text) => {
          emitConsoleWithProgress(text);
        },
        printErr: (text) => {
          emitConsoleWithProgress(`[stderr] ${text}`);
        },
        noInitialRun: true,
        onRuntimeInitialized: () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          const moduleObj = globalThis["Module"];
          if (moduleObj && typeof moduleObj["callMain"] === "function") {
            resolve(moduleObj);
          } else {
            reject(new Error("onRuntimeInitialized fired but callMain was not available"));
          }
        },
        instantiateWasm: (imports, successCallback) => {
          if (!compiledModule) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              reject(new Error("WASM module was not pre-compiled"));
            }
            return {};
          }
          WebAssembly.instantiate(compiledModule, imports).then((instance) => {
            successCallback(instance);
          }).catch((err) => {
            sendConsole(
              `WASM instantiation error: ${err instanceof Error ? err.message : String(err)}`
            );
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
          return {};
        }
      };
      self["Module"] = moduleConfig;
      void (async () => {
        try {
          await loadScriptInWorker(jsUrl, useNodeMocks);
          if (resolved) return;
          const moduleObj = globalThis["Module"];
          if (moduleObj && typeof moduleObj.ready === "object") {
            const readyModule = await moduleObj.ready;
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(readyModule);
            }
            return;
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }
      })();
    });
  }
  async function loadRequiredDataFiles(module) {
    try {
      const response = await fetch(assetUrl("Energy+.idd"), { credentials: "same-origin" });
      if (!response.ok) {
        throw new Error(`Failed to fetch IDD: ${String(response.status)} ${response.statusText}`);
      }
      module.FS.writeFile("/Energy+.idd", await response.text());
    } catch (error) {
      sendConsole(
        `Warning: failed to load Energy+.idd: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    try {
      module.FS.mkdir("/datasets");
    } catch {
    }
    for (const filename of ["FluidPropertiesRefData.idf", "GlycolPropertiesRefData.idf"]) {
      try {
        const response = await fetch(assetUrl("datasets", filename), { credentials: "same-origin" });
        if (response.ok) {
          module.FS.writeFile(`/datasets/${filename}`, await response.text());
        }
      } catch {
      }
    }
  }
  async function initEngine() {
    const cfg = requireConfig();
    try {
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly is not supported in this browser");
      }
      const jsUrl = assetUrl(cfg.loaderFile);
      const wasmUrl = assetUrl(cfg.wasmFile);
      try {
        const head = await fetchWithTimeout(
          wasmUrl,
          { method: "HEAD", credentials: "same-origin" },
          cfg.loadTimeoutMs
        );
        if (!head.ok) {
          throw new Error(
            `WASM file not found at ${wasmUrl}: ${String(head.status)} ${head.statusText}`
          );
        }
        sendConsole("Loading simulation engine...");
        try {
          wasmModule = await loadWasmWithConfig(jsUrl, wasmUrl, false, cfg.loadTimeoutMs);
        } catch (prodError) {
          sendConsole(
            `Standard mode failed: ${prodError instanceof Error ? prodError.message : String(prodError)}`
          );
          sendConsole("Trying NODERAWFS compatibility mode...");
          wasmModule = await loadWasmWithConfig(jsUrl, wasmUrl, true, cfg.loadTimeoutMs);
        }
        if (typeof wasmModule.callMain !== "function") {
          throw new Error("Failed to initialise the runtime - callMain was not available");
        }
        await loadRequiredDataFiles(wasmModule);
        const enginePolls = typeof wasmModule._idfkit_supports_cancellation === "function";
        const canCancelMidRun = enginePolls && cancelFlags !== null;
        if (cancelFlags) {
          wasmModule.idfkitCancel = cancelFlags;
        }
        if (!canCancelMidRun) {
          sendConsole(
            enginePolls ? "Mid-run cancellation unavailable: no cancellation buffer (the page is not cross-origin isolated)." : "Mid-run cancellation unavailable: this engine binary was built without the cancellation hook."
          );
        }
        sendConsole("Simulation engine ready.");
        send({ type: "ready", canCancelMidRun });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        sendConsole(`Engine loading failed: ${errorMsg}`);
        send({
          type: "init-error",
          error: `The simulation engine failed to load: ${errorMsg}. Check that the assets are reachable at ${cfg.assetBaseUrl}, that the browser allows WebAssembly, and that no extension or proxy is blocking the download.`
        });
      }
    } catch (error) {
      send({ type: "init-error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  function resetOutputDir(module) {
    try {
      for (const entry of module.FS.readdir("/output")) {
        if (entry === "." || entry === "..") continue;
        try {
          module.FS.unlink(`/output/${entry}`);
        } catch {
        }
      }
      return;
    } catch {
    }
    try {
      module.FS.mkdir("/output");
    } catch {
    }
  }
  function clearStagedFiles(module) {
    for (const path of stagedPaths) {
      try {
        module.FS.unlink(path);
      } catch {
      }
    }
    stagedPaths = [];
  }
  function stageFiles(module, files) {
    if (!files) return;
    for (const [key, contents] of Object.entries(files)) {
      const path = stagedPathFor(key);
      const segments = key.split("/");
      let directory = "";
      for (const segment of segments.slice(0, -1)) {
        directory += `/${segment}`;
        try {
          module.FS.mkdir(directory);
        } catch {
        }
      }
      module.FS.writeFile(path, contents);
      stagedPaths.push(path);
    }
  }
  function readTextFile(module, path) {
    try {
      return module.FS.readFile(path, { encoding: "utf8" });
    } catch {
      return void 0;
    }
  }
  function readBinaryFile(module, path) {
    try {
      const data = module.FS.readFile(path);
      const copy = new Uint8Array(data.length);
      copy.set(data);
      return copy.buffer;
    } catch {
      return void 0;
    }
  }
  async function runSimulation(runId, idf, epw, files, outputSelection) {
    if (!wasmModule) {
      send({ type: "run-error", runId, error: "Engine is not loaded." });
      return;
    }
    if (isRunning) {
      send({ type: "run-error", runId, error: "A run is already in flight." });
      return;
    }
    isRunning = true;
    shouldCancel = false;
    runConsole = [];
    const module = wasmModule;
    try {
      resetOutputDir(module);
      clearStagedFiles(module);
      let processedIdf = idf;
      let expandStats;
      if (needsExpansion(idf)) {
        sendConsole("--- ExpandObjects preprocessor ---");
        sendProgress("expanding", 2, "Expanding template and ground heat transfer objects...");
        const expandResult = await expandObjects(idf, {
          assetBaseUrl: requireConfig().assetBaseUrl
        });
        expandStats = expandResult.stats;
        for (const error of expandResult.errors) {
          sendConsole(`  ERROR: ${error.message}`);
        }
        for (const warning of expandResult.warnings) {
          sendConsole(`  WARNING: ${warning}`);
        }
        if (!expandResult.success) {
          send({
            type: "result",
            runId,
            result: {
              exitCode: 1,
              success: false,
              expand: expandResult.stats,
              consoleOutput: runConsole,
              fatalError: `ExpandObjects failed: ${expandResult.errors.map((e) => e.message).join("; ")}. HVACTemplate objects must be expanded before simulation.`
            }
          });
          return;
        }
        sendConsole(
          `  templates found: ${String(expandResult.stats.templatesFound)}, expanded: ${String(expandResult.stats.templatesExpanded)}, objects created: ${String(expandResult.stats.objectsCreated)}`
        );
        processedIdf = expandResult.expandedIDF;
        sendConsole("--- end ExpandObjects ---");
        const slabInput = expandResult.groundHeatTransfer?.slabInput;
        if (slabInput) {
          if (!epw) {
            send({
              type: "result",
              runId,
              result: {
                exitCode: 1,
                success: false,
                expand: expandStats,
                consoleOutput: runConsole,
                fatalError: "This model uses GroundHeatTransfer:Slab objects, which require a weather file: the Slab preprocessor derives monthly ground temperatures from it. Supply an EPW, or remove the ground heat transfer objects."
              }
            });
            return;
          }
          sendConsole("--- Slab ground heat transfer preprocessor ---");
          sendProgress("expanding", 4, "Computing ground temperatures...");
          const slabResult = await runSlab(slabInput, epw, {
            assetBaseUrl: requireConfig().assetBaseUrl
          });
          if (!slabResult.success) {
            send({
              type: "result",
              runId,
              result: {
                exitCode: 1,
                success: false,
                expand: expandStats,
                consoleOutput: runConsole,
                fatalError: `Ground heat transfer preprocessing failed: ${slabResult.errors.join("; ")}`
              }
            });
            return;
          }
          for (const row of slabResult.monthlyTemperatures ?? []) {
            sendConsole(
              `  month ${String(row.month).padStart(2)}: average ${row.average.toFixed(2)} C, perimeter ${row.perimeter.toFixed(2)} C, core ${row.core.toFixed(2)} C`
            );
          }
          processedIdf = `${processedIdf}
${slabResult.objects}`;
          sendConsole("--- end Slab ---");
        }
        const basementInput = expandResult.groundHeatTransfer?.basementInput;
        if (basementInput) {
          if (!epw) {
            send({
              type: "result",
              runId,
              result: {
                exitCode: 1,
                success: false,
                expand: expandStats,
                consoleOutput: runConsole,
                fatalError: "This model uses GroundHeatTransfer:Basement objects, which require a weather file: the Basement preprocessor derives monthly ground temperatures from it. Supply an EPW, or remove the ground heat transfer objects."
              }
            });
            return;
          }
          sendConsole("--- Basement ground heat transfer preprocessor ---");
          sendConsole("  solving an annual 3-D simulation; this takes appreciably longer than Slab");
          sendProgress("expanding", 4, "Computing basement ground temperatures...");
          const basementResult = await runBasement(basementInput, epw, {
            assetBaseUrl: requireConfig().assetBaseUrl
          });
          if (!basementResult.success) {
            send({
              type: "result",
              runId,
              result: {
                exitCode: 1,
                success: false,
                expand: expandStats,
                consoleOutput: runConsole,
                fatalError: `Ground heat transfer preprocessing failed: ${basementResult.errors.join("; ")}`
              }
            });
            return;
          }
          for (const row of basementResult.monthlyTemperatures ?? []) {
            sendConsole(
              `  month ${String(row.month).padStart(2)}: wall ${row.wall.toFixed(2)} C, floor ${row.floor.toFixed(2)} C, upper ${row.upperWall.toFixed(2)} C, lower ${row.lowerWall.toFixed(2)} C`
            );
          }
          processedIdf = `${processedIdf}
${basementResult.objects}`;
          sendConsole("--- end Basement ---");
        }
      }
      if (shouldCancel) {
        send({
          type: "result",
          runId,
          result: {
            exitCode: 1,
            success: false,
            cancelled: true,
            expand: expandStats,
            consoleOutput: runConsole
          }
        });
        return;
      }
      const missingFiles = findMissingFiles(processedIdf, Object.keys(files ?? {}), [
        "/Energy+.idd"
      ]);
      if (missingFiles.length > 0) {
        send({
          type: "result",
          runId,
          result: {
            exitCode: 1,
            success: false,
            expand: expandStats,
            consoleOutput: runConsole,
            fatalError: describeMissingFiles(missingFiles)
          }
        });
        return;
      }
      module.FS.writeFile("/input.idf", processedIdf);
      if (epw) {
        module.FS.writeFile("/weather.epw", epw);
      }
      stageFiles(module, files);
      const args = ["-d", "/output"];
      if (epw) args.push("-w", "/weather.epw");
      args.push("/input.idf");
      stageProcCmdline(module, args);
      sendConsole(`Starting simulation: ${args.join(" ")}`);
      let exitCode = 0;
      let callMainFailure = null;
      try {
        exitCode = module.callMain(args);
      } catch (e) {
        callMainFailure = describeThrown(module, e);
        if (callMainFailure.crash) {
          exitCode = 1;
          sendConsole(`Uncaught exception inside the engine: ${callMainFailure.text}`);
        } else {
          const exitMatch = /exit\((\d+)\)/.exec(callMainFailure.text);
          exitCode = exitMatch?.[1] ? Number.parseInt(exitMatch[1], 10) : 1;
        }
      }
      const errContent = readTextFile(module, "/output/eplusout.err");
      if (errContent) {
        sendConsole("--- eplusout.err ---");
        for (const line of errContent.split("\n")) {
          if (line.trim()) sendConsole(line);
        }
        sendConsole("--- end eplusout.err ---");
      }
      const fatalMatch = errContent ? /\*\*\s*Fatal\s*\*\*\s*(.*?)(?=\n|$)/i.exec(errContent) : null;
      const hasFatal = Boolean(fatalMatch);
      const stoppedEarly = cancelFlags !== null && Atomics.load(cancelFlags, CANCEL_SLOT_ACKNOWLEDGED) !== 0;
      const success = !stoppedEarly && exitCode === 0 && !hasFatal && !callMainFailure;
      const result = {
        exitCode,
        success,
        consoleOutput: runConsole
      };
      if (stoppedEarly) {
        result.cancelled = true;
        sendConsole("Run cancelled: the engine stopped at a checkpoint on the host's request.");
      }
      if (expandStats) result.expand = expandStats;
      if (errContent) result.err = parseERR(errContent);
      if (callMainFailure?.crash) result.crash = callMainFailure.crash;
      if (!success) {
        const fatal = fatalMatch?.[1]?.trim();
        if (fatal) {
          result.fatalError = `Fatal: ${fatal}`;
        } else if (callMainFailure) {
          result.fatalError = `Engine crashed: ${callMainFailure.text}`;
        } else if (!stoppedEarly) {
          result.fatalError = `Engine failed with exit code ${String(exitCode)}`;
        }
      }
      const outputs = resolveOutputSelection(outputSelection);
      const omitted = omittedOutputs(outputs);
      if (omitted.length > 0) {
        result.omittedOutputs = omitted;
        sendConsole(`Not reading back: ${omitted.join(", ")} (run({ outputs }))`);
      }
      if (outputs.eso) {
        const esoContent = readTextFile(module, "/output/eplusout.eso");
        if (esoContent) result.eso = parseESO(esoContent);
      }
      if (outputs.mtr) {
        const mtrContent = readTextFile(module, "/output/eplusout.mtr");
        if (mtrContent) result.mtr = parseESO(mtrContent);
      }
      if (outputs.rdd) {
        const rdd = readTextFile(module, "/output/eplusout.rdd");
        if (rdd) result.rdd = rdd;
      }
      if (outputs.mdd) {
        const mdd = readTextFile(module, "/output/eplusout.mdd");
        if (mdd) result.mdd = mdd;
      }
      if (outputs.csv) {
        const csv = readTextFile(module, "/output/eplusout.csv");
        if (csv) result.csv = csv;
      }
      if (outputs.html) {
        const html = readTextFile(module, "/output/eplustbl.htm");
        if (html) result.html = html;
      }
      if (outputs.sql) {
        const sql = readBinaryFile(module, "/output/eplusout.sql");
        if (sql) result.sql = sql;
      }
      const transfer = seriesBuffers([
        ...result.eso?.timeSeries.values() ?? [],
        ...result.mtr?.timeSeries.values() ?? []
      ]);
      if (result.sql) transfer.push(result.sql);
      send({ type: "result", runId, result }, transfer);
    } catch (error) {
      send({
        type: "run-error",
        runId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      isRunning = false;
    }
  }
  function runVersion(runId) {
    if (!wasmModule) {
      send({ type: "run-error", runId, error: "Engine is not loaded." });
      return;
    }
    runConsole = [];
    try {
      stageProcCmdline(wasmModule, ["--version"]);
      const exitCode = wasmModule.callMain(["--version"]);
      send({
        type: "result",
        runId,
        result: { exitCode, success: exitCode === 0, consoleOutput: runConsole }
      });
    } catch (error) {
      send({
        type: "run-error",
        runId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  self.onmessage = (event) => {
    const message = event.data;
    switch (message.type) {
      case "init":
        config = message;
        cancelFlags = message.cancelBuffer ? new Int32Array(message.cancelBuffer) : null;
        void initEngine();
        break;
      case "simulate":
        void runSimulation(
          message.runId,
          message.idf,
          message.epw,
          message.files,
          message.outputs
        );
        break;
      case "version":
        runVersion(message.runId);
        break;
      case "cancel":
        shouldCancel = true;
        break;
    }
  };
})();
//# sourceMappingURL=engine.worker.js.map