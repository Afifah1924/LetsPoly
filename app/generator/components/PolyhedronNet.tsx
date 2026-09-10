"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeNet } from "./polyhedronNetUtils";

type PolyhedronNetProps = {
  selected: string;
  height: number;
  unit?: "mm" | "cm";
  /**
   * "clean"     -> STEP 3 · FLAT NET: only the flat geometry (faces + edges).
   * "technical" -> 2D NET tab: adds dimension arrows, width/height and the
   *                face-count caption used for measurement.
   */
  mode?: "technical" | "clean";
};

const fmt = (mm: number, unit: "mm" | "cm") => (unit === "cm" ? (mm / 10).toFixed(1) : String(Math.round(mm)));

type Pt = { x: number; y: number };

function pathOf(pts: Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ") + " Z";
}

export default function PolyhedronNet({ selected, height, unit = "mm", mode = "technical" }: PolyhedronNetProps) {
  const clean = mode === "clean";
  const net = useMemo(() => computeNet(selected), [selected]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Responsively size the SVG to its container while preserving aspect ratio.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view = useMemo(() => {
    if (!net) return null;
    // Larger design canvas + generous margins in technical mode so dimension
    // arrows/labels have their own clear space instead of crowding the net.
    const designW = clean ? 680 : 900;
    const designH = clean ? 520 : 680;
    const dimPad = clean ? 16 : 78;
    const pad = clean ? 8 : 18;
    const w = net.bounds.maxX - net.bounds.minX;
    const h = net.bounds.maxY - net.bounds.minY;
    const s = Math.min((designW - dimPad - pad * 2) / w, (designH - dimPad - pad * 2) / h);
    const ox = dimPad + pad - net.bounds.minX * s;
    const oy = dimPad + pad - net.bounds.minY * s;
    const px = (x: number) => x * s + ox;
    const py = (y: number) => y * s + oy;

    const facePts = net.polygons.map((poly) => poly.map((p) => ({ x: px(p.x), y: py(p.y) })));
    const facePaths = facePts.map(pathOf);

    // Classify every polygon edge: edges used twice are internal fold creases,
    // edges used once are the outer (cut) boundary.
    const edgeMap = new Map<string, { x1: number; y1: number; x2: number; y2: number; count: number }>();
    for (const pts of facePts) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const k1 = `${a.x.toFixed(2)},${a.y.toFixed(2)}`;
        const k2 = `${b.x.toFixed(2)},${b.y.toFixed(2)}`;
        const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        const rec = edgeMap.get(key) || { x1: a.x, y1: a.y, x2: b.x, y2: b.y, count: 0 };
        rec.count += 1;
        edgeMap.set(key, rec);
      }
    }
    const cutEdges: Pt[][] = [];
    const foldEdges: Pt[][] = [];
    edgeMap.forEach((e) => {
      const seg: Pt[] = [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
      (e.count >= 2 ? foldEdges : cutEdges).push(seg);
    });

    // Printable glue tabs, transformed into drawing space (2D Net only). Each
    // tab also carries the physical length of the edge it glues.
    const tabs = clean
      ? []
      : (net.tabs ?? []).map((t) => {
          const pts = t.pts.map((p) => ({ x: px(p.x), y: py(p.y) }));
          const outline = pts.slice(1).concat(pts[0]);
          const outlinePath = outline
            .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
            .join(" ");
          const len = Math.hypot(t.base.x2 - t.base.x1, t.base.y2 - t.base.y1);
          const mm = (len * height) / h;
          const dx = pts[1].x - pts[0].x;
          const dy = pts[1].y - pts[0].y;
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          const na = ((angle % 360) + 360) % 360;
          if (na > 90 && na < 270) angle -= 180;
          return {
            fill: pathOf(pts),
            outlinePath,
            mm,
            cx: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4,
            cy: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4,
            angle,
          };
        });

    const mmW = (height / h) * w;

    return {
      facePaths,
      cutEdges,
      foldEdges,
      tabs,
      width: Math.round(w * s + dimPad * 2 + pad * 2),
      height: Math.round(h * s + dimPad * 2 + pad * 2),
      leftX: dimPad + pad,
      topY: dimPad + pad,
      rightX: dimPad + pad + w * s,
      bottomY: dimPad + pad + h * s,
      mmW,
      mmH: height,
    };
  }, [net, height, clean]);

  if (!net || !view) {
    return (
      <div className="flex min-h-[320px] w-full items-center justify-center">
        <p className="text-sm text-slate-400">Unable to generate net for this shape.</p>
      </div>
    );
  }

  // Reserve a little breathing room in technical mode (dimension labels live
  // inside the SVG; there is no caption below it anymore).
  const availW = Math.max(0, box.w - (clean ? 8 : 16));
  const availH = Math.max(0, box.h - (clean ? 8 : 12));
  const aspect = view.width / view.height;
  let dw = availW;
  let dh = availW / aspect;
  if (dh > availH) {
    dh = Math.max(0, availH);
    dw = dh * aspect;
  }
  const ready = dw > 0 && dh > 0;

  const { leftX, rightX, topY, bottomY, mmW, mmH } = view;
  const labelW = fmt(mmW, unit);
  const labelH = fmt(mmH, unit);
  const unitLabel = unit === "cm" ? "cm" : "mm";
  const labelStyle = {
    fontSize: 19,
    fontWeight: 700,
    fill: "#f1f5f9",
    paintOrder: "stroke" as const,
    stroke: "#0f172a",
    strokeWidth: 4,
    strokeLinejoin: "round" as const,
  };
  const dimColor = "#cbd5e1";
  const dimGap = clean ? 0 : 36;

  return (
    <div ref={wrapRef} className="flex min-h-full w-full flex-col items-center justify-center">
      {ready && (
        <svg
          width={Math.round(dw)}
          height={Math.round(dh)}
          viewBox={`0 0 ${view.width} ${view.height}`}
          role="img"
          aria-label={`${selected} net`}
        >
          <rect x={0} y={0} width={view.width} height={view.height} rx={16} className="fill-slate-950" stroke="currentColor" strokeOpacity={0.15} />

          {clean ? (
            view.facePaths.map((d, i) => (
              <path key={`p-${i}`} d={d} fill="rgba(16,230,193,0.10)" stroke="#2dd4bf" strokeWidth={2} />
            ))
          ) : (
            <>
              {view.facePaths.map((d, i) => (
                <path key={`p-${i}`} d={d} fill="rgba(16,230,193,0.07)" />
              ))}
              {view.tabs.map((t, i) => (
                <path key={`tfill-${i}`} d={t.fill} fill="rgba(148,163,184,0.12)" />
              ))}
              {view.tabs.map((t, i) => (
                <path
                  key={`tout-${i}`}
                  d={t.outlinePath}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {view.tabs.map((t, i) => (
                <text
                  key={`tlab-${i}`}
                  x={t.cx}
                  y={t.cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${t.angle.toFixed(1)} ${t.cx.toFixed(1)} ${t.cy.toFixed(1)})`}
                  style={{ ...labelStyle, fontSize: 13 }}
                >
                  {fmt(t.mm, unit)} {unitLabel}
                </text>
              ))}
              {view.cutEdges.map(([a, b], i) => (
                <line key={`c-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2dd4bf" strokeWidth={2.6} strokeLinecap="round" />
              ))}
              {view.foldEdges.map(([a, b], i) => (
                <line key={`f-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#99f6e4" strokeWidth={1.8} strokeDasharray="9 6" strokeLinecap="round" opacity={0.95} />
              ))}
            </>
          )}

          {!clean && (
            <>
              {/* Height dimension (left, vertical) */}
              <line x1={leftX - dimGap} y1={topY - 4} x2={leftX - dimGap} y2={bottomY + 4} stroke={dimColor} strokeWidth={2} />
              <polygon points={`${leftX - dimGap},${topY - 4} ${leftX - dimGap - 10},${topY + 8} ${leftX - dimGap + 10},${topY + 8}`} fill={dimColor} />
              <polygon points={`${leftX - dimGap},${bottomY + 4} ${leftX - dimGap - 10},${bottomY - 8} ${leftX - dimGap + 10},${bottomY - 8}`} fill={dimColor} />
              <text
                x={leftX - dimGap - 22}
                y={(topY + bottomY) / 2}
                textAnchor="middle"
                transform={`rotate(-90 ${leftX - dimGap - 22} ${(topY + bottomY) / 2})`}
                style={labelStyle}
              >
                {labelH} {unitLabel}
              </text>

              {/* Width dimension (bottom, horizontal) */}
              <line x1={leftX} y1={bottomY + dimGap} x2={rightX} y2={bottomY + dimGap} stroke={dimColor} strokeWidth={2} />
              <polygon points={`${leftX},${bottomY + dimGap} ${leftX + 9},${bottomY + dimGap - 10} ${leftX + 9},${bottomY + dimGap + 10}`} fill={dimColor} />
              <polygon points={`${rightX},${bottomY + dimGap} ${rightX - 9},${bottomY + dimGap - 10} ${rightX - 9},${bottomY + dimGap + 10}`} fill={dimColor} />
              <text x={(leftX + rightX) / 2} y={bottomY + dimGap + 34} textAnchor="middle" style={labelStyle}>
                {labelW} {unitLabel}
              </text>
            </>
          )}
        </svg>
      )}
    </div>
  );
}
