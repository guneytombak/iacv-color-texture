// Illustrative indices for the perceptual texture characteristics of Lecture 4 (slides 48–51):
// orientedness, coarseness and regularity. These are teaching measures with explicit formulas,
// not a standard named feature set (Tamura et al., 1978, is the classical one).
// Image conventions: size × size, row-major, y downward; angles from +x toward +y.

import { fft2d } from "./fft.ts";
import type { PolarPower } from "./spectrum.ts";

/**
 * Spectral anisotropy A = |Σ P(u,v) e^{i2θ}| / Σ P(u,v) ∈ [0, 1] and the dominant direction of the
 * frequency vector, ½·arg Σ P e^{i2θ} (stripes run perpendicular to it). Doubling the angle makes
 * θ and θ + 180° count as the same orientation.
 */
export function spectralOrientation(polar: PolarPower) {
  let c = 0;
  let s = 0;
  for (let index = 1; index < polar.power.length; index += 1) {
    const doubled = (2 * polar.angle[index] * Math.PI) / 180;
    c += polar.power[index] * Math.cos(doubled);
    s += polar.power[index] * Math.sin(doubled);
  }
  const anisotropy = polar.total > 0 ? Math.hypot(c, s) / polar.total : 0;
  const angle = ((((Math.atan2(s, c) * 90) / Math.PI) % 180) + 180) % 180;
  return { anisotropy, angle };
}

/** Power-weighted mean radial frequency f̄ = Σ P r / Σ P (cycles/pixel); λ̄ = 1/f̄ is a characteristic wavelength. */
export function meanFrequency(polar: PolarPower) {
  let sum = 0;
  for (let index = 1; index < polar.power.length; index += 1) sum += polar.power[index] * polar.radius[index];
  return polar.total > 0 ? sum / polar.total : 0;
}

/**
 * Normalized autocorrelation of the mean-removed image for lags |τx|, |τy| ≤ maxLag, computed by the
 * Wiener–Khinchin theorem on a zero-padded grid (no wrap-around) and divided by the number of
 * overlapping pixel pairs (N − |τx|)(N − |τy|), so R(0) = 1 and distant lags are not biased toward 0.
 * Output index (τy + L)(2L + 1) + (τx + L).
 */
export function autocorrelation(values: Float64Array, size: number, maxLag: number) {
  const n = 2 * size;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const field = { re: new Float64Array(n * n), im: new Float64Array(n * n), size: n };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) field.re[y * n + x] = values[y * size + x] - mean;
  fft2d(field);
  for (let index = 0; index < n * n; index += 1) {
    field.re[index] = field.re[index] ** 2 + field.im[index] ** 2;
    field.im[index] = 0;
  }
  fft2d(field, true);
  const span = 2 * maxLag + 1;
  const output = new Float64Array(span * span);
  const zero = field.re[0] / (size * size);
  for (let ty = -maxLag; ty <= maxLag; ty += 1) {
    for (let tx = -maxLag; tx <= maxLag; tx += 1) {
      const raw = field.re[((ty + n) % n) * n + ((tx + n) % n)];
      const overlap = (size - Math.abs(tx)) * (size - Math.abs(ty));
      output[(ty + maxLag) * span + (tx + maxLag)] = zero > 0 ? raw / overlap / zero : 0;
    }
  }
  return { values: output, maxLag };
}

/**
 * Regularity: the largest autocorrelation outside the central lobe. The lobe radius r₀ is the first
 * lag radius at which the ring-averaged autocorrelation falls to 0 (at least 2). The location of that
 * peak is the dominant repetition (period) vector. If the texture stays correlated at every lag up to
 * maxLag, no repetition is identifiable and the index is 0.
 */
export function regularity(ac: { values: Float64Array; maxLag: number }) {
  const { values, maxLag } = ac;
  const span = 2 * maxLag + 1;
  const ringSum = new Float64Array(maxLag + 2);
  const ringCount = new Float64Array(maxLag + 2);
  for (let ty = -maxLag; ty <= maxLag; ty += 1) {
    for (let tx = -maxLag; tx <= maxLag; tx += 1) {
      const radius = Math.round(Math.hypot(tx, ty));
      if (radius > maxLag) continue;
      ringSum[radius] += values[(ty + maxLag) * span + (tx + maxLag)];
      ringCount[radius] += 1;
    }
  }
  let lobe = -1;
  for (let radius = 1; radius <= maxLag; radius += 1) {
    if (ringSum[radius] / ringCount[radius] <= 0) {
      lobe = radius;
      break;
    }
  }
  // Still correlated at every lag considered: no repetition can be identified within maxLag.
  if (lobe < 0) return { index: 0, peak: null, lobeRadius: null };
  lobe = Math.max(2, lobe);
  let best = -Infinity;
  let peak = { x: 0, y: 0 };
  for (let ty = -maxLag; ty <= maxLag; ty += 1) {
    for (let tx = -maxLag; tx <= maxLag; tx += 1) {
      const radius = Math.hypot(tx, ty);
      if (radius < lobe || radius > maxLag) continue;
      best = Math.max(best, values[(ty + maxLag) * span + (tx + maxLag)]);
    }
  }
  // Report the shortest lag that reaches (within 0.01) the maximum: a texture constant along one
  // direction repeats at every shift along it. Of each ± pair, R(τ) = R(−τ), keep ty > 0 (or ty = 0, tx > 0).
  let shortest = Infinity;
  for (let ty = 0; ty <= maxLag; ty += 1) {
    for (let tx = -maxLag; tx <= maxLag; tx += 1) {
      if (ty === 0 && tx <= 0) continue;
      const radius = Math.hypot(tx, ty);
      if (radius < lobe || radius > maxLag) continue;
      if (values[(ty + maxLag) * span + (tx + maxLag)] >= best - 0.01 && radius < shortest) {
        shortest = radius;
        peak = { x: tx, y: ty };
      }
    }
  }
  return { index: Math.max(0, best), peak, lobeRadius: lobe };
}

/** Ring-averaged autocorrelation R̄(r) for integer radii 0 … maxLag. */
export function radialAutocorrelation(ac: { values: Float64Array; maxLag: number }) {
  const { values, maxLag } = ac;
  const span = 2 * maxLag + 1;
  const sum = new Float64Array(maxLag + 1);
  const count = new Float64Array(maxLag + 1);
  for (let ty = -maxLag; ty <= maxLag; ty += 1) {
    for (let tx = -maxLag; tx <= maxLag; tx += 1) {
      const radius = Math.round(Math.hypot(tx, ty));
      if (radius > maxLag) continue;
      sum[radius] += values[(ty + maxLag) * span + (tx + maxLag)];
      count[radius] += 1;
    }
  }
  return sum.map((value, radius) => value / count[radius]);
}

/**
 * Two correlation lengths from the ring-averaged autocorrelation R̄(r), linearly interpolated (pixels):
 * r½, where R̄ first falls to ½, reflects the finest dominant structure; r₀, where R̄ first reaches 0,
 * is the decorrelation distance used here as the coarseness index, because it grows with the size of
 * the largest coherent primitives. Either is null when not reached within maxLag.
 */
export function correlationLengths(ac: { values: Float64Array; maxLag: number }) {
  const profile = radialAutocorrelation(ac);
  const crossing = (level: number) => {
    for (let radius = 1; radius < profile.length; radius += 1) {
      if (profile[radius] <= level) return radius - 1 + (profile[radius - 1] - level) / (profile[radius - 1] - profile[radius]);
    }
    return null;
  };
  return { half: crossing(0.5), zero: crossing(0), profile };
}
