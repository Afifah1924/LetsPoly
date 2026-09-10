import * as THREE from "three";
import { computeUnfold, netProjection } from "./polyhedronUnfold";

/**
 * Geometry-derived net measurements. All lengths come from the actual solid
 * and the net coordinates produced by its rigid unfolding. Nothing is
 * hard-coded and nothing is distorted; rounding happens only at display time.
 */

type Pt = { x: number; y: number };

export type Measurement = {
  faceCount: number;
  vertexCount: number;
  edgeCount: number;
  euler: number;
  rawW: number;
  rawH: number;
  /** Distinct solid edge-length classes in raw units (length = running mean). */
  classes: Array<{ length: number; count: number; onTri: boolean; onQuad: boolean }>;
  /** Largest |edge − class-mean| across every solid edge, in raw units. */
  maxEdgeError: number;
  /** Largest endpoint gap between the two coincident copies of a shared net edge. */
  maxFoldGap: number;
};

const key3 = (p: THREE.Vector3) => `${p.x.toFixed(6)}|${p.y.toFixed(6)}|${p.z.toFixed(6)}`;
const key2 = (x: number, y: number) => `${x.toFixed(9)}|${y.toFixed(9)}`;

/** Cyclic boundary order of a convex face (sorted around its centroid). */
function boundaryOrder(pts: THREE.Vector3[]): number[] {
  if (pts.length <= 3) return pts.map((_, i) => i);
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  let e1: THREE.Vector3 | null = null;
  let n: THREE.Vector3 | null = null;
  outer: for (let i = 1; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      e1 = new THREE.Vector3().subVectors(pts[i], pts[0]);
      const t = new THREE.Vector3().subVectors(pts[j], pts[0]);
      n = new THREE.Vector3().crossVectors(e1, t);
      if (n.lengthSq() > 1e-12) break outer;
    }
  }
  if (!e1 || !n) return pts.map((_, i) => i);
  n.normalize();
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  return pts
    .map((p, i) => {
      const d = new THREE.Vector3().subVectors(p, c);
      return { i, ang: Math.atan2(d.dot(e2), d.dot(e1)) };
    })
    .sort((a, b) => a.ang - b.ang)
    .map((o) => o.i);
}

