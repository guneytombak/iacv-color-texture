"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ModelBlock } from "../_components/DemoChrome";
import { loadSquareImage, lumaOf } from "../_lib/image.ts";
import {
  angularProfile,
  centredLogPower,
  inWedge,
  polarPower,
  radialProfile,
  ringFraction,
  wedgeFraction,
  windowedSpectrum,
} from "../_lib/spectrum.ts";
import type { PolarPower } from "../_lib/spectrum.ts";

const FEATURE_SIZE = 256;
const CANVAS = 420;
const MAX_RADIUS = 0.7;
const RADIAL_BINS = 50;
const ANGULAR_BINS = 36;

type Preset = { name: string; src: string };

async function loadPolar(source: string) {
  const image = await loadSquareImage(source, FEATURE_SIZE);
  return polarPower(windowedSpectrum(lumaOf(image.rgba), FEATURE_SIZE).spectrum);
}

/** Canvas position of frequency u for a centred n-point grid drawn `width` pixels wide. */
function toCanvas(u: number, width: number) {
  return ((u * FEATURE_SIZE + FEATURE_SIZE / 2 + 0.5) / FEATURE_SIZE) * width;
}

function pointerFrequency(event: PointerEvent<HTMLCanvasElement>) {
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth) * canvas.width;
  const y = ((event.clientY - rect.top - canvas.clientTop) / canvas.clientHeight) * canvas.height;
  const centre = toCanvas(0, canvas.width);
  const u = ((x - centre) / canvas.width);
  const v = ((y - centre) / canvas.height);
  return { radius: Math.hypot(u, v), angle: ((((Math.atan2(v, u) * 180) / Math.PI) % 180) + 180) % 180 };
}

function angularDistance(a: number, b: number) {
  const difference = Math.abs(a - b) % 180;
  return Math.min(difference, 180 - difference);
}

function SpectrumCanvas({ polar, label, draw, onPointer }: { polar: PolarPower; label: string; draw: (context: CanvasRenderingContext2D, width: number) => void; onPointer: (point: { radius: number; angle: number }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const background = useMemo(() => {
    const values = centredLogPower(polar);
    const sorted = Float64Array.from(values).sort();
    const high = sorted[Math.floor(sorted.length * 0.998)] || 1;
    const low = sorted[Math.floor(sorted.length * 0.05)];
    const rgba = new Uint8ClampedArray(values.length * 4);
    values.forEach((value, index) => {
      const level = Math.round(230 * Math.min(1, Math.max(0, (value - low) / Math.max(1e-12, high - low))) ** 1.4);
      rgba[index * 4] = level;
      rgba[index * 4 + 1] = level;
      rgba[index * 4 + 2] = level;
      rgba[index * 4 + 3] = 255;
    });
    return rgba;
  }, [polar]);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = FEATURE_SIZE;
    offscreen.height = FEATURE_SIZE;
    offscreen.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(background), FEATURE_SIZE, FEATURE_SIZE), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    const centre = toCanvas(0, canvas.width);
    context.strokeStyle = "rgba(255,255,255,.35)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centre, 0);
    context.lineTo(centre, canvas.height);
    context.moveTo(0, centre);
    context.lineTo(canvas.width, centre);
    context.stroke();
    context.fillStyle = "rgba(255,255,255,.75)";
    context.font = "12px Helvetica, Arial, sans-serif";
    context.fillText("u →", canvas.width - 30, centre - 6);
    context.fillText("v ↓", centre + 6, canvas.height - 8);
    draw(context, canvas.width);
  }, [background, draw]);

  return <canvas
    ref={ref}
    width={CANVAS}
    height={CANVAS}
    className="texture-raster ring-wedge-canvas"
    role="img"
    aria-label={label}
    onPointerDown={(event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = event.pointerId;
      onPointer(pointerFrequency(event));
    }}
    onPointerMove={(event) => { if (dragging.current === event.pointerId) onPointer(pointerFrequency(event)); }}
    onPointerUp={() => { dragging.current = null; }}
    onPointerCancel={() => { dragging.current = null; }}
  />;
}

function ProfileBars({ values, highlight, ticks, label }: { values: Float64Array; highlight: (index: number) => boolean; ticks: { at: number; text: string }[]; label: string }) {
  const width = 600;
  const height = 150;
  const maximum = Math.max(...values, 1e-12);
  const barWidth = width / values.length;
  return <svg className="ring-wedge-profile" viewBox={`0 0 ${width} ${height + 22}`} role="img" aria-label={label}>
    {Array.from(values, (value, index) => {
      const barHeight = (value / maximum) * (height - 6);
      return <rect key={index} x={(index * barWidth + 0.5).toFixed(1)} y={(height - barHeight).toFixed(1)} width={(barWidth - 1).toFixed(1)} height={barHeight.toFixed(1)} className={highlight(index) ? "selected" : ""} />;
    })}
    <line x1="0" x2={width} y1={height} y2={height} className="axis" />
    {ticks.map((tick) => <text key={tick.text} x={(tick.at * width).toFixed(1)} y={height + 16} textAnchor={tick.at <= 0 ? "start" : tick.at >= 1 ? "end" : "middle"}>{tick.text}</text>)}
  </svg>;
}

