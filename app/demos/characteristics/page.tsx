"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { Raster, rangeRgba, signedRgba } from "../_components/Raster";
import { loadImageElement, lumaOf, renderView } from "../_lib/image.ts";
import { autocorrelation, correlationLengths, regularity, spectralOrientation } from "../_lib/characteristics.ts";
import { centredLogPower, polarPower, windowedSpectrum } from "../_lib/spectrum.ts";
import { withBasePath } from "../_lib/paths.ts";

const SIZE = 256;
const MAX_LAG = 64;
const PRESETS = [
  { name: "Wicker", src: withBasePath("/textures/wicker.png") },
  { name: "Painting", src: withBasePath("/textures/painting.png") },
  { name: "Textile", src: withBasePath("/textures/textile.png") },
  { name: "Cloud", src: withBasePath("/textures/cloud.png") },
  { name: "Co-occurrence texture", src: withBasePath("/textures/coocur-texture.png") },
];
const LECTURE_LABELS: Record<string, string> = {
  Wicker: "oriented (slide 49) · fine (slide 51)",
  Painting: "example texture (slide 48)",
  Textile: "regular (slide 50) · coarse (slide 51)",
  Cloud: "isotropic (slide 49) · stochastic (slide 50)",
  "Co-occurrence texture": "co-occurrence example (slide 60)",
};

type Measures = {
  values: Float64Array;
  logPower: Float64Array;
  anisotropy: number;
  angle: number;
  ac: Float64Array;
  half: number | null;
  zero: number | null;
  profile: Float64Array;
  regularity: number;
  peak: { x: number; y: number } | null;
};

function measure(values: Float64Array): Measures {
  const polar = polarPower(windowedSpectrum(values, SIZE).spectrum);
  const orientation = spectralOrientation(polar);
  const ac = autocorrelation(values, SIZE, MAX_LAG);
  const lengths = correlationLengths(ac);
  const repetition = regularity(ac);
  return { values, logPower: centredLogPower(polar), anisotropy: orientation.anisotropy, angle: orientation.angle, ac: ac.values, half: lengths.half, zero: lengths.zero, profile: lengths.profile, regularity: repetition.index, peak: repetition.peak };
}

function viewValues(image: HTMLImageElement, zoom: number, rotation: number, noise: number) {
  const values = lumaOf(renderView(image, SIZE, zoom, rotation).rgba);
  if (noise > 0) {
    // Deterministic Gaussian noise (Box–Muller on a fixed linear congruential sequence).
    let state = 12345;
    const uniform = () => ((state = (state * 16807) % 2147483647) / 2147483647);
    for (let index = 0; index < values.length; index += 2) {
      const radius = Math.sqrt(-2 * Math.log(uniform() || 1e-12));
      const angle = 2 * Math.PI * uniform();
      values[index] += noise * radius * Math.cos(angle);
      if (index + 1 < values.length) values[index + 1] += noise * radius * Math.sin(angle);
    }
  }
  return values;
}

function SpectrumWithDirection({ logPower, anisotropy, angle }: { logPower: Float64Array; anisotropy: number; angle: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const sorted = Float64Array.from(logPower).sort();
    const low = sorted[Math.floor(sorted.length * 0.05)];
    const high = sorted[Math.floor(sorted.length * 0.998)];
    const rgba = new Uint8ClampedArray(logPower.length * 4);
    logPower.forEach((value, index) => {
      const level = Math.round(235 * Math.min(1, Math.max(0, (value - low) / Math.max(1e-12, high - low))) ** 1.4);
      rgba.set([level, level, level, 255], index * 4);
    });
    const offscreen = document.createElement("canvas");
    offscreen.width = SIZE;
    offscreen.height = SIZE;
    offscreen.getContext("2d")?.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    const centre = ((SIZE / 2 + 0.5) / SIZE) * canvas.width;
    const length = 0.5 * canvas.width * Math.max(0.08, anisotropy);
    const radians = (angle * Math.PI) / 180;
    context.lineWidth = 3;
    context.strokeStyle = "#ef573f";
    context.beginPath();
    context.moveTo(centre - length * Math.cos(radians), centre - length * Math.sin(radians));
    context.lineTo(centre + length * Math.cos(radians), centre + length * Math.sin(radians));
    context.stroke();
  }, [angle, anisotropy, logPower]);
  return <canvas ref={ref} width={420} height={420} className="texture-raster" role="img" aria-label={`Log power spectrum; dominant frequency direction ${angle.toFixed(0)} degrees, anisotropy ${anisotropy.toFixed(2)}`} />;
}

