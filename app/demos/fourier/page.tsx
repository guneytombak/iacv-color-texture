"use client";

/* eslint-disable @next/next/no-img-element -- this browser-local demo must preview blob: URLs from user uploads. */

import { useEffect, useMemo, useRef, useState } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { loadSquareImage } from "../_lib/image";
import { RingWedgeSection } from "./RingWedge";
import { withBasePath } from "../_lib/paths.ts";

const SIZE = 128;
/** Resolution of the natural-image spectra (the sinusoid section keeps SIZE). */
const IMAGE_SIZE = 256;
const PRESETS = [
  { name: "Wicker", src: withBasePath("/textures/wicker.png") },
  { name: "Textile", src: withBasePath("/textures/textile.png") },
  { name: "Painting", src: withBasePath("/textures/painting.png") },
  { name: "Cloud", src: withBasePath("/textures/cloud.png") },
];

type ComplexField = { re: Float64Array; im: Float64Array };
type LoadedSpectrum = { spectrum: Uint8ClampedArray; means: [number, number, number] };

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

/** In-place radix-2 FFT using F(k)=sum_n f(n)e^{-2 pi i kn/N}. */
function fft1d(re: Float64Array, im: Float64Array) {
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
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wLengthR = Math.cos(angle);
    const wLengthI = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let wr = 1;
      let wi = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const tr = re[odd] * wr - im[odd] * wi;
        const ti = re[odd] * wi + im[odd] * wr;
        re[odd] = re[even] - tr;
        im[odd] = im[even] - ti;
        re[even] += tr;
        im[even] += ti;
        const nextWr = wr * wLengthR - wi * wLengthI;
        wi = wr * wLengthI + wi * wLengthR;
        wr = nextWr;
      }
    }
  }
}

function fft2d(values: Float64Array, size = SIZE): ComplexField {
  const re = Float64Array.from(values);
  const im = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const rowR = re.slice(y * size, (y + 1) * size);
    const rowI = im.slice(y * size, (y + 1) * size);
    fft1d(rowR, rowI);
    re.set(rowR, y * size);
    im.set(rowI, y * size);
  }
  for (let x = 0; x < size; x += 1) {
    const columnR = new Float64Array(size);
    const columnI = new Float64Array(size);
    for (let y = 0; y < size; y += 1) {
      columnR[y] = re[y * size + x];
      columnI[y] = im[y * size + x];
    }
    fft1d(columnR, columnI);
    for (let y = 0; y < size; y += 1) {
      re[y * size + x] = columnR[y];
      im[y * size + x] = columnI[y];
    }
  }
  return { re, im };
}

function shiftedLogMagnitude(field: ComplexField, size = SIZE) {
  const output = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = (x + size / 2) % size;
      const sourceY = (y + size / 2) % size;
      const index = sourceY * size + sourceX;
      output[y * size + x] = Math.log1p(Math.hypot(field.re[index], field.im[index]));
    }
  }
  return output;
}

function grayPixels(values: Float64Array) {
  const pixels = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    const level = Math.round(clamp(value, 0, 255));
    pixels[index * 4] = level;
    pixels[index * 4 + 1] = level;
    pixels[index * 4 + 2] = level;
    pixels[index * 4 + 3] = 255;
  });
  return pixels;
}

function normalizedGraySpectrum(values: Float64Array) {
  const maximum = Math.max(...values, 1e-12);
  const pixels = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    const level = Math.round(255 * Math.pow(value / maximum, 0.72));
    pixels[index * 4] = level;
    pixels[index * 4 + 1] = level;
    pixels[index * 4 + 2] = level;
    pixels[index * 4 + 3] = 255;
  });
  return pixels;
}

function RasterCanvas({ pixels, size = SIZE, label, className = "" }: { pixels: Uint8ClampedArray; size?: number; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
  }, [pixels, size]);
  return <canvas ref={ref} width={size} height={size} className={`texture-raster ${className}`} role="img" aria-label={label} />;
}

function SignalPlot({ values, reference, label }: { values: Float64Array; reference: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,.2)";
    context.beginPath();
    const refY = height - (reference / 255) * height;
    context.moveTo(0, refY);
    context.lineTo(width, refY);
    context.stroke();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.beginPath();
    values.forEach((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (value / 255) * height;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }, [reference, values]);
  return <canvas ref={ref} width={900} height={220} className="signal-plot" role="img" aria-label={label} />;
}

