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
function groupErrors(summary) {
  const groups = /* @__PURE__ */ new Map();
  for (const entry of summary.entries) {
    const key = `${entry.severity}:${entry.message}`;
    if (groups.has(key)) {
      const existing = groups.get(key);
      if (!existing) continue;
      existing.count = (existing.count || 1) + 1;
      for (const ctx of entry.context) {
        if (!existing.context.includes(ctx)) {
          existing.context.push(ctx);
        }
      }
    } else {
      groups.set(key, { ...entry, count: 1 });
    }
  }
  return Array.from(groups.values());
}
function filterBySeverity(summary, severity) {
  return summary.entries.filter((entry) => entry.severity === severity);
}
function formatErrorReport(summary) {
  const lines = [];
  lines.push("=== EnergyPlus Simulation Report ===");
  lines.push("");
  if (summary.simulationSuccessful) {
    lines.push("Status: COMPLETED SUCCESSFULLY");
  } else {
    lines.push("Status: FAILED");
  }
  lines.push("");
  lines.push(`Warnings: ${String(summary.warningCount)}`);
  lines.push(`Severe Errors: ${String(summary.severeCount)}`);
  lines.push(`Fatal Errors: ${String(summary.fatalCount)}`);
  lines.push("");
  const fatals = filterBySeverity(summary, "fatal");
  if (fatals.length > 0) {
    lines.push("--- Fatal Errors ---");
    for (const entry of fatals) {
      lines.push(`  ${entry.message}`);
      for (const ctx of entry.context) {
        lines.push(`    ${ctx}`);
      }
    }
    lines.push("");
  }
  const severes = filterBySeverity(summary, "severe");
  if (severes.length > 0) {
    lines.push("--- Severe Errors ---");
    for (const entry of severes) {
      lines.push(`  ${entry.message}`);
      for (const ctx of entry.context) {
        lines.push(`    ${ctx}`);
      }
    }
    lines.push("");
  }
  const warnings = filterBySeverity(summary, "warning");
  if (warnings.length > 0) {
    lines.push(`--- Warnings (showing first 20 of ${String(warnings.length)}) ---`);
    for (const entry of warnings.slice(0, 20)) {
      lines.push(`  ${entry.message}`);
    }
    if (warnings.length > 20) {
      lines.push(`  ... and ${String(warnings.length - 20)} more warnings`);
    }
  }
  return lines.join("\n");
}
function hasBlockingErrors(summary) {
  return summary.fatalCount > 0 || summary.severeCount > 10;
}
function getSeverityColor(severity) {
  switch (severity) {
    case "fatal":
      return "red";
    case "severe":
      return "orange";
    case "warning":
      return "yellow";
    default:
      return "gray";
  }
}

export {
  parseERR,
  groupErrors,
  filterBySeverity,
  formatErrorReport,
  hasBlockingErrors,
  getSeverityColor
};
//# sourceMappingURL=chunk-2Z4KKIX7.js.map