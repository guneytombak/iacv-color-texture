// Gabor filters following Lecture 4 (slides 66–69):
//   g(x, y) = exp(−(x² + y²)/(4Δ²)) · cos(2π f (x cos θ + y sin θ) + ψ)
// Conventions used throughout this module:
// - x is the column index (right), y the row index (DOWN); θ is measured from +x toward +y,
//   so increasing θ turns clockwise on screen, as in image-array libraries and on slide 70.
// - f, u, v are ordinary spatial frequencies in cycles per pixel; Nyquist is 0.5.
// - Δ (= Δx,y) is the RMS width of the energy density |envelope|², in pixels.
// Continuous Fourier transform of g (ψ applied to the two lobes):
//   G(u, v) = 2πΔ² [e^{iψ} E(u − fu, v − fv) + e^{−iψ} E(u + fu, v + fv)],  E(a, b) = exp(−4π²Δ²(a² + b²))
// so the lobe width is Δu,v = 1/(4πΔ) cycles/pixel and Δx,y·Δu,v = 1/(4π); in angular frequency
// (ω = 2πu, rad/pixel) the same product is 1/2, the Gabor minimum of the uncertainty relation.

import { fft1d, fft2d } from "./fft.ts";
import type { Complex2D } from "./fft.ts";
import { windowedSpectrum } from "./spectrum.ts";

export { windowedSpectrum };

export type GaborParams = { frequency: number; orientation: number; delta: number; phase: number };
export type BankFilter = GaborParams & { scale: number; orientationIndex: number };
export type BankSpec = { maxFrequency: number; scales: number; orientations: number; octaves: number };

const SQRT_2_LN2 = Math.sqrt(2 * Math.LN2);

/** Δu,v in cycles/pixel for a spatial precision Δx,y in pixels. */
export function frequencyPrecision(delta: number) {
  return 1 / (4 * Math.PI * delta);
}

/** Radius (cycles/pixel) at which a lobe's power |G|² falls to half its peak: √(2 ln 2)·Δu,v. */
export function halfPowerRadius(delta: number) {
  return SQRT_2_LN2 * frequencyPrecision(delta);
}

/** Radial half-power bandwidth in octaves, log₂((f + r)/(f − r)); infinite once the lobe reaches zero frequency. */
export function octaveBandwidth(frequency: number, delta: number) {
  const radius = halfPowerRadius(delta);
  return radius < frequency ? Math.log2((frequency + radius) / (frequency - radius)) : Infinity;
}

/** The Δx,y that gives a lobe at `frequency` the requested half-power bandwidth in octaves. */
export function deltaForBandwidth(frequency: number, octaves: number) {
  const ratio = 2 ** octaves;
  const radius = (frequency * (ratio - 1)) / (ratio + 1);
  return SQRT_2_LN2 / (4 * Math.PI * radius);
}

/**
 * Half-width of the square kernel support: four standard deviations of the amplitude envelope (√2·Δ),
 * where the envelope has fallen to e^{−8} ≈ 3·10⁻⁴. Truncating at three deviations (1.1 %) already
 * shifts the measured half-power radius by about 1 %.
 */
export function supportRadius(delta: number) {
  return Math.ceil(4 * Math.SQRT2 * delta);
}

/** Carrier frequency vector (fu, fv) in image coordinates. */
export function carrier(params: Pick<GaborParams, "frequency" | "orientation">) {
  const radians = (params.orientation * Math.PI) / 180;
  return { fu: params.frequency * Math.cos(radians), fv: params.frequency * Math.sin(radians) };
}

/** The lecture's real kernel sampled on its square support; index (y + R)(2R + 1) + (x + R). */
export function realKernel(params: GaborParams) {
  const radius = supportRadius(params.delta);
  const size = 2 * radius + 1;
  const { fu, fv } = carrier(params);
  const psi = (params.phase * Math.PI) / 180;
  const values = new Float64Array(size * size);
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const envelope = Math.exp(-(x * x + y * y) / (4 * params.delta * params.delta));
      values[(y + radius) * size + (x + radius)] = envelope * Math.cos(2 * Math.PI * (fu * x + fv * y) + psi);
    }
  }
  return { radius, size, values };
}

/** Smallest power-of-two grid (≥ 128) that holds the kernel support without overlap. */
export function spectrumGridSize(delta: number) {
  let size = 128;
  while (size < 2 * supportRadius(delta) + 1) size *= 2;
  return size;
}

/**
 * DFT magnitude of the sampled real kernel on an n × n grid, displayed with zero frequency at
 * index (n/2, n/2). This is the response of the discrete filter actually used, so truncation
 * and aliasing near Nyquist are visible. `dcRatio` is |G(0,0)| / max |G|.
 */
export function kernelSpectrum(params: GaborParams, n = spectrumGridSize(params.delta)) {
  const kernel = realKernel(params);
  const field: Complex2D = { re: new Float64Array(n * n), im: new Float64Array(n * n), size: n };
  for (let y = -kernel.radius; y <= kernel.radius; y += 1) {
    for (let x = -kernel.radius; x <= kernel.radius; x += 1) {
      field.re[((y + n) % n) * n + ((x + n) % n)] = kernel.values[(y + kernel.radius) * kernel.size + (x + kernel.radius)];
    }
  }
  fft2d(field);
  const magnitude = new Float64Array(n * n);
  let maximum = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const source = ((y + n / 2) % n) * n + ((x + n / 2) % n);
      const value = Math.hypot(field.re[source], field.im[source]);
      magnitude[y * n + x] = value;
      maximum = Math.max(maximum, value);
    }
  }
  return { magnitude, size: n, dcRatio: maximum > 0 ? Math.hypot(field.re[0], field.im[0]) / maximum : 0 };
}

