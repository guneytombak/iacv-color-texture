"use client";

import { useEffect, useRef } from "react";

export function grayToRgba(values: Float64Array, map: (value: number) => number) {
  const rgba = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    const level = Math.round(Math.max(0, Math.min(255, map(value))));
    rgba[index * 4] = level;
    rgba[index * 4 + 1] = level;
    rgba[index * 4 + 2] = level;
    rgba[index * 4 + 3] = 255;
  });
  return rgba;
}

/** Zero maps to mid-gray; ±max|value| map to white and black. */
export function signedRgba(values: Float64Array) {
  let maximum = 1e-12;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return grayToRgba(values, (value) => 127.5 + 127.5 * (value / maximum));
}

/** Zero maps to black, the maximum to white; `gamma` < 1 brightens weak values. */
export function unsignedRgba(values: Float64Array, gamma = 1) {
  let maximum = 1e-12;
  for (const value of values) maximum = Math.max(maximum, value);
  return grayToRgba(values, (value) => 255 * Math.pow(Math.max(0, value) / maximum, gamma));
}

/** Linear map of [min, max] to [0, 255]. */
export function rangeRgba(values: Float64Array) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return grayToRgba(values, (value) => (255 * (value - minimum)) / Math.max(1e-12, maximum - minimum));
}

export function Raster({ rgba, size, label, className = "" }: { rgba: Uint8ClampedArray; size: number; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size, size), 0, 0);
  }, [rgba, size]);
  return <canvas ref={ref} width={size} height={size} className={`texture-raster ${className}`} role="img" aria-label={label} />;
}