export function RingWedgeSection({ imageSource, imageName, presets }: { imageSource: string; imageName: string; presets: Preset[] }) {
  const [inner, setInner] = useState(0.05);
  const [outer, setOuter] = useState(0.15);
  const [start, setStart] = useState(75);
  const [end, setEnd] = useState(105);
  const [polar, setPolar] = useState<{ source: string; value: PolarPower } | null>(null);
  const [presetPolars, setPresetPolars] = useState<Record<string, PolarPower>>({});

  useEffect(() => {
    let cancelled = false;
    loadPolar(imageSource).then((value) => { if (!cancelled) setPolar({ source: imageSource, value }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [imageSource]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(presets.map(async (preset) => [preset.name, await loadPolar(preset.src)] as const))
      .then((entries) => { if (!cancelled) setPresetPolars(Object.fromEntries(entries)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [presets]);

  const current = polar && polar.source === imageSource ? polar.value : null;
  const radial = useMemo(() => current ? radialProfile(current, RADIAL_BINS) : null, [current]);
  const angular = useMemo(() => current ? angularProfile(current, ANGULAR_BINS) : null, [current]);

  const drawRing = useMemo(() => (context: CanvasRenderingContext2D, width: number) => {
    const centre = toCanvas(0, width);
    context.fillStyle = "rgba(239,87,63,.38)";
    context.beginPath();
    context.arc(centre, centre, outer * width, 0, Math.PI * 2);
    context.arc(centre, centre, inner * width, 0, Math.PI * 2, true);
    context.fill("evenodd");
    context.strokeStyle = "#ef573f";
    context.lineWidth = 2;
    for (const radius of [inner, outer]) {
      context.beginPath();
      context.arc(centre, centre, radius * width, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([4, 4]);
    context.strokeStyle = "rgba(255,255,255,.4)";
    context.beginPath();
    context.arc(centre, centre, 0.5 * width, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }, [inner, outer]);

  const drawWedge = useMemo(() => (context: CanvasRenderingContext2D, width: number) => {
    const centre = toCanvas(0, width);
    const sweep = ((end - start) % 180 + 180) % 180;
    context.fillStyle = "rgba(239,87,63,.38)";
    context.strokeStyle = "#ef573f";
    context.lineWidth = 2;
    for (const offset of [0, 180]) {
      const from = ((start + offset) * Math.PI) / 180;
      const to = ((start + offset + sweep) * Math.PI) / 180;
      context.beginPath();
      context.moveTo(centre, centre);
      context.arc(centre, centre, width, from, to);
      context.closePath();
      context.fill();
      context.stroke();
    }
  }, [end, start]);

  function moveRing({ radius }: { radius: number }) {
    const value = Math.min(MAX_RADIUS, Math.round(radius * 200) / 200);
    if (Math.abs(value - inner) <= Math.abs(value - outer)) setInner(Math.min(value, outer - 0.005));
    else setOuter(Math.max(value, inner + 0.005));
  }

  function moveWedge({ angle }: { angle: number }) {
    const value = Math.round(angle) % 180;
    if (angularDistance(value, start) <= angularDistance(value, end)) setStart(value);
    else setEnd(value);
  }

  const ring = current ? ringFraction(current, inner, outer) : null;
  const wedge = current ? wedgeFraction(current, start, end) : null;

  return <section className="demo-section alternate">
    <header className="section-heading compact"><p>Fourier features</p><h2>Integrate the power spectrum over rings and wedges</h2></header>
    <div className="ring-wedge-layout">
      <aside className="texture-controls">
        <p className="formula-card">F<sub>ring</sub> = Σ<sub>r₁ ≤ √(u²+v²) &lt; r₂</sub> |F(u,v)|² / Σ|F|²</p>
        <label className="texture-control"><span>Inner radius r₁</span><strong>{inner.toFixed(3)} cyc/px · λ {inner > 0 ? `${(1 / inner).toFixed(1)} px` : "∞"}</strong><input type="range" min="0" max={MAX_RADIUS} step="0.005" value={inner} onChange={(event) => setInner(Math.min(Number(event.target.value), outer - 0.005))} /></label>
        <label className="texture-control"><span>Outer radius r₂</span><strong>{outer.toFixed(3)} cyc/px · λ {(1 / outer).toFixed(1)} px</strong><input type="range" min="0.005" max={MAX_RADIUS} step="0.005" value={outer} onChange={(event) => setOuter(Math.max(Number(event.target.value), inner + 0.005))} /></label>
        <p className="formula-card">F<sub>wedge</sub> = Σ<sub>θ₁ ≤ θ &lt; θ₂</sub> |F(u,v)|² / Σ|F|²</p>
        <label className="texture-control"><span>Wedge start θ₁</span><strong>{start}°</strong><input type="range" min="0" max="179" step="1" value={start} onChange={(event) => setStart(Number(event.target.value))} /></label>
        <label className="texture-control"><span>Wedge end θ₂</span><strong>{end}°</strong><input type="range" min="0" max="179" step="1" value={end} onChange={(event) => setEnd(Number(event.target.value))} /></label>
        <div className="texture-readout">
          <span>ring power</span><strong>{ring === null ? "…" : `${(100 * ring).toFixed(1)} %`}</strong>
          <span>wedge power</span><strong>{wedge === null ? "…" : `${(100 * wedge).toFixed(1)} %`}</strong>
          <span>wedge width</span><strong>{(((end - start) % 180 + 180) % 180)}° of 180°</strong>
        </div>
      </aside>
      <div className="ring-wedge-views">
        <figure className="spectral-panel">{current ? <SpectrumCanvas polar={current} label={`Log power spectrum of ${imageName} with the selected ring`} draw={drawRing} onPointer={moveRing} /> : <div className="texture-loading">Computing…</div>}<figcaption><strong>Coarseness.</strong> Drag to move the nearer ring edge. Dashed circle: r = 0.5 (Nyquist along the axes).</figcaption></figure>
        <figure className="spectral-panel">{current ? <SpectrumCanvas polar={current} label={`Log power spectrum of ${imageName} with the selected wedge`} draw={drawWedge} onPointer={moveWedge} /> : <div className="texture-loading">Computing…</div>}<figcaption><strong>Directionality.</strong> Drag to move the nearer wedge edge; the opposite sector is always included.</figcaption></figure>
        <figure>{radial ? <ProfileBars values={radial} highlight={(index) => (index + 0.5) * (0.5 / RADIAL_BINS) >= inner && (index + 0.5) * (0.5 / RADIAL_BINS) < outer} ticks={[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((value) => ({ at: value / 0.5, text: value.toFixed(1) }))} label="Radial power distribution" /> : null}<figcaption>Power per radial band, r from 0 to 0.5 cyc/px (selected ring highlighted). Corners beyond 0.5 still count in the fractions.</figcaption></figure>
        <figure>{angular ? <ProfileBars values={angular} highlight={(index) => inWedge((index + 0.5) * (180 / ANGULAR_BINS), start, end)} ticks={[0, 45, 90, 135, 180].map((value) => ({ at: value / 180, text: `${value}°` }))} label="Angular power distribution" /> : null}<figcaption>Power per 5° direction band, θ from 0° to 180° (selected wedge highlighted).</figcaption></figure>
      </div>
    </div>
    <div className="ring-wedge-table-wrap">
      <table className="ring-wedge-table">
        <caption>The same ring and wedge applied to every supplied texture</caption>
        <thead><tr><th scope="col">Texture</th><th scope="col">Ring {inner.toFixed(3)}–{outer.toFixed(3)}</th><th scope="col">Wedge {start}°–{end}°</th><th scope="col">Strongest 5° band</th></tr></thead>
        <tbody>{presets.map((preset) => {
          const value = presetPolars[preset.name];
          const profile = value ? angularProfile(value, ANGULAR_BINS) : null;
          const strongest = profile ? profile.indexOf(Math.max(...profile)) * (180 / ANGULAR_BINS) : null;
          return <tr key={preset.name} className={preset.src === imageSource ? "current" : ""}>
            <th scope="row">{preset.name}</th>
            <td>{value ? `${(100 * ringFraction(value, inner, outer)).toFixed(1)} %` : "…"}</td>
            <td>{value ? `${(100 * wedgeFraction(value, start, end)).toFixed(1)} %` : "…"}</td>
            <td>{strongest === null ? "…" : `${strongest}°–${strongest + 180 / ANGULAR_BINS}°`}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="explanation-grid three">
      <ModelBlock title="Rings measure coarseness"><p>Coarse textures put their power near the origin; fine textures put it farther out. A ring from r₁ to r₂ collects the power of all structures with wavelengths between 1/r₂ and 1/r₁ pixels, whatever their direction.</p></ModelBlock>
      <ModelBlock title="Wedges measure directionality" tone="green"><p>Oriented textures concentrate power along the direction perpendicular to their stripes. Because P(u,v) = P(−u,−v) for a real image, each wedge also includes the opposite sector. Here θ = atan2(v,u) is measured from the u axis toward v, which points down as in the image; the slide writes arctan(u/v), which measures the same angle from the v axis.</p></ModelBlock>
      <ModelBlock title="Conventions and limits" tone="violet"><p>Luma of the centre-cropped image at {FEATURE_SIZE}×{FEATURE_SIZE}, mean removed and multiplied by a Hann window so that the image border does not add false power along the axes; DC is excluded from all sums. The features are global: they say which frequencies occur, not where. Gabor filters localize the same measurement.</p></ModelBlock>
    </div>
  </section>;
}
