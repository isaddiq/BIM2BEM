// src/assets.ts
function toAbsoluteUrl(url, base) {
  try {
    return new URL(url, base ?? getDefaultBase()).href;
  } catch {
    return url;
  }
}
function getDefaultBase() {
  if (typeof globalThis !== "undefined") {
    const loc = globalThis.location;
    if (loc?.href) return loc.href;
  }
  return void 0;
}
function missingAssetBaseUrlError() {
  return new Error(
    "createEnergyPlus() requires an assetBaseUrl.\n\n@idfkit/engine ships no engine binary; the assets live in @idfkit/engine-assets. Copy them somewhere your app serves, and point assetBaseUrl at that path:\n\n  npx idfkit-engine-assets public/energyplus\n  createEnergyPlus({ assetBaseUrl: '/energyplus' })\n\nOr load them from a CDN, with no build step:\n\n  createEnergyPlus({\n    assetBaseUrl: 'https://cdn.jsdelivr.net/npm/@idfkit/engine-assets@26.2/assets',\n    workerUrl: 'https://cdn.jsdelivr.net/npm/@idfkit/engine/dist/engine.worker.js',\n  })"
  );
}
function defaultWorkerUrl(assetBaseUrl) {
  return `${assetBaseUrl.replace(/\/$/, "")}/engine.worker.js`;
}
function currentOrigin() {
  const loc = globalThis.location;
  return loc?.origin ?? null;
}
function isCrossOrigin(url) {
  const origin = currentOrigin();
  if (origin === null) return false;
  try {
    return new URL(url, origin).origin !== origin;
  } catch {
    return false;
  }
}
function createEngineWorker(workerUrl) {
  if (typeof Worker === "undefined") {
    throw new Error(
      "Web Workers are not available in this environment. In Node, import the engine from '@idfkit/engine/node', which runs it on a worker_threads worker."
    );
  }
  const absolute = toAbsoluteUrl(workerUrl);
  if (!isCrossOrigin(absolute)) {
    return { worker: new Worker(absolute), release: () => void 0 };
  }
  const shim = `importScripts(${JSON.stringify(absolute)});`;
  const blobUrl = URL.createObjectURL(new Blob([shim], { type: "text/javascript" }));
  try {
    const worker = new Worker(blobUrl);
    return {
      worker,
      release: () => {
        URL.revokeObjectURL(blobUrl);
      }
    };
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(
      `Failed to construct a cross-origin worker from ${absolute}. If the page has a Content-Security-Policy, it needs "worker-src blob:". (original error: ${error instanceof Error ? error.message : String(error)})`
    );
  }
}

// src/protocol.ts
var DEFAULT_WASM_FILE = "energyplus.js-26.2.wasm";
var DEFAULT_LOADER_FILE = "energyplus.js";
var DEFAULT_LOAD_TIMEOUT_MS = 3e4;
var CANCEL_SLOT_REQUEST = 0;
var CANCEL_SLOT_ACKNOWLEDGED = 1;
var CANCEL_BUFFER_SLOTS = 2;

// src/staging.ts
var RESERVED_FILES = ["input.idf", "weather.epw", "energy+.idd"];
var RESERVED_DIRS = ["output", "datasets"];
function validateStagedKeys(files) {
  const problems = [];
  for (const key of Object.keys(files)) {
    const problem = keyProblem(key);
    if (problem) problems.push(`  "${key}" -- ${problem}`);
  }
  if (problems.length === 0) return null;
  return `run() was given file keys it cannot stage:
${problems.join("\n")}`;
}
function keyProblem(key) {
  if (key.trim() === "") return "the key is empty";
  if (key !== key.trim()) return "the key has leading or trailing whitespace";
  if (key.includes("\\") || /^[A-Za-z]:/.test(key)) {
    return "a backslash is not a path separator here; use forward slashes";
  }
  if (key.startsWith("/")) return 'keys are relative to the model; drop the leading "/"';
  if (key.endsWith("/")) return "this names a directory, not a file";
  const segments = key.split("/");
  for (const segment of segments) {
    if (segment === "") return "the key has an empty path segment";
    if (segment === "." || segment === "..") return `"${segment}" is not allowed in a key`;
  }
  const lower = key.toLowerCase();
  if (RESERVED_FILES.includes(lower)) {
    return `the engine writes /${key} itself; choose another name`;
  }
  const first = segments[0]?.toLowerCase() ?? "";
  if (RESERVED_DIRS.includes(first)) {
    return `/${first} belongs to the engine; stage outside it`;
  }
  return null;
}

