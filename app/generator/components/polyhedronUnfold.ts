import * as THREE from "three";
import { extractTriangles, groupCoplanarFaces, makeGeometry, pointKey } from "./polyhedronGeometry";

export type UnfoldFace = {
  parent: number;
  depth: number;
  foldAngle: number;
  hinge: [number, number];
};

export type UnfoldResult = {
  order: number[];
  solid: THREE.Vector3[][];
  net: THREE.Vector3[][];
  tree: UnfoldFace[];
  rootNormal: THREE.Vector3;
  rootOrigin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  faceCount: number;
};

const EPS_AREA = 1e-6;

export function hull2D(pts: THREE.Vector2[]): THREE.Vector2[] {
  const p = pts
    .filter((q, i, arr) => arr.findIndex((r) => Math.abs(r.x - q.x) < 1e-9 && Math.abs(r.y - q.y) < 1e-9) === i)
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (p.length <= 2) return p.slice();
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: THREE.Vector2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
function clipConvex(subject: THREE.Vector2[], clip: THREE.Vector2[]): THREE.Vector2[] {
  const isLeft = (a: THREE.Vector2, b: THREE.Vector2, p: THREE.Vector2) =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
  let out = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    if (input.length === 0) break;
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = isLeft(a, b, p);
      const qin = isLeft(a, b, q);
      if (pin && qin) {
        out.push(q);
      } else if (pin !== qin) {
        const den = (b.x - a.x) * (p.y - q.y) - (b.y - a.y) * (p.x - q.x);
        if (Math.abs(den) < 1e-14) continue;
        const s = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / den;
        out.push(new THREE.Vector2(p.x + s * (q.x - p.x), p.y + s * (q.y - p.y)));
        if (qin) out.push(q);
      }
    }
  }
  return out;
}

function signedArea2(poly: THREE.Vector2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - a.y * b.x;
  }
  return s / 2;
}

function overlapArea(a: THREE.Vector2[], b: THREE.Vector2[]): number {
  return Math.max(0, Math.abs(signedArea2(clipConvex(a, b))));
}

function signedAngleAround(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3): number {
  const a = from.clone().normalize();
  const b = to.clone().normalize();
  return Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(axis), a.dot(b));
}

function rotationMatrix(axis: THREE.Vector3, angle: number): THREE.Matrix3 {
  const m4 = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  return new THREE.Matrix3().setFromMatrix4(m4);
}
type SearchState = {
  solid: THREE.Vector3[][];
  adj: Array<Array<{ neighbor: number; a: number; b: number; ca: number; cb: number }>>;
  normal: THREE.Vector3[];
  n: number;
  root: number;
  rootNormal: THREE.Vector3;
  rootOrigin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  placed: boolean[];
  order: number[];
  parent: number[];
  depth: number[];
  foldAngle: number[];
  hinge: Array<[number, number]>;
  R: Array<THREE.Matrix3 | null>;
  t: Array<THREE.Vector3 | null>;
  hull: Array<THREE.Vector2[] | null>;
  budget: number;
};

function collectFaces(selected: string) {
  const geom = makeGeometry(selected);
  const tris = extractTriangles(geom);
  geom.dispose();
  return groupCoplanarFaces(tris);
}

function projectHull(pts: THREE.Vector3[], origin: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3): THREE.Vector2[] {
  return hull2D(
    pts.map((p) => {
      const d = new THREE.Vector3().subVectors(p, origin);
      return new THREE.Vector2(d.dot(u), d.dot(v));
    })
  );
}

