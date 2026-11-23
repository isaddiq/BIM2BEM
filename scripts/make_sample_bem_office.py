"""
Generate the BIM2BEM reference model "BEM demo office" (IFC4).

A fictional two-storey office written to exercise and verify the IFC-to-BEM pipeline.
Every number here is a known input, so the conversion can be checked against it:

  * plan 20.0 m (project x) by 12.0 m (project y) to the inside faces of the exterior walls
  * two storeys of 3.5 m; rooms 3.24 m high (floor-to-ceiling)
  * four rooms per storey, 9.9 m x 5.9 m each (58.41 m2), split by 0.2 m partitions
  * exterior wall 15 render + 160 mineral wool + 200 reinforced concrete + 15 gypsum plaster
  * intermediate floor 200 concrete + 60 screed; ground floor 250 concrete + 100 XPS + 60 screed
  * roof 200 concrete + 220 mineral wool
  * material thermal data as IfcMaterialProperties (Pset_MaterialThermal, Pset_MaterialCommon),
    values from ISO 10456:2007 Table 3 or typical declared values for the insulation products
  * windows with Pset_WindowCommon.ThermalTransmittance and Pset_DoorWindowGlazingType
  * IfcSite at 37.5663 N, 126.9779 E, 38 m (used only to look up weather; the building is fictional)
  * project north rotated 15 degrees east of true north (IfcGeometricRepresentationContext.TrueNorth)

Released under the project's MIT licence. Run with a Python that has IfcOpenShell 0.8+:

    py -3.13 scripts/make_sample_bem_office.py assets/ifc/BEMDemoOffice.ifc
"""

import math
import sys

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.api.project
import ifcopenshell.guid

OUT = sys.argv[1] if len(sys.argv) > 1 else "BEMDemoOffice.ifc"

LX, LY = 20.0, 12.0
STOREY_H = 3.5
ROOM_H = 3.24
PART_T = 0.2
NORTH_DEG = 15.0

# name: (conductivity W/mK, density kg/m3, specific heat J/kgK, colour)
MATS = {
    "Cement render": (1.0, 1800, 1000, (0.86, 0.84, 0.80)),
    "Mineral wool": (0.035, 30, 1030, (0.93, 0.85, 0.45)),
    "Reinforced concrete": (2.3, 2300, 1000, (0.66, 0.66, 0.64)),
    "Gypsum plaster": (0.57, 1300, 1000, (0.95, 0.94, 0.91)),
    "Gypsum plasterboard": (0.21, 700, 1000, (0.96, 0.96, 0.95)),
    "Extruded polystyrene": (0.034, 35, 1450, (0.55, 0.75, 0.90)),
    "Cement screed": (1.0, 1800, 1000, (0.78, 0.77, 0.74)),
}
EXT_WALL = [("Cement render", 0.015), ("Mineral wool", 0.16), ("Reinforced concrete", 0.2), ("Gypsum plaster", 0.015)]
PARTITION = [("Gypsum plasterboard", 0.0125), ("Mineral wool", 0.175), ("Gypsum plasterboard", 0.0125)]
FLOOR_MID = [("Reinforced concrete", 0.2), ("Cement screed", 0.06)]
FLOOR_GROUND = [("Reinforced concrete", 0.25), ("Extruded polystyrene", 0.1), ("Cement screed", 0.06)]
ROOF = [("Reinforced concrete", 0.2), ("Mineral wool", 0.22)]
EXT_T = sum(t for _, t in EXT_WALL)

f = ifcopenshell.api.project.create_file(version="IFC4")
api = lambda usecase, **kw: ifcopenshell.api.run(usecase, f, **kw)

project = api("root.create_entity", ifc_class="IfcProject", name="BIM2BEM reference model: BEM demo office")
api("unit.assign_unit", units=[
    api("unit.add_si_unit", unit_type="LENGTHUNIT"),
    api("unit.add_si_unit", unit_type="AREAUNIT"),
    api("unit.add_si_unit", unit_type="VOLUMEUNIT"),
])
model_ctx = api("context.add_context", context_type="Model")
a = math.radians(NORTH_DEG)
model_ctx.TrueNorth = f.createIfcDirection([-math.sin(a), math.cos(a)])
body = api("context.add_context", context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=model_ctx)

