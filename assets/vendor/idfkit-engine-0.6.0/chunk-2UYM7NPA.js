import {
  SeriesBuilder,
  TimestampTableBuilder
} from "./chunk-JHJGWJA6.js";

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
var StreamingESOParser = class {
  builder = new ESOBuilder();
  buffer = "";
  result;
  /**
   * Process a chunk of data
   */
  processChunk(chunk) {
    if (this.result) throw new Error("StreamingESOParser: processChunk() called after finish()");
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      this.builder.processLine(line);
    }
  }
  /**
   * Finish processing (handle any remaining buffer).
   *
   * Calling it again returns the same object, not a copy: if its buffers have
   * been transferred since, they are detached in that object too.
   */
  finish() {
    if (this.result) return this.result;
    if (this.buffer.trim()) {
      this.builder.processLine(this.buffer);
    }
    this.buffer = "";
    this.result = this.builder.build(true);
    return this.result;
  }
  /**
   * A snapshot of what has been parsed so far. Copies every series; for
   * progress reporting use {@link StreamingESOParser.getProgress}. After
   * {@link StreamingESOParser.finish} it returns that same result, not a copy.
   */
  getData() {
    return this.result ?? this.builder.build();
  }
  /**
   * Get progress info
   */
  getProgress() {
    return {
      variableCount: this.builder.variables.size,
      dataPointCount: this.builder.valueCount
    };
  }
};
function getTimeSeries(data, variableId) {
  return data.timeSeries.get(variableId);
}
function findVariables(data, pattern) {
  const results = [];
  const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
  for (const variable of data.variables.values()) {
    if (regex.test(variable.variableName) || regex.test(variable.keyValue)) {
      results.push(variable);
    }
  }
  return results;
}
function getTimeSeriesStats(timeSeries) {
  const values = timeSeries.values;
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, sum: 0, count: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return {
    min,
    max,
    mean: sum / values.length,
    sum,
    count: values.length
  };
}

export {
  parseESO,
  StreamingESOParser,
  getTimeSeries,
  findVariables,
  getTimeSeriesStats
};
//# sourceMappingURL=chunk-2UYM7NPA.js.map