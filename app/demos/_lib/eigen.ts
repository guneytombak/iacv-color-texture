// Eigenfilters (Ade 1983; Lecture 4, slides 71–86).
// A sparse mask samples the image at a 3 × 3 grid of taps with spacing (dx, dy). Every pixel
// position yields a 9-vector; PCA of those vectors over a defect-free training region gives
// eigenvectors, which, laid back onto the mask, are the eigenfilters. Images are size × size,
// row-major, y downward.

import { boxMean, mirrorIndex } from "./laws.ts";

export type Offset = { x: number; y: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Tap offsets in row-major order: (−dy, −dx), (−dy, 0), (−dy, dx), (0, −dx), … */
export function sparseOffsets(dx: number, dy: number): Offset[] {
  return [-dy, 0, dy].flatMap((y) => [-dx, 0, dx].map((x) => ({ x, y })));
}

/**
 * Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations. Returns eigenvalues in
 * descending order and unit eigenvectors; each vector's largest-magnitude entry is made positive so
 * that the (arbitrary) sign is deterministic.
 */
export function symmetricEigen(input: number[][]) {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] ** 2;
    if (off < 1e-22 * Math.max(1, a.reduce((sum, row, i) => sum + row[i] ** 2, 0))) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => {
      const vector = v.map((row) => row[i]);
      const largest = vector.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
      return largest < 0 ? vector.map((value) => -value) : vector;
    }),
  };
}

/** Pixels whose every tap lies inside the image and whose centre lies inside `rect` (x1, y1 exclusive). */
function forEachValid(size: number, offsets: Offset[], rect: Rect, visit: (x: number, y: number) => void) {
  const reachX = Math.max(...offsets.map((offset) => Math.abs(offset.x)));
  const reachY = Math.max(...offsets.map((offset) => Math.abs(offset.y)));
  for (let y = Math.max(rect.y0, reachY); y < Math.min(rect.y1, size - reachY); y += 1) {
    for (let x = Math.max(rect.x0, reachX); x < Math.min(rect.x1, size - reachX); x += 1) visit(x, y);
  }
}

/** Mean vector and covariance (1/N normalization) of the mask vectors inside the training rectangle. */
export function maskCovariance(values: Float64Array, size: number, offsets: Offset[], rect: Rect) {
  const n = offsets.length;
  const mean = new Array(n).fill(0);
  const second = Array.from({ length: n }, () => new Array(n).fill(0));
  let count = 0;
  const sample = new Array(n);
  forEachValid(size, offsets, rect, (x, y) => {
    for (let k = 0; k < n; k += 1) sample[k] = values[(y + offsets[k].y) * size + (x + offsets[k].x)];
    for (let i = 0; i < n; i += 1) {
      mean[i] += sample[i];
      for (let j = i; j < n; j += 1) second[i][j] += sample[i] * sample[j];
    }
    count += 1;
  });
  if (!count) return { mean, covariance: second, count };
  for (let i = 0; i < n; i += 1) mean[i] /= count;
  const covariance = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    const [a, b] = i <= j ? [i, j] : [j, i];
    return second[a][b] / count - mean[a] * mean[b];
  }));
  return { mean, covariance, count };
}

/** Response of eigenfilter k at every pixel: e_kᵀ (v(x, y) − μ), with mirrored borders. */
export function eigenResponses(values: Float64Array, size: number, offsets: Offset[], mean: number[], vectors: number[][]) {
  const responses = vectors.map(() => new Float64Array(size * size));
  const sample = new Float64Array(offsets.length);
  // Mirrored source column and row of every tap, precomputed once.
  const columns = offsets.map((offset) => Int32Array.from({ length: size }, (_, x) => mirrorIndex(x + offset.x, size)));
  const rows = offsets.map((offset) => Int32Array.from({ length: size }, (_, y) => mirrorIndex(y + offset.y, size) * size));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (let k = 0; k < offsets.length; k += 1) sample[k] = values[rows[k][y] + columns[k][x]] - mean[k];
      vectors.forEach((vector, index) => {
        let sum = 0;
        for (let k = 0; k < vector.length; k += 1) sum += vector[k] * sample[k];
        responses[index][y * size + x] = sum;
      });
    }
  }
  return responses;
}

export function energyMaps(responses: Float64Array[], size: number, radius: number) {
  return responses.map((response) => boxMean(Float64Array.from(response, (value) => value * value), size, radius));
}

/**
 * Flags pixels whose energy, for any selected filter, lies outside the range observed in the
 * training rectangle (its central `coverage` fraction), widened by `margin` (a fraction of that range). Pixels within `border` of the
 * image edge are not evaluated (flag value 2), because mirrored borders distort the energies there.
 */
export function detectFlaws(energies: Float64Array[], size: number, selected: number[], training: Rect, border: number, margin: number, coverage = 1) {
  const inner: Rect = { x0: Math.max(training.x0, border), y0: Math.max(training.y0, border), x1: Math.min(training.x1, size - border), y1: Math.min(training.y1, size - border) };
  const ranges = selected.map((index) => {
    if (coverage >= 1) {
      let low = Infinity;
      let high = -Infinity;
      for (let y = inner.y0; y < inner.y1; y += 1) {
        for (let x = inner.x0; x < inner.x1; x += 1) {
          const value = energies[index][y * size + x];
          if (value < low) low = value;
          if (value > high) high = value;
        }
      }
      const pad = margin * (high - low);
      return { index, low: low - pad, high: high + pad };
    }
    const values: number[] = [];
    for (let y = inner.y0; y < inner.y1; y += 1) {
      for (let x = inner.x0; x < inner.x1; x += 1) values.push(energies[index][y * size + x]);
    }
    if (!values.length) return { index, low: NaN, high: NaN };
    values.sort((a, b) => a - b);
    // The central `coverage` fraction of the training energies; coverage = 1 is the full [min, max] range.
    const tail = (1 - coverage) / 2;
    const low = values[Math.floor(tail * (values.length - 1))];
    const high = values[Math.ceil((1 - tail) * (values.length - 1))];
    const pad = margin * (high - low);
    return { index, low: low - pad, high: high + pad };
  });
  const flags = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const position = y * size + x;
      if (x < border || y < border || x >= size - border || y >= size - border) {
        flags[position] = 2;
        continue;
      }
      if (ranges.some((range) => Number.isFinite(range.low) && (energies[range.index][position] < range.low || energies[range.index][position] > range.high))) flags[position] = 1;
    }
  }
  return { flags, ranges };
}