site = api("root.create_entity", ifc_class="IfcSite", name="Demo site (fictional building)")
site.RefLatitude = (37, 33, 58, 680000)
site.RefLongitude = (126, 58, 40, 440000)
site.RefElevation = 38.0
building = api("root.create_entity", ifc_class="IfcBuilding", name="BEM demo office")
building.BuildingAddress = f.createIfcPostalAddress(None, None, None, None, ["Fictional demo building"], None, "Seoul", None, None, "KR")
api("aggregate.assign_object", products=[site], relating_object=project)
api("aggregate.assign_object", products=[building], relating_object=site)


def pt(*c):
    return f.createIfcCartesianPoint([float(v) for v in c])


def dirn(*c):
    return f.createIfcDirection([float(v) for v in c])


def axis3(x=0.0, y=0.0, z=0.0, axis=None, ref=None):
    return f.createIfcAxis2Placement3D(pt(x, y, z), dirn(*axis) if axis else None, dirn(*ref) if ref else None)


def placement(rel, x=0.0, y=0.0, z=0.0, ref=None):
    return f.createIfcLocalPlacement(rel, axis3(x, y, z, axis=(0, 0, 1) if ref else None, ref=ref))


def box(x0, y0, z0, x1, y1, z1):
    dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
    prof = f.createIfcRectangleProfileDef("AREA", None, f.createIfcAxis2Placement2D(f.createIfcCartesianPoint([dx / 2, dy / 2]), None), dx, dy)
    return f.createIfcExtrudedAreaSolid(prof, axis3(x0, y0, z0), dirn(0, 0, 1), dz)


def shape(items):
    return f.createIfcProductDefinitionShape(None, None, [f.createIfcShapeRepresentation(body, "Body", "SweptSolid", items)])


_styles = {}


def style(colour, transparency=0.0):
    key = (colour, transparency)
    if key not in _styles:
        r = f.createIfcSurfaceStyleRendering(f.createIfcColourRgb(None, *colour), transparency, None, None, None, None, None, None, "NOTDEFINED")
        _styles[key] = f.createIfcSurfaceStyle(None, "BOTH", [r])
    return _styles[key]


def make(cls, name, rel, items, colour, transparency=0.0, **attrs):
    el = api("root.create_entity", ifc_class=cls, name=name)
    for k, v in attrs.items():
        setattr(el, k, v)
    el.ObjectPlacement = rel
    el.Representation = shape(items)
    for it in items:
        f.createIfcStyledItem(it, [style(colour, transparency)], None)
    return el


def single(name, value, measure):
    return f.createIfcPropertySingleValue(name, None, f.create_entity(measure, value), None)


def add_pset(product, name, props):
    ps = f.createIfcPropertySet(ifcopenshell.guid.new(), None, name, None, props)
    f.createIfcRelDefinesByProperties(ifcopenshell.guid.new(), None, None, None, [product], ps)


# Materials with thermal properties.
materials = {}
for name, (k, rho, cp, colour) in MATS.items():
    m = f.createIfcMaterial(name, None, None)
    f.createIfcMaterialProperties("Pset_MaterialThermal", None, [single("ThermalConductivity", k, "IfcThermalConductivityMeasure"), single("SpecificHeatCapacity", float(cp), "IfcSpecificHeatCapacityMeasure")], m)
    f.createIfcMaterialProperties("Pset_MaterialCommon", None, [single("MassDensity", float(rho), "IfcMassDensityMeasure")], m)
    materials[name] = m


def layer_set(name, layers):
    return f.createIfcMaterialLayerSet([f.createIfcMaterialLayer(materials[m], t, None, m, None, None, None) for m, t in layers], name, None)


SETS = {
    "ext": layer_set("Exterior wall 390", EXT_WALL),
    "part": layer_set("Partition 200", PARTITION),
    "mid": layer_set("Intermediate floor 260", FLOOR_MID),
    "ground": layer_set("Ground floor 410", FLOOR_GROUND),
    "roof": layer_set("Flat roof 420", ROOF),
}
_usage_users = {}


def assign_usage(el, key, direction):
    usage_key = (key, direction)
    if usage_key not in _usage_users:
        _usage_users[usage_key] = (f.createIfcMaterialLayerSetUsage(SETS[key], direction, "POSITIVE", 0.0, None), [])
    _usage_users[usage_key][1].append(el)


