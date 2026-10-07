import assert from "node:assert/strict";
import test from "node:test";
import { autocorrelation, correlationLengths, meanFrequency, regularity, spectralOrientation } from "../app/demos/_lib/characteristics.ts";
import { polarPower, windowedSpectrum } from "../app/demos/_lib/spectrum.ts";

const close = (actual, expected, tolerance, label = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≠ ${expected} (±${tolerance})`);
const SIZE = 128;

function grating(frequency, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const fu = frequency * Math.cos(radians);
  const fv = frequency * Math.sin(radians);
  return Float64Array.from({ length: SIZE * SIZE }, (_, index) => 128 + 80 * Math.cos(2 * Math.PI * (fu * (index % SIZE) + fv * Math.floor(index / SIZE))));
}

function noise(seed = 11) {
  let state = seed;
  return Float64Array.from({ length: SIZE * SIZE }, () => {
    state = (state * 16807) % 2147483647;
    return (state / 2147483647) * 255;
  });
}

test("a grating is fully oriented along its frequency vector; white noise is nearly isotropic", () => {
  for (const degrees of [0, 30, 120]) {
    const { anisotropy, angle } = spectralOrientation(polarPower(windowedSpectrum(grating(0.125, degrees), SIZE).spectrum));
    assert.ok(anisotropy > 0.95, `A=${anisotropy}`);
    close(angle, degrees, 1, "dominant direction");
  }
  const random = spectralOrientation(polarPower(windowedSpectrum(noise(), SIZE).spectrum));
  assert.ok(random.anisotropy < 0.05, `noise A=${random.anisotropy}`);
});

test("mean frequency of a grating is its frequency", () => {
  close(meanFrequency(polarPower(windowedSpectrum(grating(0.125, 0), SIZE).spectrum)), 0.125, 0.01);
});

test("autocorrelation is 1 at zero lag, symmetric, and peaks at the grating period", () => {
  const ac = autocorrelation(grating(1 / 16, 0), SIZE, 40);
  const span = 81;
  const at = (x, y) => ac.values[(y + 40) * span + (x + 40)];
  close(at(0, 0), 1, 1e-9, "R(0)");
  close(at(7, -3), at(-7, 3), 1e-9, "R(τ) = R(−τ)");
  close(at(16, 0), 1, 1e-6, "one period");
  close(at(8, 0), -1, 1e-6, "half period");
  const result = regularity(ac);
  assert.ok(result.index > 0.99, `ρ=${result.index}`);
  // Vertical stripes repeat at every shift along y, so the shortest perfect repetition is (0, τy) or (±16k, ·).
  assert.equal(Math.abs(result.peak.x) % 16, 0);
  // A two-dimensional lattice has a unique shortest period vector.
  const lattice = Float64Array.from({ length: 128 * 128 }, (_, index) => 128 + 40 * Math.cos((2 * Math.PI * (index % 128)) / 16) + 40 * Math.cos((2 * Math.PI * Math.floor(index / 128)) / 12));
  const latticeResult = regularity(autocorrelation(lattice, 128, 40));
  assert.ok(latticeResult.index > 0.95, `lattice ρ=${latticeResult.index}`);
  assert.deepEqual(latticeResult.peak, { x: 0, y: 12 });
});

test("decorrelation distance of a grating follows the first zero of J₀", () => {
  // Ring average of cos(2π f r cos φ) over φ is J₀(2π f r); its first zero is at 2π f r = 2.4048.
  const frequency = 1 / 20;
  const { zero } = correlationLengths(autocorrelation(grating(frequency, 35), SIZE, 40));
  close(zero, 2.4048 / (2 * Math.PI * frequency), 0.6, "r₀");
});

test("white noise decorrelates immediately and shows no regular repetition", () => {
  const ac = autocorrelation(noise(5), SIZE, 32);
  const { half, zero } = correlationLengths(ac);
  // R̄(r) of white noise fluctuates around 0 with a sampling error of about 1/N, so it crosses 0 within a few pixels.
  assert.ok(half < 1 && zero < 5, `r½=${half} r₀=${zero}`);
  assert.ok(regularity(ac).index < 0.1, `ρ=${regularity(ac).index}`);
});
