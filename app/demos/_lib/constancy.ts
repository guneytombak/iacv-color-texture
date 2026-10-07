// Colour constancy (Lecture 4, slides 31–35): the light reaching the eye or camera is the product of
// surface reflectance and illuminant spectrum, and the observer has to separate the two.
// Spectra are sampled at WAVELENGTHS (380–700 nm, 5 nm). Colour matching uses the analytic CIE 1931
// fit from color.ts; RGB values are linear sRGB (D65 primaries) unless stated otherwise.

import { WAVELENGTHS, blackbodyRelative, cieXyzBar } from "./color.ts";

export type Vec3 = [number, number, number];
export type Spectrum = number[];

export const REFERENCE_TEMPERATURE = 6500;
/** CIE D65 white (Y = 1), the white point of sRGB displays. */
export const D65_WHITE: [number, number, number] = [0.95047, 1, 1.08883];

// ---- Illuminants -------------------------------------------------------------------------------

export function blackbody(temperature: number): Spectrum {
  const raw = WAVELENGTHS.map((wavelength) => blackbodyRelative(wavelength, temperature));
  const maximum = Math.max(...raw);
  return raw.map((value) => value / maximum);
}

/** Two-peak white LED (blue pump + broad phosphor), relative units. */
export function ledSpectrum(): Spectrum {
  return WAVELENGTHS.map((wavelength) => 1.2 * Math.exp(-(((wavelength - 450) / 18) ** 2)) + 0.72 * Math.exp(-(((wavelength - 560) / 75) ** 2)));
}

/** A strongly green light with a weak broadband floor, like the green-filtered photograph on slide 31. */
export function greenSpectrum(): Spectrum {
  return WAVELENGTHS.map((wavelength) => 0.06 + Math.exp(-(((wavelength - 530) / 35) ** 2)));
}

// ---- Synthetic surfaces ------------------------------------------------------------------------

const bump = (wavelength: number, centre: number, width: number) => Math.exp(-(((wavelength - centre) / width) ** 2));
const rise = (wavelength: number, edge: number, slope: number) => 1 / (1 + Math.exp(-(wavelength - edge) / slope));

/** Smooth synthetic reflectances (0–1). Not measured data; chosen to span hues and neutrals. */
export const PATCHES: { name: string; reflectance: (wavelength: number) => number }[] = [
  { name: "red", reflectance: (w) => 0.05 + 0.75 * rise(w, 600, 12) },
  { name: "orange", reflectance: (w) => 0.05 + 0.8 * rise(w, 575, 12) },
  { name: "yellow", reflectance: (w) => 0.06 + 0.82 * rise(w, 525, 12) },
  { name: "yellow-green", reflectance: (w) => 0.05 + 0.6 * bump(w, 555, 45) + 0.15 * rise(w, 640, 15) },
  { name: "green", reflectance: (w) => 0.05 + 0.5 * bump(w, 530, 38) },
  { name: "teal", reflectance: (w) => 0.05 + 0.5 * bump(w, 495, 40) },
  { name: "cyan", reflectance: (w) => 0.06 + 0.65 * bump(w, 480, 55) },
  { name: "blue", reflectance: (w) => 0.05 + 0.55 * bump(w, 450, 35) },
  { name: "violet", reflectance: (w) => 0.06 + 0.45 * bump(w, 420, 35) + 0.25 * rise(w, 650, 15) },
  { name: "magenta", reflectance: (w) => 0.05 + 0.55 * bump(w, 430, 40) + 0.7 * rise(w, 610, 15) },
  { name: "pink", reflectance: (w) => 0.35 + 0.5 * rise(w, 580, 18) },
  { name: "skin", reflectance: (w) => 0.2 + 0.45 * rise(w, 570, 30) },
  { name: "brown", reflectance: (w) => 0.04 + 0.28 * rise(w, 580, 25) },
  { name: "olive", reflectance: (w) => 0.04 + 0.22 * bump(w, 570, 60) },
  { name: "navy", reflectance: (w) => 0.03 + 0.2 * bump(w, 455, 35) },
  { name: "sky", reflectance: (w) => 0.2 + 0.35 * bump(w, 460, 60) },
  { name: "foliage", reflectance: (w) => 0.04 + 0.16 * bump(w, 550, 30) + 0.12 * rise(w, 690, 10) },
  { name: "lavender", reflectance: (w) => 0.4 + 0.25 * bump(w, 440, 50) + 0.12 * rise(w, 640, 20) },
  { name: "white", reflectance: () => 0.9 },
  { name: "light gray", reflectance: () => 0.59 },
  { name: "mid gray", reflectance: () => 0.36 },
  { name: "dark gray", reflectance: () => 0.2 },
  { name: "charcoal", reflectance: () => 0.09 },
  { name: "black", reflectance: () => 0.03 },
];