/**
 * DFT (n points per axis) of the complex Gabor h = envelope · e^{i2π(fu x + fv y)}, scaled so that
 * Σ envelope = 1, i.e. unit gain at the carrier frequency. Built from the separable 1D factors.
 * For any phase ψ, the real kernel's response equals Σenvelope · Re(e^{iψ}(I * h)).
 */
export function complexTransfer(params: GaborParams, n: number): Complex2D {
  const radius = supportRadius(params.delta);
  const { fu, fv } = carrier(params);
  const factors = [fu, fv].map((component) => {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let sum = 0;
    for (let t = -radius; t <= radius; t += 1) {
      const envelope = Math.exp(-(t * t) / (4 * params.delta * params.delta));
      re[(t + n) % n] = envelope * Math.cos(2 * Math.PI * component * t);
      im[(t + n) % n] = envelope * Math.sin(2 * Math.PI * component * t);
      sum += envelope;
    }
    fft1d(re, im);
    return { re, im, sum };
  });
  const [a, b] = factors;
  const scale = 1 / (a.sum * b.sum);
  const transfer: Complex2D = { re: new Float64Array(n * n), im: new Float64Array(n * n), size: n };
  for (let l = 0; l < n; l += 1) {
    for (let k = 0; k < n; k += 1) {
      transfer.re[l * n + k] = (a.re[k] * b.re[l] - a.im[k] * b.im[l]) * scale;
      transfer.im[l * n + k] = (a.re[k] * b.im[l] + a.im[k] * b.re[l]) * scale;
    }
  }
  return transfer;
}

/** Mirror a size × size image into a 2size × 2size periodic tile so circular convolution sees no border jumps. */
export function symmetricExtension(values: Float64Array, size: number) {
  const n = 2 * size;
  const output = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    const sourceY = y < size ? y : n - 1 - y;
    for (let x = 0; x < n; x += 1) {
      const sourceX = x < size ? x : n - 1 - x;
      output[y * n + x] = values[sourceY * size + sourceX];
    }
  }
  return output;
}

/** Fourier transform of the mirrored image, optionally after subtracting its global mean. */
export function prepareImage(values: Float64Array, size: number, subtractMean = true) {
  const mean = subtractMean ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const extended = symmetricExtension(Float64Array.from(values, (value) => value - mean), size);
  const spectrum = fft2d({ re: extended, im: new Float64Array(extended.length), size: 2 * size });
  return { spectrum, size, mean };
}

/** Complex response I * h (convolution) on the original size × size domain. */
export function filterResponse(image: ReturnType<typeof prepareImage>, params: GaborParams) {
  const n = image.spectrum.size;
  const transfer = complexTransfer(params, n);
  const product: Complex2D = { re: new Float64Array(n * n), im: new Float64Array(n * n), size: n };
  for (let index = 0; index < n * n; index += 1) {
    const ar = image.spectrum.re[index];
    const ai = image.spectrum.im[index];
    product.re[index] = ar * transfer.re[index] - ai * transfer.im[index];
    product.im[index] = ar * transfer.im[index] + ai * transfer.re[index];
  }
  fft2d(product, true);
  const re = new Float64Array(image.size * image.size);
  const im = new Float64Array(image.size * image.size);
  for (let y = 0; y < image.size; y += 1) {
    for (let x = 0; x < image.size; x += 1) {
      re[y * image.size + x] = product.re[y * n + x];
      im[y * image.size + x] = product.im[y * n + x];
    }
  }
  return { re, im };
}

/** Mean local energy |I * h|² over the image: one texture feature per filter. */
export function meanEnergy(response: { re: Float64Array; im: Float64Array }) {
  let sum = 0;
  for (let index = 0; index < response.re.length; index += 1) sum += response.re[index] ** 2 + response.im[index] ** 2;
  return sum / response.re.length;
}

/**
 * Mean output energy of one filter on the windowed image, evaluated in the frequency domain by
 * Parseval's theorem: E = Σ_{u,v} |Î_w(u,v)|² |H(u,v)|² / (N² Σ w²). This is the power spectrum
 * integrated with the filter's power response as weight (cf. Fourier features, slide 53).
 */
export function bandEnergy(image: ReturnType<typeof windowedSpectrum>, params: GaborParams) {
  const { re, im, size } = image.spectrum;
  const transfer = complexTransfer(params, size);
  let sum = 0;
  for (let index = 0; index < re.length; index += 1) {
    sum += (re[index] ** 2 + im[index] ** 2) * (transfer.re[index] ** 2 + transfer.im[index] ** 2);
  }
  return sum / (size * size * image.windowEnergy);
}

/** Octave-spaced scales f_s = f_max / 2^s and equally spaced orientations θ_j = j·180°/N; Δ follows from the bandwidth. */
export function filterBank(spec: BankSpec): BankFilter[] {
  const filters: BankFilter[] = [];
  for (let scale = 0; scale < spec.scales; scale += 1) {
    const frequency = spec.maxFrequency / 2 ** scale;
    const delta = deltaForBandwidth(frequency, spec.octaves);
    for (let orientationIndex = 0; orientationIndex < spec.orientations; orientationIndex += 1) {
      filters.push({ frequency, orientation: (orientationIndex * 180) / spec.orientations, delta, phase: 0, scale, orientationIndex });
    }
  }
  return filters;
}
