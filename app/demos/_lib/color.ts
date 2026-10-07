export type RGB = [number, number, number];
export type HSV = [number, number, number];
export type HSL = [number, number, number];
export type XYZ = [number, number, number];
export type XY = [number, number];

export const WAVELENGTHS = Array.from({ length: 65 }, (_, index) => 380 + index * 5);

// CIE 1931 2-degree spectral-locus chromaticities, sampled every 5 nm.
// Source: CIE 018:2019, Table 6; DOI 10.25039/CIE.DS.mifmy4x4.
// The line of purples is the straight closing segment from 700 nm to 380 nm.
export const CIE1931_LOCUS: XY[] = [
  [0.17411, 0.00496], [0.17401, 0.00498], [0.17380, 0.00492], [0.17356, 0.00492],
  [0.17334, 0.00480], [0.17302, 0.00478], [0.17258, 0.00480], [0.17209, 0.00483],
  [0.17141, 0.00510], [0.17030, 0.00579], [0.16888, 0.00690], [0.16690, 0.00855],
  [0.16441, 0.01086], [0.16111, 0.01379], [0.15664, 0.01771], [0.15099, 0.02274],
  [0.14396, 0.02970], [0.13550, 0.03988], [0.12412, 0.05780], [0.10960, 0.08684],
  [0.09129, 0.13270], [0.06871, 0.20072], [0.04539, 0.29498], [0.02346, 0.41270],
  [0.00817, 0.53842], [0.00386, 0.65482], [0.01387, 0.75019], [0.03885, 0.81202],
  [0.07430, 0.83380], [0.11416, 0.82621], [0.15472, 0.80586], [0.19288, 0.78163],
  [0.22962, 0.75433], [0.26578, 0.72432], [0.30160, 0.69231], [0.33736, 0.65885],
  [0.37310, 0.62445], [0.40873, 0.58961], [0.44406, 0.55472], [0.47878, 0.52020],
  [0.51249, 0.48659], [0.54479, 0.45443], [0.57515, 0.42423], [0.60293, 0.39650],
  [0.62704, 0.37249], [0.64823, 0.35140], [0.66576, 0.33401], [0.68008, 0.31975],
  [0.69151, 0.30834], [0.70061, 0.29930], [0.70792, 0.29203], [0.71403, 0.28593],
  [0.71903, 0.28094], [0.72303, 0.27695], [0.72599, 0.27401], [0.72827, 0.27173],
  [0.72997, 0.27003], [0.73109, 0.26891], [0.73199, 0.26801], [0.73272, 0.26728],
  [0.73342, 0.26658], [0.73405, 0.26595], [0.73439, 0.26561], [0.73459, 0.26541],
  [0.73469, 0.26531],
];

export function clamp(value: number, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

export function srgbDecode(value: number) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function srgbEncode(value: number) {
  const v = Math.max(0, value);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function rgbToHsv([r, g, b]: RGB): HSV {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-10) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return [hue, max === 0 ? 0 : delta / max, max];
}

export function rgbToHsl([r, g, b]: RGB): HSL {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta > 1e-10) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return [hue, saturation, lightness];
}