export function computeUnfold(selected: string): UnfoldResult | null {
  const clumps = collectFaces(selected);
  const n = clumps.length;
  if (n === 0) return null;

  const solid = clumps.map((c) => c.points.map((p) => p.clone()));
  const normal = clumps.map((c) => c.normal.clone().normalize());
  const keyToIdx = clumps.map((c) => {
    const m = new Map<string, number>();
    c.points.forEach((p, i) => m.set(pointKey(p), i));
    return m;
  });

  const adj: SearchState["adj"] = Array.from({ length: n }, () => []);
  const edgeMap = new Map<string, Array<{ ci: number; ia: number; ib: number }>>();
  clumps.forEach((c, ci) => {
    const idx = keyToIdx[ci];
    c.triangles.forEach((t) => {
      const ia = idx.get(pointKey(t[0]))!;
      const ib = idx.get(pointKey(t[1]))!;
      const ic = idx.get(pointKey(t[2]))!;
      [[ia, ib], [ib, ic], [ic, ia]].forEach(([ea, eb]) => {
        const ka = pointKey(c.points[ea]);
        const kb = pointKey(c.points[eb]);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (!edgeMap.has(key)) edgeMap.set(key, []);
        edgeMap.get(key)!.push({ ci, ia: ea, ib: eb });
      });
    });
  });
  const seenPairs = new Set<string>();
  edgeMap.forEach((recs) => {
    const byClump = new Map<number, { a: number; b: number }>();
    recs.forEach((r) => {
      if (!byClump.has(r.ci)) byClump.set(r.ci, { a: r.ia, b: r.ib });
    });
    const entries = Array.from(byClump.entries());
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [ci, ea] = entries[i];
        const [cj, eb] = entries[j];
        const pairKey = ci < cj ? `${ci}_${cj}` : `${cj}_${ci}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        adj[ci].push({ neighbor: cj, a: ea.a, b: ea.b, ca: eb.a, cb: eb.b });
        adj[cj].push({ neighbor: ci, a: eb.a, b: eb.b, ca: ea.a, cb: ea.b });
      }
    }
  });

  const roots = Array.from({ length: n }, (_, i) => i).sort((a, b) => adj[b].length - adj[a].length || a - b);
  for (const root of roots) {
    const out = unfoldFromRoot(adj, solid, normal, root);
    if (out) return out;
  }
  return null;
}
function unfoldFromRoot(
  adj: SearchState["adj"],
  solid: THREE.Vector3[][],
  normal: THREE.Vector3[],
  root: number
): UnfoldResult | null {
  const n = solid.length;
  const st: SearchState = {
    solid,
    adj,
    normal,
    n,
    root,
    rootNormal: normal[root].clone(),
    rootOrigin: solid[root][0].clone(),
    u: new THREE.Vector3(),
    v: new THREE.Vector3(),
    placed: new Array(n).fill(false),
    order: [],
    parent: new Array(n).fill(-1),
    depth: new Array(n).fill(0),
    foldAngle: new Array(n).fill(0),
    hinge: Array.from({ length: n }, () => [-1, -1] as [number, number]),
    R: new Array(n).fill(null),
    t: new Array(n).fill(null),
    hull: new Array(n).fill(null),
    budget: 400000,
  };

  const p0 = solid[root][0];
  const p1 = solid[root][1 % solid[root].length];
  st.u.subVectors(p1, p0);
  if (st.u.lengthSq() < 1e-12) st.u.set(1, 0, 0);
  st.u.normalize();
  st.v.crossVectors(st.rootNormal, st.u).normalize();

  st.R[root] = new THREE.Matrix3();
  st.t[root] = new THREE.Vector3();
  st.placed[root] = true;
  st.order.push(root);
  st.hull[root] = projectHull(solid[root], st.rootOrigin, st.u, st.v);

  if (!dfsGrow(st)) return null;

  const tree: UnfoldFace[] = new Array(n);
  for (const fi of st.order) {
    tree[fi] = {
      parent: st.parent[fi],
      depth: st.depth[fi],
      foldAngle: st.foldAngle[fi],
      hinge: [st.hinge[fi][0], st.hinge[fi][1]],
    };
  }

  const net: THREE.Vector3[][] = new Array(n);
  for (const fi of st.order) {
    const R = st.R[fi]!;
    const tt = st.t[fi]!;
    net[fi] = solid[fi].map((p) => p.clone().applyMatrix3(R).add(tt));
  }

  return {
    order: st.order.slice(),
    solid,
    net,
    tree,
    rootNormal: st.rootNormal.clone(),
    rootOrigin: st.rootOrigin.clone(),
    u: st.u.clone(),
    v: st.v.clone(),
    faceCount: n,
  };
}

function dfsGrow(st: SearchState): boolean {
  if (st.budget-- <= 0) return false;
  if (st.order.length === st.n) return true;

  for (let oi = st.order.length - 1; oi >= 0; oi--) {
    const p = st.order[oi];
    for (const e of st.adj[p]) {
      const c = e.neighbor;
      if (st.placed[c]) continue;

      const Rp = st.R[p]!;
      const tp = st.t[p]!;

      const A = st.solid[p][e.a].clone().applyMatrix3(Rp).add(tp);
      const B = st.solid[p][e.b].clone().applyMatrix3(Rp).add(tp);
      const axis = new THREE.Vector3().subVectors(B, A);
      if (axis.lengthSq() < 1e-12) continue;
      axis.normalize();

      const nCur = st.normal[c].clone().applyMatrix3(Rp);
      const angle = signedAngleAround(nCur, st.rootNormal, axis);
      const mat = rotationMatrix(axis, angle);

      const Rc = new THREE.Matrix3().multiplyMatrices(mat, Rp);
      const tc = A.clone().add(new THREE.Vector3().subVectors(tp, A).applyMatrix3(mat));
      const cNet = st.solid[c].map((pp) => pp.clone().applyMatrix3(Rc).add(tc));

      const cHull = projectHull(cNet, st.rootOrigin, st.u, st.v);
      let overlaps = false;
      for (const fi of st.order) {
        const other = st.hull[fi];
        if (other && overlapArea(cHull, other) > EPS_AREA) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      st.R[c] = Rc;
      st.t[c] = tc;
      st.hull[c] = cHull;
      st.placed[c] = true;
      st.parent[c] = p;
      st.depth[c] = st.depth[p] + 1;
      st.foldAngle[c] = -angle;
      st.hinge[c] = [e.ca, e.cb];

      st.order.push(c);
      if (dfsGrow(st)) return true;
      st.order.pop();
      st.placed[c] = false;
      st.R[c] = null;
      st.t[c] = null;
      st.hull[c] = null;
    }
  }
  return false;
}
export function foldPositions(unfold: UnfoldResult, t: number): THREE.Vector3[][] {
  const { tree, net, order } = unfold;
  const pos = net.map((f) => f.map((p) => p.clone()));

  const children: number[][] = new Array(order.length);
  for (let i = 0; i < order.length; i++) children[i] = [];
  for (const fi of order) {
    const f = tree[fi];
    if (f.parent >= 0) children[f.parent].push(fi);
  }

  for (const fi of order) {
    const f = tree[fi];
    if (f.parent < 0) continue;
    const [ha, hb] = f.hinge;

    const A = pos[fi][ha].clone();
    const B = pos[fi][hb].clone();
    const axis = new THREE.Vector3().subVectors(B, A);
    if (axis.lengthSq() < 1e-12) continue;
    axis.normalize();

    const angle = -t * f.foldAngle;
    if (Math.abs(angle) < 1e-10) continue;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);

    const stack = [fi];
    while (stack.length) {
      const g = stack.pop()!;
      for (const ch of children[g]) stack.push(ch);
      const pts = pos[g];
      for (let k = 0; k < pts.length; k++) {
        pts[k].sub(A).applyQuaternion(q).add(A);
      }
    }
  }
  return pos;
}

export type NetTab = {
  /** glue-tab polygon (rectangle) in raw net coordinates */
  pts: Array<{ x: number; y: number }>;
  /** the tab's base edge lying on the net boundary (fold line when gluing) */
  base: { x1: number; y1: number; x2: number; y2: number };
};

/**
 * Compute printable glue tabs for the flat net.
 *
 * A tab is needed on exactly one side of every edge that connects two faces in
 * the solid but is NOT a shared hinge in the flat net (those are "cut" edges).
 * When the net is folded up, each pair of cut edges has to be glued together —
 * the tab provides the extra paper to do that.
 */
export function netTabs(unfold: UnfoldResult): NetTab[] {
  const n = unfold.solid.length;
  const keyToIdx = unfold.solid.map((pts) => {
    const m = new Map<string, number>();
    pts.forEach((p, i) => m.set(pointKey(p), i));
    return m;
  });
  const projOf = (fi: number, idx: number) => {
    const d = new THREE.Vector3().subVectors(unfold.net[fi][idx], unfold.rootOrigin);
    return { x: d.dot(unfold.u), y: d.dot(unfold.v) };
  };

  const tabs: NetTab[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const sharedA: number[] = [];
      unfold.solid[a].forEach((p, i) => {
        const j = keyToIdx[b].get(pointKey(p));
        if (j !== undefined) sharedA.push(i);
      });
      if (sharedA.length < 2) continue;

      // Tree-adjacent faces meet along a hinge (fold) -> no tab needed.
      if (unfold.tree[a].parent === b || unfold.tree[b].parent === a) continue;

      // a & b share this edge in the solid but not in the net: glue tab on a.
      const p0 = projOf(a, sharedA[0]);
      const p1 = projOf(a, sharedA[1]);
      let cx = 0;
      let cy = 0;
      const allPts = unfold.net[a].map((p) => {
        const d = new THREE.Vector3().subVectors(p, unfold.rootOrigin);
        return { x: d.dot(unfold.u), y: d.dot(unfold.v) };
      });
      for (const p of allPts) {
        cx += p.x;
        cy += p.y;
      }
      cx /= allPts.length;
      cy /= allPts.length;

      const ex = p1.x - p0.x;
      const ey = p1.y - p0.y;
      const len = Math.hypot(ex, ey) || 1e-6;
      const nrm = { x: -ey / len, y: ex / len };
      const midx = (p0.x + p1.x) / 2;
      const midy = (p0.y + p1.y) / 2;
      const outward =
        (midx - cx) * nrm.x + (midy - cy) * nrm.y >= 0 ? nrm : { x: -nrm.x, y: -nrm.y };

      const depth = Math.max(0.14, len * 0.18);
      const q0 = { x: p0.x + outward.x * depth, y: p0.y + outward.y * depth };
      const q1 = { x: p1.x + outward.x * depth, y: p1.y + outward.y * depth };
      tabs.push({
        pts: [p0, p1, q1, q0],
        base: { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y },
      });
    }
  }
  return tabs;
}

export function netProjection(unfold: UnfoldResult) {
  const polys: THREE.Vector2[][] = new Array(unfold.order.length);
  const foldLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const fi of unfold.order) {
    const proj = projectHull(unfold.net[fi], unfold.rootOrigin, unfold.u, unfold.v);
    polys[fi] = proj;
    for (const p of proj) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const f = unfold.tree[fi];
    if (f.parent >= 0) {
      const [ha, hb] = f.hinge;
      const a = new THREE.Vector3().subVectors(unfold.net[fi][ha], unfold.rootOrigin);
      const b = new THREE.Vector3().subVectors(unfold.net[fi][hb], unfold.rootOrigin);
      foldLines.push({ x1: a.dot(unfold.u), y1: a.dot(unfold.v), x2: b.dot(unfold.u), y2: b.dot(unfold.v) });
    }
  }

  return {
    polygons: polys,
    foldLines,
    tabs: netTabs(unfold),
    bounds: { minX, minY, maxX, maxY },
    faceCount: unfold.faceCount,
  };
}
