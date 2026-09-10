import type { Point2 } from "./polyhedronGeometry";
import { computeUnfold, netProjection } from "./polyhedronUnfold";

export type NetTab = {
  pts: Array<{ x: number; y: number }>;
  base: { x1: number; y1: number; x2: number; y2: number };
};

export type NetResult = {
  polygons: Point2[][];
  foldLines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  tabs: NetTab[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  faceCount: number;
};

/** Flat 2D net of a polyhedron (non-overlapping, single-sided). */
export function computeNet(selected: string): NetResult | null {
  const unfold = computeUnfold(selected);
  if (!unfold) return null;
  const proj = netProjection(unfold);
  return {
    polygons: proj.polygons.map((poly) => poly.map((p) => ({ x: p.x, y: p.y }))),
    foldLines: proj.foldLines,
    tabs: proj.tabs,
    bounds: proj.bounds,
    faceCount: proj.faceCount,
  };
}
