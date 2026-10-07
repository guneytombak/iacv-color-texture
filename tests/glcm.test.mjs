import assert from "node:assert/strict";
import test from "node:test";
import {
  clientToImagePoint,
  computeMatrix,
  grayHistogram,
  independenceMatrix,
  matrixFeatures,
  mutualInformation,
  shuffledImage,
  constrainDisplacement,
  nudgeDisplacement,
  validPairCount,
} from "../app/demos/_lib/glcm.ts";

const close = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

// Haralick, Shanmugam and Dinstein (1973), Fig. 2: a 4×4 image with gray levels 0…3.
// Levels are stored as 8-bit values 0, 64, 128, 192 so that 4-bin quantization recovers them.
const HARALICK_LEVELS = [
  0, 0, 1, 1,
  0, 0, 1, 1,
  0, 2, 2, 2,
  2, 2, 3, 3,
];
const haralick = { gray: Uint8ClampedArray.from(HARALICK_LEVELS, (level) => level * 64), width: 4, height: 4, name: "haralick" };

function counts(result, levels) {
  return Array.from({ length: levels }, (_, i) => Array.from({ length: levels }, (_, j) => Math.round(result.probabilities[i * levels + j] * result.pairs)));
}

function randomImage(width, height, seed = 7) {
  let state = seed;
  const gray = new Uint8ClampedArray(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    gray[index] = state % 256;
  }
  return { gray, width, height, name: "random" };
}

test("reproduces the textbook ordered and symmetric horizontal co-occurrence counts", () => {
  const ordered = computeMatrix(haralick, { vx: 1, vy: 0 }, 4, false, 135, 1.5);
  assert.equal(ordered.pairs, 12);
  assert.deepEqual(counts(ordered, 4), [
    [2, 2, 1, 0],
    [0, 2, 0, 0],
    [0, 0, 3, 1],
    [0, 0, 0, 1],
  ]);
  const symmetric = computeMatrix(haralick, { vx: 1, vy: 0 }, 4, true, 135, 1.5);
  assert.equal(symmetric.pairs, 24);
  assert.deepEqual(counts(symmetric, 4), [
    [4, 2, 1, 0],
    [2, 4, 0, 0],
    [1, 0, 6, 1],
    [0, 0, 1, 2],
  ]);
});

test("computes the five features from the normalized matrix", () => {
  const result = computeMatrix(haralick, { vx: 1, vy: 0 }, 4, false, 135, 1.5);
  // Nonzero counts over 12 pairs: 2,2,1 | 2 | 3,1 | 1 at (i,j) = (0,0),(0,1),(0,2),(1,1),(2,2),(2,3),(3,3).
  close(result.energy, (4 + 4 + 1 + 4 + 9 + 1 + 1) / 144);
  close(result.contrast, (1 * 2 + 4 * 1 + 1 * 1) / 12);
  close(result.homogeneity, (2 + 2 / 2 + 1 / 3 + 2 + 3 + 1 / 2 + 1) / 12);
  close(result.maximum, 3 / 12);
  const entropy = -(3 * (2 / 12) * Math.log2(2 / 12) + 3 * (1 / 12) * Math.log2(1 / 12) + (3 / 12) * Math.log2(3 / 12));
  close(result.entropy, entropy);
});

test("counts exactly (W − |vx|)(H − |vy|) valid pairs, including the lecture's long vector", () => {
  const image = randomImage(160, 160);
  for (const vector of [{ vx: 1, vy: 0 }, { vx: -1, vy: 1 }, { vx: 52, vy: 30 }, { vx: -80, vy: -80 }, { vx: 0, vy: 7 }]) {
    const result = computeMatrix(image, vector, 16, false, 135, 1.5);
    assert.equal(result.pairs, validPairCount(160, 160, vector), JSON.stringify(vector));
    close(result.probabilities.reduce((sum, value) => sum + value, 0), 1, 1e-9);
    assert.ok(result.weightedScore >= 0 && result.weightedScore <= 1);
  }
});

