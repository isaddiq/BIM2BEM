/**
 * Reference material and construction library, and steady-state U-values.
 *
 * Every library entry records where its numbers come from. Values marked
 * `kind: 'design'` are tabulated design values (ISO 10456:2007, Table 3). Values
 * marked `kind: 'assumption'` are typical declared values chosen by BIM2BEM for
 * when the IFC file gives nothing better; they are shown to the user as
 * assumptions and are always editable. Thermal properties are never inferred from
 * an IFC material's name: a name match is offered only as a suggestion that the
 * user has to accept.
 */

const ISO10456 = 'ISO 10456:2007, Table 3 (design values)';
const ASSUMED_INSULATION = 'Assumed typical declared value (EN 13162/13163 products); replace with the manufacturer\'s λD';

// ρ kg/m³, λ W/(m·K), cp J/(kg·K)
const LIBRARY_MATERIALS = [
  { id: 'concrete-reinforced', name: 'Reinforced concrete (1% steel)', density: 2300, conductivity: 2.3, specificHeat: 1000, kind: 'design', source: ISO10456, keywords: ['reinforced concrete', 'rc ', 'beton armé', 'stahlbeton'] },
  { id: 'concrete-2400', name: 'Concrete, high density', density: 2400, conductivity: 2.0, specificHeat: 1000, kind: 'design', source: ISO10456, keywords: ['concrete', 'beton', 'cast in place', 'cast-in-place', 'precast'] },
  { id: 'concrete-2000', name: 'Concrete, medium density', density: 2000, conductivity: 1.35, specificHeat: 1000, kind: 'design', source: ISO10456, keywords: [] },
  { id: 'screed-cement-sand', name: 'Cement/sand screed or render', density: 1800, conductivity: 1.0, specificHeat: 1000, kind: 'design', source: ISO10456, keywords: ['screed', 'render', 'cement', 'mortar', 'stucco'] },
  { id: 'plaster-gypsum-1300', name: 'Gypsum plaster', density: 1300, conductivity: 0.57, specificHeat: 1000, kind: 'design', source: ISO10456, keywords: ['plaster', 'putz'] },
  { id: 'plasterboard-700', name: 'Gypsum plasterboard', density: 700, conductivity: 0.21, specificHeat: 1000, kind: 'design', source: ISO10456, keywords: ['plasterboard', 'gypsum board', 'gypsum wall board', 'drywall', 'gwb', 'gipskarton'] },
  { id: 'timber-softwood', name: 'Timber, softwood', density: 500, conductivity: 0.13, specificHeat: 1600, kind: 'design', source: ISO10456, keywords: ['softwood', 'timber', 'wood', 'pine', 'spruce', 'holz'] },
  { id: 'timber-hardwood', name: 'Timber, hardwood', density: 700, conductivity: 0.18, specificHeat: 1600, kind: 'design', source: ISO10456, keywords: ['hardwood', 'oak', 'beech'] },
  { id: 'steel', name: 'Steel', density: 7800, conductivity: 50, specificHeat: 450, kind: 'design', source: ISO10456, keywords: ['steel', 'stahl'] },
  { id: 'aluminium', name: 'Aluminium alloys', density: 2800, conductivity: 160, specificHeat: 880, kind: 'design', source: ISO10456, keywords: ['aluminium', 'aluminum'] },
  { id: 'glass-soda-lime', name: 'Glass, soda lime', density: 2500, conductivity: 1.0, specificHeat: 750, kind: 'design', source: ISO10456, keywords: ['glass'] },
  { id: 'ceramic-tile', name: 'Ceramic tiles', density: 2300, conductivity: 1.3, specificHeat: 840, kind: 'design', source: ISO10456, keywords: ['tile', 'ceramic', 'porcelain'] },
  { id: 'granite', name: 'Natural stone, granite', density: 2600, conductivity: 2.8, specificHeat: 1000, kind: 'design', source: ISO10456, keywords: ['granite', 'stone'] },
  { id: 'mineral-wool', name: 'Mineral wool insulation', density: 30, conductivity: 0.035, specificHeat: 1030, kind: 'assumption', source: ASSUMED_INSULATION, keywords: ['mineral wool', 'rock wool', 'rockwool', 'glass wool', 'insulation', 'dämmung', 'isolation'] },
  { id: 'eps', name: 'Expanded polystyrene (EPS)', density: 20, conductivity: 0.035, specificHeat: 1450, kind: 'assumption', source: ASSUMED_INSULATION, keywords: ['eps', 'expanded polystyrene', 'polystyrene'] },
  { id: 'xps', name: 'Extruded polystyrene (XPS)', density: 35, conductivity: 0.034, specificHeat: 1450, kind: 'assumption', source: ASSUMED_INSULATION, keywords: ['xps', 'extruded polystyrene'] },
];

