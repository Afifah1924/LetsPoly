import * as THREE from "three";
import { ConvexGeometry } from "three-stdlib";

export function getUniqueEdges(geometry: THREE.BufferGeometry): Array<[number, number]> {
  const index = geometry.index?.array;
  const position = geometry.attributes.position;
  const edgeSet = new Set<string>();
  const result: Array<[number, number]> = [];

  function addEdge(a: number, b: number) {
    if (a === b) return;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      result.push([a, b]);
    }
  }

  if (index) {
    for (let i = 0; i < index.length; i += 3) {
      addEdge(index[i], index[i + 1]);
      addEdge(index[i + 1], index[i + 2]);
      addEdge(index[i + 2], index[i]);
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      addEdge(i, i + 1);
      addEdge(i + 1, i + 2);
      addEdge(i + 2, i);
    }
  }

  return result;
}

export function makeTruncatedGeometry(
  baseGeometry: THREE.BufferGeometry,
  factor = 0.28
): THREE.BufferGeometry {
  const position = baseGeometry.attributes.position;
  const edges = getUniqueEdges(baseGeometry);
  const points: THREE.Vector3[] = [];

  edges.forEach(([aIndex, bIndex]) => {
    const a = new THREE.Vector3().fromBufferAttribute(position, aIndex);
    const b = new THREE.Vector3().fromBufferAttribute(position, bIndex);
    points.push(a.clone().lerp(b, factor));
    points.push(b.clone().lerp(a, factor));
  });

  baseGeometry.dispose();
  return new ConvexGeometry(points);
}

/**
 * Build a convex polyhedron from explicit vertices + polygon faces.
 * Every polygon is fan-triangulated and every triangle is oriented so its
 * normal points away from the vertex centroid (outward), producing clean,
 * non-degenerate planar faces (no interior "fan centre" vertices like the
 * THREE cylinder/cone builders add on their caps).
 */
