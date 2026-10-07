"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { Raster, grayToRgba, signedRgba, unsignedRgba } from "../_components/Raster";
import { cropDescription, loadSquareImage, lumaOf } from "../_lib/image.ts";
import {
  bandEnergy,
  carrier,
  filterBank,
  filterResponse,
  frequencyPrecision,
  halfPowerRadius,
  kernelSpectrum,
  octaveBandwidth,
  prepareImage,
  realKernel,
  supportRadius,
  windowedSpectrum,
} from "../_lib/gabor.ts";
import type { BankFilter, GaborParams } from "../_lib/gabor.ts";
import { withBasePath } from "../_lib/paths.ts";

const ANALYSIS_SIZE = 256;
const PLANE_SIZE = 480;
const PRESETS = [
  { name: "Wicker", src: withBasePath("/textures/wicker.png") },
  { name: "Textile", src: withBasePath("/textures/textile.png") },
  { name: "Painting", src: withBasePath("/textures/painting.png") },
  { name: "Cloud", src: withBasePath("/textures/cloud.png") },
  { name: "Co-occurrence texture", src: withBasePath("/textures/coocur-texture.png") },
];
const LOBE_COLOR = "#ef573f";

type GrayImage = { values: Float64Array; name: string; crop: string };

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

/** Canvas coordinate of frequency u (cycles/pixel) on an n-point centered DFT grid drawn `width` pixels wide. */
function frequencyToCanvas(u: number, n: number, width: number) {
  return ((u * n + n / 2 + 0.5) / n) * width;
}

function canvasToFrequency(c: number, n: number, width: number) {
  return ((c / width) * n - n / 2 - 0.5) / n;
}

function pointerToCanvas(event: PointerEvent<HTMLCanvasElement>) {
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth) * canvas.width,
    y: ((event.clientY - rect.top - canvas.clientTop) / canvas.clientHeight) * canvas.height,
  };
}

function drawFrequencyAxes(context: CanvasRenderingContext2D, n: number, width: number) {
  context.strokeStyle = "rgba(255,255,255,.28)";
  context.lineWidth = 1;
  context.fillStyle = "rgba(255,255,255,.7)";
  context.font = "11px Helvetica, Arial, sans-serif";
  const zero = frequencyToCanvas(0, n, width);
  context.beginPath();
  context.moveTo(zero, 0);
  context.lineTo(zero, width);
  context.moveTo(0, zero);
  context.lineTo(width, zero);
  context.stroke();
  for (const tick of [-0.25, 0.25]) {
    const position = frequencyToCanvas(tick, n, width);
    context.beginPath();
    context.moveTo(position, zero - 4);
    context.lineTo(position, zero + 4);
    context.moveTo(zero - 4, position);
    context.lineTo(zero + 4, position);
    context.stroke();
    context.fillText(tick.toFixed(2), position - 12, zero + 16);
  }
  context.fillText("u →", width - 28, zero - 6);
  context.fillText("v ↓", zero + 6, width - 8);
}

function drawLobeCircle(context: CanvasRenderingContext2D, u: number, v: number, radius: number, n: number, width: number) {
  context.beginPath();
  context.arc(frequencyToCanvas(u, n, width), frequencyToCanvas(v, n, width), (radius * width), 0, Math.PI * 2);
}

function KernelView({ params }: { params: GaborParams }) {
  const kernel = useMemo(() => realKernel(params), [params]);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = kernel.size;
    offscreen.height = kernel.size;
    offscreen.getContext("2d")?.putImageData(new ImageData(signedRgba(kernel.values), kernel.size, kernel.size), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    // Circle of radius 2Δ, where the amplitude envelope e^{−r²/(4Δ²)} equals 1/e.
    const scale = canvas.width / kernel.size;
    context.strokeStyle = "rgba(239,87,63,.9)";
    context.setLineDash([5, 4]);
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, 2 * params.delta * scale, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }, [kernel, params.delta]);
  return <canvas ref={ref} width={PLANE_SIZE} height={PLANE_SIZE} className="texture-raster" role="img" aria-label={`Sampled Gabor kernel, ${kernel.size} by ${kernel.size} pixels; mid-gray is zero`} />;
}

