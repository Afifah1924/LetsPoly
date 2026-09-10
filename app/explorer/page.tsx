"use client";

import { useState } from "react";
import GeneratorPanel from "../generator/components/GeneratorPanel";
import SiteFooter from "../components/SiteFooter";

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

export default function ExplorePage() {
  const [activeShape, setActiveShape] = useState("Icosahedron");
  const selectedStructure = structureDetails[activeShape];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex w-full max-w-[min(90vw,1600px)] items-center justify-between px-6 py-5">
          <div>
            <h1 className="font-[family-name:var(--font-space-grotesk)] text-3xl font-bold tracking-tight text-white">
              Lets<span className="text-teal-300">Poly</span>
            </h1>
            <p className="mt-1.5 text-xs uppercase tracking-[0.35em] text-slate-500">
              Interactive Polyhedron Construction
            </p>
          </div>
        </div>
      </header>
      <section className="mx-auto grid w-full max-w-[min(90vw,1600px)] gap-6 px-6 py-10 xl:grid-cols-[2fr_6fr_2fr]">
        <aside className="space-y-6 rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
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
        <GeneratorPanel selected={activeShape} />
        <aside className="space-y-6 rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-teal-300">STRUCTURE INFO</p>
            <h2 className="mt-3 text-xl font-semibold text-white">{selectedStructure.name}</h2>
          </div>

          <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-950/80 p-5 text-sm text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-500">Name</span>
              <span className="font-medium text-white">{selectedStructure.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Category</span>
              <span className="font-medium text-white">{selectedStructure.category}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Faces</span>
              <span className="font-medium text-white">{selectedStructure.faces}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Vertices</span>
              <span className="font-medium text-white">{selectedStructure.vertices}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Edges</span>
              <span className="font-medium text-white">{selectedStructure.edges}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Symmetry</span>
              <span className="font-medium text-white">{selectedStructure.symmetry}</span>
            </div>
          </div>
        </aside>
      </section>
      <SiteFooter />
    </main>
  );
}