function buildConvexPolyhedron(vertices: THREE.Vector3[], faces: number[][]): THREE.BufferGeometry {
  const center = new THREE.Vector3();
  vertices.forEach((v) => center.add(v));
  center.divideScalar(vertices.length);

  const positions: number[] = [];
  const normals: number[] = [];

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
    const centroid = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    // Orient outward from the polyhedron centroid.
    const ordered = n.dot(centroid.clone().sub(center)) < 0 ? [a, c, b] : [a, b, c];
    const nn = n.dot(centroid.clone().sub(center)) < 0 ? n.clone().negate() : n;
    for (const p of ordered) {
      positions.push(p.x, p.y, p.z);
      normals.push(nn.x, nn.y, nn.z);
    }
  };

  faces.forEach((face) => {
    for (let i = 1; i + 1 < face.length; i++) {
      pushTri(vertices[face[0]], vertices[face[i]], vertices[face[i + 1]]);
    }
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geom;
}

function buildPyramidGeometry(): THREE.BufferGeometry {
  // Square pyramid, base side ~1.77 (radius 1.25) and height 1.6, matching the
  // proportions of the old ConeGeometry(1.25, 1.6, 4).
  const d = 1.25 / Math.SQRT2;
  const hy = 0.8;
  const vertices = [
    new THREE.Vector3(-d, -hy, -d),
    new THREE.Vector3(d, -hy, -d),
    new THREE.Vector3(d, -hy, d),
    new THREE.Vector3(-d, -hy, d),
    new THREE.Vector3(0, hy, 0), // apex
  ];
  const faces = [
    [0, 1, 2, 3], // base
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ];
  return buildConvexPolyhedron(vertices, faces);
}

function buildPrismGeometry(): THREE.BufferGeometry {
  // Equilateral triangular prism: cross-section circumradius 0.95, length 1.6
  // along the X axis (same proportions as CylinderGeometry(0.95, 0.95, 1.6, 3)).
  const R = 0.95;
  const half = 0.8;
  const a = (Math.PI / 2); // angle offsets: 90, 210, 330 deg
  const ring: THREE.Vector3[] = [];
  for (const k of [0, 1, 2]) {
    const th = a + (k * 2 * Math.PI) / 3;
    ring.push(new THREE.Vector3(0, R * Math.cos(th), R * Math.sin(th)));
  }
  const vertices = [
    new THREE.Vector3(-half, ring[0].y, ring[0].z),
    new THREE.Vector3(-half, ring[1].y, ring[1].z),
    new THREE.Vector3(-half, ring[2].y, ring[2].z),
    new THREE.Vector3(half, ring[0].y, ring[0].z),
    new THREE.Vector3(half, ring[1].y, ring[1].z),
    new THREE.Vector3(half, ring[2].y, ring[2].z),
  ];
  const faces = [
    [0, 1, 2], // back end
    [5, 4, 3], // front end
    [0, 1, 4, 3], // side 0
    [1, 2, 5, 4], // side 1
    [2, 0, 3, 5], // side 2
  ];
  return buildConvexPolyhedron(vertices, faces);
}

export function makeGeometry(selected: string): THREE.BufferGeometry {
  switch (selected) {
    case "Tetrahedron":
      return new THREE.TetrahedronGeometry(1.4);
    case "Cube":
      return new THREE.BoxGeometry(1.4, 1.4, 1.4);
    case "Octahedron":
      return new THREE.OctahedronGeometry(1.4);
    case "Dodecahedron":
      return new THREE.DodecahedronGeometry(1.2);
    case "Icosahedron":
      return new THREE.IcosahedronGeometry(1.2);
    case "Truncated Cube": {
      const base = new THREE.BoxGeometry(1.6, 1.6, 1.6);
      return makeTruncatedGeometry(base, 0.28);
    }
    case "Truncated Icosahedron": {
      const base = new THREE.IcosahedronGeometry(1.4);
      const geom = makeTruncatedGeometry(base, 0.28);
      geom.scale(0.94, 0.94, 0.94);
      return geom;
    }
    case "Prism":
      return buildPrismGeometry();
    case "Pyramid":
      return buildPyramidGeometry();
    default:
      return new THREE.IcosahedronGeometry(1.2);
  }
}

export type Tri = [THREE.Vector3, THREE.Vector3, THREE.Vector3];

export type Point2 = { x: number; y: number };

export type FaceClump = {
  triangles: Tri[];
  points: THREE.Vector3[];
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
};

export function pointKey(p: THREE.Vector3): string {
  return `${p.x.toFixed(4)}|${p.y.toFixed(4)}|${p.z.toFixed(4)}`;
}

export function extractTriangles(geometry: THREE.BufferGeometry): Tri[] {
  const index = geometry.index?.array;
  const position = geometry.attributes.position;
  const result: Tri[] = [];

  if (index) {
    for (let i = 0; i < index.length; i += 3) {
      result.push([
        new THREE.Vector3().fromBufferAttribute(position, index[i]),
        new THREE.Vector3().fromBufferAttribute(position, index[i + 1]),
        new THREE.Vector3().fromBufferAttribute(position, index[i + 2]),
      ]);
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      result.push([
        new THREE.Vector3().fromBufferAttribute(position, i),
        new THREE.Vector3().fromBufferAttribute(position, i + 1),
        new THREE.Vector3().fromBufferAttribute(position, i + 2),
      ]);
    }
  }

  return result;
}

function triNormal(t: Tri): THREE.Vector3 {
  const ab = new THREE.Vector3().subVectors(t[1], t[0]);
  const ac = new THREE.Vector3().subVectors(t[2], t[0]);
  return new THREE.Vector3().crossVectors(ab, ac).normalize();
}

function trianglesShareEdge(a: Tri, b: Tri): boolean {
  const keysA = new Set(a.map(pointKey));
  let shared = 0;
  for (const k of b) {
    if (keysA.has(pointKey(k))) shared += 1;
  }
  return shared >= 2;
}

export function groupCoplanarFaces(tris: Tri[]): FaceClump[] {
  const n = tris.length;
  const normals = tris.map(triNormal);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (normals[i].dot(normals[j]) > 0.999 && trianglesShareEdge(tris[i], tris[j])) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }

  const clumps: FaceClump[] = [];
  groups.forEach((idxList) => {
    const ctris = idxList.map((i) => tris[i]);
    const points: THREE.Vector3[] = [];
    const seen = new Set<string>();
    const centroid = new THREE.Vector3();
    ctris.forEach((t) => {
      t.forEach((p) => {
        centroid.add(p);
        const k = pointKey(p);
        if (!seen.has(k)) {
          seen.add(k);
          points.push(p.clone());
        }
      });
    });
    centroid.divideScalar(ctris.length * 3);
    clumps.push({
      triangles: ctris,
      points,
      normal: normals[idxList[0]].clone(),
      centroid,
    });
  });

  clumps.sort((a, b) => a.centroid.lengthSq() - b.centroid.lengthSq());

  return clumps;
}