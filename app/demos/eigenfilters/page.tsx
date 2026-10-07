"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { Raster, signedRgba, unsignedRgba } from "../_components/Raster";
import { cropDescription, loadSquareImage, lumaOf } from "../_lib/image.ts";
import { boxMean } from "../_lib/laws.ts";
import { detectFlaws, eigenResponses, energyMaps, maskCovariance, sparseOffsets, symmetricEigen } from "../_lib/eigen.ts";
import type { Rect } from "../_lib/eigen.ts";
import { withBasePath } from "../_lib/paths.ts";

const SIZE = 256;
const EDITOR = 512;
const PRESETS = [
  { name: "Textile", src: withBasePath("/textures/textile.png") },
  { name: "Wicker", src: withBasePath("/textures/wicker.png") },
  { name: "Co-occurrence texture", src: withBasePath("/textures/coocur-texture.png") },
  { name: "Cloud", src: withBasePath("/textures/cloud.png") },
];
const DEFAULT_TRAINING: Rect = { x0: 0, y0: 0, x1: SIZE, y1: SIZE / 2 };
type Tool = "train" | "blur" | "darken" | "erase";
const TOOL_LABELS: Record<Tool, string> = { train: "Select training region", blur: "Paint defect: blur", darken: "Paint defect: darken", erase: "Erase painted defects" };

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function diverging(value: number, maximum: number) {
  const t = clamp(value / Math.max(1e-12, maximum), -1, 1);
  return t >= 0 ? `rgba(224,69,44,${0.08 + 0.8 * t})` : `rgba(32,74,216,${0.08 - 0.8 * t})`;
}

/** Painted defects: 1 = blurred, 2 = darkened. */
function applyDefects(base: Float64Array, blurred: Float64Array, defects: Uint8Array) {
  return Float64Array.from(base, (value, index) => defects[index] === 1 ? blurred[index] : defects[index] === 2 ? value * 0.6 : value);
}

function paintDisc(defects: Uint8Array, cx: number, cy: number, radius: number, mode: number) {
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(SIZE - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(SIZE - 1, Math.ceil(cx + radius)); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) defects[y * SIZE + x] = mode;
    }
  }
}

