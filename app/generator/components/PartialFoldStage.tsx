"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PartialFoldViewer from "./PartialFoldViewer";

type PartialFoldStageProps = {
  selected: string;
  modelScale: number;
};

/** Angular speed of the fold animation (radians / second). */
const SPEED = 0.9;

function stageName(q: number): string {
  if (q <= 0.06) return "3D Model";
  if (q >= 0.94) return "Flat Net";
  return "Partial Fold";
}

/**
 * STEP 2 · PARTIAL FOLD — a real, interactive fold.
 *
 * The fold progress (0 = fully assembled 3D model, 1 = fully flat net) is held
 * in a shared ref that the Three.js fold geometry reads on every frame. Play /
 * pause only freeze the progress value — the face transforms always follow it,
 * so pausing stops the actual geometry and resuming continues from the exact
 * same position.
 */
export default function PartialFoldStage({ selected, modelScale }: PartialFoldStageProps) {
  const progressRef = useRef<number>(0.5); // start at the "partial fold" midpoint
  const phaseRef = useRef<number>(Math.PI / 2); // cos(π/2) = 0  =>  q = 0.5
  const sliderRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(true);

  const paint = useCallback(() => {
    const q = progressRef.current;
    if (sliderRef.current) {
      sliderRef.current.value = String(Math.round(q * 100));
    }
    if (statusRef.current) {
      statusRef.current.textContent = `${stageName(q)} · ${Math.round(q * 100)}%`;
    }
  }, []);

  // Sync the UI once after mount.
  useEffect(() => {
    paint();
  }, [paint]);

  // Animation loop — only advances the phase while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      phaseRef.current += SPEED * dt;
      // Smooth 0 -> 1 -> 0 oscillation (cos), pause/resume keeps the phase.
      progressRef.current = 0.5 - 0.5 * Math.cos(phaseRef.current);
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, paint]);

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const q = Number(event.currentTarget.value) / 100;
    progressRef.current = q;
    // Keep the phase consistent so resuming continues smoothly from here.
    phaseRef.current = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * q)));
    paint();
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative min-h-0 flex-1 touch-none select-none">
        <PartialFoldViewer selected={selected} modelScale={modelScale} progress={progressRef} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-slate-800/80 bg-slate-950/60 px-2.5 pb-2 pt-2 sm:gap-x-4 sm:gap-y-2 sm:px-3 sm:pb-2.5 sm:pt-2.5">
        <button
          type="button"
          onClick={() => setPlaying((v) => !v)}
          aria-label={playing ? "Pause fold animation" : "Play fold animation"}
          title={playing ? "Pause fold animation" : "Play fold animation"}
          className="inline-flex min-h-10 touch-manipulation items-center gap-2 rounded-full bg-teal-400 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-950 transition hover:bg-teal-300 sm:px-4 sm:text-xs sm:tracking-[0.2em]"
        >
          <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
          {playing ? "Pause" : "Play"}
        </button>

        <div className="flex min-w-[110px] flex-1 items-center gap-2 sm:min-w-[220px] sm:gap-3">
          <span className="hidden shrink-0 text-[10px] uppercase tracking-[0.2em] text-slate-500 sm:inline">3D</span>
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={100}
            step={0.5}
            defaultValue={50}
            onChange={handleSeek}
            aria-label="Fold progress"
            title="Drag to scrub through the fold"
            className="h-10 w-full min-w-0 flex-1 touch-manipulation accent-teal-400"
          />
          <span className="hidden shrink-0 text-[10px] uppercase tracking-[0.2em] text-slate-500 sm:inline">Flat</span>
        </div>

        <span
          ref={statusRef}
          aria-live="polite"
          className="inline-flex min-w-0 shrink-0 items-center justify-center rounded-full border border-teal-400/25 bg-teal-400/10 px-2.5 py-1 text-center text-[11px] font-medium uppercase tracking-[0.12em] text-teal-200 sm:min-w-[130px] sm:px-3 sm:text-xs sm:tracking-[0.2em]"
        >
          Partial Fold · 50%
        </span>
      </div>
    </div>
  );
}
