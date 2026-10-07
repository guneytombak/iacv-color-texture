import assert from "node:assert/strict";
import test from "node:test";
import { detectFlaws, eigenResponses, energyMaps, maskCovariance, sparseOffsets, symmetricEigen } from "../app/demos/_lib/eigen.ts";

const close = (actual, expected, tolerance, label = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≠ ${expected} (±${tolerance})`);

function check(matrix) {
  const { values, vectors } = symmetricEigen(matrix);
  const n = matrix.length;
  for (let k = 0; k < n; k += 1) {
    // A v = λ v
    for (let i = 0; i < n; i += 1) close(matrix[i].reduce((sum, value, j) => sum + value * vectors[k][j], 0), values[k] * vectors[k][i], 1e-9, `Av=λv ${k},${i}`);
    // orthonormal
    for (let l = 0; l < n; l += 1) close(vectors[k].reduce((sum, value, i) => sum + value * vectors[l][i], 0), k === l ? 1 : 0, 1e-10, `VᵀV ${k},${l}`);
    if (k) assert.ok(values[k] <= values[k - 1] + 1e-12, "descending");
  }
  return { values, vectors };
}

test("symmetric eigen-decomposition: known 2×2 and 3×3 spectra, random 9×9 identities", () => {
  close(check([[2, 1], [1, 2]]).values[0], 3, 1e-12);
  const { values } = check([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]);
  [2 + Math.SQRT2, 2, 2 - Math.SQRT2].forEach((expected, index) => close(values[index], expected, 1e-12, `λ${index}`));
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const b = Array.from({ length: 9 }, () => Array.from({ length: 9 }, random));
  const spd = b.map((row, i) => b.map((_, j) => b.reduce((sum, r) => sum + r[i] * r[j], 0)));
  const result = check(spd);
  const trace = spd.reduce((sum, row, i) => sum + row[i], 0);
  close(result.values.reduce((sum, value) => sum + value, 0), trace, 1e-10, "trace");
  for (const vector of result.vectors) {
    const largest = vector.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
    assert.ok(largest > 0, "sign convention");
  }
});

test("the sparse mask has 9 taps spanning (2dy+1) rows by (2dx+1) columns", () => {
  const offsets = sparseOffsets(8, 6);
  assert.equal(offsets.length, 9);
  assert.deepEqual(offsets[0], { x: -8, y: -6 });
  assert.deepEqual(offsets[4], { x: 0, y: 0 });
  assert.deepEqual(offsets[8], { x: 8, y: 6 });
});

test("mask covariance matches a direct computation and its trace is the total variance", () => {
  const size = 24;
  const values = Float64Array.from({ length: size * size }, (_, index) => Math.sin(index * 0.37) * 40 + (index % 11));
  const offsets = sparseOffsets(2, 3);
  const rect = { x0: 0, y0: 0, x1: size, y1: 15 };
  const { mean, covariance, count } = maskCovariance(values, size, offsets, rect);
  const samples = [];
  for (let y = 3; y < 15; y += 1) for (let x = 2; x < size - 2; x += 1) samples.push(offsets.map((o) => values[(y + o.y) * size + x + o.x]));
  assert.equal(count, samples.length);
  for (const [i, j] of [[0, 0], [2, 7], [8, 4]]) {
    const mi = samples.reduce((s, v) => s + v[i], 0) / samples.length;
    const mj = samples.reduce((s, v) => s + v[j], 0) / samples.length;
    close(mean[i], mi, 1e-9);
    close(covariance[i][j], samples.reduce((s, v) => s + (v[i] - mi) * (v[j] - mj), 0) / samples.length, 1e-8, `C${i}${j}`);
    close(covariance[i][j], covariance[j][i], 1e-12);
  }
});

test("responses are projections of the centred mask vector onto each eigenvector", () => {
  const size = 16;
  const values = Float64Array.from({ length: size * size }, (_, index) => (index * 13) % 29);
  const offsets = sparseOffsets(1, 2);
  const { mean, covariance } = maskCovariance(values, size, offsets, { x0: 0, y0: 0, x1: size, y1: size });
  const { vectors } = symmetricEigen(covariance);
  const responses = eigenResponses(values, size, offsets, mean, vectors);
  const [x, y] = [7, 9];
  const sample = offsets.map((o, k) => values[(y + o.y) * size + x + o.x] - mean[k]);
  vectors.forEach((vector, index) => close(responses[index][y * size + x], vector.reduce((sum, value, k) => sum + value * sample[k], 0), 1e-9, `#${index}`));
});

test("a region whose texture differs from training is flagged; the training texture is not", () => {
  const size = 64;
  // Periodic texture (period 8 in x and y), with a smooth (blurred-looking) patch at the bottom.
  const values = Float64Array.from({ length: size * size }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    const inPatch = y >= 44 && y < 54 && x >= 16 && x < 48;
    return inPatch ? 128 : 128 + 60 * Math.sin((2 * Math.PI * x) / 8) * Math.cos((2 * Math.PI * y) / 8);
  });
  const offsets = sparseOffsets(2, 2);
  const training = { x0: 0, y0: 0, x1: size, y1: 32 };
  const { mean, covariance } = maskCovariance(values, size, offsets, training);
  const { vectors } = symmetricEigen(covariance);
  const energies = energyMaps(eigenResponses(values, size, offsets, mean, vectors), size, 3);
  const { flags } = detectFlaws(energies, size, [0, 1, 2], training, 6, 0.1);
  assert.equal(flags[49 * size + 32], 1, "patch centre flagged");
  let falseAlarms = 0;
  for (let y = 6; y < 38; y += 1) for (let x = 6; x < size - 6; x += 1) falseAlarms += flags[y * size + x] === 1 ? 1 : 0;
  assert.equal(falseAlarms, 0, "no false alarms in clean texture");
  assert.equal(flags[0], 2, "border not evaluated");
});
