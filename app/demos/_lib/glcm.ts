// Gray-level co-occurrence matrices (GLCM) and the geometry of the displacement editor.
// Conventions: image x grows to the right, y grows downward, the origin is the top-left
// pixel. A displacement v = (vx, vy) pairs pixel (x, y) with its neighbor (x + vx, y + vy).

export type GrayImage = { gray: Uint8ClampedArray; width: number; height: number; name: string };
export type Displacement = { vx: number; vy: number };
export type MatrixResult = {
  probabilities: Float64Array;
  pairs: number;
  energy: number;
  entropy: number;
  contrast: number;
  homogeneity: number;
  maximum: number;
  weightedScore: number;
};

export function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

/** Uniform quantization of an 8-bit value into `levels` bins, 0 … levels − 1. */
export function quantizeLevel(value: number, levels: number) {
  return Math.min(levels - 1, Math.floor((value * levels) / 256));
}

/** Number of ordered pairs whose neighbor lies inside a width × height image. */
export function validPairCount(width: number, height: number, vector: Displacement) {
  return Math.max(0, width - Math.abs(vector.vx)) * Math.max(0, height - Math.abs(vector.vy));
}

export function weightAt(i: number, j: number, levels: number, angle: number, sigma: number) {
  const center = (levels - 1) / 2;
  const radians = (angle * Math.PI) / 180;
  // Canvas coordinates: j grows right and i grows down. At 135°, the direction
  // vector points north-west, so the high-weight ridge follows the main diagonal.
  const directionX = Math.cos(radians);
  const directionY = -Math.sin(radians);
  const normalX = -directionY;
  const normalY = directionX;
  const distance = (j - center) * normalX + (i - center) * normalY;
  return Math.exp(-0.5 * (distance / sigma) ** 2);
}

export function computeMatrix(image: GrayImage, vector: Displacement, levels: number, symmetric: boolean, angle: number, sigma: number): MatrixResult {
  const counts = new Float64Array(levels * levels);
  let pairs = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const targetX = x + vector.vx;
      const targetY = y + vector.vy;
      if (targetX < 0 || targetX >= image.width || targetY < 0 || targetY >= image.height) continue;
      const i = quantizeLevel(image.gray[y * image.width + x], levels);
      const j = quantizeLevel(image.gray[targetY * image.width + targetX], levels);
      counts[i * levels + j] += 1;
      pairs += 1;
      if (symmetric) {
        counts[j * levels + i] += 1;
        pairs += 1;
      }
    }
  }
  const probabilities = Float64Array.from(counts, (count) => (pairs ? count / pairs : 0));
  return matrixFeatures(probabilities, levels, angle, sigma, pairs);
}

/** Haralick-style features of a normalized levels × levels matrix (row i = reference, column j = neighbor). */
export function matrixFeatures(probabilities: Float64Array, levels: number, angle: number, sigma: number, pairs: number): MatrixResult {
  let energy = 0;
  let entropy = 0;
  let contrast = 0;
  let homogeneity = 0;
  let maximum = 0;
  let weightedScore = 0;
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < levels; j += 1) {
      const probability = probabilities[i * levels + j];
      energy += probability * probability;
      if (probability > 0) entropy -= probability * Math.log2(probability);
      contrast += (i - j) ** 2 * probability;
      homogeneity += probability / (1 + Math.abs(i - j));
      maximum = Math.max(maximum, probability);
      weightedScore += probability * weightAt(i, j, levels, angle, sigma);
    }
  }
  return { probabilities, pairs, energy, entropy, contrast, homogeneity, maximum, weightedScore };
}

/** Normalized histogram p(i) of the quantized gray levels. */
export function grayHistogram(image: GrayImage, levels: number) {
  const histogram = new Float64Array(levels);
  for (const value of image.gray) histogram[quantizeLevel(value, levels)] += 1;
  return histogram.map((count) => count / image.gray.length);
}

/** The same pixel values in a random order (Fisher–Yates, seeded): identical histogram, no spatial structure. */
export function shuffledImage(image: GrayImage, seed: number): GrayImage {
  const gray = Uint8ClampedArray.from(image.gray);
  let state = seed >>> 0;
  const random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = gray.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [gray[index], gray[other]] = [gray[other], gray[index]];
  }
  return { ...image, gray, name: `${image.name} (shuffled)` };
}

/** p(i)·p(j): the co-occurrence matrix expected if a pixel and its neighbor were statistically independent. */
export function independenceMatrix(histogram: Float64Array) {
  const levels = histogram.length;
  const matrix = new Float64Array(levels * levels);
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < levels; j += 1) matrix[i * levels + j] = histogram[i] * histogram[j];
  }
  return matrix;
}

/**
 * Mutual information I(i; j) in bits between reference and neighbor levels, using the matrix's own
 * row and column marginals: Σ P(i,j) log₂[P(i,j) / (P_row(i) P_col(j))]. Zero exactly when P = P_row ⊗ P_col.
 */
export function mutualInformation(probabilities: Float64Array, levels: number) {
  const rows = new Float64Array(levels);
  const columns = new Float64Array(levels);
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < levels; j += 1) {
      rows[i] += probabilities[i * levels + j];
      columns[j] += probabilities[i * levels + j];
    }
  }
  let information = 0;
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < levels; j += 1) {
      const probability = probabilities[i * levels + j];
      if (probability > 0) information += probability * Math.log2(probability / (rows[i] * columns[j]));
    }
  }
  return Math.max(0, information);
}

/** Limits each component to ±maximum; returns null for the zero vector, which has no texture meaning. */
export function constrainDisplacement(vx: number, vy: number, maximum: number): Displacement | null {
  const next = { vx: Math.round(clamp(vx, -maximum, maximum)), vy: Math.round(clamp(vy, -maximum, maximum)) };
  return next.vx === 0 && next.vy === 0 ? null : next;
}

/** Keyboard nudge that steps over the forbidden zero vector instead of stopping in front of it. */
export function nudgeDisplacement(vector: Displacement, stepX: number, stepY: number, maximum: number): Displacement {
  return constrainDisplacement(vector.vx + stepX, vector.vy + stepY, maximum)
    ?? constrainDisplacement(vector.vx + 2 * stepX, vector.vy + 2 * stepY, maximum)
    ?? vector;
}

/**
 * Maps a pointer position to continuous image coordinates for a canvas drawn with
 * `object-fit: contain`. `box` is the element's content box in client coordinates.
 * `cssPerPixel` is the on-screen size of one image pixel.
 */
export function clientToImagePoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
) {
  const scale = Math.min(box.width / canvasWidth, box.height / canvasHeight);
  const drawnWidth = canvasWidth * scale;
  const drawnHeight = canvasHeight * scale;
  const left = box.left + (box.width - drawnWidth) / 2;
  const top = box.top + (box.height - drawnHeight) / 2;
  return {
    x: ((clientX - left) / drawnWidth) * imageWidth,
    y: ((clientY - top) / drawnHeight) * imageHeight,
    cssPerPixel: drawnWidth / imageWidth,
  };
}
