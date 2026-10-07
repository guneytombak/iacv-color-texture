import assert from "node:assert/strict";
import test from "node:test";
import {
  LAWS_VECTORS,
  boxMean,
  lawsBank,
  lawsFeatures,
  lawsMask,
  lawsResponse,
  logEnergies,
  mirrorIndex,
  removeLocalMean,
  vectorMagnitude,
} from "../app/demos/_lib/laws.ts";

const close = (actual, expected, tolerance, label = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≠ ${expected} (±${tolerance})`);

test("the 1D vectors match the lecture table; only the level vectors have a nonzero sum", () => {
  assert.deepEqual(LAWS_VECTORS.L5, [1, 4, 6, 4, 1]);
  assert.deepEqual(LAWS_VECTORS.E5, [-1, -2, 0, 2, 1]);
  assert.deepEqual(LAWS_VECTORS.S5, [-1, 0, 2, 0, -1]);
  assert.deepEqual(LAWS_VECTORS.W5, [-1, 2, 0, -2, 1]);
  assert.deepEqual(LAWS_VECTORS.R5, [1, -4, 6, -4, 1]);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  assert.equal(sum(LAWS_VECTORS.L5), 16);
  assert.equal(sum(LAWS_VECTORS.L3), 4);
  for (const name of ["E3", "S3", "E5", "S5", "W5", "R5"]) assert.equal(sum(LAWS_VECTORS[name]), 0, name);
  assert.equal(lawsBank("5").length, 25);
  assert.equal(lawsBank("3").length, 9);
  assert.deepEqual(lawsMask("E5", "L5").slice(0, 5), [-1, -4, -6, -4, -1]);
});

test("separable filtering equals direct 2D correlation with the outer-product mask (mirrored borders)", () => {
  const size = 12;
  const values = Float64Array.from({ length: size * size }, (_, index) => ((index * 37) % 23) - 7);
  for (const [vertical, horizontal] of [["E5", "L5"], ["S5", "W5"], ["R5", "E5"], ["S3", "E3"]]) {
    const mask = lawsMask(vertical, horizontal);
    const n = LAWS_VECTORS[vertical].length;
    const half = (n - 1) / 2;
    const separable = lawsResponse(values, size, vertical, horizontal);
    for (const [x, y] of [[0, 0], [5, 6], [11, 3], [2, 11]]) {
      let direct = 0;
      for (let dy = -half; dy <= half; dy += 1) {
        for (let dx = -half; dx <= half; dx += 1) {
          direct += mask[(dy + half) * n + (dx + half)] * values[mirrorIndex(y + dy, size) * size + mirrorIndex(x + dx, size)];
        }
      }
      close(separable[y * size + x], direct, 1e-9, `${vertical}${horizontal} at ${x},${y}`);
    }
  }
});

test("E5L5 (E5 vertical) responds to horizontal stripes and L5E5 does not", () => {
  const size = 32;
  const stripes = Float64Array.from({ length: size * size }, (_, index) => 100 * Math.sin((2 * Math.PI * Math.floor(index / size)) / 8));
  const energy = (response) => response.reduce((sum, value) => sum + value * value, 0);
  assert.ok(energy(lawsResponse(stripes, size, "E5", "L5")) > 1e6);
  close(energy(lawsResponse(stripes, size, "L5", "E5")), 0, 1e-12, "L5E5");
});

test("local mean removal and zero-sum masks ignore brightness", () => {
  const size = 16;
  const constant = new Float64Array(size * size).fill(173);
  close(Math.max(...boxMean(constant, size, 3).map((value) => Math.abs(value - 173))), 0, 1e-9, "box mean");
  close(Math.max(...removeLocalMean(constant, size).map(Math.abs)), 0, 1e-9, "mean removal");
  for (const filter of lawsBank("5").filter((f) => f.name !== "L5L5")) {
    close(Math.max(...lawsResponse(constant, size, filter.vertical, filter.horizontal).map(Math.abs)), 0, 1e-9, filter.name);
  }
});

test("energy features: halves average to the whole, and L5L5 normalization zeroes its own entry", () => {
  const size = 32;
  const values = Float64Array.from({ length: size * size }, (_, index) => Math.sin(index / 3) * 50 + (index % 7));
  const bank = lawsBank("5");
  const { whole, left, right } = lawsFeatures(values, size, bank);
  whole.forEach((value, index) => close(value, (left[index] + right[index]) / 2, 1e-9 * value, bank[index].name));
  const normalized = logEnergies(whole, bank, true);
  assert.equal(normalized[0], 0);
  close(normalized[1], Math.log10(whole[1] / whole[0]), 1e-12);
});

test("the 1D vectors are low-pass (L5) through high-pass (R5)", () => {
  close(vectorMagnitude("L5", 0), 16, 1e-12);
  close(vectorMagnitude("L5", 0.5), 0, 1e-12);
  close(vectorMagnitude("R5", 0.5), 16, 1e-12);
  close(vectorMagnitude("E5", 0), 0, 1e-12);
  const peak = (name) => {
    let best = 0;
    for (let k = 1; k <= 100; k += 1) if (vectorMagnitude(name, k / 200) > vectorMagnitude(name, best / 200)) best = k;
    return best / 200;
  };
  const peaks = ["L5", "E5", "S5", "W5", "R5"].map(peak);
  for (let index = 1; index < peaks.length; index += 1) assert.ok(peaks[index] > peaks[index - 1], `${peaks}`);
});

test("the running-sum box mean equals a direct windowed average with mirrored borders", () => {
  const size = 20;
  const values = Float64Array.from({ length: size * size }, (_, index) => Math.sin(index * 0.7) * 30 + (index % 9));
  for (const radius of [1, 4, 9]) {
    const fast = boxMean(values, size, radius);
    for (const [x, y] of [[0, 0], [10, 3], [19, 19], [5, 17]]) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) sum += values[mirrorIndex(y + dy, size) * size + mirrorIndex(x + dx, size)];
      close(fast[y * size + x], sum / (2 * radius + 1) ** 2, 1e-9, `r=${radius} at ${x},${y}`);
    }
  }
});
