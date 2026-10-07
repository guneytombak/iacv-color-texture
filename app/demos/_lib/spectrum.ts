// Power-spectrum measurements shared by the texture pages (Fourier features, slides 53–54).
// Frequencies (u, v) are in cycles per pixel; v follows the image row index and grows DOWNWARD.
// Angles θ = atan2(v, u) are measured from the +u axis toward +v and folded into [0°, 180°),
// because the power spectrum of a real image is centrally symmetric: P(u, v) = P(−u, −v).

import { fft2d } from "./fft.ts";
import type { Complex2D } from "./fft.ts";

/**
 * Fourier transform of the mean-subtracted image multiplied by a separable Hann window.
 * The window removes the jump at the periodic border, which would otherwise put spurious
 * energy along the u and v axes.
 */
export function windowedSpectrum(values: Float64Array, size: number) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const field: Complex2D = { re: new Float64Array(size * size), im: new Float64Array(size * size), size };
  let windowEnergy = 0;
  for (let y = 0; y < size; y += 1) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / size);
    for (let x = 0; x < size; x += 1) {
      const window = wy * (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / size));
      field.re[y * size + x] = (values[y * size + x] - mean) * window;
      windowEnergy += window * window;
    }
  }
  return { spectrum: fft2d(field), windowEnergy };
}

export type PolarPower = {
  size: number;
  /** |F|² in natural DFT order (index l·size + k); the DC bin is set to 0. */
  power: Float64Array;
  radius: Float64Array;
  /** Folded angle in degrees, [0, 180). */
  angle: Float64Array;
  /** Σ power over all bins except DC. */
  total: number;
};

/** Signed frequency of DFT index k on an n-point grid, in cycles per sample. */
export function signedFrequency(k: number, n: number) {
  return (k < n / 2 ? k : k - n) / n;
}

export function polarPower(spectrum: Complex2D): PolarPower {
  const { re, im, size } = spectrum;
  const power = new Float64Array(size * size);
  const radius = new Float64Array(size * size);
  const angle = new Float64Array(size * size);
  let total = 0;
  for (let l = 0; l < size; l += 1) {
    const v = signedFrequency(l, size);
    for (let k = 0; k < size; k += 1) {
      const u = signedFrequency(k, size);
      const index = l * size + k;
      radius[index] = Math.hypot(u, v);
      angle[index] = (((Math.atan2(v, u) * 180) / Math.PI) % 180 + 180) % 180;
      if (index === 0) continue;
      power[index] = re[index] ** 2 + im[index] ** 2;
      total += power[index];
    }
  }
  return { size, power, radius, angle, total };
}

/** Fraction of non-DC power with r₁ ≤ √(u² + v²) < r₂ (coarseness feature). */
export function ringFraction(polar: PolarPower, inner: number, outer: number) {
  let sum = 0;
  for (let index = 1; index < polar.power.length; index += 1) {
    if (polar.radius[index] >= inner && polar.radius[index] < outer) sum += polar.power[index];
  }
  return polar.total > 0 ? sum / polar.total : 0;
}

/** True when the folded angle lies in [θ₁, θ₂), wrapping through 180° when θ₁ > θ₂. */
export function inWedge(angle: number, start: number, end: number) {
  return start <= end ? angle >= start && angle < end : angle >= start || angle < end;
}

/** Fraction of non-DC power with θ₁ ≤ θ < θ₂, both opposite sectors included (directionality feature). */
export function wedgeFraction(polar: PolarPower, start: number, end: number) {
  let sum = 0;
  for (let index = 1; index < polar.power.length; index += 1) {
    if (inWedge(polar.angle[index], start, end)) sum += polar.power[index];
  }
  return polar.total > 0 ? sum / polar.total : 0;
}

/** Power fraction in equal-width radial bins over [0, maximum). Bins beyond `maximum` are ignored. */
export function radialProfile(polar: PolarPower, bins: number, maximum = 0.5) {
  const profile = new Float64Array(bins);
  for (let index = 1; index < polar.power.length; index += 1) {
    const bin = Math.floor((polar.radius[index] / maximum) * bins);
    if (bin < bins) profile[bin] += polar.power[index];
  }
  return profile.map((value) => (polar.total > 0 ? value / polar.total : 0));
}

/** Power fraction in equal-width angular bins over [0°, 180°). */
export function angularProfile(polar: PolarPower, bins: number) {
  const profile = new Float64Array(bins);
  for (let index = 1; index < polar.power.length; index += 1) {
    profile[Math.min(bins - 1, Math.floor((polar.angle[index] / 180) * bins))] += polar.power[index];
  }
  return profile.map((value) => (polar.total > 0 ? value / polar.total : 0));
}

/** log(1 + |F|²) with zero frequency moved to the centre (index n/2), for display. */
export function centredLogPower(polar: PolarPower) {
  const n = polar.size;
  const output = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      output[y * n + x] = Math.log1p(polar.power[((y + n / 2) % n) * n + ((x + n / 2) % n)]);
    }
  }
  return output;
}
