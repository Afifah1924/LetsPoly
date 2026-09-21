"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import PolyhedronNet from "./PolyhedronNet";
import { fitFromMeasurement, measureNet } from "./netMeasurement";
import { buildNetPdf, fmtLength, netPdfFileName, planSheets } from "./netPdf";

const PolyhedronViewer = dynamic(() => import("./PolyhedronViewer"), { ssr: false });
const PartialFoldStage = dynamic(() => import("./PartialFoldStage"), { ssr: false });

/**
 * Printer glyph for the export buttons.
 *
 * Hand-drawn like the rest of the app's icons: nothing here pulls in an icon
 * package, and the paths use `currentColor` so the button's own text colour
 * drives it. `stroke-linecap`/`linejoin` come from the wrapper classes.
 */
function PrintIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* sheet going in, the body, and the tray coming out */}
      <path d="M7 9V4h10v5" />
      <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v6H7z" />
    </svg>
  );
}

/**
 * Format the height input value for the active unit (used by the text field).
 *
 * Display lengths use `fmtLength` from `./netPdf`, the same function the printed
 * sheet's caption uses; this one is only about what the *input field* holds, and
 * keeps cm entries at one decimal like a tape measure.
 */
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
  // A press that landed on a control, waiting to see whether it becomes a drag.
  const pendingRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  // Set when a drag swallowed a control's press, so the trailing click is ignored.
  const swallowClickRef = useRef(false);
  // True from the first pointer that landed on the model until the last lifts.
  const activeRef = useRef(false);
  // Latest gesture closures, so native listeners stay bound once and still read
  // the current rotate/zoom state on every event.
  const gesturesRef = useRef<{
    down: (event: PointerEvent, surface: HTMLElement) => void;
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  }>({ down: () => {}, move: () => {}, up: () => {} });
  const [helpOpen, setHelpOpen] = useState(false);
  // Result line under the print button: file name on success, a plain answer on
  // failure. Nothing is ever claimed unless a file was actually written.
  const [pdfNote, setPdfNote] = useState("");

  /**
   * Builds the printable PDF in the browser and hands it to the download
   * manager. Same numbers as the panel: the measured fit, the chosen unit and
   * the chosen paper — so the sheets match what the visitor just looked at.
   */
  const downloadPdf = () => {
    if (!pdfSource) return;
    try {
      const bytes = buildNetPdf({ selected, paper, unit, fit: pdfSource });
      if (!bytes) throw new Error("no net to export");
      const name = netPdfFileName(selected, pdfSource.netHeightMm, unit, paper);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking in the same tick can cancel the download in some browsers, and
      // 30 s is far longer than a download needs, so nothing leaks either.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setPdfNote(`Saved ${name} · ${paperPages} page${paperPages === 1 ? "" : "s"} · print at 100%`);
    } catch {
      setPdfNote("Could not build the PDF — please try again.");
    }
  };

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

  // Paper tiling for printing the fitted net. The count comes from the same
  // function the PDF export tiles with, so what is shown here is the page count
  // of the file the button hands over, not a separate estimate.
  const paperDims = paper === "A4" ? { w: 210, h: 297 } : { w: 297, h: 420 };
  const sheets = fit ? planSheets(fit.netWidthMm, fit.netHeightMm, paper) : null;
  const paperPages = sheets ? sheets.pages : 0;
  const modelScale = useMemo(() => Math.min(1.6, 0.8 + height / 180), [height]);
  // A PDF needs real geometry: no net height (or an unmeasurable solid) means no file.
  const canExportPdf = !!fit && !!measurement;
  /**
   * The measured fit, read out into a plain object here rather than inside the
   * click handler below. React's compiler refuses to keep a manual `useMemo`
   * (`fit`) alive when a nested function touches it, and this component has no
   * other reason to give that memoization up.
   */
  const pdfSource = fit ? { ...fit } : null;

  /** The surface only captures gestures while a rotatable 3D view is showing. */
  const canRotate = viewMode === "3d" || (viewMode === "transition" && transitionStep === 1);

  /** Movement that turns a press on a control into a rotate drag instead of a tap. */
  const DRAG_SLOP = 8;

  /** Begins a rotate/pinch drag for a pointer, remembering the press origin. */
  const startDrag = (pointerId: number, x: number, y: number) => {
    pointersRef.current.set(pointerId, { x, y });

    // A second finger on the surface switches to pinch-to-zoom.
    if (pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y) || 1;
      pinchRef.current = { distance, zoom };
      draggingRef.current = false;
      return;
    }

    draggingRef.current = true;
    dragStartRef.current = { x, y, rotateX, rotateY, offsetX: offset.x, offsetY: offset.y };
  };

  /**
   * Gesture handling deliberately uses *native* listeners (bound once in the
   * effect below) instead of React's synthetic pointer props, so that a swipe on
   * a phone survives whatever a browser does to touch mid-gesture:
   *  - `pointermove`/`pointerup` are tracked on `window`, so the drag keeps
   *    rotating after the finger leaves the preview and nothing — a stray
   *    `pointerleave` in particular — can end it before the finger lifts;
   *  - `setPointerCapture` is best-effort, so a browser that refuses it for the
   *    touch pointer no longer skips `startDrag` (which left the model looking
   *    undraggable on that device);
   *  - a non-passive `touchmove` listener keeps the page still while dragging,
   *    for touch browsers that do not fully honour `touch-action`.
   */
  const gestures = {
    down(event: PointerEvent, surface: HTMLElement) {
      // Interactive controls (the STEP pills, the help button) live *inside* the
      // preview, so a thumb often lands on one before the swipe starts. Capturing
      // the pointer on those would retarget the events and kill the control's
      // click, so remember the press instead and only take over once it has
      // travelled past DRAG_SLOP (see move()).
      const target = event.target as HTMLElement | null;
      const onControl =
        !!target &&
        typeof target.closest === "function" &&
        !!target.closest("button, a, input, select, textarea, label");
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!canRotate) return;

      swallowClickRef.current = false;
      if (onControl) {
        pendingRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        return;
      }

      activeRef.current = true;
      setHelpOpen(false);
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        /* Capture is a convenience — the window listeners keep the drag alive. */
      }
      startDrag(event.pointerId, event.clientX, event.clientY);
    },

    move(event: PointerEvent) {
      const pending = pendingRef.current;
      if (pending && pending.pointerId === event.pointerId) {
        // Still a tap? Leave it to the control.
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= DRAG_SLOP) return;
        // A swipe that started on a pill / the help button becomes a rotate drag.
        pendingRef.current = null;
        swallowClickRef.current = true;
        activeRef.current = true;
        setHelpOpen(false);
        const surface = viewportRef.current;
        if (surface) {
          try {
            surface.setPointerCapture(event.pointerId);
          } catch {
            /* Capture is a convenience — the window listeners keep the drag alive. */
          }
        }
        startDrag(event.pointerId, pending.x, pending.y);
      }

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
        // A thumb covers far fewer pixels than a mouse drag, so touch rotates faster.
        const speed = event.pointerType === "touch" ? 0.35 : 0.2;
        setRotateX(Math.max(-80, Math.min(80, dragStartRef.current.rotateX + dy * speed)));
        setRotateY(dragStartRef.current.rotateY + dx * speed);
      }
    },
    up(event: PointerEvent) {
      if (pendingRef.current?.pointerId === event.pointerId) pendingRef.current = null;
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (pointersRef.current.size === 0) {
        activeRef.current = false;
        draggingRef.current = false;
      } else if (activeRef.current && pointersRef.current.size === 1) {
        // A pinch dropped one finger: the one still down keeps rotating from here
        // (instead of the gesture going dead until the user lifts and retries).
        const [remaining] = [...pointersRef.current.values()];
        dragStartRef.current = {
          x: remaining.x,
          y: remaining.y,
          rotateX,
          rotateY,
          offsetX: offset.x,
          offsetY: offset.y,
        };
        draggingRef.current = true;
      }
      // The click after a promoted drag is swallowed below; drop the flag anyway in
      // case the browser sends no click at all.
      if (swallowClickRef.current) {
        window.setTimeout(() => {
          swallowClickRef.current = false;
        }, 400);
      }
    },
  };

  // Keep the bound-once native listeners pointing at the freshest closures (they
  // read the current rotate/zoom/offset state) without re-binding every render.
  useEffect(() => {
    gesturesRef.current = gestures;
  });

  useEffect(() => {
    const surface = viewportRef.current;
    if (!surface) return;
    const onDown = (event: PointerEvent) => gesturesRef.current.down(event, surface);
    const onMove = (event: PointerEvent) => gesturesRef.current.move(event);
    const onUp = (event: PointerEvent) => gesturesRef.current.up(event);
    // iOS: once the gesture is a drag it belongs to the model, not the page.
    const onTouchMove = (event: TouchEvent) => {
      if (draggingRef.current) event.preventDefault();
    };
    surface.addEventListener("pointerdown", onDown);
    // Window-level so the drag survives the finger leaving the preview and works
    // even where captured touch events are not retargeted.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    surface.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      surface.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      surface.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

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
                  viewMode === "net"
                    ? "min-h-[70svh]"
                    : viewMode === "transition"
                      ? // Transition stacks the step pills and the fold controls inside this
                        // box, so a square preview left the model a ~130px letterbox strip
                        // on a phone. No aspect-square here: with a definite min-height it
                        // also forces the width, which overflows the column.
                        "min-h-[58svh] sm:aspect-[16/10] sm:min-h-0"
                      : "aspect-square sm:aspect-[16/10]"
                } ${canRotate ? "touch-none select-none cursor-grab active:cursor-grabbing" : ""}`}
                onClickCapture={(event) => {
                  // A swipe that started on a pill must not also activate it.
                  if (!swallowClickRef.current) return;
                  swallowClickRef.current = false;
                  event.stopPropagation();
                  event.preventDefault();
                }}
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
                    {/* One compact row on phones — the three stacked pills used to eat
                        half the preview and leave the model a letterbox strip. */}
                    <div className="flex items-stretch gap-1.5 px-2 pb-2.5 pt-2 sm:flex-wrap sm:items-center sm:justify-center sm:gap-2 sm:pb-3">
                      {[
                        { step: 1, label: "3D Model" },
                        { step: 2, label: "Partial Fold" },
                        { step: 3, label: "Flat Net" },
                      ].map((s, i) => {
                        const active = transitionStep === s.step;
                        return (
                          <div key={s.step} className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
                            {i > 0 && <div className="hidden h-px w-6 shrink-0 bg-slate-700 sm:block" />}
                            <button
                              type="button"
                              onClick={() => setTransitionStep(s.step)}
                              className={`min-h-10 w-full min-w-0 touch-manipulation rounded-full px-1 py-2 text-[11px] font-semibold transition sm:w-auto sm:px-4 sm:text-xs sm:font-normal sm:uppercase sm:tracking-[0.2em] ${
                                active
                                  ? "bg-teal-400 text-slate-950"
                                  : "bg-slate-800 font-normal text-slate-300 hover:bg-slate-700"
                              }`}
                            >
                              <span className="hidden sm:inline">Step {s.step} · </span>
                              {s.label}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {viewMode === "net" && (
                  // pt-16 keeps the pinned print button off the drawing: the net
                  // scrolls underneath it instead of under the button.
                  <div className="absolute inset-0 overflow-auto overscroll-contain p-4 pt-16 sm:p-6 sm:pt-16">
                    <PolyhedronNet selected={selected} height={height} unit={unit} />
                  </div>
                )}

                {/* Pinned to the preview frame, so it is on screen the instant the
                    net appears and stays there while the sheet scrolls. Two
                    separate conditions rather than a fragment: the React Compiler
                    drops manual memoization in this component when a fragment
                    wraps this view. */}
                {viewMode === "net" && (
                  <button
                    type="button"
                    onClick={downloadPdf}
                    disabled={!canExportPdf}
                    aria-label="Print / Export PDF"
                    title={
                      canExportPdf
                        ? `Print / Export PDF · ${paper} · ${paperPages} page${paperPages === 1 ? "" : "s"} · true size`
                        : "Enter a net height above 0 first"
                    }
                    className="absolute right-3 top-3 z-20 grid h-10 w-10 touch-manipulation place-items-center rounded-full border border-teal-400/60 bg-slate-950/95 text-teal-200 shadow-lg shadow-slate-950/60 transition hover:border-teal-300 hover:bg-teal-400/10 hover:text-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500 disabled:hover:bg-slate-950/95"
                  >
                    <PrintIcon className="h-5 w-5" />
                  </button>
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
                  { label: "Net height", value: fmtLength(height, unit) },
                  { label: "Net width", value: fit ? fmtLength(fit.netWidthMm, unit) : "—" },
                  ...(fit?.edgeRows.map((e) => ({
                    label: e.count > 0 ? `${e.label} (×${e.count})` : e.label,
                    value: fmtLength(e.mm, unit),
                  })) ?? []),
                  {
                    label: "Net sheet size",
                    value: fit ? `${fmtLength(fit.netWidthMm, unit)} × ${fmtLength(height, unit)}` : "—",
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
                    Tile the {fmtLength(fit?.netWidthMm ?? 0, unit)} × {fmtLength(height, unit)} net onto {paper} (
                    {fmtLength(paperDims.w, unit)} × {fmtLength(paperDims.h, unit)}){" "}
                    <span className="whitespace-nowrap">
                      → <span className="font-medium text-white">{paperPages}</span> page
                      {paperPages === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                  {/* The primary action: the printer icon, sized like every other
                      control (40 px) so it is an easy thumb target next to the
                      paper pills. */}
                  <button
                    type="button"
                    onClick={downloadPdf}
                    disabled={!canExportPdf}
                    aria-label="Print / Export PDF"
                    title={
                      canExportPdf
                        ? `Print / Export PDF · ${paper} · ${paperPages} page${paperPages === 1 ? "" : "s"}`
                        : "Enter a net height above 0 first"
                    }
                    className="grid h-10 w-10 touch-manipulation place-items-center rounded-full bg-teal-400 text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    <PrintIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {pdfNote && (
                <p role="status" className="mt-4 text-xs leading-relaxed text-teal-200">
                  {pdfNote}
                </p>
              )}

              {widthMismatch && fit && (
                <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-200">
                  Requested width {fmtLength(requestedWidthMm, unit)} cannot be met by a single uniform
                  scale together with a {fmtLength(height, unit)} net height (this net has a fixed aspect
                  ratio of ≈{netAspect.toFixed(3)}). Fitting the height yields a net width of{" "}
                  {fmtLength(fit.netWidthMm, unit)} — set the width to that value (or choose auto) to keep
                  the geometry undistorted.
                </p>
              )}
            </div>
          </div>
        </div>
  );
}
