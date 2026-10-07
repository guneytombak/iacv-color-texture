// Radix-2 discrete Fourier transforms on interleaved-free (separate re/im) arrays.
// Forward convention: F[k] = Σ_n f[n] e^{−2πikn/N}. The inverse includes the 1/N factor.

export type Complex2D = { re: Float64Array; im: Float64Array; size: number };

/** In-place 1D FFT of length N (a power of two). `inverse` uses e^{+2πikn/N} without scaling. */
export function fft1d(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (sign * 2 * Math.PI) / length;
    const stepR = Math.cos(angle);
    const stepI = Math.sin(angle);
    const half = length >> 1;
    for (let start = 0; start < n; start += length) {
      let wr = 1;
      let wi = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const even = start + offset;
        const odd = even + half;
        const tr = re[odd] * wr - im[odd] * wi;
        const ti = re[odd] * wi + im[odd] * wr;
        re[odd] = re[even] - tr;
        im[odd] = im[even] - ti;
        re[even] += tr;
        im[even] += ti;
        const nextWr = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR;
        wr = nextWr;
      }
    }
  }
}

/** In-place 2D FFT of a size × size field stored row-major (index = y·size + x). Inverse divides by size². */
export function fft2d(field: Complex2D, inverse = false) {
  const { re, im, size } = field;
  const rowR = new Float64Array(size);
  const rowI = new Float64Array(size);
  for (let y = 0; y < size; y += 1) {
    const offset = y * size;
    rowR.set(re.subarray(offset, offset + size));
    rowI.set(im.subarray(offset, offset + size));
    fft1d(rowR, rowI, inverse);
    re.set(rowR, offset);
    im.set(rowI, offset);
  }
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      rowR[y] = re[y * size + x];
      rowI[y] = im[y * size + x];
    }
    fft1d(rowR, rowI, inverse);
    for (let y = 0; y < size; y += 1) {
      re[y * size + x] = rowR[y];
      im[y * size + x] = rowI[y];
    }
  }
  if (inverse) {
    const scale = 1 / (size * size);
    for (let index = 0; index < re.length; index += 1) {
      re[index] *= scale;
      im[index] *= scale;
    }
  }
  return field;
}