function Editor({ image, defects, training, tool, brush, onPaint, onTraining }: { image: Float64Array; defects: Uint8Array; training: Rect; tool: Tool; brush: number; onPaint: (next: Uint8Array) => void; onTraining: (rect: Rect) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointer: number; start: { x: number; y: number }; last: { x: number; y: number }; working: Uint8Array | null } | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = SIZE;
    offscreen.height = SIZE;
    const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
    image.forEach((value, index) => {
      const level = clamp(Math.round(value), 0, 255);
      const tint = defects[index] ? 1 : 0;
      rgba[index * 4] = Math.round(level * (1 - 0.25 * tint) + 230 * 0.25 * tint);
      rgba[index * 4 + 1] = Math.round(level * (1 - 0.25 * tint) + 231 * 0.25 * tint);
      rgba[index * 4 + 2] = Math.round(level * (1 - 0.25 * tint) + 84 * 0.25 * tint);
      rgba[index * 4 + 3] = 255;
    });
    offscreen.getContext("2d")?.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    const scale = canvas.width / SIZE;
    const rect = draft ?? training;
    context.setLineDash([8, 5]);
    context.lineWidth = 3;
    context.strokeStyle = "#000";
    context.strokeRect(rect.x0 * scale, rect.y0 * scale, (rect.x1 - rect.x0) * scale, (rect.y1 - rect.y0) * scale);
    context.lineWidth = 2;
    context.strokeStyle = "#fff";
    context.strokeRect(rect.x0 * scale, rect.y0 * scale, (rect.x1 - rect.x0) * scale, (rect.y1 - rect.y0) * scale);
    context.setLineDash([]);
    context.font = "700 15px Helvetica, Arial, sans-serif";
    context.lineWidth = 4;
    context.strokeStyle = "#000";
    context.strokeText("training", rect.x0 * scale + 8, rect.y0 * scale + 20);
    context.fillStyle = "#fff";
    context.fillText("training", rect.x0 * scale + 8, rect.y0 * scale + 20);
  }, [defects, draft, image, training]);

  function locate(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth) * SIZE, 0, SIZE - 1),
      y: clamp(((event.clientY - rect.top - canvas.clientTop) / canvas.clientHeight) * SIZE, 0, SIZE - 1),
    };
  }

  function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
    return { x0: Math.floor(Math.min(a.x, b.x)), y0: Math.floor(Math.min(a.y, b.y)), x1: Math.ceil(Math.max(a.x, b.x)) + 1, y1: Math.ceil(Math.max(a.y, b.y)) + 1 };
  }

  function stroke(working: Uint8Array, from: { x: number; y: number }, to: { x: number; y: number }) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, brush / 2)));
    const mode = tool === "blur" ? 1 : tool === "darken" ? 2 : 0;
    for (let step = 0; step <= steps; step += 1) paintDisc(working, from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps, brush, mode);
  }

  return <canvas
    ref={ref}
    width={EDITOR}
    height={EDITOR}
    className="texture-raster eigen-editor"
    role="img"
    aria-label="Texture with the training rectangle and painted synthetic defects"
    onPointerDown={(event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = locate(event);
      const working = tool === "train" ? null : Uint8Array.from(defects);
      if (working) {
        stroke(working, point, point);
        onPaint(working);
      }
      drag.current = { pointer: event.pointerId, start: point, last: point, working };
    }}
    onPointerMove={(event) => {
      const state = drag.current;
      if (!state || state.pointer !== event.pointerId) return;
      const point = locate(event);
      if (tool === "train") setDraft(rectFrom(state.start, point));
      else if (state.working) {
        const next = Uint8Array.from(state.working);
        stroke(next, state.last, point);
        state.working = next;
        onPaint(next);
      }
      state.last = point;
    }}
    onPointerUp={(event) => {
      const state = drag.current;
      if (!state || state.pointer !== event.pointerId) return;
      if (tool === "train") {
        const rect = rectFrom(state.start, locate(event));
        if (rect.x1 - rect.x0 >= 24 && rect.y1 - rect.y0 >= 24) onTraining(rect);
        setDraft(null);
      }
      drag.current = null;
    }}
    onPointerCancel={() => { drag.current = null; setDraft(null); }}
  />;
}

function MaskDiagram({ dx, dy }: { dx: number; dy: number }) {
  const columns = 2 * dx + 1;
  const rows = 2 * dy + 1;
  const cell = Math.min(320 / columns, 220 / rows);
  const offsets = sparseOffsets(dx, dy);
  return <svg className="eigen-mask" viewBox={`0 0 ${columns * cell + 2} ${rows * cell + 2}`} role="img" aria-label={`Sparse mask with nine taps spanning ${rows} rows and ${columns} columns`}>
    {Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => <rect key={`${x}-${y}`} x={1 + x * cell} y={1 + y * cell} width={cell} height={cell} className="cell" />))}
    {offsets.map((offset, index) => <g key={index}>
      <rect x={1 + (offset.x + dx) * cell} y={1 + (offset.y + dy) * cell} width={cell} height={cell} className="tap" />
      {cell >= 11 && <text x={1 + (offset.x + dx + 0.5) * cell} y={1 + (offset.y + dy + 0.5) * cell + 4} textAnchor="middle">{index + 1}</text>}
    </g>)}
  </svg>;
}

function EigenvalueBars({ values }: { values: number[] }) {
  const width = 420;
  const height = 200;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const maximum = Math.max(...values, 1e-12);
  const bar = (width - 20) / values.length;
  return <svg className="eigen-bars" viewBox={`0 0 ${width} ${height + 34}`} role="img" aria-label="Eigenvalues (variances) of the mask vectors">
    {values.map((value, index) => {
      const h = (Math.max(0, value) / maximum) * (height - 20);
      return <g key={index}>
        <rect x={10 + index * bar + 3} y={height - h} width={bar - 6} height={h} />
        <text x={10 + (index + 0.5) * bar} y={height - h - 5} textAnchor="middle">{((100 * Math.max(0, value)) / total).toFixed(0)}%</text>
        <text x={10 + (index + 0.5) * bar} y={height + 16} textAnchor="middle">#{index + 1}</text>
      </g>;
    })}
    <line x1="10" x2={width - 10} y1={height} y2={height} className="axis" />
    <text x={width / 2} y={height + 32} textAnchor="middle">eigenvector · label: share of total variance</text>
  </svg>;
}

