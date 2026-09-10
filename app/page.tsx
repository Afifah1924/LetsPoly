"use client";

import { useState } from "react";
import SiteFooter from "./components/SiteFooter";

export default function Home() {
  const domains = [
    {
      name: "Creative",
      description: "Design, art, and visual projects.",
      color: "bg-[#E9E3F8]",
    },
    {
      name: "Business",
      description: "Professional and company templates.",
      color: "bg-[#DCE6F2]",
    },
    {
      name: "Portfolio",
      description: "Showcase your work beautifully.",
      color: "bg-[#DEEADF]",
    },
    {
      name: "Personal",
      description: "Simple pages for personal use.",
      color: "bg-[#F3E8D3]",
    },
  ];

  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  const selectedDomainData = domains.find(
    (domain) => domain.name === selectedDomain
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">

      <nav className="flex justify-between items-center px-8 py-6 max-w-6xl mx-auto">
        <h1 className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold tracking-tight">
          Lets<span className="text-teal-600">Poly</span>
        </h1>

        <button className="rounded-full bg-slate-900 px-5 py-2 text-white">
          Explore
        </button>
      </nav>


      <section className="relative max-w-6xl mx-auto px-8 py-16">

        <div className="absolute right-20 top-40 hidden h-48 w-48 rotate-12 rounded-3xl border border-slate-200 bg-white shadow-xl md:block">
          <div className="absolute inset-6 rotate-12 rounded-2xl border border-slate-200"></div>
        </div>


        <div className="max-w-3xl">

          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">
            Digital Design System
          </p>

          <h2 className="mt-6 text-6xl font-semibold tracking-tight">
            Templates shaped with structure.
          </h2>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
            A refined collection of modern templates inspired by balance,
            geometry, and simplicity.
          </p>

          <button className="mt-8 rounded-full bg-slate-900 px-8 py-3 text-sm text-white transition hover:bg-slate-700">
            Explore Templates
          </button>

        </div>


        <div className="mt-12 grid gap-6 md:grid-cols-4">

          {domains.map((domain) => (
            <button
              key={domain.name}
              type="button"
              onClick={() => setSelectedDomain(domain.name)}
              className={`group rounded-3xl border border-white/60 p-8 text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg ${domain.color} ${selectedDomain === domain.name ? "ring-4 ring-slate-900/10" : ""}`}
            >
              <h3 className="text-xl font-medium tracking-tight">
                {domain.name}
              </h3>
              <p className="mt-3 text-sm text-slate-600">
                {domain.description}
              </p>
            </button>
          ))}
        </div>


        {selectedDomainData ? (

          <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">

            <p className="text-sm uppercase tracking-[0.3em] text-slate-500">
              Selected Domain
            </p>

            <h3 className="mt-4 text-3xl font-semibold">
              {selectedDomainData.name}
            </h3>

            <p className="mt-4 text-lg text-slate-600">
              {selectedDomainData.description}
            </p>

          </div>

        ) : (

          <div className="mt-10 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-slate-500">
            Select a domain to explore templates.
          </div>

        )}

      </section>

      <SiteFooter />
    </main>
  );
}