function SpectrumView({ params, onCarrierChange }: { params: GaborParams; onCarrierChange: (frequency: number, orientation: number) => void }) {
  const spectrum = useMemo(() => kernelSpectrum(params), [params]);
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const { fu, fv } = carrier(params);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const n = spectrum.size;
    const offscreen = document.createElement("canvas");
    offscreen.width = n;
    offscreen.height = n;
    offscreen.getContext("2d")?.putImageData(new ImageData(unsignedRgba(spectrum.magnitude), n, n), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    drawFrequencyAxes(context, n, canvas.width);
    const radius = halfPowerRadius(params.delta);
    context.setLineDash([5, 4]);
    context.strokeStyle = LOBE_COLOR;
    context.lineWidth = 1.5;
    for (const sign of [1, -1]) {
      drawLobeCircle(context, sign * fu, sign * fv, radius, n, canvas.width);
      context.stroke();
    }
    context.setLineDash([]);
    context.lineWidth = 3;
    context.strokeStyle = "#ffffff";
    context.beginPath();
    context.arc(frequencyToCanvas(fu, n, canvas.width), frequencyToCanvas(fv, n, canvas.width), 9, 0, Math.PI * 2);
    context.stroke();
  }, [fu, fv, params.delta, spectrum]);

  function update(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointerToCanvas(event);
    const u = canvasToFrequency(point.x, spectrum.size, event.currentTarget.width);
    const v = canvasToFrequency(point.y, spectrum.size, event.currentTarget.width);
    const frequency = clamp(Math.hypot(u, v), 0.01, 0.5);
    let orientation = (Math.atan2(v, u) * 180) / Math.PI;
    orientation = ((orientation % 180) + 180) % 180;
    onCarrierChange(Math.round(frequency * 1000) / 1000, Math.round(orientation * 2) / 2);
  }

  return <canvas
    ref={ref}
    width={PLANE_SIZE}
    height={PLANE_SIZE}
    className="texture-raster gabor-draggable"
    role="img"
    aria-label={`Fourier magnitude of the sampled kernel; carrier at u = ${fu.toFixed(3)}, v = ${fv.toFixed(3)} cycles per pixel`}
    onPointerDown={(event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = event.pointerId;
      update(event);
    }}
    onPointerMove={(event) => { if (dragging.current === event.pointerId) update(event); }}
    onPointerUp={(event) => { if (dragging.current === event.pointerId) dragging.current = null; }}
    onPointerCancel={() => { dragging.current = null; }}
  />;
}

