"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import FoldingPolyhedron from "./FoldingPolyhedron";

type PartialFoldViewerProps = {
  selected: string;
  modelScale: number;
  /** 0 = fully assembled solid, 1 = fully unfolded flat net */
  progress: { current: number };
};

export default function PartialFoldViewer({ selected, modelScale, progress }: PartialFoldViewerProps) {
  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 45 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 10, 7.5]} intensity={1.1} />
      <FoldingPolyhedron selected={selected} modelScale={modelScale} progress={progress} />
      <OrbitControls enablePan={false} enableZoom={false} />
    </Canvas>
  );
}