export function measureNet(selected: string): Measurement | null {
  const unfold = computeUnfold(selected);
  if (!unfold) return null;
  const proj = netProjection(unfold);
  const polys = proj.polygons;
  const solid = unfold.solid;

  // ---- Count vertices / edges and gather every edge length on the SOLID ----
  const verts = new Set<string>();
  const edgeLens = new Map<string, number>();
  const occ: Array<{ len: number; faceSize: number }> = [];

  solid.forEach((pts) => {
    const order = boundaryOrder(pts);
    for (let i = 0; i < order.length; i++) {
      const a = pts[order[i]];
      const b = pts[order[(i + 1) % order.length]];
      const ka = key3(a);
      const kb = key3(b);
      verts.add(ka);
      verts.add(kb);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const len = a.distanceTo(b);
      edgeLens.set(key, len);
      occ.push({ len, faceSize: pts.length });
    }
  });

  // ---- Cluster solid edge lengths into classes ----
  const sorted = Array.from(edgeLens.values()).sort((x, y) => x - y);
  const classes: Measurement["classes"] = [];
  for (const l of sorted) {
    const last = classes[classes.length - 1];
    if (!last || Math.abs(l - last.length) > 1e-7 * last.length + 1e-9) {
      classes.push({ length: l, count: 1, onTri: false, onQuad: false });
    } else {
      last.length = (last.length * last.count + l) / (last.count + 1);
      last.count += 1;
    }
  }

  const classIdOf = (len: number): number => {
    for (let c = 0; c < classes.length; c++) {
      if (Math.abs(len - classes[c].length) <= 1e-6 * classes[c].length + 1e-7) return c;
    }
    return classes.length - 1;
  };

  occ.forEach((o) => {
    const c = classIdOf(o.len);
    if (o.faceSize === 3) classes[c].onTri = true;
    if (o.faceSize === 4) classes[c].onQuad = true;
  });

  // ---- Max within-class deviation ----
  let maxEdgeError = 0;
  edgeLens.forEach((len) => {
    const cls = classes[classIdOf(len)];
    maxEdgeError = Math.max(maxEdgeError, Math.abs(len - cls.length));
  });

  // ---- Shared-edge gap check on the flat net (fold creases must coincide) ----
  const netEdge = new Map<string, { count: number; a1?: Pt; b1?: Pt; a2?: Pt; b2?: Pt }>();
  polys.forEach((poly) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ka = key2(a.x, a.y);
      const kb = key2(b.x, b.y);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const rec = netEdge.get(key) || { count: 0 };
      rec.count += 1;
      if (rec.count === 1) {
        rec.a1 = a;
        rec.b1 = b;
      } else if (rec.count === 2) {
        rec.a2 = a;
        rec.b2 = b;
      }
      netEdge.set(key, rec);
    }
  });

  let maxFoldGap = 0;
  netEdge.forEach((e) => {
    if (e.count !== 2 || !e.a1 || !e.b1 || !e.a2 || !e.b2) return;
    const d1 =
      Math.hypot(e.a1.x - e.a2.x, e.a1.y - e.a2.y) + Math.hypot(e.b1.x - e.b2.x, e.b1.y - e.b2.y);
    const d2 =
      Math.hypot(e.a1.x - e.b2.x, e.a1.y - e.b2.y) + Math.hypot(e.b1.x - e.a2.x, e.b1.y - e.a2.y);
    maxFoldGap = Math.max(maxFoldGap, Math.min(d1, d2));
  });

  const faceCount = polys.length;
  const edgeCount = edgeLens.size;
  const vertexCount = verts.size;
  const b = proj.bounds;

  return {
    faceCount,
    vertexCount,
    edgeCount,
    euler: vertexCount - edgeCount + faceCount,
    rawW: b.maxX - b.minX,
    rawH: b.maxY - b.minY,
    classes,
    maxEdgeError,
    maxFoldGap,
  };
}

export type EdgeRow = { label: string; mm: number; count: number };

export type NetFit = {
  netHeightMm: number;
  netWidthMm: number;
  scale: number;
  edgeRows: EdgeRow[];
  maxEdgeErrorMm: number;
  maxFoldGapMm: number;
  faceCount: number;
  vertexCount: number;
  edgeCount: number;
  euler: number;
};

function edgeLabels(selected: string, classes: Measurement["classes"]): string[] {
  return classes.map((c) => {
    if (classes.length === 1) return "Edge length";
    if (selected === "Pyramid") return c.onQuad ? "Base edge" : "Lateral edge";
    if (selected === "Prism") return c.onTri ? "Edge (triangular faces)" : "Edge (prism length)";
    return "Edge length";
  });
}

/**
 * Fit an already-measured net to a requested physical HEIGHT (mm) using one
 * uniform scale. Width and edge measurements follow from the scaled geometry.
 */
export function fitFromMeasurement(
  m: Measurement,
  selected: string,
  heightMm: number
): NetFit | null {
  if (!m || !(m.rawH > 0) || !(heightMm > 0)) return null;

  const scale = heightMm / m.rawH;
  const labels = edgeLabels(selected, m.classes);

  return {
    netHeightMm: heightMm,
    netWidthMm: m.rawW * scale,
    scale,
    edgeRows: m.classes.map((c, i) => ({
      label: labels[i],
      mm: c.length * scale,
      count: c.count,
    })),
    maxEdgeErrorMm: m.maxEdgeError * scale,
    maxFoldGapMm: m.maxFoldGap * scale,
    faceCount: m.faceCount,
    vertexCount: m.vertexCount,
    edgeCount: m.edgeCount,
    euler: m.euler,
  };
}

export function fitNetToHeight(selected: string, heightMm: number): NetFit | null {
  const m = measureNet(selected);
  return m ? fitFromMeasurement(m, selected, heightMm) : null;
}
