"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { RGB } from "../_lib/color";
import { rgbToHsl, rgbToHsv } from "../_lib/color";

type Space = "rgb" | "hsv" | "hsl";

function positionFor(rgb: RGB, space: Space) {
  if (space === "rgb") return new THREE.Vector3(2 * rgb[0] - 1, 2 * rgb[1] - 1, 2 * rgb[2] - 1);
  if (space === "hsv") {
    const [h, s, v] = rgbToHsv(rgb);
    const chroma = s * v;
    const angle = h * Math.PI / 180;
    return new THREE.Vector3(chroma * Math.cos(angle), 2 * v - 1, chroma * Math.sin(angle));
  }
  const [h, s, l] = rgbToHsl(rgb);
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const angle = h * Math.PI / 180;
  return new THREE.Vector3(chroma * Math.cos(angle), 2 * l - 1, chroma * Math.sin(angle));
}

function whiteLineMaterial(opacity = 0.72) {
  return new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity });
}

function colorSolidWire(space: Space) {
  if (space === "rgb") {
    return new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), whiteLineMaterial());
  }
  const vertices: number[] = [];
  const segments = 48;
  for (let i = 0; i < segments; i += 1) {
    const a = i / segments * Math.PI * 2;
    const b = (i + 1) / segments * Math.PI * 2;
    const rimY = space === "hsv" ? 1 : 0;
    vertices.push(Math.cos(a), rimY, Math.sin(a), Math.cos(b), rimY, Math.sin(b));
    if (space === "hsv") vertices.push(0, -1, 0, Math.cos(a), 1, Math.sin(a));
    else {
      vertices.push(0, -1, 0, Math.cos(a), 0, Math.sin(a));
      vertices.push(0, 1, 0, Math.cos(a), 0, Math.sin(a));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, whiteLineMaterial());
}

function whiteAxes() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 1.35, 0, 0,
    0, 0, 0, 0, 1.35, 0,
    0, 0, 0, 0, 0, 1.35,
  ], 3));
  return new THREE.LineSegments(geometry, whiteLineMaterial(0.45));
}

export function ColorSpaceViewer({
  space,
  rgb,
  pixels,
  pointSize,
}: {
  space: Space;
  rgb: RGB;
  pixels: RGB[];
  pointSize: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    points?: THREE.Points;
    active: THREE.Mesh;
    resize: ResizeObserver;
    render: () => void;
  } | null>(null);

  const reference = useMemo(() => {
    const values = Array.from({ length: 8 }, (_, index) => index / 7);
    const points: RGB[] = [];
    values.forEach((r) => values.forEach((g) => values.forEach((b) => points.push([r, g, b]))));
    return points;
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(3.2, 2.5, 3.4);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 2.4;
    controls.maxDistance = 8;
    scene.add(colorSolidWire(space));
    scene.add(whiteAxes());
    const active = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    scene.add(active);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const resize = new ResizeObserver(() => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(mount);
    sceneRef.current = { scene, camera, renderer, controls, active, resize, render };
    render();
    return () => {
      resize.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [space]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.points) {
      state.scene.remove(state.points);
      state.points.geometry.dispose();
      (state.points.material as THREE.Material).dispose();
    }
    const source = pixels.length ? pixels : reference;
    const positions = new Float32Array(source.length * 3);
    const colors = new Float32Array(source.length * 3);
    source.forEach((color, index) => {
      const point = positionFor(color, space);
      positions.set([point.x, point.y, point.z], index * 3);
      const renderedColor = new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace);
      colors.set([renderedColor.r, renderedColor.g, renderedColor.b], index * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: pixels.length ? pointSize : pointSize * 0.72,
      vertexColors: true,
      transparent: true,
      opacity: pixels.length ? 0.76 : 0.38,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    state.scene.add(points);
    state.points = points;
    state.active.position.copy(positionFor(rgb, space));
    (state.active.material as THREE.MeshBasicMaterial).color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    state.render();
  }, [pixels, pointSize, reference, rgb, space]);

  const labels = space === "rgb" ? ["R", "G", "B"] : space === "hsv" ? ["hue", "value", "saturation"] : ["hue", "lightness", "chroma"];
  return (
    <div className="space-viewer">
      <div ref={mountRef} className="three-mount" />
      <div className="scene-axis-labels"><span>{labels[0]}</span><span>{labels[1]}</span><span>{labels[2]}</span></div>
      <p>Drag to orbit · scroll to zoom</p>
    </div>
  );
}