function AutocorrelationView({ ac, zero, peak }: { ac: Float64Array; zero: number | null; peak: { x: number; y: number } | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const span = 2 * MAX_LAG + 1;
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = span;
    offscreen.height = span;
    offscreen.getContext("2d")?.putImageData(new ImageData(signedRgba(ac), span, span), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    const scale = canvas.width / span;
    const centre = (MAX_LAG + 0.5) * scale;
    if (zero !== null) {
      context.setLineDash([5, 4]);
      context.strokeStyle = "#204ad8";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(centre, centre, zero * scale, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    if (peak) {
      for (const sign of [1, -1]) {
        const x = centre + sign * peak.x * scale;
        const y = centre + sign * peak.y * scale;
        context.strokeStyle = "#ef573f";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(x, y, 9, 0, Math.PI * 2);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(centre, centre);
      context.lineTo(centre + peak.x * scale, centre + peak.y * scale);
      context.stroke();
    }
  }, [ac, peak, span, zero]);
  return <canvas ref={ref} width={420} height={420} className="texture-raster" role="img" aria-label="Normalized autocorrelation for lags up to 64 pixels" />;
}

function ProfilePlot({ profile, half, zero }: { profile: Float64Array; half: number | null; zero: number | null }) {
  const width = 600;
  const height = 200;
  const toX = (radius: number) => 40 + (radius / MAX_LAG) * (width - 52);
  const toY = (value: number) => 12 + ((1 - value) / 1.5) * (height - 40);
  return <svg className="characteristics-profile" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Ring-averaged autocorrelation against lag radius">
    {[1, 0.5, 0, -0.5].map((value) => <g key={value}><line x1="40" x2={width - 12} y1={toY(value)} y2={toY(value)} className={value === 0 ? "zero" : "grid"} /><text x="34" y={toY(value) + 4} textAnchor="end">{value}</text></g>)}
    {[0, 16, 32, 48, 64].map((radius) => <text key={radius} x={toX(radius)} y={height - 8} textAnchor="middle">{radius}</text>)}
    <polyline points={Array.from(profile, (value, radius) => `${toX(radius).toFixed(1)},${toY(value).toFixed(1)}`).join(" ")} />
    {half !== null && <g className="mark half"><line x1={toX(half)} x2={toX(half)} y1={toY(1)} y2={toY(-0.5)} /><text x={toX(half) + 4} y={toY(0.5) - 6}>r½</text></g>}
    {zero !== null && <g className="mark zero"><line x1={toX(zero)} x2={toX(zero)} y1={toY(1)} y2={toY(-0.5)} /><text x={toX(zero) + 4} y={toY(0) - 6}>r₀</text></g>}
    <text x={width - 12} y={height - 24} textAnchor="end">lag radius (px)</text>
  </svg>;
}

function IndexBar({ label, value, maximum, text }: { label: string; value: number; maximum: number; text: string }) {
  return <div className="characteristics-index">
    <span>{label}</span>
    <strong>{text}</strong>
    <i aria-hidden="true"><b style={{ width: `${Math.min(100, (100 * value) / maximum)}%` }} /></i>
  </div>;
}

export default function CharacteristicsDemo() {
  const [source, setSource] = useState(PRESETS[0].src);
  const [sourceName, setSourceName] = useState(PRESETS[0].name);
  const [image, setImage] = useState<{ source: string; element: HTMLImageElement } | null>(null);
  const [presetImages, setPresetImages] = useState<Record<string, HTMLImageElement>>({});
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [noise, setNoise] = useState(0);
  const view = useDeferredValue(useMemo(() => ({ zoom, rotation, noise }), [noise, rotation, zoom]));

  useEffect(() => {
    let cancelled = false;
    loadImageElement(source).then((element) => { if (!cancelled) setImage({ source, element }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(PRESETS.map(async (preset) => [preset.name, await loadImageElement(preset.src)] as const))
      .then((entries) => { if (!cancelled) setPresetImages(Object.fromEntries(entries)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const element = image && image.source === source ? image.element : null;
  const current = useMemo(() => element ? measure(viewValues(element, view.zoom, view.rotation, view.noise)) : null, [element, view]);
  const inputRgba = useMemo(() => current ? rangeRgba(current.values) : null, [current]);
  const table = useMemo(() => PRESETS.filter((preset) => presetImages[preset.name]).map((preset) => ({ preset, result: measure(viewValues(presetImages[preset.name], 1, 0, 0)) })), [presetImages]);
  const region = element ? Math.min(element.naturalWidth, element.naturalHeight) / (Math.SQRT2 * zoom) : null;

  function uploadImage(file?: File) {
    if (!file) return;
    setSource((previous) => {
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setSourceName(file.name);
  }

  return (
    <DemoChrome number="T01" title="Texture characteristics" subtitle="Measure three properties the lecture uses to describe textures: orientedness, coarseness and regularity. Rotate, magnify or add noise to a texture and check that each measurement changes the way the property should.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Measurements</p><h2>Orientation, scale and repetition</h2></header>
        <div className="characteristics-layout">
          <aside className="texture-image-picker">
            <div className="preset-strip">{PRESETS.map((preset) => <button type="button" key={preset.name} className={source === preset.src ? "active" : ""} aria-pressed={source === preset.src} onClick={() => { setSource(preset.src); setSourceName(preset.name); }}>{preset.name}</button>)}</div>
            <label className="file-control">Load another image<input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} /></label>
            <label className="texture-control"><span>Rotation (clockwise)</span><strong>{rotation}°</strong><input type="range" min="0" max="180" step="5" value={rotation} onChange={(event) => setRotation(Number(event.target.value))} /></label>
            <label className="texture-control"><span>Magnification</span><strong>×{zoom.toFixed(2)}</strong><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
            <label className="texture-control"><span>Added Gaussian noise σ</span><strong>{noise} gray levels</strong><input type="range" min="0" max="80" step="5" value={noise} onChange={(event) => setNoise(Number(event.target.value))} /></label>
            <p>View: the central {region ? Math.round(region) : "…"}-pixel square of the source (side/(√2 × magnification), so every rotation fits), resampled to {SIZE}×{SIZE}; luma.</p>
            {current && <div className="characteristics-indices">
              <IndexBar label="Orientedness A" value={current.anisotropy} maximum={1} text={`${current.anisotropy.toFixed(2)} · frequency vector at ${current.angle.toFixed(0)}°`} />
              <IndexBar label="Coarseness r₀" value={current.zero ?? MAX_LAG} maximum={MAX_LAG} text={current.zero === null ? `> ${MAX_LAG} px` : `${current.zero.toFixed(1)} px`} />
              <IndexBar label="Regularity ρ" value={current.regularity} maximum={1} text={`${current.regularity.toFixed(2)}${current.peak ? ` · repeats at (${current.peak.x}, ${current.peak.y})` : " · no repetition found"}`} />
            </div>}
            <p className="characteristics-caveat"><strong>Caveat.</strong> These three indices are definitions chosen for this page to make each property measurable. Other definitions, such as Tamura&apos;s features, give different numbers and sometimes different rankings; the lecture&apos;s descriptions remain the reference.</p>
          </aside>
          <div className="characteristics-views">
            <figure>{inputRgba ? <Raster rgba={inputRgba} size={SIZE} label={`${sourceName} view used for the measurements`} /> : <div className="texture-loading">Loading…</div>}<figcaption>{sourceName} · display stretched to its range</figcaption></figure>
            <figure className="spectral-panel">{current ? <SpectrumWithDirection logPower={current.logPower} anisotropy={current.anisotropy} angle={current.angle} /> : <div className="texture-loading">…</div>}<figcaption>Log power spectrum (Hann window, u right, v down). Red line: dominant frequency direction, length ∝ A.</figcaption></figure>
            <figure className="spectral-panel">{current ? <AutocorrelationView ac={current.ac} zero={current.zero} peak={current.peak} /> : <div className="texture-loading">…</div>}<figcaption>Autocorrelation R(τ) for |τx|, |τy| ≤ {MAX_LAG} px · mid-gray 0, white 1. Blue: r₀. Red: strongest repetition outside it.</figcaption></figure>
            <figure>{current ? <ProfilePlot profile={current.profile} half={current.half} zero={current.zero} /> : null}<figcaption>Ring-averaged autocorrelation R̄(r). r½: first fall to ½ (finest dominant structure) · r₀: first fall to 0 (size of the largest coherent primitives).</figcaption></figure>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Orientedness"><p>A = |Σ P(u,v)e<sup>i2θ</sup>| / Σ P(u,v), with θ the direction of each frequency vector. Doubling θ treats opposite directions as one orientation. A = 1 for parallel stripes and A ≈ 0 when power is spread evenly over directions. Rotating the image rotates the reported direction by the same angle.</p></ModelBlock>
          <ModelBlock title="Coarseness" tone="green"><p>r₀ is the distance at which pixel values stop being correlated on average. Large primitives keep neighbors similar over longer distances. Some textures have two scales: textile has fine threads inside large woven blocks, so its r½ is small while its r₀ is large. Magnification multiplies both.</p></ModelBlock>
          <ModelBlock title="Regularity" tone="red"><p>ρ is the highest autocorrelation outside the central lobe (|τ| ≥ r₀). A repeating pattern correlates with a copy of itself shifted by one period, so ρ approaches 1; a stochastic texture has no such peak. The peak&apos;s position is a period vector, a natural displacement for a co-occurrence matrix. Noise lowers ρ.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>The lecture&apos;s examples</p><h2>Do the measurements agree with the labels?</h2></header>
        {table.length ? <div className="characteristics-table-wrap"><table className="characteristics-table">
          <thead><tr><th scope="col">Texture</th><th scope="col">Label in the lecture</th><th scope="col">Orientedness A</th><th scope="col">Coarseness r₀</th><th scope="col">Regularity ρ</th></tr></thead>
          <tbody>{table.map(({ preset, result }) => <tr key={preset.name} className={source === preset.src ? "current" : ""}>
            <th scope="row">{preset.name}</th>
            <td>{LECTURE_LABELS[preset.name]}</td>
            <td>{result.anisotropy.toFixed(2)}</td>
            <td>{result.zero === null ? `> ${MAX_LAG} px` : `${result.zero.toFixed(1)} px`}</td>
            <td>{result.regularity.toFixed(2)}</td>
          </tr>)}</tbody>
        </table></div> : <div className="texture-loading">Measuring the supplied textures…</div>}
        <p className="characteristics-note">Pairs to compare: wicker versus cloud for orientedness, textile versus cloud for regularity, textile versus wicker for coarseness. Values are for the unrotated, unmagnified, noise-free view.</p>
        <div className="explanation-grid three">
          <ModelBlock title="Illustrative indices"><p>These three numbers are defined for this page so that each property has one explicit, inspectable formula. They are not a standard feature set; the classical one is due to Tamura, Mori and Yamawaki (1978), whose coarseness, directionality and regularity measures follow similar ideas with different formulas.</p></ModelBlock>
          <ModelBlock title="Scale matters" tone="green"><p>Every value depends on the resolution at which the texture is viewed. A texture is coarse or fine only relative to the window and pixel size, which is why the same pattern can look regular at one magnification and stochastic at another.</p></ModelBlock>
          <ModelBlock title="Where these ideas lead" tone="violet"><p>The power spectrum behind orientedness leads to Fourier ring and wedge features; the autocorrelation behind coarseness and regularity is the second-order statistic that co-occurrence matrices refine by counting gray-level pairs.</p></ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
