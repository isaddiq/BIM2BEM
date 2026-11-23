(() => {
  const GEO_EPS = 1e-9;
  const SNAP = 1e-3;
  const toEP = (x, y, z) => [x, -z, y];
  const fromEP = ([x, y, z]) => [x, z, -y];
  const v3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    }
  };
  function snap(x) {
    return Math.round(x / SNAP) * SNAP;
  }
  function newell(poly) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return [nx, ny, nz];
  }
  function polyArea3(poly) {
    return v3.len(newell(poly)) / 2;
  }
  function polyNormal3(poly) {
    return v3.norm(newell(poly));
  }
  function polyCentroid3(poly) {
    const m = poly.reduce((s, p) => v3.add(s, p), [0, 0, 0]).map((c2) => c2 / poly.length);
    let a = 0;
    let c = [0, 0, 0];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const w = v3.len(v3.cross(v3.sub(p, m), v3.sub(q, m))) / 2;
      a += w;
      c = v3.add(c, v3.scale(v3.add(v3.add(m, p), q), w / 3));
    }
    return a > GEO_EPS ? v3.scale(c, 1 / a) : m;
  }
  function planeBasis(n) {
    let u;
    if (Math.abs(n[2]) > 0.999) u = [1, 0, 0];
    else u = v3.norm([-n[1], n[0], 0]);
    const v = v3.norm(v3.cross(n, u));
    return { u, v, n };
  }
  function to2D(p, origin, b) {
    const d = v3.sub(p, origin);
    return [v3.dot(d, b.u), v3.dot(d, b.v)];
  }
  function to3D(q, origin, b) {
    return v3.add(origin, v3.add(v3.scale(b.u, q[0]), v3.scale(b.v, q[1])));
  }
  function ringArea2(r) {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  function cleanRing(ring, tol = 5e-3) {
    let r = ring.slice();
    if (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < tol) r.pop();
    let changed = true;
    while (changed && r.length >= 3) {
      changed = false;
      for (let i = 0; i < r.length && r.length >= 3; i++) {
        const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
        const abx = b[0] - a[0], aby = b[1] - a[1];
        const acx = c[0] - a[0], acy = c[1] - a[1];
        const lac = Math.hypot(acx, acy);
        const lab = Math.hypot(abx, aby);
        const dist = lac > GEO_EPS ? Math.abs(abx * acy - aby * acx) / lac : lab;
        const along = lac > GEO_EPS ? (abx * acx + aby * acy) / (lac * lac) : 0;
        if (lab < tol || dist < tol && along > -0.01 && along < 1.01) {
          r.splice(i, 1);
          changed = true;
          i--;
        }
      }
    }
    return r.length >= 3 ? r : [];
  }
  function pc() {
    const lib = typeof window !== "undefined" && window.polygonClipping || typeof globalThis !== "undefined" && globalThis.polygonClipping;
    if (!lib) throw new Error("polygon-clipping is not loaded");
    return lib;
  }
  const snapRing = (r) => {
    const out = r.map((p) => [snap(p[0]), snap(p[1])]);
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0].slice());
    return out;
  };
  const asMulti = (polys) => polys.map((p) => p.map(snapRing));
  function mpUnion(list) {
    if (!list.length) return [];
    return pc().union(...list.map((p) => asMulti(p)));
  }
  function mpIntersect(a, b) {
    if (!a.length || !b.length) return [];
    return pc().intersection(asMulti(a), asMulti(b));
  }
  function mpDiff(a, b) {
    if (!a.length) return [];
    if (!b.length) return a;
    return pc().difference(asMulti(a), asMulti(b));
  }
  function mpArea(mp) {
    return mp.reduce((s, poly) => s + poly.reduce((t, ring, i) => t + (i === 0 ? 1 : -1) * Math.abs(ringArea2(ring)), 0), 0);
  }
  function splitHoles(poly) {
    if (poly.length <= 1) return [poly[0]];
    const cuts = /* @__PURE__ */ new Set();
    poly.slice(1).forEach((h) => {
      const vs = h.map((p) => p[1]);
      cuts.add(Math.min(...vs));
      cuts.add(Math.max(...vs));
    });
    const ys = poly[0].map((p) => p[1]);
    const lo = Math.min(...ys) - 1, hi = Math.max(...ys) + 1;
    const xs = poly[0].map((p) => p[0]);
    const xlo = Math.min(...xs) - 1, xhi = Math.max(...xs) + 1;
    const bounds = [lo, ...[...cuts].sort((a, b) => a - b), hi];
    const out = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      if (bounds[i + 1] - bounds[i] < SNAP) continue;
      const band = [[[[xlo, bounds[i]], [xhi, bounds[i]], [xhi, bounds[i + 1]], [xlo, bounds[i + 1]], [xlo, bounds[i]]]]];
      mpIntersect([poly], band).forEach((p) => {
        if (p.length === 1) out.push(p[0]);
        else splitHoles(p).forEach((r) => out.push(r));
      });
    }
    return out;
  }
  function multiToRings(mp, minArea = 0.01) {
    const out = [];
    mp.forEach((poly) => splitHoles(poly).forEach((r) => {
      let ring = cleanRing(r);
      if (ring.length < 3) return;
      if (ringArea2(ring) < 0) ring = ring.reverse();
      if (Math.abs(ringArea2(ring)) >= minArea) out.push(ring);
    }));
    return out;
  }
  function meshVolume(P, I) {
    let vol = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = P[I[t]], b = P[I[t + 1]], c = P[I[t + 2]];
      vol += v3.dot(a, v3.cross(b, c)) / 6;
    }
    return vol;
  }
  function meshPlanarFaces(P, I, { angleTol = 0.02, distTol = 0.02, minArea = 0.01 } = {}) {
    const groups = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = P[I[t]], b = P[I[t + 1]], c = P[I[t + 2]];
      const cr = v3.cross(v3.sub(b, a), v3.sub(c, a));
      const l = v3.len(cr);
      if (l < 1e-8) continue;
      const n = v3.scale(cr, 1 / l);
      const d = v3.dot(n, a);
      let g = groups.find((x) => v3.dot(x.n, n) > 1 - angleTol && Math.abs(x.d - d) < distTol);
      if (!g) {
        g = { n, d, tris: [], area: 0, nAcc: [0, 0, 0] };
        groups.push(g);
      }
      g.tris.push([a, b, c]);
      g.area += l / 2;
      g.nAcc = v3.add(g.nAcc, cr);
    }
    const faces = [];
    groups.forEach((g) => {
      if (g.area < minArea) return;
      const n = v3.norm(g.nAcc);
      const d = g.tris.reduce((s, tr) => s + v3.dot(n, tr[0]), 0) / g.tris.length;
      const origin = v3.scale(n, d);
      const basis = planeBasis(n);
      const tris2 = g.tris.map((tr) => {
        let r = tr.map((p) => to2D(p, origin, basis));
        if (ringArea2(r) < 0) r = r.reverse();
        return [[r]];
      });
      let mp;
      try {
        mp = mpUnion(tris2);
      } catch (err) {
        return;
      }
      const rings = multiToRings(mp, minArea);
      if (rings.length) faces.push({ normal: n, origin, basis, rings, area: rings.reduce((s, r) => s + ringArea2(r), 0) });
    });
    return faces;
  }
  function rayTri(o, d, a, b, c) {
    const e1 = v3.sub(b, a), e2 = v3.sub(c, a);
    const p = v3.cross(d, e2);
    const det = v3.dot(e1, p);
    if (Math.abs(det) < 1e-12) return null;
    const inv = 1 / det;
    const s = v3.sub(o, a);
    const u = v3.dot(s, p) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) return null;
    const q = v3.cross(s, e1);
    const v = v3.dot(d, q) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) return null;
    const t = v3.dot(e2, q) * inv;
    return t > 1e-6 ? t : null;
  }
  function rayBox(o, d, min, max) {
    let t0 = -Infinity, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-12) {
        if (o[k] < min[k] || o[k] > max[k]) return null;
        continue;
      }
      let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    return t1 < 0 ? null : Math.max(t0, 0);
  }
  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1] + 1e-300) + a[0]) inside = !inside;
    }
    return inside;
  }
  function ringSamples(ring, n = 4) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pts = [];
    const c = (() => {
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const w = p[0] * q[1] - q[0] * p[1];
        a += w;
        cx += (p[0] + q[0]) * w;
        cy += (p[1] + q[1]) * w;
      }
      return Math.abs(a) > GEO_EPS ? [cx / (3 * a), cy / (3 * a)] : [(x0 + x1) / 2, (y0 + y1) / 2];
    })();
    if (pointInRing(c, ring)) pts.push(c);
    for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) {
      const p = [x0 + (x1 - x0) * (i - 0.5) / n, y0 + (y1 - y0) * (j - 0.5) / n];
      if (pointInRing(p, ring)) pts.push(p);
    }
    return pts.length ? pts : [c];
  }
  Object.assign(window, {
    toEP,
    fromEP,
    v3,
    newell,
    polyArea3,
    polyNormal3,
    polyCentroid3,
    planeBasis,
    to2D,
    to3D,
    ringArea2,
    cleanRing,
    mpUnion,
    mpIntersect,
    mpDiff,
    mpArea,
    splitHoles,
    multiToRings,
    meshVolume,
    meshPlanarFaces,
    rayTri,
    rayBox,
    pointInRing,
    ringSamples,
    GEO_SNAP: SNAP
  });
})();