// src/createEnergyPlus.ts
async function createEnergyPlus(options) {
  if (!options?.assetBaseUrl) {
    throw missingAssetBaseUrlError();
  }
  const assetBaseUrl = toAbsoluteUrl(options.assetBaseUrl).replace(/\/$/, "");
  const workerUrl = toAbsoluteUrl(options.workerUrl ?? defaultWorkerUrl(assetBaseUrl));
  return startEngine({ ...options, assetBaseUrl }, createEngineWorker(workerUrl));
}
async function startEngine(options, { worker, release }) {
  const { assetBaseUrl } = options;
  let disposed = false;
  let nextRunId = 1;
  let handedOver = false;
  let fatalError = null;
  let cancelRequested = false;
  const cancelBuffer = (() => {
    try {
      if (typeof SharedArrayBuffer === "undefined") return void 0;
      return new SharedArrayBuffer(CANCEL_BUFFER_SLOTS * Int32Array.BYTES_PER_ELEMENT);
    } catch {
      return void 0;
    }
  })();
  let cancelFlags = cancelBuffer ? new Int32Array(cancelBuffer) : null;
  let canCancelMidRun = false;
  let pending = null;
  let settleReady = null;
  const failPending = (error) => {
    if (pending) {
      if (pending.cancellable && cancelRequested) {
        pending.resolve({
          exitCode: 1,
          success: false,
          cancelled: true,
          consoleOutput: []
        });
      } else {
        pending.reject(error);
      }
      pending = null;
    }
  };
  worker.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "ready":
        canCancelMidRun = message.canCancelMidRun === true;
        settleReady?.resolve();
        settleReady = null;
        break;
      case "init-error":
        settleReady?.reject(new Error(message.error));
        settleReady = null;
        break;
      case "console":
        options.onConsole?.(message.text);
        break;
      case "progress":
        options.onProgress?.(message.update);
        break;
      case "result":
        if (pending && pending.runId === message.runId) {
          pending.resolve(message.result);
          pending = null;
        }
        break;
      case "run-error":
        if (pending && pending.runId === message.runId) {
          pending.reject(new Error(message.error));
          pending = null;
        }
        break;
    }
  });
  const killEngine = (error) => {
    const notify = !disposed && handedOver;
    if (!disposed) {
      disposed = true;
      fatalError = error;
      worker.terminate();
      release();
    }
    settleReady?.reject(error);
    settleReady = null;
    failPending(error);
    if (notify) options.onDispose?.(error);
  };
  worker.addEventListener("error", (event) => {
    killEngine(new Error(`Engine worker failed: ${event.message || "unknown error"}`));
  });
  worker.addEventListener("messageerror", () => {
    killEngine(new Error("Engine worker sent a message that could not be deserialised."));
  });
  await new Promise((resolve, reject) => {
    settleReady = { resolve, reject };
    const init = {
      type: "init",
      assetBaseUrl,
      wasmFile: options.wasmFile ?? DEFAULT_WASM_FILE,
      loaderFile: options.loaderFile ?? DEFAULT_LOADER_FILE,
      loadTimeoutMs: options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    };
    if (!cancelBuffer) {
      worker.postMessage(init);
      return;
    }
    try {
      worker.postMessage({ ...init, cancelBuffer });
    } catch {
      cancelFlags = null;
      worker.postMessage(init);
    }
  }).catch((error) => {
    worker.terminate();
    release();
    disposed = true;
    throw error instanceof Error ? error : new Error(String(error));
  });
  const unusableReason = () => {
    if (!disposed) return null;
    return fatalError ?? new Error("This engine has been disposed. Create a new one with createEnergyPlus().");
  };
  handedOver = true;
  return {
    run(runOptions) {
      const unusable = unusableReason();
      if (unusable) return Promise.reject(unusable);
      if (pending) {
        return Promise.reject(
          new Error("A run is already in flight. Await it, or create a second engine.")
        );
      }
      if (runOptions.files) {
        const keyProblem2 = validateStagedKeys(runOptions.files);
        if (keyProblem2) return Promise.reject(new Error(keyProblem2));
      }
      cancelRequested = false;
      if (cancelFlags) {
        Atomics.store(cancelFlags, CANCEL_SLOT_REQUEST, 0);
        Atomics.store(cancelFlags, CANCEL_SLOT_ACKNOWLEDGED, 0);
      }
      const runId = nextRunId++;
      return new Promise((resolve, reject) => {
        pending = { runId, cancellable: true, resolve, reject };
        worker.postMessage({
          type: "simulate",
          runId,
          idf: runOptions.idf,
          epw: runOptions.epw,
          files: runOptions.files,
          outputs: runOptions.outputs
        });
      });
    },
    version() {
      const unusable = unusableReason();
      if (unusable) return Promise.reject(unusable);
      if (pending) {
        return Promise.reject(new Error("A run is already in flight."));
      }
      const runId = nextRunId++;
      return new Promise((resolve, reject) => {
        pending = {
          runId,
          // A version query has no cancelled outcome, so a worker death during
          // it is a crash whether or not a cancel() preceded or accompanied
          // it. Clearing `cancelRequested` here instead would only cover a
          // cancel() from BEFORE this call: one arriving while the query is in
          // flight would still make a genuine crash resolve as
          // `{ exitCode: 1 }`, indistinguishable from an engine that ran.
          cancellable: false,
          resolve: (result) => {
            resolve({ exitCode: result.exitCode });
          },
          reject
        };
        worker.postMessage({ type: "version", runId });
      });
    },
    cancel() {
      if (disposed) return;
      cancelRequested = true;
      if (cancelFlags) {
        Atomics.store(cancelFlags, CANCEL_SLOT_REQUEST, 1);
      }
      worker.postMessage({ type: "cancel" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      failPending(new Error("Engine disposed while a run was in flight."));
      worker.terminate();
      release();
      options.onDispose?.();
    },
    get isDisposed() {
      return disposed;
    },
    get canCancelMidRun() {
      return canCancelMidRun && !disposed;
    }
  };
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
    const wasmModule = await createFreshModule(options.assetBaseUrl);
    wasmModule.FS.writeFile("/Energy+.idd", iddContentCache);
    wasmModule.FS.writeFile("/in.idf", idfContent);
    const exitCode = wasmModule.callMain(["/in.idf", "/expanded.idf"]);
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
    const expandedIDF = wasmModule.FS.readFile("/expanded.idf", {
      encoding: "utf8"
    });
    const groundHeatTransfer = {};
    const slabInput = readOptionalFile(wasmModule, "/GHTIn.idf");
    if (slabInput) groundHeatTransfer.slabInput = slabInput;
    const basementInput = readOptionalFile(wasmModule, "/BasementGHTIn.idf");
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

export {
  DEFAULT_WASM_FILE,
  DEFAULT_LOADER_FILE,
  DEFAULT_LOAD_TIMEOUT_MS,
  createEnergyPlus,
  startEngine,
  detectExternalFileReferences,
  containsHVACTemplates,
  expandObjects
};
//# sourceMappingURL=chunk-7JIVJ5U2.js.map