"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { computeUnfold, foldPositions, type UnfoldResult } from "./polyhedronUnfold";

type FoldingPolyhedronProps = {
  selected: string;
  modelScale: number;
  /** 0 = fully assembled solid, 1 = fully unfolded flat net */
  progress: { current: number };
};

/** Boundary order of a face from its flat-net projection (convex faces). */
function boundaryOrder(unfold: UnfoldResult, fi: number): number[] {
  const pts = unfold.net[fi];
  const proj = pts.map((p, i) => {
    const d = new THREE.Vector3().subVectors(p, unfold.rootOrigin);
    return { i, x: d.dot(unfold.u), y: d.dot(unfold.v) };
  });
  let cx = 0;
  let cy = 0;
  for (const p of proj) {
    cx += p.x;
    cy += p.y;
  }
  cx /= proj.length;
  cy /= proj.length;
  return proj
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
    .map((p) => p.i);
}

export default function FoldingPolyhedron({ selected, modelScale, progress }: FoldingPolyhedronProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Last applied fold progress. When it doesn't change (paused or static
  // scrubber) we skip recomputing the geometry entirely, so a paused fold is
  // a genuinely frozen model — not a hidden animation.
  const lastProgressRef = useRef<number>(-1);

  const unfold = useMemo(() => computeUnfold(selected), [selected]);

  const spec = useMemo(() => {
    if (!unfold) return null;
    const triFaces: number[] = [];
    const triPts: number[] = [];
    for (const fi of unfold.order) {
      const order = boundaryOrder(unfold, fi);
      for (let i = 1; i + 1 < order.length; i++) {
        triFaces.push(fi, fi, fi);
        triPts.push(order[0], order[i], order[i + 1]);
      }
    }
    return { triFaces, triPts, count: triFaces.length / 3 };
  }, [unfold]);

  const attributeArrays = useMemo(() => {
    if (!spec) return null;
    return {
      positions: new Float32Array(spec.count * 9),
      normals: new Float32Array(spec.count * 9),
    };
  }, [spec]);

  useFrame(() => {
    if (!unfold || !spec) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    const positionAttr = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const normalAttr = mesh.geometry.attributes.normal as THREE.BufferAttribute;
    const positions = positionAttr.array as Float32Array;
    const normals = normalAttr.array as Float32Array;

    // Fold progress (0 = assembled solid, 1 = flat net) maps to the internal
    // fold parameter t where t = 1 is the solid and t = 0 the flat net.
    const q = Math.min(1, Math.max(0, progress.current));
    if (q === lastProgressRef.current) return; // fold frozen / unchanged
    lastProgressRef.current = q;
    const t = 1 - q;
    const pos = foldPositions(unfold, t);

    const { triFaces, triPts } = spec;

    let o = 0;
    for (let tr = 0; tr < spec.count; tr++) {
      for (let k = 0; k < 3; k++) {
        const fi = triFaces[tr * 3 + k];
        const pi = triPts[tr * 3 + k];
        const v = pos[fi][pi];
        positions[o] = v.x;
        positions[o + 1] = v.y;
        positions[o + 2] = v.z;
        o += 3;
      }
    }

    // Flat normals per triangle.
    for (let tr = 0; tr < spec.count; tr++) {
      const b = tr * 9;
      const ax = positions[b];
      const ay = positions[b + 1];
      const az = positions[b + 2];
      const bx = positions[b + 3];
      const by = positions[b + 4];
      const bz = positions[b + 5];
      const cx = positions[b + 6];
      const cy = positions[b + 7];
      const cz = positions[b + 8];
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-12) {
        nx /= len;
        ny /= len;
        nz /= len;
      }
      normals[b] = nx;
      normals[b + 1] = ny;
      normals[b + 2] = nz;
      normals[b + 3] = nx;
      normals[b + 4] = ny;
      normals[b + 5] = nz;
      normals[b + 6] = nx;
      normals[b + 7] = ny;
      normals[b + 8] = nz;
    }

    positionAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
  });

  if (!unfold || !spec || !attributeArrays) {
    return (
      <mesh>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#10e6c1" />
      </mesh>
    );
  }

  return (
    <group scale={modelScale * 0.9}>
      <mesh ref={meshRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[attributeArrays.positions, 3]} />
          <bufferAttribute attach="attributes-normal" args={[attributeArrays.normals, 3]} />
        </bufferGeometry>
        <meshStandardMaterial color="#10e6c1" metalness={0.05} roughness={0.35} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
