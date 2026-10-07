import assert from "node:assert/strict";
import test from "node:test";
import { fft1d, fft2d } from "../app/demos/_lib/fft.ts";
import {
  bandEnergy,
  carrier,
  deltaForBandwidth,
  filterBank,
  filterResponse,
  frequencyPrecision,
  halfPowerRadius,
  kernelSpectrum,
  meanEnergy,
  octaveBandwidth,
  prepareImage,
  supportRadius,
  windowedSpectrum,
  complexTransfer,
} from "../app/demos/_lib/gabor.ts";

const close = (actual, expected, tolerance, label = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≠ ${expected} (±${tolerance})`);

test("FFT matches the direct DFT F[k] = Σ f[n] e^{−2πikn/N} and inverts exactly", () => {
  const n = 16;
  const re = Float64Array.from({ length: n }, (_, index) => Math.sin(index * 1.7) + index / 5);
  const im = Float64Array.from({ length: n }, (_, index) => Math.cos(index * 0.3));
  const outRe = Float64Array.from(re);
  const outIm = Float64Array.from(im);
  fft1d(outRe, outIm);
  for (let k = 0; k < n; k += 1) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t += 1) {
      const angle = (-2 * Math.PI * k * t) / n;
      sumRe += re[t] * Math.cos(angle) - im[t] * Math.sin(angle);
      sumIm += re[t] * Math.sin(angle) + im[t] * Math.cos(angle);
    }
    close(outRe[k], sumRe, 1e-9, `re[${k}]`);
    close(outIm[k], sumIm, 1e-9, `im[${k}]`);
  }
  const field = { re: Float64Array.from({ length: 64 }, (_, index) => (index * 37) % 11), im: new Float64Array(64), size: 8 };
  const original = Float64Array.from(field.re);
  fft2d(field);
  fft2d(field, true);
  original.forEach((value, index) => close(field.re[index], value, 1e-9, `round trip ${index}`));
});

test("states the uncertainty product in both frequency units", () => {
  for (const delta of [0.8, 2, 7.5]) {
    close(delta * frequencyPrecision(delta), 1 / (4 * Math.PI), 1e-15, "cycles/pixel");
    close(delta * 2 * Math.PI * frequencyPrecision(delta), 0.5, 1e-15, "rad/pixel");
  }
});

test("the half-power radius of the sampled filter matches √(2 ln 2)·Δu", () => {
  // Direct DTFT of the separable 1D factor, normalized to 1 at the carrier.
  const delta = 4;
  const frequency = 0.125;
  const radius = supportRadius(delta);
  const gain = (u) => {
    let re = 0;
    let im = 0;
    let sum = 0;
    for (let t = -radius; t <= radius; t += 1) {
      const envelope = Math.exp(-(t * t) / (4 * delta * delta));
      re += envelope * Math.cos(2 * Math.PI * (frequency - u) * t);
      im += envelope * Math.sin(2 * Math.PI * (frequency - u) * t);
      sum += envelope;
    }
    return (re * re + im * im) / (sum * sum);
  };
  close(gain(frequency), 1, 1e-12, "carrier gain");
  close(gain(frequency + halfPowerRadius(delta)), 0.5, 5e-4, "half power");
});

test("bandwidth in octaves and the automatic precision are inverse to each other", () => {
  for (const frequency of [0.05, 0.2, 0.4]) {
    for (const octaves of [0.5, 1, 1.5]) close(octaveBandwidth(frequency, deltaForBandwidth(frequency, octaves)), octaves, 1e-12);
  }
  // One octave: the half-power circle spans f·(2/3) … f·(4/3).
  close(halfPowerRadius(deltaForBandwidth(0.3, 1)), 0.1, 1e-12);
  assert.equal(octaveBandwidth(0.01, 2), Infinity);
});

test("the spectrum peaks at the carrier and the even filter's DC leak grows as f falls", () => {
  const params = { frequency: 0.25, orientation: 30, delta: 3, phase: 0 };
  const { magnitude, size } = kernelSpectrum(params, 128);
  let best = 0;
  for (let index = 1; index < magnitude.length; index += 1) if (magnitude[index] > magnitude[best]) best = index;
  const u = ((best % size) - size / 2) / size;
  const v = (Math.floor(best / size) - size / 2) / size;
  const { fu, fv } = carrier(params);
  // Either lobe of the conjugate pair; v grows downward like the image row index.
  assert.ok(Math.hypot(Math.abs(u) - Math.abs(fu), Math.abs(v) - Math.abs(fv)) <= 1 / size && Math.sign(u * v) === Math.sign(fu * fv), `peak at (${u}, ${v})`);
  const high = kernelSpectrum({ ...params, frequency: 0.3 }).dcRatio;
  const low = kernelSpectrum({ ...params, frequency: 0.05 }).dcRatio;
  assert.ok(high < 1e-3 && low > 0.2, `${high} ${low}`);
});

test("the impulse response is the normalized complex kernel (convolution, y downward)", () => {
  const size = 64;
  const image = new Float64Array(size * size);
  image[32 * size + 32] = 1;
  const params = { frequency: 0.15, orientation: 60, delta: 2.5, phase: 0 };
  const response = filterResponse(prepareImage(image, size, false), params);
  const { fu, fv } = carrier(params);
  let norm = 0;
  for (let t = -supportRadius(params.delta); t <= supportRadius(params.delta); t += 1) norm += Math.exp(-(t * t) / (4 * params.delta ** 2));
  norm *= norm;
  for (const [x, y] of [[0, 0], [1, 0], [0, 2], [-3, 1], [2, -2]]) {
    const envelope = Math.exp(-(x * x + y * y) / (4 * params.delta ** 2)) / norm;
    const phase = 2 * Math.PI * (fu * x + fv * y);
    const index = (32 + y) * size + (32 + x);
    close(response.re[index], envelope * Math.cos(phase), 1e-12, `re ${x},${y}`);
    close(response.im[index], envelope * Math.sin(phase), 1e-12, `im ${x},${y}`);
  }
});

test("a filter bank selects the orientation and scale of an oblique grating", () => {
  const size = 128;
  const grating = { frequency: 0.2, orientation: 60 };
  const { fu, fv } = carrier(grating);
  const image = Float64Array.from({ length: size * size }, (_, index) => 128 + 100 * Math.cos(2 * Math.PI * (fu * (index % size) + fv * Math.floor(index / size))));
  const prepared = prepareImage(image, size);
  const bank = filterBank({ maxFrequency: 0.4, scales: 3, orientations: 6, octaves: 1 });
  const energies = bank.map((filter) => meanEnergy(filterResponse(prepared, filter)));
  const winner = bank[energies.indexOf(Math.max(...energies))];
  assert.equal(winner.frequency, 0.2);
  assert.equal(winner.orientation, 60);
  // The mirror-image orientation (120°) must not respond equally: orientation is not folded.
  const mirror = energies[bank.findIndex((filter) => filter.frequency === 0.2 && filter.orientation === 120)];
  assert.ok(mirror < 0.05 * Math.max(...energies), `${mirror}`);
});

test("bank energies by Parseval equal the spatial energy of the windowed, circularly filtered image", () => {
  const size = 64;
  const values = Float64Array.from({ length: size * size }, (_, index) => ((index * 2654435761) % 997) / 4 + 30 * Math.sin(index / 7));
  const params = { frequency: 0.18, orientation: 25, delta: 2, phase: 0 };
  const windowed = windowedSpectrum(values, size);
  // Spatial route: inverse DFT of Î_w·H, then the window-normalized mean of |r|².
  const transfer = complexTransfer(params, size);
  const product = { re: new Float64Array(size * size), im: new Float64Array(size * size), size };
  for (let index = 0; index < size * size; index += 1) {
    product.re[index] = windowed.spectrum.re[index] * transfer.re[index] - windowed.spectrum.im[index] * transfer.im[index];
    product.im[index] = windowed.spectrum.re[index] * transfer.im[index] + windowed.spectrum.im[index] * transfer.re[index];
  }
  fft2d(product, true);
  let spatial = 0;
  for (let index = 0; index < size * size; index += 1) spatial += product.re[index] ** 2 + product.im[index] ** 2;
  spatial /= windowed.windowEnergy;
  close(bandEnergy(windowed, params), spatial, 1e-9 * spatial, "Parseval");
});

test("the frequency-domain bank energies select the grating's orientation and scale", () => {
  const size = 128;
  const { fu, fv } = carrier({ frequency: 0.2, orientation: 60 });
  const image = Float64Array.from({ length: size * size }, (_, index) => 128 + 100 * Math.cos(2 * Math.PI * (fu * (index % size) + fv * Math.floor(index / size))));
  const windowed = windowedSpectrum(image, size);
  const bank = filterBank({ maxFrequency: 0.4, scales: 3, orientations: 6, octaves: 1 });
  const energies = bank.map((filter) => bandEnergy(windowed, filter));
  const winner = bank[energies.indexOf(Math.max(...energies))];
  assert.equal(winner.frequency, 0.2);
  assert.equal(winner.orientation, 60);
  const mirror = energies[bank.findIndex((filter) => filter.frequency === 0.2 && filter.orientation === 120)];
  assert.ok(mirror < 0.05 * Math.max(...energies), `${mirror}`);
});