storeys = []
for i in range(2):
    st = api("root.create_entity", ifc_class="IfcBuildingStorey", name=f"Level {i}")
    st.Elevation = i * STOREY_H
    st.ObjectPlacement = placement(None, 0, 0, i * STOREY_H)
    storeys.append(st)
api("aggregate.assign_object", products=storeys, relating_object=building)

ROOMS = [
    ("SW", 0.0, 0.0, LX / 2 - PART_T / 2, LY / 2 - PART_T / 2),
    ("SE", LX / 2 + PART_T / 2, 0.0, LX, LY / 2 - PART_T / 2),
    ("NW", 0.0, LY / 2 + PART_T / 2, LX / 2 - PART_T / 2, LY),
    ("NE", LX / 2 + PART_T / 2, LY / 2 + PART_T / 2, LX, LY),
]
# Windows per room: (wall side, along0, along1, sill, head); 'along' measured in project coordinates.
WINDOWS = {
    "SW": [("S", 2.0, 8.0, 0.9, 2.4), ("W", 1.95, 3.95, 0.9, 2.4)],
    "SE": [("S", 12.0, 18.0, 0.9, 2.4), ("E", 1.95, 3.95, 0.9, 2.4)],
    "NW": [("N", 3.0, 7.0, 0.9, 2.4), ("W", 8.05, 10.05, 0.9, 2.4)],
    "NE": [("N", 13.0, 17.0, 0.9, 2.4), ("E", 8.05, 10.05, 0.9, 2.4)],
}

