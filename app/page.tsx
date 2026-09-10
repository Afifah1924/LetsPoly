"use client";

import { useState } from "react";
import GeneratorPanel from "./generator/components/GeneratorPanel";
import SiteFooter from "./components/SiteFooter";

const structureSections = [
  {
    label: "Platonic Solids",
    items: [
      { name: "Tetrahedron", faces: 4 },
      { name: "Cube", faces: 6 },
      { name: "Octahedron", faces: 8 },
      { name: "Dodecahedron", faces: 12 },
      { name: "Icosahedron", faces: 20 },
    ],
  },
  {
    label: "Archimedean Solids",
    items: [
      { name: "Truncated Cube", faces: 14 },
      { name: "Truncated Icosahedron", faces: 32 },
    ],
  },
  {
    label: "Other",
    items: [
      { name: "Prism", faces: 5 },
      { name: "Pyramid", faces: 5 },
    ],
  },
];

const structureDetails: Record<string, { name: string; category: string; faces: number; edges: number; vertices: number; faceShape: string; difficulty: string; symmetry: string }> = {
  Tetrahedron: {
    name: "Tetrahedron",
    category: "Platonic Solid",
    faces: 4,
    edges: 6,
    vertices: 4,
    faceShape: "Triangle",
    difficulty: "Easy",
    symmetry: "High",
  },
  Cube: {
    name: "Cube",
    category: "Platonic Solid",
    faces: 6,
    edges: 12,
    vertices: 8,
    faceShape: "Square",
    difficulty: "Easy",
    symmetry: "High",
  },
  Octahedron: {
    name: "Octahedron",
    category: "Platonic Solid",
    faces: 8,
    edges: 12,
    vertices: 6,
    faceShape: "Triangle",
    difficulty: "Medium",
    symmetry: "High",
  },
  Dodecahedron: {
    name: "Dodecahedron",
    category: "Platonic Solid",
    faces: 12,
    edges: 30,
    vertices: 20,
    faceShape: "Pentagon",
    difficulty: "Medium",
    symmetry: "High",
  },
  Icosahedron: {
    name: "Icosahedron",
    category: "Platonic Solid",
    faces: 20,
    edges: 30,
    vertices: 12,
    faceShape: "Triangle",
    difficulty: "Medium",
    symmetry: "High",
  },
  "Truncated Cube": {
    name: "Truncated Cube",
    category: "Archimedean Solid",
    faces: 14,
    edges: 36,
    vertices: 24,
    faceShape: "Quadrilateral",
    difficulty: "Medium",
    symmetry: "Medium",
  },
  "Truncated Icosahedron": {
    name: "Truncated Icosahedron",
    category: "Archimedean Solid",
    faces: 32,
    edges: 90,
    vertices: 60,
    faceShape: "Hexagon/Triangle",
    difficulty: "Hard",
    symmetry: "High",
  },
  Prism: {
    name: "Prism",
    category: "Other",
    faces: 5,
    edges: 8,
    vertices: 5,
    faceShape: "Quadrilateral",
    difficulty: "Easy",
    symmetry: "Low",
  },
  Pyramid: {
    name: "Pyramid",
    category: "Other",
    faces: 5,
    edges: 8,
    vertices: 5,
    faceShape: "Triangle",
    difficulty: "Easy",
    symmetry: "Low",
  },
};

export default function ExplorerPage() {
  const [activeShape, setActiveShape] = useState("Icosahedron");
  const selectedStructure = structureDetails[activeShape];
  const structureStats = [
    { label: "Name", value: selectedStructure.name },
    { label: "Category", value: selectedStructure.category },
    { label: "Faces", value: String(selectedStructure.faces) },
    { label: "Vertices", value: String(selectedStructure.vertices) },
    { label: "Edges", value: String(selectedStructure.edges) },
    { label: "Symmetry", value: selectedStructure.symmetry },
  ];
  const allShapes = structureSections.flatMap((section) => section.items);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex w-full max-w-[min(90vw,1600px)] items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Lets<span className="text-teal-300">Poly</span>
            </h1>
            <p className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500 sm:text-xs sm:tracking-[0.35em]">
              Interactive Polyhedron Construction
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-slate-800 bg-slate-950 px-3 py-1.5 text-[11px] font-medium text-teal-200 sm:inline-flex">
            {activeShape}
          </span>
        </div>
      </header>

      {/* Mobile / tablet shape picker — sticky so it is reachable while scrolling. */}
      <div className="sticky top-0 z-30 border-b border-slate-800/70 bg-slate-950/95 backdrop-blur xl:hidden">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3 sm:px-6">
          {allShapes.map((shape) => {
            const active = activeShape === shape.name;
            return (
              <button
                key={shape.name}
                type="button"
                onClick={() => setActiveShape(shape.name)}
                aria-pressed={active}
                className={`min-h-10 shrink-0 touch-manipulation rounded-full border px-4 text-sm transition ${
                  active
                    ? "border-teal-400 bg-teal-400/10 font-semibold text-teal-200"
                    : "border-slate-800 bg-slate-900/70 text-slate-300"
                }`}
              >
                {shape.name}
              </button>
            );
          })}
        </div>
      </div>

      <section className="mx-auto grid w-full max-w-[min(90vw,1600px)] gap-6 px-4 py-6 sm:px-6 sm:py-10 xl:grid-cols-[2fr_6fr_2fr]">
        <aside className="hidden space-y-6 rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-xl xl:order-1 xl:block">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-teal-300">STRUCTURES</p>
            <h2 className="mt-3 text-xl font-semibold text-white">Navigation</h2>
          </div>

          {structureSections.map((section) => (
            <div key={section.label} className="space-y-3">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{section.label}</p>
              <div className="space-y-2 rounded-3xl border border-slate-800 bg-slate-950/60 p-3">
                {section.items.map((item) => {
                  const active = activeShape === item.name;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setActiveShape(item.name)}
                      className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                        active ? "bg-teal-500/10 ring-1 ring-teal-400" : "hover:bg-slate-800/80"
                      }`}
                    >
                      <span className="flex items-center gap-3 text-sm text-slate-100">
                        <span className="grid h-8 w-8 place-items-center rounded-2xl border border-slate-700 bg-slate-950 text-teal-300">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M12 3L3 9l9 6 9-6-9-6Z" />
                            <path d="M3 9l9 6 9-6" />
                          </svg>
                        </span>
                        <span>{item.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>
        <div className="order-1 min-w-0 xl:order-2">
          <GeneratorPanel selected={activeShape} />
        </div>
        <aside className="order-2 rounded-[2rem] border border-slate-800 bg-slate-900/80 p-4 shadow-xl sm:p-6 xl:order-3">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-teal-300">STRUCTURE INFO</p>
            <h2 className="mt-3 text-xl font-semibold text-white">{selectedStructure.name}</h2>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-slate-300 sm:grid-cols-1 sm:gap-0 sm:divide-y sm:divide-slate-800">
            {structureStats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col gap-1 rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0"
              >
                <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500 sm:text-sm sm:normal-case sm:tracking-normal">
                  {stat.label}
                </span>
                <span className="font-medium text-white">{stat.value}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>
      <SiteFooter />
    </main>
  );
}
