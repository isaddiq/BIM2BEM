// src/parsers/mtrParser.ts
function parseMeterName(variable) {
  const name = variable.variableName.toLowerCase();
  const keyValue = variable.keyValue.toLowerCase();
  const info = {
    variable,
    category: "custom"
  };
  if (name.includes("facility") || keyValue === "facility") {
    info.category = "facility";
  } else if (name.includes("building") || keyValue === "building") {
    info.category = "building";
  } else if (name.includes("zone:") || keyValue.includes("zone")) {
    info.category = "zone";
    const match = keyValue.match(/^([^:]+)/);
    if (match?.[1]) {
      info.zoneName = match[1].trim();
    }
  } else if (name.includes("hvac") || name.includes("system")) {
    info.category = "hvac";
  }
  const endUsePatterns = {
    heating: /heating/i,
    cooling: /cooling/i,
    interiorlights: /interior.*light/i,
    exteriorlights: /exterior.*light/i,
    interiorequipment: /interior.*equip/i,
    exteriorequipment: /exterior.*equip/i,
    fans: /fan/i,
    pumps: /pump/i,
    heatrejection: /heat.*reject/i,
    humidification: /humid/i,
    heatrecovery: /heat.*recov/i,
    watersystems: /water.*sys/i,
    refrigeration: /refrig/i,
    generators: /generator/i,
    other: /other/i
  };
  for (const [endUse, pattern] of Object.entries(endUsePatterns)) {
    if (pattern.test(name) || pattern.test(keyValue)) {
      info.endUse = endUse;
      info.category = "enduse";
      break;
    }
  }
  const fuelPatterns = {
    electricity: /electric/i,
    naturalgas: /natural.*gas|gas:/i,
    gasoline: /gasoline/i,
    diesel: /diesel/i,
    coal: /coal/i,
    propane: /propane/i,
    steam: /steam/i,
    districtheating: /district.*heat/i,
    districtcooling: /district.*cool/i,
    water: /water(?!.*sys)/i
  };
  for (const [fuel, pattern] of Object.entries(fuelPatterns)) {
    if (pattern.test(name) || pattern.test(keyValue)) {
      info.fuelType = fuel;
      break;
    }
  }
  return info;
}
function getMeters(data) {
  const meters = [];
  for (const variable of data.variables.values()) {
    meters.push(parseMeterName(variable));
  }
  return meters;
}
function getMetersByCategory(data, category) {
  return getMeters(data).filter((m) => m.category === category);
}
function getMetersByEndUse(data, endUse) {
  return getMeters(data).filter((m) => m.endUse === endUse);
}
function getMetersByFuel(data, fuel) {
  return getMeters(data).filter((m) => m.fuelType === fuel);
}
function getTotalEnergy(data, variableId) {
  const timeSeries = data.timeSeries.get(variableId);
  if (!timeSeries) return null;
  let total = 0;
  for (const value of timeSeries.values) {
    total += value;
  }
  return {
    value: total,
    units: timeSeries.variable.units
  };
}
function getFacilityMeters(data) {
  return getMetersByCategory(data, "facility");
}
function convertEnergy(value, fromUnits, toUnits) {
  let joules = value;
  const fromUpper = fromUnits.toUpperCase();
  if (fromUpper === "J") {
    joules = value;
  } else if (fromUpper === "KJ") {
    joules = value * 1e3;
  } else if (fromUpper === "MJ") {
    joules = value * 1e6;
  } else if (fromUpper === "GJ") {
    joules = value * 1e9;
  } else if (fromUpper === "KWH") {
    joules = value * 36e5;
  } else if (fromUpper === "WH") {
    joules = value * 3600;
  } else if (fromUpper === "THERM") {
    joules = value * 1055e5;
  } else if (fromUpper === "KBTU" || fromUpper === "MBTU") {
    joules = value * 1055e3;
  }
  switch (toUnits) {
    case "J":
      return joules;
    case "kWh":
      return joules / 36e5;
    case "MJ":
      return joules / 1e6;
    case "GJ":
      return joules / 1e9;
    case "therm":
      return joules / 1055e5;
    case "kBtu":
      return joules / 1055e3;
    default:
      return joules;
  }
}
function getEndUseSummary(data) {
  const summary = /* @__PURE__ */ new Map();
  const meters = getMeters(data);
  for (const meter of meters) {
    if (!meter.endUse) continue;
    const energy = getTotalEnergy(data, meter.variable.id);
    if (!energy) continue;
    const existing = summary.get(meter.endUse);
    if (existing) {
      existing.total += energy.value;
    } else {
      summary.set(meter.endUse, { total: energy.value, units: energy.units });
    }
  }
  return summary;
}

export {
  parseMeterName,
  getMeters,
  getMetersByCategory,
  getMetersByEndUse,
  getMetersByFuel,
  getTotalEnergy,
  getFacilityMeters,
  convertEnergy,
  getEndUseSummary
};
//# sourceMappingURL=chunk-C6KIWL2I.js.map