for li, st in enumerate(storeys):
    sp = st.ObjectPlacement
    contained, spaces = [], []
    top = STOREY_H if li == 0 else STOREY_H + 0.42 - 0.26  # level 1 walls rise to the roof top
    # Exterior walls: reference line on the outer face, local +Y pointing into the building,
    # layers stacked along +Y from the outside (render) to the inside (plaster).
    T = EXT_T
    walls = {
        "S": (-T, -T, (1, 0, 0), LX + 2 * T),
        "E": (LX + T, 0.0, (0, 1, 0), LY),
        "N": (LX + T, LY + T, (-1, 0, 0), LX + 2 * T),
        "W": (-T, LY, (0, -1, 0), LY),
    }
    wall_el = {}
    for side, (x, y, ref, length) in walls.items():
        w = make("IfcWall", f"Exterior wall {side} L{li}", placement(sp, x, y, 0.0, ref=ref), [box(0, 0, 0, length, T, top)], (0.86, 0.84, 0.80), PredefinedType="STANDARD")
        assign_usage(w, "ext", "AXIS2")
        add_pset(w, "Pset_WallCommon", [single("IsExternal", True, "IfcBoolean"), single("LoadBearing", True, "IfcBoolean")])
        contained.append(w)
        wall_el[side] = (w, x, y, ref, length)
    # Partitions.
    p1 = make("IfcWall", f"Partition E-W L{li}", placement(sp, 0.0, LY / 2 - PART_T / 2, 0.0, ref=(1, 0, 0)), [box(0, 0, 0, LX, PART_T, ROOM_H)], (0.96, 0.96, 0.95), PredefinedType="PARTITIONING")
    p2a = make("IfcWall", f"Partition N-S south L{li}", placement(sp, LX / 2 + PART_T / 2, 0.0, 0.0, ref=(0, 1, 0)), [box(0, 0, 0, LY / 2 - PART_T / 2, PART_T, ROOM_H)], (0.96, 0.96, 0.95), PredefinedType="PARTITIONING")
    p2b = make("IfcWall", f"Partition N-S north L{li}", placement(sp, LX / 2 + PART_T / 2, LY / 2 + PART_T / 2, 0.0, ref=(0, 1, 0)), [box(0, 0, 0, LY / 2 - PART_T / 2, PART_T, ROOM_H)], (0.96, 0.96, 0.95), PredefinedType="PARTITIONING")
    for p in (p1, p2a, p2b):
        assign_usage(p, "part", "AXIS2")
        add_pset(p, "Pset_WallCommon", [single("IsExternal", False, "IfcBoolean")])
        contained.append(p)
    # Floor slab of this storey (ground floor on level 0), reference at the underside, layers upward.
    if li == 0:
        slab = make("IfcSlab", "Ground floor slab", placement(sp, 0, 0, -0.41), [box(0, 0, 0, LX, LY, 0.41)], (0.78, 0.77, 0.74), PredefinedType="BASESLAB")
        assign_usage(slab, "ground", "AXIS3")
    else:
        slab = make("IfcSlab", "Floor slab Level 1", placement(sp, 0, 0, -0.26), [box(0, 0, 0, LX, LY, 0.26)], (0.78, 0.77, 0.74), PredefinedType="FLOOR")
        assign_usage(slab, "mid", "AXIS3")
    add_pset(slab, "Pset_SlabCommon", [single("IsExternal", li == 0, "IfcBoolean")])
    contained.append(slab)
    if li == 1:
        roof = make("IfcSlab", "Roof slab", placement(sp, 0, 0, ROOM_H), [box(0, 0, 0, LX, LY, 0.42)], (0.35, 0.36, 0.38), PredefinedType="ROOF")
        assign_usage(roof, "roof", "AXIS3")
        add_pset(roof, "Pset_SlabCommon", [single("IsExternal", True, "IfcBoolean")])
        contained.append(roof)
    # Rooms and windows.
    for code, x0, y0, x1, y1 in ROOMS:
        s = make("IfcSpace", f"{li}.{code}", placement(sp), [box(x0, y0, 0, x1, y1, ROOM_H)], (0.31, 0.70, 0.66), 0.7, LongName=f"Office {code} L{li}", PredefinedType="INTERNAL")
        add_pset(s, "Pset_SpaceCommon", [single("IsExternal", False, "IfcBoolean"), single("Reference", f"{li}.{code}", "IfcIdentifier")])
        q = f.createIfcElementQuantity(ifcopenshell.guid.new(), None, "Qto_SpaceBaseQuantities", None, None, [
            f.createIfcQuantityArea("NetFloorArea", None, None, round((x1 - x0) * (y1 - y0), 4), None),
            f.createIfcQuantityLength("Height", None, None, ROOM_H, None),
        ])
        f.createIfcRelDefinesByProperties(ifcopenshell.guid.new(), None, None, None, [s], q)
        spaces.append(s)
        for wi, (side, a0, a1, sill, head) in enumerate(WINDOWS[code]):
            w, wx, wy, ref, length = wall_el[side]
            # Distance along the wall's local x from its origin.
            if side == "S":
                u0, u1 = a0 - wx, a1 - wx
            elif side == "N":
                u0, u1 = wx - a1, wx - a0
            elif side == "E":
                u0, u1 = a0 - wy, a1 - wy
            else:
                u0, u1 = wy - a1, wy - a0
            op = make("IfcOpeningElement", f"Opening {code}{wi} L{li}", placement(w.ObjectPlacement), [box(u0, -0.05, sill, u1, EXT_T + 0.05, head)], (0.8, 0.8, 0.8), PredefinedType="OPENING")
            f.createIfcRelVoidsElement(ifcopenshell.guid.new(), None, None, None, w, op)
            win = make("IfcWindow", f"Window {li}.{code}.{wi + 1}", placement(w.ObjectPlacement), [box(u0, EXT_T * 0.35, sill, u1, EXT_T * 0.35 + 0.1, head)], (0.55, 0.75, 0.89), 0.55, OverallWidth=round(u1 - u0, 4), OverallHeight=round(head - sill, 4), PredefinedType="WINDOW")
            f.createIfcRelFillsElement(ifcopenshell.guid.new(), None, None, None, op, win)
            add_pset(win, "Pset_WindowCommon", [single("IsExternal", True, "IfcBoolean"), single("ThermalTransmittance", 1.1, "IfcThermalTransmittanceMeasure")])
            add_pset(win, "Pset_DoorWindowGlazingType", [single("SolarHeatGainTransmittance", 0.45, "IfcNormalisedRatioMeasure"), single("VisibleLightTransmittance", 0.7, "IfcNormalisedRatioMeasure")])
            contained.append(win)
    api("spatial.assign_container", products=contained, relating_structure=st)
    api("aggregate.assign_object", products=spaces, relating_object=st)

for (usage, users) in _usage_users.values():
    f.createIfcRelAssociatesMaterial(ifcopenshell.guid.new(), None, None, None, users, usage)

f.write(OUT)
print(f"Wrote {OUT}")