export function hsvToRgb([h, s, v]: HSV): RGB {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - chroma;
  let rgb: RGB;
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

export function hslToRgb([h, s, l]: HSL): RGB {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  let rgb: RGB;
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

export function rgbToXyz(rgb: RGB): XYZ {
  const [r, g, b] = rgb.map(srgbDecode) as RGB;
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

export function xyzToRgb([x, y, z]: XYZ): RGB {
  const linear: RGB = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
  return linear.map((value) => clamp(srgbEncode(value))) as RGB;
}

export function xyzToXy([x, y, z]: XYZ): XY {
  const sum = x + y + z;
  return sum <= 1e-12 ? [0.3127, 0.3290] : [x / sum, y / sum];
}

export function xyYToXyz([x, y]: XY, luminance: number): XYZ {
  if (y <= 1e-8) return [0, 0, 0];
  return [luminance * x / y, luminance, luminance * (1 - x - y) / y];
}

export function pointInTriangle(point: XY, triangle: [XY, XY, XY]) {
  const [a, b, c] = triangle;
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-12) return false;
  const u = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const v = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  const w = 1 - u - v;
  return u >= -1e-9 && v >= -1e-9 && w >= -1e-9;
}

function nearestOnSegment(point: XY, a: XY, b: XY): XY {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const length2 = abx * abx + aby * aby;
  if (length2 < 1e-12) return a;
  const t = clamp(((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / length2);
  return [a[0] + t * abx, a[1] + t * aby];
}

export function nearestOnTriangle(point: XY, triangle: [XY, XY, XY]): XY {
  const candidates = [
    nearestOnSegment(point, triangle[0], triangle[1]),
    nearestOnSegment(point, triangle[1], triangle[2]),
    nearestOnSegment(point, triangle[2], triangle[0]),
  ];
  return candidates.reduce((best, candidate) => {
    const dBest = (best[0] - point[0]) ** 2 + (best[1] - point[1]) ** 2;
    const dCandidate = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2;
    return dCandidate < dBest ? candidate : best;
  });
}

export function coneSensitivity(wavelength: number): RGB {
  const gaussian = (mean: number, width: number) => Math.exp(-Math.pow((wavelength - mean) / width, 2));
  return [gaussian(570, 67), gaussian(535, 58), gaussian(445, 38)]; // L, M, S
}

// Analytic approximation of the CIE 1931 2-degree matching functions.
// Based on asymmetric Gaussian fits; intended for interactive visualization.
export function cieXyzBar(wavelength: number): XYZ {
  const g = (mean: number, left: number, right: number) => {
    const width = wavelength < mean ? left : right;
    return Math.exp(-0.5 * Math.pow((wavelength - mean) * width, 2));
  };
  const x = 1.056 * g(599.8, 0.0264, 0.0323) + 0.362 * g(442.0, 0.0624, 0.0374) - 0.065 * g(501.1, 0.0490, 0.0382);
  const y = 0.821 * g(568.8, 0.0213, 0.0247) + 0.286 * g(530.9, 0.0613, 0.0322);
  const z = 1.217 * g(437.0, 0.0845, 0.0278) + 0.681 * g(459.0, 0.0385, 0.0725);
  return [Math.max(0, x), Math.max(0, y), Math.max(0, z)];
}

export function integrateSpectrum(samples: number[], brightness = 1) {
  const unitAreas = [0, 0, 0];
  const responses = [0, 0, 0];
  const xyz: XYZ = [0, 0, 0];
  WAVELENGTHS.forEach((wavelength, index) => {
    const [l, m, s] = coneSensitivity(wavelength);
    const power = clamp(samples[index] ?? 0) * brightness;
    unitAreas[0] += l;
    unitAreas[1] += m;
    unitAreas[2] += s;
    responses[0] += power * l;
    responses[1] += power * m;
    responses[2] += power * s;
    const bar = cieXyzBar(wavelength);
    xyz[0] += power * bar[0];
    xyz[1] += power * bar[1];
    xyz[2] += power * bar[2];
  });
  const normalized = responses.map((value, index) => value / unitAreas[index]) as RGB;
  const maxY = 8;
  const displayXyz = xyz.map((value) => value / maxY) as XYZ;
  return { responses: normalized, xyz, displayRgb: xyzToRgb(displayXyz) };
}

export function rgbCss(rgb: RGB) {
  return `rgb(${Math.round(clamp(rgb[0]) * 255)} ${Math.round(clamp(rgb[1]) * 255)} ${Math.round(clamp(rgb[2]) * 255)})`;
}

export function blackbodyRelative(wavelengthNm: number, temperature: number) {
  const wavelength = wavelengthNm * 1e-9;
  const c2 = 1.438776877e-2;
  const value = 1 / (Math.pow(wavelength, 5) * (Math.exp(c2 / (wavelength * temperature)) - 1));
  return value;
}

export function illuminantSpectrum(kind: "daylight" | "tungsten" | "led") {
  const raw = WAVELENGTHS.map((wavelength) => {
    if (kind === "daylight") return blackbodyRelative(wavelength, 6500);
    if (kind === "tungsten") return blackbodyRelative(wavelength, 2856);
    return 1.2 * Math.exp(-Math.pow((wavelength - 450) / 18, 2)) + 0.72 * Math.exp(-Math.pow((wavelength - 560) / 75, 2));
  });
  const max = Math.max(...raw);
  return raw.map((value) => value / max);
}

export function reflectanceSpectrum(kind: "neutral" | "red" | "green" | "blue") {
  return WAVELENGTHS.map((wavelength) => {
    if (kind === "neutral") return 0.72;
    const centers = { red: 620, green: 535, blue: 460 };
    const widths = { red: 70, green: 55, blue: 45 };
    return 0.06 + 0.88 * Math.exp(-Math.pow((wavelength - centers[kind]) / widths[kind], 2));
  });
}

export function spectralCameraResponse(illuminant: number[], reflectance: number[]) {
  const response: RGB = [0, 0, 0];
  const white: RGB = [0, 0, 0];
  WAVELENGTHS.forEach((wavelength, index) => {
    const sensitivities: RGB = [
      Math.exp(-Math.pow((wavelength - 605) / 58, 2)),
      Math.exp(-Math.pow((wavelength - 540) / 48, 2)),
      Math.exp(-Math.pow((wavelength - 455) / 42, 2)),
    ];
    for (let channel = 0; channel < 3; channel += 1) {
      response[channel] += illuminant[index] * reflectance[index] * sensitivities[channel];
      white[channel] += sensitivities[channel];
    }
  });
  return response.map((value, index) => value / white[index]) as RGB;
}