function DetectionView({ image, flags, painted }: { image: Float64Array; flags: Uint8Array; painted: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
    image.forEach((value, index) => {
      let [r, g, b] = [value, value, value].map((channel) => clamp(Math.round(channel * 0.75), 0, 255));
      if (flags[index] === 2) [r, g, b] = [r * 0.45, g * 0.45, b * 0.45];
      if (flags[index] === 1) [r, g, b] = [Math.round(r * 0.35 + 239 * 0.65), Math.round(g * 0.35 + 50 * 0.65), Math.round(b * 0.35 + 30 * 0.65)];
      // Outline of the painted area (where a painted pixel touches an unpainted one).
      const x = index % SIZE;
      const y = Math.floor(index / SIZE);
      if (painted[index] && ((x > 0 && !painted[index - 1]) || (x < SIZE - 1 && !painted[index + 1]) || (y > 0 && !painted[index - SIZE]) || (y < SIZE - 1 && !painted[index + SIZE]))) [r, g, b] = [255, 238, 70];
      rgba.set([r, g, b, 255], index * 4);
    });
    context.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
  }, [flags, image, painted]);
  return <canvas ref={ref} width={SIZE} height={SIZE} className="texture-raster" role="img" aria-label="Detected pixels in red, painted defect outlined in yellow, unevaluated border darkened" />;
}

