import * as THREE from "three";
import { extractTriangles, groupCoplanarFaces, makeGeometry } from "./app/generator/components/polyhedronGeometry.ts";
import { computeNet } from "./app/generator/components/polyhedronNetUtils.ts";

const shapes = [
  "Tetrahedron",
  "Cube",
  "Octahedron",
  "Dodecahedron",
  "Icosahedron",
  "Truncated Cube",
  "Truncated Icosahedron",
  "Prism",
  "Pyramid",
];

for (const shape of shapes) {
  console.log(`\n=== ${shape} ===`);
  try {
    const geom = makeGeometry(shape);
    const tris = extractTriangles(geom);
    geom.dispose();
    const clumps = groupCoplanarFaces(tris);
    console.log(`  clumps (faces): ${clumps.length}`);

    clumps.forEach((c, i) => {
      const n = new THREE.Vector3();
      for (let j = 0; j < c.points.length; j++) {
        const a = c.points[j];
        const b = c.points[(j + 1) % c.points.length];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
      }
      if (n.lengthSq() > 0) n.normalize();
      const dot = c.normal && c.normal.lengthSq() > 0 ? n.dot(c.normal) : NaN;
      console.log(`    face ${i}: ${c.points.length} pts, newellDot=${dot.toFixed(3)}, centroidLen=${c.centroid.length().toFixed(3)}`);
    });

    const net = computeNet(shape);
    if (net) {
      console.log(`  net: ${net.polygons.length} polygons, ${net.foldLines.length} folds`);
      console.log(`  bounds: x[${net.bounds.minX.toFixed(2)},${net.bounds.maxX.toFixed(2)}] y[${net.bounds.minY.toFixed(2)},${net.bounds.maxY.toFixed(2)}]`);
      net.polygons.forEach((poly, i) => {
        let area = 0;
        for (let j = 0; j < poly.length; j++) {
          const a = poly[j];
          const b = poly[(j + 1) % poly.length];
          area += a.x * b.y - a.y * b.x;
        }
        area = Math.abs(area) / 2;
        if (area < 0.01) console.log(`    polygon ${i}: SMALL/EMPTY area=${area.toFixed(4)}`);
      });
    } else {
      console.log(`  net: FAILED (null)`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}