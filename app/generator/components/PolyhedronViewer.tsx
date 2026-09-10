"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { makeGeometry } from "./polyhedronGeometry";

type RotatingModelProps = {
  geometry: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  height: number;
  zoom: number;
  rotateX: number;
  rotateY: number;
  offset: { x: number; y: number };
  autoRotate?: boolean;
};

function RotatingModel({
  geometry,
  edges,
  height,
  zoom,
  rotateX,
  rotateY,
  offset,
  autoRotate,
}: RotatingModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const autoYawRef = useRef(0);
  const modelScale = Math.min(1.6, 0.8 + height / 180);

  // Continuous 360° spin. Drag still works while it spins: the auto-rotate
  // offset is added on top of the current rotateX/rotateY each frame.
  useFrame((_, delta) => {
    if (autoRotate) autoYawRef.current += delta * 20; // degrees / second
    const g = groupRef.current;
    if (!g) return;
    g.rotation.set(
      THREE.MathUtils.degToRad(rotateX),
      THREE.MathUtils.degToRad(rotateY + autoYawRef.current),
      0
    );
  });

  return (
    <group
      ref={groupRef}
      position={[offset.x / 120, -offset.y / 120, 0]}
      scale={modelScale * zoom}
    >
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#10e6c1" metalness={0.05} roughness={0.35} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#083f36" />
      </lineSegments>
    </group>
  );
}

type PolyhedronViewerProps = {
  selected: string;
  height: number;
  zoom: number;
  rotateX: number;
  rotateY: number;
  offset: { x: number; y: number };
  autoRotate?: boolean;
};

export default function PolyhedronViewer({
  selected,
  height,
  zoom,
  rotateX,
  rotateY,
  offset,
  autoRotate = false,
}: PolyhedronViewerProps) {
  const geometry = useMemo(() => makeGeometry(selected), [selected]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      edges.dispose();
    };
  }, [geometry, edges]);

  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 45 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 10, 7.5]} intensity={1} />
      <RotatingModel
        geometry={geometry}
        edges={edges}
        height={height}
        zoom={zoom}
        rotateX={rotateX}
        rotateY={rotateY}
        offset={offset}
        autoRotate={autoRotate}
      />
    </Canvas>
  );
}
