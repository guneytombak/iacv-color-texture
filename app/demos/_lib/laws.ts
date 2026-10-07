// Laws texture energy measures (Lecture 4, slides 63–65).
// A 2D mask is the outer product of two 1D vectors. Naming convention used throughout:
// "E5L5" = E5 applied VERTICALLY (down the columns, the y direction) times L5 applied HORIZONTALLY
// (along the rows, x), i.e. mask[y][x] = E5[y]·L5[x]; it responds to horizontal edges.
// Images are size × size, row-major, y downward; borders use half-sample symmetric extension.

export const LAWS_VECTORS = {
  L3: [1, 2, 1],
  E3: [-1, 0, 1],
  S3: [-1, 2, -1],
  L5: [1, 4, 6, 4, 1],
  E5: [-1, -2, 0, 2, 1],
  S5: [-1, 0, 2, 0, -1],
  W5: [-1, 2, 0, -2, 1],
  R5: [1, -4, 6, -4, 1],
} as const;

export type LawsName = keyof typeof LAWS_VECTORS;
export const LAWS_SETS: Record<"3" | "5", LawsName[]> = { "3": ["L3", "E3", "S3"], "5": ["L5", "E5", "S5", "W5", "R5"] };
export type LawsFilter = { vertical: LawsName; horizontal: LawsName; name: string };

export function lawsBank(set: "3" | "5"): LawsFilter[] {
  return LAWS_SETS[set].flatMap((vertical) => LAWS_SETS[set].map((horizontal) => ({ vertical, horizontal, name: `${vertical}${horizontal}` })));
}

/** mask[y][x] = vertical[y] · horizontal[x], row-major. */
export function lawsMask(vertical: LawsName, horizontal: LawsName) {
  const a = LAWS_VECTORS[vertical];
  const b = LAWS_VECTORS[horizontal];
  return a.flatMap((ay) => b.map((bx) => ay * bx));
}

/** Half-sample symmetric index: −1 → 0, −2 → 1, n → n − 1. */
export function mirrorIndex(index: number, n: number) {
  let value = index;
  while (value < 0 || value >= n) value = value < 0 ? -value - 1 : 2 * n - value - 1;
  return value;
}

/** Correlation with a 1D kernel along x (axis "x") or y (axis "y"); the kernel is centred. */
function filterAxis(values: Float64Array, size: number, kernel: readonly number[], axis: "x" | "y") {
  const output = new Float64Array(values.length);
  const half = (kernel.length - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const offset = k - half;
        sum += kernel[k] * (axis === "x" ? values[y * size + mirrorIndex(x + offset, size)] : values[mirrorIndex(y + offset, size) * size + x]);
      }
      output[y * size + x] = sum;
    }
  }
  return output;
}

/**
 * Filter response of the separable mask vertical ⊗ horizontal. Applied as correlation, which for
 * these symmetric or antisymmetric vectors differs from convolution at most in sign, and the
 * energy (squared response) is unaffected.
 */
export function lawsResponse(values: Float64Array, size: number, vertical: LawsName, horizontal: LawsName) {
  return filterAxis(filterAxis(values, size, LAWS_VECTORS[horizontal], "x"), size, LAWS_VECTORS[vertical], "y");
}

/** Running-sum box average along one axis with symmetric borders; cost independent of the radius. */
function boxAxis(values: Float64Array, size: number, radius: number, axis: "x" | "y") {
  const output = new Float64Array(values.length);
  const width = 2 * radius + 1;
  const line = new Float64Array(size + 2 * radius);
  for (let outer = 0; outer < size; outer += 1) {
    for (let t = -radius; t < size + radius; t += 1) {
      const source = mirrorIndex(t, size);
      line[t + radius] = axis === "x" ? values[outer * size + source] : values[source * size + outer];
    }
    let sum = 0;
    for (let t = 0; t < width; t += 1) sum += line[t];
    for (let t = 0; t < size; t += 1) {
      if (t > 0) sum += line[t + width - 1] - line[t - 1];
      if (axis === "x") output[outer * size + t] = sum / width;
      else output[t * size + outer] = sum / width;
    }
  }
  return output;
}

/** Mean over a (2r + 1) × (2r + 1) window, separable, symmetric borders. */
export function boxMean(values: Float64Array, size: number, radius: number) {
  return boxAxis(boxAxis(values, size, radius, "x"), size, radius, "y");
}

/** Laws' preprocessing: subtract the local mean so that the masks see texture, not illumination. */
export function removeLocalMean(values: Float64Array, size: number, radius = 7) {
  const mean = boxMean(values, size, radius);
  return Float64Array.from(values, (value, index) => value - mean[index]);
}

/** Local energy: windowed mean of the squared response. */
export function energyMap(response: Float64Array, size: number, radius: number) {
  return boxMean(Float64Array.from(response, (value) => value * value), size, radius);
}

/** Mean squared response over a region of interest (columns [x0, x1)), one feature per filter. */
export function meanSquare(response: Float64Array, size: number, x0 = 0, x1 = size) {
  let sum = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = x0; x < x1; x += 1) sum += response[y * size + x] ** 2;
  }
  return sum / (size * (x1 - x0));
}

/** Energy vectors of a preprocessed image for every filter in `bank`: whole image and left/right halves. */
export function lawsFeatures(values: Float64Array, size: number, bank: LawsFilter[]) {
  const whole: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  for (const filter of bank) {
    const response = lawsResponse(values, size, filter.vertical, filter.horizontal);
    whole.push(meanSquare(response, size));
    left.push(meanSquare(response, size, 0, size / 2));
    right.push(meanSquare(response, size, size / 2, size));
  }
  return { whole, left, right };
}

/** log₁₀ of the energies; with `normalize`, each energy is first divided by the L·L (level) energy. */
export function logEnergies(energies: number[], bank: LawsFilter[], normalize: boolean) {
  const levelIndex = bank.findIndex((filter) => filter.vertical.startsWith("L") && filter.horizontal.startsWith("L"));
  const reference = normalize ? energies[levelIndex] : 1;
  return energies.map((energy, index) => (normalize && index === levelIndex ? 0 : Math.log10(Math.max(energy / reference, 1e-12))));
}

export function euclidean(a: number[], b: number[]) {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
}

/** |H(f)| of a 1D Laws vector, f in cycles per pixel (0 … 0.5). */
export function vectorMagnitude(name: LawsName, frequency: number) {
  let re = 0;
  let im = 0;
  LAWS_VECTORS[name].forEach((value, index) => {
    re += value * Math.cos(2 * Math.PI * frequency * index);
    im -= value * Math.sin(2 * Math.PI * frequency * index);
  });
  return Math.hypot(re, im);
}
