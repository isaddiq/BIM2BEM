// src/parsers/rddParser.ts
function parseReportFrequency(freq) {
  const normalized = freq.toLowerCase().trim();
  switch (normalized) {
    case "timestep":
      return "timestep";
    case "hourly":
      return "hourly";
    case "daily":
      return "daily";
    case "monthly":
      return "monthly";
    case "runperiod":
      return "runperiod";
    case "environment":
      return "environment";
    case "annual":
      return "annual";
    default:
      return "hourly";
  }
}
function parseRDDLineIDF(line) {
  const trimmed = line.trim();
  if (!trimmed.toLowerCase().startsWith("output:variable")) {
    return null;
  }
  let units = "";
  const unitsMatch = trimmed.match(/!\s*-?\s*\[([^\]]*)\]/);
  if (unitsMatch?.[1]) {
    units = unitsMatch[1];
  }
  const mainPart = trimmed.split("!")[0]?.trim() ?? "";
  const withoutSemicolon = mainPart.replace(/;$/, "").trim();
  const parts = withoutSemicolon.split(",").map((p) => p.trim());
  if (parts.length < 4) {
    return null;
  }
  const keyValue = parts[1] ?? "*";
  const variableName = parts[2] ?? "";
  const frequency = parts[3] ?? "hourly";
  if (!variableName) {
    return null;
  }
  return {
    variableName,
    keyValue,
    reportingFrequency: parseReportFrequency(frequency),
    units
  };
}
function parseRDDLineCSV(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("Program Version") || trimmed.startsWith("Var Type") || trimmed.startsWith("!")) {
    return null;
  }
  const parts = trimmed.split(",").map((p) => p.trim());
  if (parts.length < 3) {
    return null;
  }
  const varType = parts[0] ?? "";
  const variableNameWithUnits = parts.slice(2).join(",").trim();
  if (!variableNameWithUnits) {
    return null;
  }
  let variableName = variableNameWithUnits;
  let units = "";
  const unitsMatch = variableNameWithUnits.match(/^(.+?)\s*\[([^\]]*)\]\s*$/);
  if (unitsMatch) {
    variableName = unitsMatch[1]?.trim() ?? variableNameWithUnits;
    units = unitsMatch[2] ?? "";
  }
  return {
    variableName,
    keyValue: varType || "*",
    // Use varType as key hint
    reportingFrequency: "hourly",
    // CSV format doesn't include frequency
    units
  };
}
function detectRDDFormat(content) {
  const lines = content.split("\n").slice(0, 10);
  for (const line of lines) {
    if (line.trim().toLowerCase().startsWith("output:variable")) {
      return "idf";
    }
    if (line.includes("Var Type") || line.includes("Var Report Type")) {
      return "csv";
    }
  }
  return "csv";
}
function parseRDD(content) {
  const lines = content.split("\n");
  const variables = [];
  const format = detectRDDFormat(content);
  const parser = format === "idf" ? parseRDDLineIDF : parseRDDLineCSV;
  for (const line of lines) {
    const variable = parser(line);
    if (variable) {
      variables.push(variable);
    }
  }
  return { variables };
}
function getUniqueVariableNames(data) {
  const names = /* @__PURE__ */ new Set();
  for (const variable of data.variables) {
    names.add(variable.variableName);
  }
  return Array.from(names).sort();
}

// src/parsers/mddParser.ts
function parseReportFrequency2(freq) {
  const normalized = freq.toLowerCase().trim();
  switch (normalized) {
    case "timestep":
      return "timestep";
    case "hourly":
      return "hourly";
    case "daily":
      return "daily";
    case "monthly":
      return "monthly";
    case "runperiod":
      return "runperiod";
    case "environment":
      return "environment";
    case "annual":
      return "annual";
    default:
      return "hourly";
  }
}
function parseMDDLineIDF(line) {
  const trimmed = line.trim();
  const lowerTrimmed = trimmed.toLowerCase();
  if (!lowerTrimmed.startsWith("output:meter")) {
    return null;
  }
  let units = "";
  const unitsMatch = trimmed.match(/!\s*-?\s*\[([^\]]*)\]/);
  if (unitsMatch?.[1]) {
    units = unitsMatch[1];
  }
  const meterFileOnly = lowerTrimmed.includes("meterfileonly");
  const cumulative = lowerTrimmed.includes("cumulative");
  const mainPart = trimmed.split("!")[0]?.trim() ?? "";
  const withoutSemicolon = mainPart.replace(/;$/, "").trim();
  const parts = withoutSemicolon.split(",").map((p) => p.trim());
  if (parts.length < 3) {
    return null;
  }
  const meterName = parts[1] ?? "";
  const frequency = parts[2] ?? "hourly";
  if (!meterName) {
    return null;
  }
  return {
    meterName,
    reportingFrequency: parseReportFrequency2(frequency),
    units,
    meterFileOnly,
    cumulative
  };
}
function parseMDDLineCSV(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("Program Version") || trimmed.startsWith("Meter Type") || trimmed.startsWith("Cumulative Meter") || trimmed.startsWith("!") || trimmed.toLowerCase().includes("report type") || trimmed.toLowerCase().includes("meter name")) {
    return null;
  }
  let meterName = trimmed;
  let units = "";
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1] ?? "";
      const unitsMatch = lastPart.match(/^(.+?)\s*\[([^\]]*)\]\s*$/);
      if (unitsMatch) {
        meterName = unitsMatch[1]?.trim() ?? lastPart;
        units = unitsMatch[2] ?? "";
      } else {
        meterName = lastPart;
      }
    }
  } else {
    const unitsMatch = trimmed.match(/^(.+?)\s*\[([^\]]*)\]\s*$/);
    if (unitsMatch) {
      meterName = unitsMatch[1]?.trim() ?? trimmed;
      units = unitsMatch[2] ?? "";
    }
  }
  if (!meterName) {
    return null;
  }
  return {
    meterName,
    reportingFrequency: "hourly",
    units,
    meterFileOnly: false,
    cumulative: false
  };
}
function detectMDDFormat(content) {
  const lines = content.split("\n").slice(0, 10);
  for (const line of lines) {
    if (line.trim().toLowerCase().startsWith("output:meter")) {
      return "idf";
    }
  }
  return "csv";
}
function parseMDD(content) {
  const lines = content.split("\n");
  const meters = [];
  const format = detectMDDFormat(content);
  const parser = format === "idf" ? parseMDDLineIDF : parseMDDLineCSV;
  for (const line of lines) {
    const meter = parser(line);
    if (meter) {
      meters.push(meter);
    }
  }
  return { meters };
}
function getUniqueMeterNames(data) {
  const names = /* @__PURE__ */ new Set();
  for (const meter of data.meters) {
    names.add(meter.meterName);
  }
  return Array.from(names).sort();
}

// src/parsers/index.ts
async function parseSimulationResults(files) {
  const results = {
    eso: null,
    mtr: null,
    err: null
  };
  if (files.eso) {
    const { parseESO: parseESO2 } = await import("./esoParser-AJOFT6BU.js");
    results.eso = parseESO2(files.eso);
  }
  if (files.mtr) {
    const { parseMTR } = await import("./mtrParser-DUZ3LSUD.js");
    results.mtr = parseMTR(files.mtr);
  }
  if (files.err) {
    const { parseERR: parseERR2 } = await import("./errParser-G4XVBZ4U.js");
    results.err = parseERR2(files.err);
  }
  return results;
}

export {
  parseRDD,
  getUniqueVariableNames,
  parseMDD,
  getUniqueMeterNames,
  parseSimulationResults
};
//# sourceMappingURL=chunk-RMJCLJGS.js.map