function ProfilePlot({ params }: { params: GaborParams }) {
  const radius = supportRadius(params.delta);
  const width = 900;
  const height = 180;
  const psi = (params.phase * Math.PI) / 180;
  const toX = (t: number) => ((t + radius) / (2 * radius)) * width;
  const toY = (value: number) => height / 2 - value * (height / 2 - 12);
  const samples = Array.from({ length: 721 }, (_, index) => -radius + (index / 720) * 2 * radius);
  const envelope = (t: number) => Math.exp(-(t * t) / (4 * params.delta * params.delta));
  const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${toX(samples[index]).toFixed(1)},${toY(value).toFixed(1)}`).join("");
  const dots = Array.from({ length: 2 * radius + 1 }, (_, index) => index - radius);
  return <svg className="gabor-profile" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Kernel profile along the carrier direction through the center">
    <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="axis" />
    {[-params.delta, params.delta].map((t) => <line key={t} x1={toX(t).toFixed(1)} x2={toX(t).toFixed(1)} y1="6" y2={height - 6} className="delta-mark" />)}
    <path d={path(samples.map(envelope))} className="envelope" />
    <path d={path(samples.map((t) => -envelope(t)))} className="envelope" />
    <path d={path(samples.map((t) => envelope(t) * Math.cos(2 * Math.PI * params.frequency * t + psi)))} className="carrier" />
    {dots.length <= 121 && dots.map((t) => <circle key={t} cx={toX(t).toFixed(1)} cy={toY(envelope(t) * Math.cos(2 * Math.PI * params.frequency * t + psi)).toFixed(1)} r="2.2" className="sample" />)}
    <text x="8" y="16">+1</text><text x="8" y={height - 6}>−1</text><text x={(toX(params.delta) + 5).toFixed(1)} y="16">+Δ</text>
    <text x={width - 72} y={height / 2 - 6}>t (px)</text>
  </svg>;
}

/** Log power spectrum of the windowed image, zero frequency at the center (index n/2). */
function shiftedLogPower(windowed: ReturnType<typeof windowedSpectrum>) {
  const { re, im, size: n } = windowed.spectrum;
  const output = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const source = ((y + n / 2) % n) * n + ((x + n / 2) % n);
      output[y * n + x] = Math.log1p(re[source] ** 2 + im[source] ** 2);
    }
  }
  return output;
}

function BankPlane({ bank, energies, selected, background, onSelect }: { bank: BankFilter[]; energies: number[] | null; selected: number; background: Float64Array | null; onSelect: (index: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = ANALYSIS_SIZE;
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#050505";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (background) {
      const offscreen = document.createElement("canvas");
      offscreen.width = n;
      offscreen.height = n;
      let minimum = Infinity;
      let maximum = -Infinity;
      for (const value of background) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
      offscreen.getContext("2d")?.putImageData(new ImageData(grayToRgba(background, (value) => 150 * ((value - minimum) / Math.max(1e-12, maximum - minimum)) ** 2), n, n), 0, 0);
      context.imageSmoothingEnabled = false;
      context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    }
    drawFrequencyAxes(context, n, canvas.width);
    const peak = energies ? Math.max(...energies, 1e-12) : 1;
    bank.forEach((filter, index) => {
      const { fu, fv } = carrier(filter);
      const radius = halfPowerRadius(filter.delta);
      for (const sign of [1, -1]) {
        drawLobeCircle(context, sign * fu, sign * fv, radius, n, canvas.width);
        if (energies) {
          context.fillStyle = `rgba(239,87,63,${(0.85 * energies[index]) / peak})`;
          context.fill();
        }
        context.lineWidth = index === selected ? 3 : 1;
        context.strokeStyle = index === selected ? "#ffffff" : "rgba(239,87,63,.85)";
        context.stroke();
      }
    });
  }, [background, bank, energies, n, selected]);

  function pick(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointerToCanvas(event);
    const u = canvasToFrequency(point.x, n, event.currentTarget.width);
    const v = canvasToFrequency(point.y, n, event.currentTarget.width);
    let best = -1;
    let bestScore = Infinity;
    bank.forEach((filter, index) => {
      const { fu, fv } = carrier(filter);
      const distance = Math.min(Math.hypot(u - fu, v - fv), Math.hypot(u + fu, v + fv)) / halfPowerRadius(filter.delta);
      if (distance <= 1.15 && distance < bestScore) { best = index; bestScore = distance; }
    });
    if (best >= 0) onSelect(best);
  }

  return <canvas ref={ref} width={PLANE_SIZE} height={PLANE_SIZE} className="texture-raster gabor-draggable" role="img" aria-label="Half-power circles of the filter bank in the frequency plane, filled in proportion to texture energy" onPointerDown={pick} />;
}

export default function GaborDemo() {
  const [frequency, setFrequency] = useState(0.2);
  const [orientation, setOrientation] = useState(30);
  const [delta, setDelta] = useState(3);
  const [phase, setPhase] = useState(0);
  const [source, setSource] = useState(PRESETS[0].src);
  const [sourceName, setSourceName] = useState(PRESETS[0].name);
  const [image, setImage] = useState<GrayImage | null>(null);
  const [maxFrequency, setMaxFrequency] = useState(0.4);
  const [scales, setScales] = useState(4);
  const [orientations, setOrientations] = useState(6);
  const [octaves, setOctaves] = useState(1);
  // The selection is tagged with the bank it belongs to, so it lapses when the bank changes.
  const [selection, setSelection] = useState<{ bank: BankFilter[]; index: number } | null>(null);

  const params = useMemo<GaborParams>(() => ({ frequency, orientation, delta, phase }), [delta, frequency, orientation, phase]);
  const deferredParams = useDeferredValue(params);
  const deltaU = frequencyPrecision(delta);
  const radius = halfPowerRadius(delta);
  const bandwidth = octaveBandwidth(frequency, delta);
  const dcRatio = useMemo(() => kernelSpectrum(params).dcRatio, [params]);

  useEffect(() => {
    let cancelled = false;
    loadSquareImage(source, ANALYSIS_SIZE).then((loaded) => {
      if (!cancelled) setImage({ values: lumaOf(loaded.rgba), name: sourceName, crop: cropDescription(loaded) });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [source, sourceName]);

  const inputRgba = useMemo(() => image ? unsignedRgba(image.values) : null, [image]);
  const prepared = useMemo(() => image ? prepareImage(image.values, ANALYSIS_SIZE) : null, [image]);
  const windowed = useMemo(() => image ? windowedSpectrum(image.values, ANALYSIS_SIZE) : null, [image]);
  const background = useMemo(() => windowed ? shiftedLogPower(windowed) : null, [windowed]);
  // The complex response does not depend on ψ; the real response for any ψ is Re(e^{iψ}·r).
  const response = useMemo(() => prepared ? filterResponse(prepared, { ...deferredParams, phase: 0 }) : null, [deferredParams, prepared]);
  const views = useMemo(() => {
    if (!response) return null;
    const psi = (deferredParams.phase * Math.PI) / 180;
    const real = Float64Array.from(response.re, (value, index) => value * Math.cos(psi) - response.im[index] * Math.sin(psi));
    const magnitude = Float64Array.from(response.re, (value, index) => Math.hypot(value, response.im[index]));
    return { real: signedRgba(real), magnitude: unsignedRgba(magnitude) };
  }, [deferredParams.phase, response]);

  const bank = useMemo(() => filterBank({ maxFrequency, scales, orientations, octaves }), [maxFrequency, octaves, orientations, scales]);

  const energies = useMemo(() => windowed ? bank.map((filter) => bandEnergy(windowed, filter)) : null, [bank, windowed]);
  const selected = selection && selection.bank === bank ? selection.index : -1;
  const totalEnergy = energies ? energies.reduce((sum, value) => sum + value, 0) : 0;

  function selectBankFilter(index: number) {
    const filter = bank[index];
    setSelection({ bank, index });
    setFrequency(filter.frequency);
    setOrientation(filter.orientation);
    setDelta(filter.delta);
  }

  function setCarrier(nextFrequency: number, nextOrientation: number) {
    setFrequency(nextFrequency);
    setOrientation(nextOrientation);
    setSelection(null);
  }

  function choosePreset(src: string, name: string) {
    setSource(src);
    setSourceName(name);
  }

  function uploadImage(file?: File) {
    if (!file) return;
    setSource((previous) => {
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setSourceName(file.name);
  }

  return (
    <DemoChrome number="T05" title="Gabor filters" subtitle="Shape one Gabor filter in the spatial and frequency domains, apply it locally to a texture, then cover the Fourier plane with a bank of filters whose output energies form a texture feature vector.">
      <section className="demo-section">
        <header className="section-heading compact"><p>One filter, two domains</p><h2>A Gaussian window on a cosine wave</h2></header>
        <div className="gabor-workbench">
          <aside className="texture-controls">
            <p className="formula-card">g(x,y) = e<sup>−(x²+y²)/(4Δ²)</sup> cos(2πf x′ + ψ)</p>
            <p>x′ = x cos θ + y sin θ. Here x runs right and y runs <strong>down</strong> (image rows), so θ turns clockwise on screen; f is in cycles per pixel (Nyquist 0.5).</p>
            <label className="texture-control"><span>Frequency f</span><strong>{frequency.toFixed(3)} cyc/px · λ = {(1 / frequency).toFixed(1)} px</strong><input type="range" min="0.01" max="0.5" step="0.005" value={frequency} onChange={(event) => setCarrier(Number(event.target.value), orientation)} /></label>
            <label className="texture-control"><span>Orientation θ</span><strong>{orientation.toFixed(1)}°</strong><input type="range" min="0" max="179.5" step="0.5" value={orientation} onChange={(event) => setCarrier(frequency, Number(event.target.value))} /></label>
            <label className="texture-control"><span>Spatial precision Δ<sub>x,y</sub></span><strong>{delta.toFixed(2)} px</strong><input type="range" min="0.75" max="24" step="0.05" value={delta} onChange={(event) => { setDelta(Number(event.target.value)); setSelection(null); }} /></label>
            <label className="texture-control"><span>Phase ψ</span><strong>{phase}°{phase === 0 ? " · even" : phase === 90 ? " · odd" : ""}</strong><input type="range" min="0" max="180" step="5" value={phase} onChange={(event) => setPhase(Number(event.target.value))} /></label>
            <div className="texture-readout gabor-readout">
              <span>Δ<sub>u,v</sub> = 1/(4πΔ<sub>x,y</sub>)</span><strong>{deltaU.toFixed(4)} cyc/px</strong>
              <span>Δ<sub>x,y</sub>·Δ<sub>u,v</sub></span><strong>{(delta * deltaU).toFixed(4)} = 1/(4π)</strong>
              <span>same in rad/px (ω = 2πu)</span><strong>{(delta * 2 * Math.PI * deltaU).toFixed(3)} = 1/2</strong>
              <span>half-power radius</span><strong>{radius.toFixed(4)} cyc/px</strong>
              <span>radial bandwidth</span><strong>{Number.isFinite(bandwidth) ? `${bandwidth.toFixed(2)} octaves` : "reaches DC"}</strong>
              <span>|G(0,0)| / max |G|</span><strong>{(100 * dcRatio).toFixed(1)} %</strong>
              <span>support (4√2Δ)</span><strong>{2 * supportRadius(delta) + 1} × {2 * supportRadius(delta) + 1} px</strong>
            </div>
          </aside>
          <div className="gabor-views">
            <figure><KernelView params={params} /><figcaption>Sampled kernel · mid-gray is 0, white and black are ±max. Each square is one pixel; on the dashed circle (r = 2Δ) the envelope has fallen to 1/e.</figcaption></figure>
            <figure className="spectral-panel"><SpectrumView params={params} onCarrierChange={setCarrier} /><figcaption>|DFT| of the sampled kernel (linear, u right, v down, ±0.5 cyc/px at the edges). <strong>Drag</strong> to move the carrier (sets f and θ). Dashed: half-power circles of radius √(2 ln 2)·Δ<sub>u,v</sub>.</figcaption></figure>
            <figure className="gabor-profile-figure"><ProfilePlot params={params} /><figcaption>Profile along x′ through the center: envelope ±e<sup>−t²/(4Δ²)</sup> (dashed), kernel (solid) and its samples at integer pixel offsets (dots, shown up to 121 samples); vertical rules at ±Δ.</figcaption></figure>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Two lobes, one filter"><p>The cosine splits into two complex exponentials, so the transform is a pair of Gaussian lobes at ±(f cos θ, f sin θ): G(u,v) = 2πΔ²[e<sup>iψ</sup>E(u−f<sub>u</sub>, v−f<sub>v</sub>) + e<sup>−iψ</sup>E(u+f<sub>u</sub>, v+f<sub>v</sub>)] with E(a,b) = e<sup>−4π²Δ²(a²+b²)</sup>. Raising f moves the lobes outward; rotating θ rotates them; the stripes in space run perpendicular to the carrier.</p></ModelBlock>
          <ModelBlock title="Precision in both domains" tone="green"><p>Δ<sub>x,y</sub> is the RMS width of the energy |envelope|²; each lobe has width Δ<sub>u,v</sub> = 1/(4πΔ<sub>x,y</sub>). The product is 1/(4π) when frequency is counted in cycles per pixel and 1/2 in radians per pixel, the form on the lecture slide. Gaussian windows attain this lower bound: a narrower kernel necessarily has wider lobes.</p></ModelBlock>
          <ModelBlock title="Phase and the zero frequency" tone="red"><p>ψ = 0 gives an even (symmetric) kernel, ψ = 90° an odd one; together they form a quadrature pair. When the lobes are wide compared with f, they overlap at the origin and the even kernel also responds to mean brightness: see |G(0,0)| / max |G|. Close to f = 0.5 the lobes cross the Nyquist border and the sampled filter aliases.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Local analysis</p><h2>Where in the image does this frequency occur?</h2></header>
        <div className="image-fourier-layout gabor-response-layout">
          <aside className="texture-image-picker">
            <div className="preset-strip">{PRESETS.map((preset) => <button type="button" className={source === preset.src ? "active" : ""} aria-pressed={source === preset.src} key={preset.name} onClick={() => choosePreset(preset.src, preset.name)}>{preset.name}</button>)}</div>
            <label className="file-control">Load another image<input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} /></label>
            <p>Center-cropped to a square, resized to {ANALYSIS_SIZE}×{ANALYSIS_SIZE}, converted to luma (Rec. 709 weights on the encoded values), and its mean subtracted. Processing stays in this browser.</p>
          </aside>
          <div className="gabor-response-grid">
            <figure>{inputRgba ? <Raster rgba={inputRgba} size={ANALYSIS_SIZE} label={`${sourceName}, grayscale analysis image`} /> : <div className="texture-loading">Loading…</div>}<figcaption>{sourceName} · {image ? image.crop : "analysis image"}</figcaption></figure>
            <figure className="spectral-panel">{views ? <Raster rgba={views.real} size={ANALYSIS_SIZE} label={`Response to the kernel with phase ${deferredParams.phase} degrees`} /> : <div className="texture-loading">Computing…</div>}<figcaption>Response I * g<sub>ψ</sub> for ψ = {deferredParams.phase}° · signed, mid-gray is 0</figcaption></figure>
            <figure className="spectral-panel">{views ? <Raster rgba={views.magnitude} size={ANALYSIS_SIZE} label="Quadrature magnitude of the Gabor response" /> : <div className="texture-loading">Computing…</div>}<figcaption>Quadrature magnitude |I * h| = √(even² + odd²) · black is 0</figcaption></figure>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Global versus local"><p>A Fourier magnitude says which frequencies a texture contains but not where they are. The Gabor response is a local measurement: bright regions of the magnitude image contain structure near (f, θ) within about Δ pixels.</p></ModelBlock>
          <ModelBlock title="Quadrature magnitude" tone="green"><p>The signed response oscillates with the stripes it detects. Combining the even and odd responses, √(even² + odd²), removes that oscillation and leaves a smooth local amplitude that does not depend on ψ.</p></ModelBlock>
          <ModelBlock title="How it is computed" tone="violet"><p>Convolution in the Fourier domain with the sampled complex kernel h = envelope·e<sup>i2π(f<sub>u</sub>x+f<sub>v</sub>y)</sup>, scaled to unit gain at the carrier. The image is mirrored at its borders first, so circular convolution does not create artificial edges. Display brightness is scaled to the largest value in each panel.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>Filter bank</p><h2>Cover the Fourier plane, read off energies</h2></header>
        <div className="gabor-bank-layout">
          <aside className="texture-controls">
            <label className="texture-control"><span>Highest frequency f<sub>1</sub></span><strong>{maxFrequency.toFixed(2)} cyc/px</strong><input type="range" min="0.2" max="0.45" step="0.05" value={maxFrequency} onChange={(event) => setMaxFrequency(Number(event.target.value))} /></label>
            <label className="texture-control"><span>Scales (octave spacing)</span><strong>{scales}</strong><input type="range" min="1" max="5" step="1" value={scales} onChange={(event) => setScales(Number(event.target.value))} /></label>
            <label className="texture-control"><span>Orientations over 180°</span><strong>{orientations} · every {(180 / orientations).toFixed(1)}°</strong><input type="range" min="2" max="8" step="1" value={orientations} onChange={(event) => setOrientations(Number(event.target.value))} /></label>
            <label className="texture-control"><span>Radial bandwidth (sets Δ automatically)</span><strong>{octaves.toFixed(2)} octaves</strong><input type="range" min="0.5" max="2" step="0.25" value={octaves} onChange={(event) => setOctaves(Number(event.target.value))} /></label>
            <p>f<sub>s</sub> = f<sub>1</sub>/2<sup>s−1</sup>; each filter receives the Δ that gives the chosen bandwidth, so Δ<sub>u,v</sub> grows in proportion to f. Click a circle or a table cell to inspect that filter in the sections above.</p>
            <p className="gabor-progress" aria-live="polite">{energies ? `${bank.length} filters · ${sourceName}` : "Loading image…"}</p>
          </aside>
          <figure className="spectral-panel gabor-plane"><BankPlane bank={bank} energies={energies} selected={selected} background={background} onSelect={selectBankFilter} /><figcaption>Half-power circles of every filter (both lobes), filled in proportion to its energy on {sourceName}. Background: log power spectrum |Î<sub>w</sub>|² of the Hann-windowed analysis image, the quantity each filter integrates.</figcaption></figure>
          <div className="gabor-energy-table-wrap">
            <table className="gabor-energy-table">
              <caption>Share of total bank energy, E<sub>k</sub>/ΣE (%)</caption>
              <thead><tr><th scope="col">f \ θ</th>{Array.from({ length: orientations }, (_, index) => <th scope="col" key={index}>{((index * 180) / orientations).toFixed(index * 180 % orientations ? 1 : 0)}°</th>)}</tr></thead>
              <tbody>{Array.from({ length: scales }, (_, scale) => <tr key={scale}>
                <th scope="row">{(maxFrequency / 2 ** scale).toFixed(3)}</th>
                {Array.from({ length: orientations }, (_, column) => {
                  const index = scale * orientations + column;
                  const share = energies && totalEnergy > 0 ? energies[index] / totalEnergy : null;
                  return <td key={column}><button type="button" aria-pressed={selected === index} onClick={() => selectBankFilter(index)} style={{ background: share === null ? undefined : `rgba(239,87,63,${Math.min(0.85, share * orientations * scales * 0.35)})` }} aria-label={`f ${(maxFrequency / 2 ** scale).toFixed(3)}, θ ${((column * 180) / orientations).toFixed(1)} degrees${share === null ? "" : `, ${(100 * share).toFixed(1)} percent`}`}>{share === null ? "…" : (100 * share).toFixed(1)}</button></td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Constant relative bandwidth"><p>With octave-spaced centers and a fixed bandwidth in octaves, every filter covers the same fraction of its own frequency. At one octave the half-power circles of neighboring scales just touch: the circle around f spans 2f/3 to 4f/3.</p></ModelBlock>
          <ModelBlock title="Gaps and overlaps" tone="green"><p>Too few orientations leave angular gaps where a texture can have energy that no filter measures; too many make neighboring filters redundant. Compare the circles with the bright parts of the background spectrum.</p></ModelBlock>
          <ModelBlock title="A feature vector" tone="red"><p>The output energy of each filter, one number per (f, θ), is a texture descriptor. By Parseval&apos;s theorem it equals the power spectrum weighted by |H<sub>k</sub>|², E<sub>k</sub> ∝ Σ<sub>u,v</sub>|Î<sub>w</sub>|²|H<sub>k</sub>|², a soft version of the ring-and-wedge integrals of the Fourier features. The image is Hann-windowed rather than mirrored here, because mirroring would merge θ with −θ. Energies scale with contrast, so the table reports each filter&apos;s share of the total.</p></ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