export default function EigenfilterDemo() {
  const [source, setSource] = useState(PRESETS[0].src);
  const [sourceName, setSourceName] = useState(PRESETS[0].name);
  const [loaded, setLoaded] = useState<{ source: string; values: Float64Array; crop: string } | null>(null);
  const [defects, setDefects] = useState<Uint8Array>(() => new Uint8Array(SIZE * SIZE));
  const [training, setTraining] = useState<Rect>(DEFAULT_TRAINING);
  const [tool, setTool] = useState<Tool>("blur");
  const [brush, setBrush] = useState(6);
  const [dx, setDx] = useState(8);
  const [dy, setDy] = useState(6);
  const [energyRadius, setEnergyRadius] = useState(10);
  const [margin, setMargin] = useState(0);
  const [coverage, setCoverage] = useState(1);
  const [selected, setSelected] = useState<number[]>([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadSquareImage(source, SIZE).then((image) => { if (!cancelled) setLoaded({ source, values: lumaOf(image.rgba), crop: cropDescription(image) }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [source]);

  const base = loaded && loaded.source === source ? loaded.values : null;
  const blurred = useMemo(() => base ? boxMean(boxMean(base, SIZE, 3), SIZE, 3) : null, [base]);
  const painted = useMemo(() => base && blurred ? applyDefects(base, blurred, defects) : null, [base, blurred, defects]);
  const analysisImage = useDeferredValue(painted);
  const analysisDefects = useDeferredValue(defects);
  const offsets = useMemo(() => sparseOffsets(dx, dy), [dx, dy]);
  const pca = useMemo(() => {
    if (!analysisImage) return null;
    const { mean, covariance, count } = maskCovariance(analysisImage, SIZE, offsets, training);
    if (count < 50) return null;
    return { mean, covariance, count, ...symmetricEigen(covariance) };
  }, [analysisImage, offsets, training]);
  const responses = useMemo(() => analysisImage && pca ? eigenResponses(analysisImage, SIZE, offsets, pca.mean, pca.vectors) : null, [analysisImage, offsets, pca]);
  const energies = useMemo(() => responses ? energyMaps(responses, SIZE, energyRadius) : null, [energyRadius, responses]);
  const reach = Math.max(dx, dy) + energyRadius;
  const detection = useMemo(() => energies && selected.length ? detectFlaws(energies, SIZE, selected, training, reach, margin, coverage) : null, [coverage, energies, margin, reach, selected, training]);
  const energyRasters = useMemo(() => energies ? energies.map((energy) => unsignedRgba(energy, 0.5)) : null, [energies]);
  const focusRaster = useMemo(() => responses ? signedRgba(responses[focus]) : null, [focus, responses]);

  const metrics = useMemo(() => {
    if (!detection) return null;
    // Pixels within `reach` of a painted pixel are affected by it through the mask and the energy window.
    const near = boxMean(Float64Array.from(analysisDefects, (value) => (value ? 1 : 0)), SIZE, reach);
    let paintedCount = 0;
    let paintedHit = 0;
    let cleanCount = 0;
    let cleanHit = 0;
    for (let index = 0; index < SIZE * SIZE; index += 1) {
      if (detection.flags[index] === 2) continue;
      if (analysisDefects[index]) {
        paintedCount += 1;
        paintedHit += detection.flags[index] === 1 ? 1 : 0;
      } else if (near[index] === 0) {
        cleanCount += 1;
        cleanHit += detection.flags[index] === 1 ? 1 : 0;
      }
    }
    return { paintedCount, paintedHit, cleanCount, cleanHit };
  }, [analysisDefects, detection, reach]);

  function addExampleFlaw() {
    setDefects((current) => {
      const next = Uint8Array.from(current);
      for (let y = 178; y < 188; y += 1) for (let x = 24; x < SIZE - 24; x += 1) next[y * SIZE + x] = 1;
      return next;
    });
  }

  function choose(src: string, name: string) {
    setSource(src);
    setSourceName(name);
    setDefects(new Uint8Array(SIZE * SIZE));
    setTraining(DEFAULT_TRAINING);
  }

  function uploadImage(file?: File) {
    if (!file) return;
    setSource((previous) => {
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setSourceName(file.name);
    setDefects(new Uint8Array(SIZE * SIZE));
    setTraining(DEFAULT_TRAINING);
  }

  const totalVariance = pca ? pca.values.reduce((sum, value) => sum + Math.max(0, value), 0) : 0;
  const covarianceMaximum = pca ? Math.max(...pca.covariance.flat().map(Math.abs)) : 1;

  return (
    <DemoChrome number="T06" title="Eigenfilters for texture inspection" subtitle="Learn filters from the texture itself: collect sparse-mask samples over a defect-free region, find their principal components, use them as filters, and flag places where the filter energies leave the range of the normal texture.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Training data</p><h2>Show the method what normal texture looks like</h2></header>
        <div className="eigen-workbench">
          <div className="eigen-editor-panel">
            {painted ? <Editor image={painted} defects={defects} training={training} tool={tool} brush={brush} onPaint={setDefects} onTraining={setTraining} /> : <div className="texture-loading">Loading texture…</div>}
            <p>{sourceName} · {loaded ? loaded.crop : "…"}; luma. Dashed rectangle: training region. Yellow tint: synthetic defects painted in this browser; the supplied images are never modified.</p>
          </div>
          <aside className="glcm-controls">
            <div className="preset-strip">{PRESETS.map((preset) => <button type="button" key={preset.name} className={source === preset.src ? "active" : ""} aria-pressed={source === preset.src} onClick={() => choose(preset.src, preset.name)}>{preset.name}</button>)}</div>
            <label className="file-control">Load another image<input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} /></label>
            <fieldset className="laws-choice eigen-tools"><legend>Pointer tool</legend>
              {(Object.keys(TOOL_LABELS) as Tool[]).map((value) => <button type="button" key={value} aria-pressed={tool === value} onClick={() => setTool(value)}>{TOOL_LABELS[value]}</button>)}
            </fieldset>
            <label className="texture-control"><span>Brush radius</span><strong>{brush} px</strong><input type="range" min="2" max="20" step="1" value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></label>
            <div className="eigen-buttons">
              <button type="button" className="tool-button" onClick={addExampleFlaw}>Add example flaw (synthetic blurred band)</button>
              <button type="button" className="tool-button" onClick={() => setDefects(new Uint8Array(SIZE * SIZE))}>Remove all painted defects</button>
              <button type="button" className="tool-button" onClick={() => setTraining(DEFAULT_TRAINING)}>Training region: top half</button>
              <button type="button" className="tool-button" onClick={() => setTraining({ x0: 0, y0: 0, x1: SIZE, y1: SIZE })}>Training region: whole image</button>
            </div>
            <label className="texture-control"><span>Mask spacing Δx</span><strong>{dx} px · {2 * dx + 1} columns</strong><input type="range" min="1" max="24" step="1" value={dx} onChange={(event) => setDx(Number(event.target.value))} /></label>
            <label className="texture-control"><span>Mask spacing Δy</span><strong>{dy} px · {2 * dy + 1} rows</strong><input type="range" min="1" max="24" step="1" value={dy} onChange={(event) => setDy(Number(event.target.value))} /></label>
            <MaskDiagram dx={dx} dy={dy} />
          </aside>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Large but sparse"><p>Nine taps on a grid with spacing (Δx, Δy) see structure across {2 * dy + 1} × {2 * dx + 1} pixels while keeping only a 9-dimensional sample at each position. Choosing the spacing is a manual design decision; spacings close to the texture&apos;s period tend to work best.</p></ModelBlock>
          <ModelBlock title="Training region" tone="green"><p>Drag a rectangle with the training tool. Only positions whose nine taps all fall inside the image and whose centre lies in the rectangle are used. If a defect lies inside the training region, the method learns it as normal.</p></ModelBlock>
          <ModelBlock title="Synthetic defects" tone="red"><p>No supplied image contains a real flaw, so this page lets you create one: the blur brush removes fine structure, the darken brush scales brightness by 0.6. Because the painted area is known, detection accuracy can be measured below. Results on real flaws depend on the flaw type.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Principal components</p><h2>Covariance, eigenvalues and eigenfilters</h2></header>
        {pca ? <>
          <div className="eigen-pca-grid">
            <figure>
              <table className="eigen-covariance" aria-label="Covariance matrix of the nine mask taps">
                <thead><tr><th scope="col"><span className="sr-only">tap</span></th>{pca.covariance.map((_, index) => <th scope="col" key={index}>{index + 1}</th>)}</tr></thead>
                <tbody>{pca.covariance.map((row, i) => <tr key={i}><th scope="row">{i + 1}</th>{row.map((value, j) => <td key={j} style={{ background: diverging(value, covarianceMaximum) }}>{value.toFixed(0)}</td>)}</tr>)}</tbody>
              </table>
              <figcaption>9 × 9 covariance of the mask vectors over {pca.count.toLocaleString()} training positions (gray levels²). Red positive, blue negative.</figcaption>
            </figure>
            <figure><EigenvalueBars values={pca.values} /><figcaption>Eigenvalues are the variances along each principal direction, sorted. Total variance (trace) {totalVariance.toFixed(0)}.</figcaption></figure>
          </div>
          <div className="eigen-filter-grid">
            {pca.vectors.map((vector, index) => <button type="button" key={index} className="eigen-filter" aria-pressed={focus === index} onClick={() => setFocus(index)} aria-label={`Eigenfilter ${index + 1}`}>
              <span className="eigen-filter-taps" aria-hidden="true">{vector.map((value, k) => <i key={k} style={{ background: diverging(value, 1) }}>{value.toFixed(2)}</i>)}</span>
              <small>#{index + 1} · λ = {pca.values[index].toFixed(0)} · {((100 * Math.max(0, pca.values[index])) / (totalVariance || 1)).toFixed(1)}%</small>
            </button>)}
          </div>
          <p className="eigen-note">Each eigenvector, laid back onto the nine tap positions, is an eigenfilter. The overall sign of an eigenvector is arbitrary; here its largest entry is made positive. Click a filter to inspect its response below.</p>
        </> : <div className="texture-loading">Select a larger training region</div>}
        <div className="explanation-grid three">
          <ModelBlock title="What PCA finds"><p>The first eigenvector is the direction in which the nine tap values vary most together. For a texture with smooth brightness changes it is nearly a uniform average; later eigenvectors are contrasts between taps that capture the texture&apos;s spatial arrangement.</p></ModelBlock>
          <ModelBlock title="Filters adapted to the texture" tone="green"><p>Unlike Laws or Gabor masks, eigenfilters are derived from the data. They are the linear filters on this mask whose outputs are uncorrelated over the training texture, with variances given by the eigenvalues.</p></ModelBlock>
          <ModelBlock title="Variance is not usefulness" tone="violet"><p>The largest eigenvalues explain most of the normal texture, but a defect may show up most clearly in a low-variance filter, as on the lecture&apos;s textile example. Inspect the energy maps rather than keeping only the first components.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>Inspection</p><h2>Flag energies outside the normal range</h2></header>
        {energies && responses && painted ? <div className="eigen-inspection">
          <div className="eigen-energy-grid">
            {energyRasters && energyRasters.map((rgba, index) => <figure key={index} className={focus === index ? "focused" : ""}>
              <button type="button" className="eigen-energy-select" onClick={() => setFocus(index)} aria-label={`Show response of eigenfilter ${index + 1}`}><Raster rgba={rgba} size={SIZE} label={`Energy of eigenfilter ${index + 1}`} /></button>
              <label className="check-control"><input type="checkbox" checked={selected.includes(index)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, index].sort((a, b) => a - b) : current.filter((value) => value !== index))} /><span>#{index + 1} used</span></label>
            </figure>)}
          </div>
          <div className="eigen-detection">
            <div className="eigen-detection-views">
              <figure className="spectral-panel">{focusRaster && <Raster rgba={focusRaster} size={SIZE} label={`Response of eigenfilter ${focus + 1}`} />}<figcaption>Response #{focus + 1} · signed, mid-gray is 0</figcaption></figure>
              <figure>{detection ? <DetectionView image={painted} flags={detection.flags} painted={analysisDefects} /> : <div className="texture-loading">Select at least one filter</div>}<figcaption>Red: flagged · yellow outline: painted defect · dark frame: border not evaluated ({reach} px)</figcaption></figure>
            </div>
            <aside className="texture-controls">
              <label className="texture-control"><span>Energy window</span><strong>{2 * energyRadius + 1}×{2 * energyRadius + 1} px</strong><input type="range" min="1" max="16" step="1" value={energyRadius} onChange={(event) => setEnergyRadius(Number(event.target.value))} /></label>
              <label className="texture-control"><span>Training values defining the range</span><strong>{coverage >= 1 ? "all (min to max)" : `central ${(coverage * 100).toFixed(1)} %`}</strong><input type="range" min="0.95" max="1" step="0.005" value={coverage} onChange={(event) => setCoverage(Number(event.target.value))} /></label>
              <label className="texture-control"><span>Tolerance beyond the training range</span><strong>{Math.round(margin * 100)} %</strong><input type="range" min="0" max="0.5" step="0.02" value={margin} onChange={(event) => setMargin(Number(event.target.value))} /></label>
              {metrics && <div className="texture-readout">
                <span>painted pixels flagged</span><strong>{metrics.paintedCount ? `${((100 * metrics.paintedHit) / metrics.paintedCount).toFixed(1)} %` : "no defect painted"}</strong>
                <span>clean pixels flagged</span><strong>{metrics.cleanCount ? `${((100 * metrics.cleanHit) / metrics.cleanCount).toFixed(2)} %` : "—"}</strong>
                <span>filters used</span><strong>{selected.map((index) => `#${index + 1}`).join(" ") || "none"}</strong>
              </div>}
              <p>A pixel is flagged when the energy of any selected filter lies outside the range observed in the training region (all values, or only their central part), widened by the tolerance. &quot;Clean&quot; excludes pixels within {reach} px of a painted defect, which the mask and window necessarily touch.</p>
            </aside>
          </div>
        </div> : <div className="texture-loading">Computing…</div>}
        <div className="explanation-grid three">
          <ModelBlock title="Energy, then a range test"><p>As with Laws masks, each response is squared and averaged over a window. The normal texture produces energies within a characteristic range for every filter; a flaw is useful only if it pushes some filter&apos;s energy outside that range.</p></ModelBlock>
          <ModelBlock title="Trade-offs to try" tone="green"><p>Widen the tolerance to remove false alarms, at the cost of missed defect pixels. Narrowing the range to the central 99 % of training values catches more defect pixels, but every selected filter then adds its own 1 % of false alarms. Enlarge the energy window to stabilize the range, at the cost of blurred detections. Remove high-variance filters and see whether the flaw is still found.</p></ModelBlock>
          <ModelBlock title="Limits" tone="red"><p>The range test assumes the training region is representative and defect-free, and it ignores correlations between filters. The method is global in training but local in detection; it remains sensitive to the manual choice of mask.</p></ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
