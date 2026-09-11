"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import PolyhedronNet from "./PolyhedronNet";
import { fitFromMeasurement, measureNet } from "./netMeasurement";

const PolyhedronViewer = dynamic(() => import("./PolyhedronViewer"), { ssr: false });
const PartialFoldStage = dynamic(() => import("./PartialFoldStage"), { ssr: false });

/** Format mm for display only; internal calculations keep full precision. */
const fmtMm = (mm: number) => {
  if (!Number.isFinite(mm)) return "—";
  return Math.abs(mm - Math.round(mm)) < 0.05 ? String(Math.round(mm)) : mm.toFixed(1);
};

/** Format the height input value for the active unit (used by the text field). */
const formatHeightInput = (mm: number, unit: "mm" | "cm") =>
  unit === "cm" ? (mm / 10).toFixed(1) : String(Math.round(mm * 10) / 10);

type GeneratorPanelProps = {
  selected: string;
  initialHeight?: number; // model height in millimetres
};

export default function GeneratorPanel({ selected, initialHeight }: GeneratorPanelProps) {
  const [viewMode, setViewMode] = useState("3d");
  const [transitionStep, setTransitionStep] = useState(1);
  const [unit, setUnit] = useState<"mm" | "cm">("mm");
  const [height, setHeight] = useState(() => {
    const h = Number(initialHeight);
    return h > 0 ? Math.max(40, h) : 120;
  });
  const [width, setWidth] = useState("");
  const [paper, setPaper] = useState<"A4" | "A3">("A4");
  const [autoRotate, setAutoRotate] = useState(false);
  // Free-text height field so the visitor can clear it completely; it holds at
  // "0" when emptied and accepts at most 8 characters.
  const [heightText, setHeightText] = useState(() => {
    const h = Number(initialHeight);
    const mm = h > 0 ? Math.max(40, h) : 120;
    return formatHeightInput(mm, "mm");
  });
  const [rotateX, setRotateX] = useState(22);
  const [rotateY, setRotateY] = useState(-28);
  const [zoom, setZoom] = useState(1.05);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, rotateX: 0, rotateY: 0, offsetX: 0, offsetY: 0 });
  // Live pointers on the drag surface: a second finger switches to pinch-zoom.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // React's onWheel is a passive listener, so preventDefault silently fails.
  // Attach a native, non-passive listener so "scroll to zoom" doesn't also scroll the page.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => Math.max(0.65, Math.min(1.8, current - event.deltaY * 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Geometry-derived live calculations. "height" is the requested NET
  // bounding-box height (mm); the whole net is scaled uniformly to fit it.
  const measurement = useMemo(() => (selected ? measureNet(selected) : null), [selected]);
  const fit = useMemo(
    () =>
      measurement && height > 0
        ? fitFromMeasurement(measurement, selected, height)
        : null,
    [measurement, selected, height]
  );

  const requestedWidthMm = useMemo(() => {
    const parsed = Number(width);
    return parsed > 0 ? parsed : 0;
  }, [width]);

  // Width shown when "Width (auto)": the actual net width at the height fit.
  const netAspect = fit && fit.netHeightMm > 0 ? fit.netWidthMm / fit.netHeightMm : 0;
  const widthMismatch =
    requestedWidthMm > 0 && fit && Math.abs(requestedWidthMm - fit.netWidthMm) > 0.5;

  // Paper tiling for printing the fitted net.
  const paperDims = paper === "A4" ? { w: 210, h: 297 } : { w: 297, h: 420 };
  const paperPages = fit
    ? Math.max(
        1,
        Math.min(
          Math.ceil(fit.netWidthMm / paperDims.w) * Math.ceil(height / paperDims.h),
          Math.ceil(fit.netWidthMm / paperDims.h) * Math.ceil(height / paperDims.w)
        )
      )
    : 0;
  const modelScale = useMemo(() => Math.min(1.6, 0.8 + height / 180), [height]);

  /** The surface only captures gestures while a rotatable 3D view is showing. */
  const canRotate = viewMode === "3d" || (viewMode === "transition" && transitionStep === 1);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Don't hijack clicks on interactive controls (e.g. the STEP / mode pills that
    // live inside this drag surface). setPointerCapture() on pointer-down retargets
    // the pointer so the button's click event never fires -> preview "gets stuck".
    const target = event.target as HTMLElement | null;
    const onControl =
      !!target &&
      typeof target.closest === "function" &&
      !!target.closest("button, a, input, select, textarea, label");
    if (onControl) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!canRotate) return;

    setHelpOpen(false);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);

    // A second finger on the surface switches to pinch-to-zoom.
    if (pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y) || 1;
      pinchRef.current = { distance, zoom };
      draggingRef.current = false;
      return;
    }

    draggingRef.current = true;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      rotateX,
      rotateY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Two fingers down: pinch scales the model instead of rotating it.
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y) || 1;
      setZoom(Math.max(0.65, Math.min(1.8, pinch.zoom * (distance / pinch.distance))));
      return;
    }

    if (!draggingRef.current) return;
    const dx = event.clientX - dragStartRef.current.x;
    const dy = event.clientY - dragStartRef.current.y;
    // Shift + drag (mouse) pans the model; a plain drag / one finger rotates it.
    if (event.shiftKey) {
      setOffset({
        x: dragStartRef.current.offsetX + dx,
        y: dragStartRef.current.offsetY + dy,
      });
    } else {
      setRotateX(Math.max(-80, Math.min(80, dragStartRef.current.rotateX + dy * 0.2)));
      setRotateY(dragStartRef.current.rotateY + dx * 0.2);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) draggingRef.current = false;
  };

  return (

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-4 shadow-xl sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-teal-300">Live model preview</p>
                  <h2 className="mt-3 text-3xl font-semibold text-white">Interactive 3D Preview</h2>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => setViewMode("3d")}
                      className={`min-h-10 touch-manipulation rounded-full px-4 py-2 transition ${
                        viewMode === "3d"
                          ? "bg-teal-400 text-slate-950"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      3D Model
                    </button>

                    <button
                      onClick={() => setViewMode("transition")}
                      className={`min-h-10 touch-manipulation rounded-full px-4 py-2 transition ${
                        viewMode === "transition"
                          ? "bg-teal-400 text-slate-950"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      Transition
                    </button>

                    <button
                      onClick={() => setViewMode("net")}
                      className="min-h-10 touch-manipulation rounded-full bg-slate-800 px-4 py-2 text-slate-300 transition hover:bg-slate-700"
                    >
                      2D Net
                    </button>
                  </div>

                  <div className="mt-2 flex items-center text-sm text-slate-400">
                    <span className="inline-flex overflow-hidden rounded-full border border-slate-800">
                      {(["mm", "cm"] as const).map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            if (u === unit) return;
                            setUnit(u);
                            setHeightText(formatHeightInput(height, u));
                          }}
                          className={`min-h-10 touch-manipulation px-3 py-1.5 text-xs uppercase transition ${
                            unit === u ? "bg-teal-400 text-slate-950" : "bg-slate-950 text-slate-400 hover:text-white"
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </span>
                  </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAutoRotate((v) => !v)}
                  title={autoRotate ? "Stop 360° rotation" : "Start 360° auto rotation"}
                  aria-pressed={autoRotate}
                  className={`inline-flex min-h-10 touch-manipulation items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                    autoRotate
                      ? "border-teal-400/60 bg-teal-400/10 text-teal-200"
                      : "border-slate-800 bg-slate-950 text-slate-300 hover:border-teal-300 hover:text-white"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <path d="M21 3v6h-6" />
                  </svg>
                  {autoRotate ? "Stop rotation" : "360° rotate"}
                </button>
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950/90 p-4">
              <div
                ref={viewportRef}
                className={`relative overflow-hidden rounded-[1.75rem] border border-slate-800 bg-slate-950 ${
                  viewMode === "net" ? "min-h-[70svh]" : "aspect-square sm:aspect-[16/10]"
                } ${canRotate ? "touch-none select-none" : ""}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.14),_transparent_40%),linear-gradient(rgba(148,163,184,0.08)_1px,_transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,_transparent_1px)] bg-[length:80px_80px]" />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_30%)]" />
                {viewMode !== "net" && (
                  <div className="absolute left-3 top-3 z-10">
                    <div className="group relative">
                      <button
                        type="button"
                        onClick={() => setHelpOpen((v) => !v)}
                        aria-label="Preview controls help"
                        aria-expanded={helpOpen}
                        className="grid h-10 w-10 cursor-help touch-manipulation place-items-center rounded-full border border-slate-700 bg-slate-950/90 text-xs font-semibold text-slate-300 transition hover:border-teal-300 hover:text-teal-200"
                      >
                        ?
                      </button>
                      <div
                        className={`pointer-events-none absolute left-0 top-10 z-20 w-56 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-[11px] leading-relaxed text-slate-300 shadow-2xl sm:w-max ${
                          helpOpen ? "block" : "hidden"
                        } group-hover:block`}
                      >
                        <span className="block font-semibold text-teal-200">Touch</span>
                        Drag to rotate · pinch to zoom.
                        <span className="mt-1 block font-semibold text-teal-200">Desktop</span>
                        Drag to rotate · Shift + drag to pan · scroll to zoom.
                      </div>
                    </div>
                  </div>
                )}
                {viewMode === "3d" && (
                  <div className="absolute inset-0">
                    <PolyhedronViewer
                      selected={selected}
                      height={height}
                      zoom={zoom}
                      rotateX={rotateX}
                      rotateY={rotateY}
                      offset={offset}
                      autoRotate={autoRotate}
                    />
                  </div>
                )}

                {viewMode === "transition" && (
                  <div className="absolute inset-0 flex flex-col">
                    <div className="relative flex-1 overflow-hidden">
                      {transitionStep === 1 && (
                        <PolyhedronViewer
                          selected={selected}
                          height={height}
                          zoom={zoom}
                          rotateX={rotateX}
                          rotateY={rotateY}
                          offset={offset}
                          autoRotate={autoRotate}
                        />
                      )}
                      {transitionStep === 2 && <PartialFoldStage selected={selected} modelScale={modelScale} />}
                      {transitionStep === 3 && <PolyhedronNet mode="clean" selected={selected} height={height} unit={unit} />}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 px-2 pb-3 pt-2">
                      {[
                        { step: 1, label: "3D Model" },
                        { step: 2, label: "Partial Fold" },
                        { step: 3, label: "Flat Net" },
                      ].map((s, i) => {
                        const active = transitionStep === s.step;
                        return (
                          <div key={s.step} className="flex items-center gap-2">
                            {i > 0 && <div className="hidden h-px w-6 shrink-0 bg-slate-700 sm:block" />}
                            <button
                              type="button"
                              onClick={() => setTransitionStep(s.step)}
                              className={`min-h-10 touch-manipulation rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] transition ${
                                active ? "bg-teal-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                              }`}
                            >
                              Step {s.step} · {s.label}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {viewMode === "net" && (
                  <div className="absolute inset-0 overflow-auto overscroll-contain p-4 sm:p-6">
<PolyhedronNet selected={selected} height={height} unit={unit} />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-4 rounded-[1.75rem] border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-300 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-slate-300">
                  <span className="text-xs uppercase tracking-[0.35em] text-slate-500">Height (net) ({unit})</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={8}
                    value={heightText}
                    placeholder="0"
                    onChange={(event) => {
                      // Digits + a single decimal point, at most 8 characters.
                      const cleaned = event.target.value.replace(/[^\d.]/g, "");
                      const parts = cleaned.split(".");
                      const raw =
                        parts.length > 1
                          ? `${parts[0]}.${parts.slice(1).join("")}`
                          : cleaned;
                      const next = raw.slice(0, 8);
                      setHeightText(next);
                      const v = Number(next);
                      if (Number.isFinite(v) && v > 0) {
                        setHeight(unit === "cm" ? v * 10 : v);
                      }
                    }}
                    onBlur={() => {
                      if (heightText.trim() === "" || Number(heightText) === 0) {
                        setHeightText("0");
                        setHeight(0);
                      }
                    }}
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-base text-white outline-none transition focus:border-teal-400 sm:text-sm"
                  />
                </label>
                <label className="space-y-2 text-slate-300">
                  <span className="text-xs uppercase tracking-[0.35em] text-slate-500">Width ({unit}) - optional</span>
                  <input
                    type="number"
                    value={width !== "" ? (unit === "cm" ? (Number(width) / 10).toFixed(1) : width) : ""}
                    min={0}
                    step={unit === "cm" ? 0.1 : 1}
                    onChange={(event) => {
                      const v = event.target.value;
                      if (v === "") {
                        setWidth("");
                      } else {
                        const num = Number(v);
                        if (Number.isFinite(num)) setWidth(unit === "cm" ? String(num * 10) : String(num));
                      }
                    }}
                    placeholder="auto"
                    className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-base text-white outline-none transition focus:border-teal-400 sm:text-sm"
                  />
                </label>
              </div>
            </div>

            <div className="mt-6 rounded-[1.75rem] border border-slate-800 bg-slate-950/80 p-6 text-sm text-slate-300">
              <div>
                {[
                  { label: "Net height", value: `${fmtMm(height)} mm` },
                  { label: "Net width", value: fit ? `${fmtMm(fit.netWidthMm)} mm` : "—" },
                  ...(fit?.edgeRows.map((e) => ({
                    label: e.count > 0 ? `${e.label} (×${e.count})` : e.label,
                    value: `${fmtMm(e.mm)} mm`,
                  })) ?? []),
                  {
                    label: "Net sheet size",
                    value: fit ? `${fmtMm(fit.netWidthMm)} × ${fmtMm(height)} mm` : "—",
                  },
                ].map((row, i, arr) => (
                  <div
                    key={row.label}
                    className={`flex justify-between text-slate-500 ${
                      i < arr.length - 1 ? "border-b border-slate-800 pb-3" : ""
                    } ${i > 0 ? "py-3" : ""} ${i === arr.length - 1 ? "pt-3" : ""}`}
                  >
                    <span>{row.label}</span>
                    <span className="font-medium text-white">{row.value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Print pages</p>
                  <p className="mt-1 text-slate-400">
                    Tile the {fmtMm(fit?.netWidthMm ?? 0)} × {fmtMm(height)} mm net onto {paper} (
                    {paperDims.w} × {paperDims.h} mm){" "}
                    <span className="whitespace-nowrap">
                      → <span className="font-medium text-white">{paperPages}</span> page
                      {paperPages === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>
                <div className="flex overflow-hidden rounded-full border border-slate-800">
                  {(["A4", "A3"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPaper(p)}
                      className={`min-h-10 touch-manipulation px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                        paper === p
                          ? "bg-teal-400 text-slate-950"
                          : "bg-slate-950 text-slate-400 hover:text-white"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {widthMismatch && fit && (
                <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
                  Requested width {fmtMm(requestedWidthMm)} mm cannot be met by a single uniform
                  scale together with a {fmtMm(height)} mm net height (this net has a fixed aspect
                  ratio of ≈{netAspect.toFixed(3)}). Fitting the height yields a net width of{" "}
                  {fmtMm(fit.netWidthMm)} mm — set the width to that value (or choose auto) to keep
                  the geometry undistorted.
                </p>
              )}
            </div>
          </div>
        </div>
  );
}
