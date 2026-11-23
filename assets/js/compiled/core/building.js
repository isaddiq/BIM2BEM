(() => {
  const PIPELINE_STEPS = {
    S1: "S1 \xB7 Level extraction",
    S2: "S2 \xB7 Room extraction",
    S3: "S3 \xB7 Door linking",
    S4: "S4 \xB7 Vertical linking"
  };
  function bboxCenter(b) {
    return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  }
  function bboxGapXZ(a, b) {
    const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
    const dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
    return Math.hypot(dx, dz);
  }
  function overlapY(a, b, tol = 0) {
    return a.min[1] - tol <= b.max[1] && b.min[1] - tol <= a.max[1];
  }
  function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function spaceFootprint(el) {
    const g = el.geometry;
    if (!g || !g.positions || !g.indices) return null;
    const p = g.positions;
    const idx = g.indices;
    let area = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len === 0 || ny / len > -0.9) continue;
      const triArea = len / 2;
      area += triArea;
      cx += triArea * (p[a] + p[b] + p[c]) / 3;
      cy += triArea * (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
      cz += triArea * (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    }
    if (area <= 1e-6) return null;
    return { area, centroid: [cx / area, cy / area, cz / area] };
  }
  function displayName(el) {
    if (!el) return "\u2014";
    const n = (el.name || "").trim();
    const ln = (el.longName || "").trim();
    if (n && ln && n !== ln) return `${n} ${ln}`;
    return n || ln || `${el.ifcClass.replace(/^Ifc/, "")} #${el.expressId}`;
  }
  function verticalKind(el) {
    const c = el.ifcClass;
    const pt = String(el.predefinedType || "").toUpperCase();
    if (/^IfcRamp/.test(c)) return "ramp";
    if (c === "IfcTransportElement") {
      if (pt.includes("ESCALATOR")) return "escalator";
      if (pt.includes("MOVINGWALKWAY")) return "walkway";
      return "lift";
    }
    return "stair";
  }
  function buildBuildingGraph(model) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const scale = model.lengthUnit && model.lengthUnit.scale || 1;
    const instances = model.elements.filter((e) => !e.isType);
    const levels = model.storeys.map((st) => {
      const members = instances.filter((e) => e.storey === st);
      const geo = members.filter((e) => e.bbox);
      const walkTops = geo.filter((e) => elementRoleOf(e) === "walkable").map((e) => e.bbox.max[1]);
      let floorY = null;
      let floorSource = null;
      if (walkTops.length) {
        floorY = median(walkTops);
        floorSource = `median top of ${walkTops.length} walkable slab${walkTops.length === 1 ? "" : "s"}`;
      } else if (geo.length) {
        floorY = Math.min(...geo.map((e) => e.bbox.min[1]));
        floorSource = "lowest contained geometry";
      }
      return {
        id: st.expressId,
        storeyId: st.expressId,
        name: st.name || st.longName || `Storey #${st.expressId}`,
        elevationAttr: st.elevation != null ? Number(st.elevation) * scale : null,
        floorY,
        floorSource,
        elementIds: members.map((e) => e.expressId),
        geometryCount: geo.length,
        spaceIds: [],
        doorIds: [],
        verticalIds: []
      };
    });
    levels.sort((a, b) => {
      if (a.floorY != null && b.floorY != null) return a.floorY - b.floorY;
      return (a.elevationAttr || 0) - (b.elevationAttr || 0);
    });
    const reference = levels.filter((l) => l.floorY != null && l.elevationAttr != null && l.floorSource && l.floorSource.startsWith("median")).sort((a, b) => Math.abs(a.elevationAttr) - Math.abs(b.elevationAttr))[0];
    const lowest = levels.find((l) => l.floorY != null);
    const elevationOffset = reference ? reference.elevationAttr - reference.floorY : lowest ? -lowest.floorY : 0;
    const elevationReference = reference ? `the IFC elevation of ${reference.name}` : "the lowest level";
    levels.forEach((lv, i) => {
      lv.elevation = lv.floorY != null ? lv.floorY + elevationOffset : null;
      const next = levels.slice(i + 1).find((n) => n.floorY != null);
      lv.index = i;
      lv.heightToNext = next && lv.floorY != null ? next.floorY - lv.floorY : null;
    });
    const levelById = new Map(levels.map((l) => [l.id, l]));
    const levelByY = (y) => {
      let best = null;
      levels.forEach((l) => {
        if (l.floorY == null) return;
        if (l.floorY <= y + 0.3 && (!best || l.floorY > best.floorY)) best = l;
      });
      return best || levels.find((l) => l.floorY != null) || null;
    };
    const levelOf = (el) => {
      if (el.storey && levelById.has(el.storey.expressId)) return levelById.get(el.storey.expressId);
      return el.bbox ? levelByY(el.bbox.min[1]) : null;
    };
    const spaces = /* @__PURE__ */ new Map();
    const spacesWithoutGeometry = [];
    (model.byClass.get("IfcSpace") || []).forEach((id) => {
      const el = model.byId.get(id);
      if (!el.bbox) {
        spacesWithoutGeometry.push(id);
        return;
      }
      const level = levelOf(el);
      const fp = spaceFootprint(el);
      const c = bboxCenter(el.bbox);
      const floorY = level && level.floorY != null ? Math.max(level.floorY, el.bbox.min[1]) : el.bbox.min[1];
      const centroid = fp ? [fp.centroid[0], floorY, fp.centroid[2]] : [c[0], floorY, c[2]];
      spaces.set(id, {
        id,
        name: displayName(el),
        named: !!((el.name || "").trim() || (el.longName || "").trim()),
        levelId: level ? level.id : null,
        levelFromStorey: !!(el.storey && levelById.has(el.storey.expressId)),
        bbox: el.bbox,
        area: fp ? fp.area : (el.bbox.max[0] - el.bbox.min[0]) * (el.bbox.max[2] - el.bbox.min[2]),
        areaSource: fp ? "floor faces" : "bounding box",
        position: centroid,
        doorIds: []
      });
      if (level) level.spaceIds.push(id);
    });
    const doors = /* @__PURE__ */ new Map();
    const doorIds = [];
    model.byClass.forEach((ids, cls) => {
      if (/^IfcDoor/.test(cls)) doorIds.push(...ids);
    });
    const openingToDoor = /* @__PURE__ */ new Map();
    const doorToHost = /* @__PURE__ */ new Map();
    const nr = model.navRelations || { spaceBoundaries: /* @__PURE__ */ new Map(), virtualBoundaries: /* @__PURE__ */ new Map(), fills: /* @__PURE__ */ new Map(), voids: /* @__PURE__ */ new Map() };
    nr.fills.forEach((fillers, openingId) => fillers.forEach((f) => openingToDoor.set(openingId, f)));
    nr.voids.forEach((openings2, hostId) => openings2.forEach((o) => {
      const d = openingToDoor.get(o);
      if (d != null) doorToHost.set(d, hostId);
    }));
    doorIds.forEach((id) => {
      const el = model.byId.get(id);
      if (!el || !el.bbox) return;
      const level = levelOf(el);
      const b = el.bbox;
      const dx = b.max[0] - b.min[0];
      const dz = b.max[2] - b.min[2];
      const attrWidth = el.overallWidth != null ? Number(el.overallWidth) * scale : null;
      const width = attrWidth || Math.max(dx, dz);
      const c = bboxCenter(b);
      doors.set(id, {
        id,
        name: displayName(el),
        levelId: level ? level.id : null,
        bbox: b,
        position: [c[0], b.min[1], c[2]],
        normalAxis: dx < dz ? 0 : 2,
        // the thin horizontal axis points through the door
        width,
        widthSource: attrWidth ? "OverallWidth attribute" : "bounding box",
        hostId: doorToHost.get(id) || null,
        spaceIds: [],
        linkSource: null
      });
      if (level) level.doorIds.push(id);
    });
    nr.spaceBoundaries.forEach((elementIds, spaceId) => {
      if (!spaces.has(spaceId)) return;
      elementIds.forEach((eid) => {
        const d = doors.get(eid);
        if (!d || d.spaceIds.includes(spaceId)) return;
        d.spaceIds.push(spaceId);
        d.linkSource = "IfcRelSpaceBoundary";
      });
    });
    const GAP_TOL = 0.45;
    doors.forEach((d) => {
      if (d.spaceIds.length >= 2) return;
      const axis = d.normalAxis;
      const center = bboxCenter(d.bbox);
      const sides = { neg: null, pos: null };
      spaces.forEach((s) => {
        if (d.spaceIds.includes(s.id)) return;
        if (!overlapY(d.bbox, s.bbox, 0.3)) return;
        const gap = bboxGapXZ(d.bbox, s.bbox);
        if (gap > GAP_TOL) return;
        const side = s.position[axis] < center[axis] ? "neg" : "pos";
        if (!sides[side] || gap < sides[side].gap) sides[side] = { id: s.id, gap };
      });
      const known = d.spaceIds[0] ? spaces.get(d.spaceIds[0]) : null;
      const knownSide = known ? known.position[axis] < center[axis] ? "neg" : "pos" : null;
      ["neg", "pos"].forEach((side) => {
        if (side === knownSide || !sides[side] || d.spaceIds.length >= 2) return;
        d.spaceIds.push(sides[side].id);
        d.linkSource = d.linkSource ? `${d.linkSource} + geometry` : "geometry";
      });
    });
    doors.forEach((d) => d.spaceIds.forEach((sid) => spaces.get(sid).doorIds.push(d.id)));
    const openings = /* @__PURE__ */ new Map();
    const hasVirtualInfo = nr.virtualBoundaries && nr.virtualBoundaries.size > 0;
    const spaceList = [...spaces.values()];
    for (let i = 0; i < spaceList.length; i++) {
      for (let j = i + 1; j < spaceList.length; j++) {
        const a = spaceList[i], b = spaceList[j];
        if (a.levelId == null || a.levelId !== b.levelId) continue;
        if (hasVirtualInfo && !(nr.virtualBoundaries.get(a.id) && nr.virtualBoundaries.get(b.id))) continue;
        if (bboxGapXZ(a.bbox, b.bbox) > 0.05) continue;
        const lo = [Math.max(a.bbox.min[0], b.bbox.min[0]), Math.max(a.bbox.min[2], b.bbox.min[2])];
        const hi = [Math.min(a.bbox.max[0], b.bbox.max[0]), Math.min(a.bbox.max[2], b.bbox.max[2])];
        const contact = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
        if (contact < 0.6) continue;
        const key = `o:${a.id}-${b.id}`;
        const y = Math.max(a.position[1], b.position[1]);
        openings.set(key, {
          id: key,
          name: `Open connection ${a.name} / ${b.name}`,
          levelId: a.levelId,
          spaceIds: [a.id, b.id],
          position: [(lo[0] + hi[0]) / 2, y, (lo[1] + hi[1]) / 2],
          width: contact,
          linkSource: hasVirtualInfo ? "IfcRelSpaceBoundary (VIRTUAL) + geometry" : "geometry (touching rooms)"
        });
        a.openingIds = (a.openingIds || []).concat(key);
        b.openingIds = (b.openingIds || []).concat(key);
      }
    }
    const verticalRoots = /* @__PURE__ */ new Map();
    instances.forEach((el) => {
      if (elementRoleOf(el) !== "vertical" || !el.bbox) return;
      let root = el;
      let cur = el;
      while (cur.parentExpressId != null) {
        const p = model.byId.get(cur.parentExpressId);
        if (!p || elementRoleOf(p) !== "vertical") break;
        root = p;
        cur = p;
      }
      if (!verticalRoots.has(root.expressId)) {
        verticalRoots.set(root.expressId, { id: root.expressId, name: displayName(root), kind: verticalKind(root), memberIds: [], bbox: { min: [...el.bbox.min], max: [...el.bbox.max] } });
      }
      const v = verticalRoots.get(root.expressId);
      v.memberIds.push(el.expressId);
      for (let a = 0; a < 3; a++) {
        v.bbox.min[a] = Math.min(v.bbox.min[a], el.bbox.min[a]);
        v.bbox.max[a] = Math.max(v.bbox.max[a], el.bbox.max[a]);
      }
    });
    const verticals = /* @__PURE__ */ new Map();
    verticalRoots.forEach((v) => {
      const served = levels.filter((l) => l.floorY != null && l.floorY >= v.bbox.min[1] - 0.6 && l.floorY <= v.bbox.max[1] + 0.6);
      v.levelIds = served.map((l) => l.id);
      served.forEach((l) => l.verticalIds.push(v.id));
      verticals.set(v.id, v);
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      levels,
      elevationOffset,
      elevationReference,
      spaces,
      doors,
      openings,
      verticals,
      spacesWithoutGeometry,
      unassignedGeometry: instances.filter((e) => e.bbox && !e.storey && elementRoleOf(e) !== "container").map((e) => e.expressId),
      buildMs: t1 - t0
    };
  }
  Object.assign(window, {
    PIPELINE_STEPS,
    buildBuildingGraph,
    spaceDisplayName: displayName
  });
})();