test("reversing the displacement transposes the directional matrix; reverse pairs symmetrize it", () => {
  const image = randomImage(40, 30, 11);
  const levels = 8;
  const forward = computeMatrix(image, { vx: 3, vy: -2 }, levels, false, 135, 1.5);
  const backward = computeMatrix(image, { vx: -3, vy: 2 }, levels, false, 135, 1.5);
  const symmetric = computeMatrix(image, { vx: 3, vy: -2 }, levels, true, 135, 1.5);
  assert.equal(symmetric.pairs, 2 * forward.pairs);
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < levels; j += 1) {
      close(forward.probabilities[i * levels + j], backward.probabilities[j * levels + i]);
      close(symmetric.probabilities[i * levels + j], symmetric.probabilities[j * levels + i]);
    }
  }
});

test("displacement editing excludes the zero vector and respects the component limit", () => {
  assert.equal(constrainDisplacement(0, 0, 80), null);
  assert.deepEqual(constrainDisplacement(120, -95, 80), { vx: 80, vy: -80 });
  assert.deepEqual(nudgeDisplacement({ vx: 1, vy: 0 }, -1, 0, 80), { vx: -1, vy: 0 });
  assert.deepEqual(nudgeDisplacement({ vx: 0, vy: 2 }, 0, -1, 80), { vx: 0, vy: 1 });
  assert.deepEqual(nudgeDisplacement({ vx: 80, vy: 3 }, 1, 0, 80), { vx: 80, vy: 3 });
});

test("maps pointer positions through object-fit: contain letterboxing", () => {
  // A 640×640 canvas shown in an 800×650 content box is drawn 650×650 and centered horizontally.
  const box = { left: 100, top: 20, width: 800, height: 650 };
  const topLeft = clientToImagePoint(175, 20, box, 640, 640, 160, 160);
  close(topLeft.x, 0);
  close(topLeft.y, 0);
  const center = clientToImagePoint(500, 345, box, 640, 640, 160, 160);
  close(center.x, 80);
  close(center.y, 80);
  close(center.cssPerPixel, 650 / 160);
});

test("shuffling keeps the histogram exactly and drives the GLCM toward p(i)·p(j)", () => {
  // A smooth texture with strong neighbor correlation.
  const size = 160;
  const gray = Uint8ClampedArray.from({ length: size * size }, (_, index) => 128 + 100 * Math.sin((index % size) / 6) * Math.cos(Math.floor(index / size) / 9));
  const image = { gray, width: size, height: size, name: "smooth" };
  const shuffled = shuffledImage(image, 7);
  const levels = 8;
  assert.deepEqual(Array.from(grayHistogram(shuffled, levels)), Array.from(grayHistogram(image, levels)));
  assert.deepEqual(Array.from(shuffled.gray).sort((a, b) => a - b), Array.from(gray).sort((a, b) => a - b));
  const independent = independenceMatrix(grayHistogram(image, levels));
  const original = computeMatrix(image, { vx: 1, vy: 0 }, levels, false, 135, 1.5);
  const permuted = computeMatrix(shuffled, { vx: 1, vy: 0 }, levels, false, 135, 1.5);
  const distance = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
  // Multinomial sampling noise alone gives an expected L1 distance of about 0.04 for 64 cells and ~25 000 pairs.
  assert.ok(distance(permuted.probabilities, independent) < 0.06, `shuffled ${distance(permuted.probabilities, independent)}`);
  assert.ok(distance(original.probabilities, independent) > 0.5, `original ${distance(original.probabilities, independent)}`);
  assert.ok(mutualInformation(original.probabilities, levels) > 1);
  assert.ok(mutualInformation(permuted.probabilities, levels) < 0.01);
});

test("mutual information is 0 for independence and equals the entropy for identical levels", () => {
  const histogram = Float64Array.from([0.1, 0.2, 0.3, 0.4]);
  close(mutualInformation(independenceMatrix(histogram), 4), 0, 1e-12);
  const diagonal = new Float64Array(16);
  histogram.forEach((value, index) => { diagonal[index * 4 + index] = value; });
  const entropy = -histogram.reduce((sum, value) => sum + value * Math.log2(value), 0);
  close(mutualInformation(diagonal, 4), entropy, 1e-12);
  const features = matrixFeatures(diagonal, 4, 135, 1.5, 0);
  close(features.contrast, 0, 1e-15);
  close(features.homogeneity, 1, 1e-12);
});