function SpectrumPlot({ values, label }: { values: Float64Array; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#050505";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const maximum = Math.max(...values, 1e-12);
    context.strokeStyle = "#e3e754";
    context.lineWidth = 2;
    context.beginPath();
    values.forEach((value, index) => {
      const shiftedIndex = (index + values.length / 2) % values.length;
      const magnitude = Math.log1p(values[shiftedIndex]);
      const normalized = magnitude / Math.log1p(maximum);
      const x = (index / (values.length - 1)) * canvas.width;
      const y = canvas.height - normalized * (canvas.height - 8) - 4;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }, [values]);
  return <canvas ref={ref} width={900} height={220} className="signal-plot" role="img" aria-label={label} />;
}

function realFftMagnitude(values: Float64Array, subtraction = 0) {
  const re = Float64Array.from(values, (value) => value - subtraction);
  const im = new Float64Array(values.length);
  fft1d(re, im);
  return Float64Array.from(re, (value, index) => Math.hypot(value, im[index]));
}

function Field({ label, value, unit = "", children }: { label: string; value: string | number; unit?: string; children: React.ReactNode }) {
  return <label className="texture-control"><span>{label}</span><strong>{value}{unit}</strong>{children}</label>;
}

export default function FourierDemo() {
  const [frequency, setFrequency] = useState(7);
  const [orientation, setOrientation] = useState(0);
  const [minimum, setMinimum] = useState(0);
  const [maximum, setMaximum] = useState(255);
  const [referenceMean, setReferenceMean] = useState(128);
  const [noise, setNoise] = useState(0);
  const [imageSource, setImageSource] = useState(PRESETS[0].src);
  const [imageName, setImageName] = useState(PRESETS[0].name);
  const [loaded, setLoaded] = useState<LoadedSpectrum | null>(null);
  const [useWindow, setUseWindow] = useState(true);

  const wave = useMemo(() => {
    const values = new Float64Array(SIZE * SIZE);
    const row = new Float64Array(SIZE);
    const radians = (orientation * Math.PI) / 180;
    const amplitude = (maximum - minimum) / 2;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const coordinate = ((x - SIZE / 2) * Math.cos(radians) + (y - SIZE / 2) * Math.sin(radians)) / SIZE;
        const random = ((((x + y * SIZE) * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
        values[y * SIZE + x] = clamp(referenceMean + amplitude * Math.sin(2 * Math.PI * frequency * coordinate) + noise * random, minimum, maximum);
      }
    }
    for (let x = 0; x < SIZE; x += 1) {
      const random = (((x * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
      row[x] = clamp(referenceMean + amplitude * Math.sin((2 * Math.PI * frequency * x) / SIZE) + noise * random, minimum, maximum);
    }
    const actualMean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const rawField = fft2d(values);
    const correctedField = fft2d(Float64Array.from(values, (value) => value - referenceMean));
    return {
      values,
      row,
      actualMean,
      rawSpectrum: shiftedLogMagnitude(rawField),
      correctedSpectrum: shiftedLogMagnitude(correctedField),
      rawDc: Math.hypot(rawField.re[0], rawField.im[0]) / values.length,
      correctedDc: Math.hypot(correctedField.re[0], correctedField.im[0]) / values.length,
      rowRawSpectrum: realFftMagnitude(row),
      rowCorrectedSpectrum: realFftMagnitude(row, referenceMean),
    };
  }, [frequency, maximum, minimum, noise, orientation, referenceMean]);

  useEffect(() => {
    let cancelled = false;
    loadSquareImage(imageSource, IMAGE_SIZE).then((loaded) => {
      if (cancelled) return;
      const source = loaded.rgba;
      const n = IMAGE_SIZE;
      const channels = [new Float64Array(n * n), new Float64Array(n * n), new Float64Array(n * n)];
      const means: [number, number, number] = [0, 0, 0];
      for (let index = 0; index < n * n; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          channels[channel][index] = source[index * 4 + channel];
          means[channel] += channels[channel][index];
        }
      }
      for (let channel = 0; channel < 3; channel += 1) means[channel] /= n * n;
      // Separable Hann window: removes the jump between opposite image borders, which the DFT
      // treats as neighbours and which otherwise adds a bright cross along the u and v axes.
      const hann = Float64Array.from({ length: n }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / n));
      const magnitudes = channels.map((channel, index) => shiftedLogMagnitude(fft2d(Float64Array.from(channel, (value, position) => (value - means[index]) * (useWindow ? hann[position % n] * hann[Math.floor(position / n)] : 1)), n), n));
      const combinedValues = magnitudes.flatMap((channel) => Array.from(channel));
      combinedValues.sort((a, b) => a - b);
      const scale = combinedValues[Math.floor(combinedValues.length * 0.995)] || 1;
      const floor = combinedValues[Math.floor(combinedValues.length * 0.35)] || 0;
      const spectrum = new Uint8ClampedArray(n * n * 4);
      for (let index = 0; index < n * n; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) spectrum[index * 4 + channel] = Math.round(255 * Math.pow(clamp((magnitudes[channel][index] - floor) / Math.max(1e-12, scale - floor), 0, 1), 0.85));
        spectrum[index * 4 + 3] = 255;
      }
      setLoaded({ spectrum, means });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [imageSource, useWindow]);

  function choosePreset(src: string, name: string) {
    setLoaded(null);
    setImageSource(src);
    setImageName(name);
  }

  function uploadImage(file?: File) {
    if (!file) return;
    setLoaded(null);
    setImageSource((previous) => {
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setImageName(file.name);
  }

  return (
    <DemoChrome number="T02" title="Sinusoids and the Fourier domain" subtitle="Build a one- or two-dimensional sinusoid, inspect its zero-frequency component and conjugate spectral peaks, compare those ideal responses with the RGB Fourier spectrum of a real texture, then integrate its power spectrum over rings and wedges to obtain coarseness and directionality features.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Pure sinusoid</p><h2>Change the pattern; watch its spectrum move</h2></header>
        <div className="fourier-workbench">
          <aside className="texture-controls">
            <Field label="Spatial frequency" value={frequency} unit=" cycles/image"><input type="range" min="1" max="24" step="1" value={frequency} onChange={(event) => setFrequency(Number(event.target.value))} /></Field>
            <Field label="Frequency-vector angle" value={orientation} unit="°"><input type="range" min="0" max="180" step="1" value={orientation} onChange={(event) => setOrientation(Number(event.target.value))} /></Field>
            <Field label="Minimum display level" value={minimum}><input type="range" min="0" max="254" step="1" value={minimum} onChange={(event) => setMinimum(Math.min(Number(event.target.value), maximum - 1))} /></Field>
            <Field label="Maximum display level" value={maximum}><input type="range" min="1" max="255" step="1" value={maximum} onChange={(event) => setMaximum(Math.max(Number(event.target.value), minimum + 1))} /></Field>
            <Field label="Subtracted reference mean" value={referenceMean}><input type="range" min="0" max="255" step="1" value={referenceMean} onChange={(event) => setReferenceMean(Number(event.target.value))} /></Field>
            <Field label="Uniform noise amplitude" value={noise} unit=" gray levels"><input type="range" min="0" max="64" step="1" value={noise} onChange={(event) => setNoise(Number(event.target.value))} /></Field>
            <div className="texture-readout"><span>measured image mean</span><strong>{wave.actualMean.toFixed(2)}</strong><span>raw DC / pixel</span><strong>{wave.rawDc.toFixed(2)}</strong><span>residual DC / pixel</span><strong>{wave.correctedDc.toFixed(2)}</strong></div>
          </aside>
          <div className="fourier-views">
            <figure><RasterCanvas pixels={grayPixels(wave.values)} label="Generated two-dimensional sinusoidal image" /><figcaption>Image domain · the angle controls the frequency vector; visible stripes are perpendicular to it.</figcaption></figure>
            <figure className="spectral-panel"><RasterCanvas pixels={normalizedGraySpectrum(wave.rawSpectrum)} label="Log Fourier magnitude including the zero-frequency component" /><figcaption>Raw log magnitude · the bright center is the zero-frequency or DC component.</figcaption></figure>
            <figure className="spectral-panel"><RasterCanvas pixels={normalizedGraySpectrum(wave.correctedSpectrum)} label="Log Fourier magnitude after subtracting the selected mean" /><figcaption>Reference-mean removed · the conjugate peaks become easier to see.</figcaption></figure>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="What the two points mean"><p>A real sinusoid contains equal positive- and negative-frequency components. Increasing frequency moves the pair away from the center; rotating the wave rotates that pair. Off-bin rotations on this finite square grid also produce spectral leakage around the ideal locations.</p></ModelBlock>
          <ModelBlock title="Mean removal" tone="green"><p>For an ideal 8-bit sinusoid centered at mid-gray, subtract 128 before the transform. The adjustable reference makes a wrong subtraction visible as a residual central peak. The measured mean may differ after clipping or noise.</p></ModelBlock>
          <ModelBlock title="Noise" tone="red"><p>Independent pixel noise spreads energy broadly across frequency. The sinusoidal peaks remain localized, but their contrast against the spectral floor decreases.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>One dimension</p><h2>The same frequency without orientation</h2></header>
        <div className="signal-pair">
          <figure><SignalPlot values={wave.row} reference={referenceMean} label="One-dimensional sinusoidal signal" /><figcaption>Signal samples · the faint horizontal rule is the selected reference mean.</figcaption></figure>
          <figure><SpectrumPlot values={wave.rowRawSpectrum} label="One-dimensional raw Fourier magnitude" /><figcaption>Raw magnitude · DC is centered after display shifting.</figcaption></figure>
          <figure><SpectrumPlot values={wave.rowCorrectedSpectrum} label="One-dimensional mean-subtracted Fourier magnitude" /><figcaption>Reference-mean removed · orientation has no role in a 1D signal.</figcaption></figure>
        </div>
        <ModelBlock title="Transform convention" tone="violet"><p>This page uses F[k] = Σ<sub>n</sub> f[n]e<sup>−2πikn/N</sup> and displays the zero frequency at the center. Magnitudes use log(1+|F|) only for visibility; the FFT itself is linear and unscaled.</p></ModelBlock>
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>Natural images</p><h2>Transform each primary channel independently</h2></header>
        <div className="image-fourier-layout">
          <aside className="texture-image-picker">
            <div className="preset-strip">{PRESETS.map((preset) => <button type="button" className={imageSource === preset.src ? "active" : ""} key={preset.name} onClick={() => choosePreset(preset.src, preset.name)}>{preset.name}</button>)}</div>
            <label className="file-control">Load another image<input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} /></label>
            <label className="check-control"><input type="checkbox" checked={useWindow} onChange={(event) => { setLoaded(null); setUseWindow(event.target.checked); }} /><span>Hann window before the transform</span></label>
            <p>Images are centre-cropped, resized to {IMAGE_SIZE}×{IMAGE_SIZE}, and transformed locally in this browser. The DFT treats the image as periodic, so without a window the jump between opposite borders adds false energy along the u and v axes.</p>
          </aside>
          <div className="image-spectrum-pair">
            <figure><img src={imageSource} alt={`${imageName} texture selected for Fourier analysis`} /><figcaption>{imageName} · source image</figcaption></figure>
            <figure className="spectral-panel">{loaded ? <RasterCanvas pixels={loaded.spectrum} size={IMAGE_SIZE} label={`Combined RGB Fourier magnitude of ${imageName}`} /> : <div className="texture-loading">Computing…</div>}<figcaption>RGB log magnitude at {IMAGE_SIZE}×{IMAGE_SIZE} · R, G, and B are transformed separately, then shown in their corresponding display primaries; brightness spans the 35th to 99.5th percentile, so the weakest noise floor is black.{useWindow ? " Hann window applied." : " No window: the bright cross along the axes comes from the image borders, not from the texture."}</figcaption></figure>
          </div>
        </div>
        {loaded && <div className="channel-mean-row"><span>subtracted channel means</span><strong>R {loaded.means[0].toFixed(1)}</strong><strong>G {loaded.means[1].toFixed(1)}</strong><strong>B {loaded.means[2].toFixed(1)}</strong></div>}
        <ModelBlock title="Reading a texture spectrum"><p>Strong directional structure creates energy along the normal direction in frequency space. Fine repetition appears farther from the center; coarse variation stays near it. A Fourier magnitude is global, so it records which frequencies occur but not where they occur.</p></ModelBlock>
      </section>

      <RingWedgeSection imageSource={imageSource} imageName={imageName} presets={PRESETS} />
    </DemoChrome>
  );
}