// Interior and exterior surface resistances, m²·K/W (ISO 6946:2017, Table 7).
const SURFACE_RESISTANCE = {
  wall: { rsi: 0.13, rse: 0.04 },        // horizontal heat flow
  roof: { rsi: 0.10, rse: 0.04 },        // upward heat flow
  floorExposed: { rsi: 0.17, rse: 0.04 },// downward heat flow
  floorGround: { rsi: 0.17, rse: 0 },    // ground resistance is not part of the construction
  interior: { rsi: 0.13, rse: 0.13 },
  interiorFloor: { rsi: 0.17, rse: 0.10 },
};
const SURFACE_RESISTANCE_SOURCE = 'ISO 6946:2017, Table 7 (conventional surface resistances)';

// Reference constructions, outside layer first. Used only when the IFC gives neither
// layer thermal data nor a declared U-value; always shown as an assumption.
const REFERENCE_CONSTRUCTIONS = {
  exteriorWall: { name: 'Reference exterior wall (insulated concrete)', layers: [['screed-cement-sand', 0.01], ['mineral-wool', 0.12], ['concrete-reinforced', 0.2], ['plaster-gypsum-1300', 0.015]] },
  interiorWall: { name: 'Reference partition (plasterboard stud)', layers: [['plasterboard-700', 0.0125], ['mineral-wool', 0.075], ['plasterboard-700', 0.0125]] },
  roof: { name: 'Reference flat roof (insulated concrete)', layers: [['mineral-wool', 0.2], ['concrete-reinforced', 0.2], ['plaster-gypsum-1300', 0.015]] },
  groundFloor: { name: 'Reference ground floor (insulated slab)', layers: [['concrete-reinforced', 0.2], ['eps', 0.08], ['screed-cement-sand', 0.06]] },
  exposedFloor: { name: 'Reference exposed floor (insulated slab)', layers: [['mineral-wool', 0.12], ['concrete-reinforced', 0.2], ['screed-cement-sand', 0.06]] },
  interiorFloor: { name: 'Reference intermediate floor (concrete slab)', layers: [['concrete-reinforced', 0.2], ['screed-cement-sand', 0.06]] },
  door: { name: 'Reference exterior door (solid timber)', layers: [['timber-softwood', 0.05]] },
};
const REFERENCE_WINDOW = { name: 'Reference window (assumed double glazing)', uFactor: 1.4, shgc: 0.4, vt: 0.6, source: 'Assumed whole-window values; replace with the product\'s U, g and τv' };

const libraryMaterial = (id) => LIBRARY_MATERIALS.find(m => m.id === id) || null;

/** Steady-state U-value (W/m²·K) of a layer list [{ thickness, conductivity } | { resistance }]. */
function uValueOf(layers, category = 'wall') {
  const sr = SURFACE_RESISTANCE[category] || SURFACE_RESISTANCE.wall;
  let r = sr.rsi + sr.rse;
  for (const l of layers) {
    if (l.resistance != null) r += l.resistance;
    else if (l.conductivity > 0 && l.thickness > 0) r += l.thickness / l.conductivity;
    else return null;
  }
  return r > 0 ? 1 / r : null;
}

/** Areal heat capacity (kJ/m²·K) of the layers, for display. */
function heatCapacityOf(layers) {
  let c = 0;
  for (const l of layers) if (l.density && l.specificHeat && l.thickness) c += l.density * l.specificHeat * l.thickness;
  return c / 1000;
}

/** A library material whose keywords appear in an IFC material name. A suggestion only. */
function suggestLibraryMaterial(name) {
  const n = ` ${String(name || '').toLowerCase()} `;
  let best = null;
  for (const m of LIBRARY_MATERIALS) for (const k of m.keywords) {
    if (n.includes(k) && (!best || k.length > best.k.length)) best = { m, k };
  }
  return best ? { id: best.m.id, matched: best.k.trim() } : null;
}

Object.assign(window, {
  LIBRARY_MATERIALS, SURFACE_RESISTANCE, SURFACE_RESISTANCE_SOURCE, REFERENCE_CONSTRUCTIONS, REFERENCE_WINDOW,
  libraryMaterial, uValueOf, heatCapacityOf, suggestLibraryMaterial, ISO10456,
});