export function patchSpectra() {
  return PATCHES.map((patch) => WAVELENGTHS.map((wavelength) => patch.reflectance(wavelength)));
}

// ---- Colorimetry -------------------------------------------------------------------------------

const BARS = WAVELENGTHS.map((wavelength) => cieXyzBar(wavelength));

/**
 * XYZ of a surface under an illuminant, scaled so that a perfect white reflector has Y = 1
 * (an exposure that follows the brightness of the light but not its colour).
 */
export function surfaceXyz(illuminant: Spectrum, reflectance: Spectrum): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let norm = 0;
  illuminant.forEach((power, index) => {
    const [xb, yb, zb] = BARS[index];
    x += power * reflectance[index] * xb;
    y += power * reflectance[index] * yb;
    z += power * reflectance[index] * zb;
    norm += power * yb;
  });
  return [x / norm, y / norm, z / norm];
}

export function whiteXyz(illuminant: Spectrum): Vec3 {
  return surfaceXyz(illuminant, illuminant.map(() => 1));
}

const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];
const RGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

export function multiply(matrix: number[][], vector: Vec3): Vec3 {
  return [0, 1, 2].map((row) => matrix[row][0] * vector[0] + matrix[row][1] * vector[1] + matrix[row][2] * vector[2]) as Vec3;
}

export const xyzToLinearRgb = (xyz: Vec3) => multiply(XYZ_TO_RGB, xyz);
export const linearRgbToXyz = (rgb: Vec3) => multiply(RGB_TO_XYZ, rgb);

/** CIELAB relative to a reference white (both in XYZ). */
export function xyzToLab(xyz: Vec3, white: Vec3): Vec3 {
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const [fx, fy, fz] = [f(xyz[0] / white[0]), f(xyz[1] / white[1]), f(xyz[2] / white[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---- Corrections (all diagonal, i.e. one gain per channel) -------------------------------------
// `neutral` is the channel triple that counts as achromatic: (1, 1, 1) for linear sRGB, the reference
// white for XYZ. A gain triple maps an estimate of the light's colour onto it.

export type Method = "none" | "grayWorld" | "whitePatch" | "manual" | "vonKries";

const EPSILON = 1e-6;

/** Gray world: assume the average surface is gray, so the channel means are mapped onto `neutral` (keeping the mean of the second channel). */
export function grayWorldGains(values: Vec3[], neutral: Vec3 = [1, 1, 1]): Vec3 {
  const means = [0, 1, 2].map((channel) => values.reduce((sum, value) => sum + value[channel], 0) / values.length);
  return neutralGains(means as Vec3, neutral);
}

/** White patch (max-RGB): assume the brightest value of every channel comes from a white surface; maps the maxima to `neutral`. */
export function whitePatchGains(values: Vec3[], neutral: Vec3 = [1, 1, 1], quantile = 1): Vec3 {
  const peaks = [0, 1, 2].map((channel) => {
    const sorted = values.map((value) => value[channel]).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(quantile * (sorted.length - 1)))];
  });
  return [0, 1, 2].map((channel) => neutral[channel] / Math.max(EPSILON, peaks[channel])) as Vec3;
}

/** Manual: the chosen sample becomes neutral (a multiple of `neutral` with the sample's second channel unchanged). */
export function neutralGains(sample: Vec3, neutral: Vec3 = [1, 1, 1]): Vec3 {
  const scale = Math.max(EPSILON, sample[1]) / neutral[1];
  return [0, 1, 2].map((channel) => (neutral[channel] * scale) / Math.max(EPSILON, sample[channel])) as Vec3;
}

export function applyGains(rgb: Vec3, gains: Vec3): Vec3 {
  return [rgb[0] * gains[0], rgb[1] * gains[1], rgb[2] * gains[2]];
}

// Bradford cone-like response matrix (Lam 1985), used for a von Kries adaptation with a known light.
const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

function invert3(m: number[][]) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}
const BRADFORD_INVERSE = invert3(BRADFORD);

/** Von Kries adaptation in Bradford space: scales cone-like responses so that `fromWhite` maps to `toWhite`. */
export function vonKries(xyz: Vec3, fromWhite: Vec3, toWhite: Vec3): Vec3 {
  const source = multiply(BRADFORD, fromWhite);
  const target = multiply(BRADFORD, toWhite);
  const cone = multiply(BRADFORD, xyz);
  return multiply(BRADFORD_INVERSE, [cone[0] * (target[0] / source[0]), cone[1] * (target[1] / source[1]), cone[2] * (target[2] / source[2])]);
}

/**
 * Renders every patch under `illuminant` with a camera whose three sensors are the CIE colour matching
 * functions (non-negative, so recordings are XYZ), corrects the recording with `method`, and compares
 * the result with the same patches under the reference light (CIELAB relative to the reference white).
 * Methods that estimate the light from the image apply per-channel gains in this XYZ sensor space;
 * "vonKries" uses the known light and adapts in the cone-like Bradford space.
 */
export function evaluate(illuminant: Spectrum, method: Method, manualIndex: number, reflectances = patchSpectra()) {
  const reference = blackbody(REFERENCE_TEMPERATURE);
  const referenceWhite = whiteXyz(reference);
  const lightWhite = whiteXyz(illuminant);
  const recorded = reflectances.map((reflectance) => surfaceXyz(illuminant, reflectance));
  const target = reflectances.map((reflectance) => surfaceXyz(reference, reflectance));
  let corrected: Vec3[];
  let gains: Vec3 | null = null;
  if (method === "vonKries") corrected = recorded.map((xyz) => vonKries(xyz, lightWhite, referenceWhite));
  else {
    gains = method === "grayWorld" ? grayWorldGains(recorded, referenceWhite) : method === "whitePatch" ? whitePatchGains(recorded, referenceWhite) : method === "manual" ? neutralGains(recorded[manualIndex], referenceWhite) : [1, 1, 1];
    const appliedGains = gains;
    corrected = recorded.map((xyz) => applyGains(xyz, appliedGains));
  }
  const errors = corrected.map((xyz, index) => deltaE(xyzToLab(xyz, referenceWhite), xyzToLab(target[index], referenceWhite)));
  // Display only: the screen's white is D65, so a fixed adaptation from the reference white to D65 is
  // applied to every grid alike; otherwise neutral reference patches would look slightly magenta.
  const display = (xyz: Vec3) => xyzToLinearRgb(vonKries(xyz, referenceWhite, D65_WHITE));
  return {
    recorded: recorded.map(display),
    corrected: corrected.map(display),
    reference: target.map(display),
    errors,
    meanError: errors.reduce((sum, value) => sum + value, 0) / errors.length,
    gains,
    lightWhite,
    referenceWhite,
  };
}

/** Linear-sRGB colour of a perfect white under `illuminant` relative to the reference light (diagonal cast). */
export function castGains(illuminant: Spectrum): Vec3 {
  const light = xyzToLinearRgb(whiteXyz(illuminant));
  const reference = xyzToLinearRgb(whiteXyz(blackbody(REFERENCE_TEMPERATURE)));
  const gains = light.map((value, index) => Math.max(1e-4, value) / reference[index]) as Vec3;
  const peak = Math.max(...gains);
  return gains.map((value) => value / peak) as Vec3;
}
