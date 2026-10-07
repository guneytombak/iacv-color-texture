"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { cropDescription, loadSquareImage, lumaOf } from "../_lib/image";
import {
  clamp,
  clientToImagePoint,
  computeMatrix,
  constrainDisplacement,
  grayHistogram,
  independenceMatrix,
  matrixFeatures,
  mutualInformation,
  nudgeDisplacement,
  quantizeLevel,
  shuffledImage,
  weightAt,
} from "../_lib/glcm";
import type { Displacement, GrayImage, MatrixResult } from "../_lib/glcm";
import { withBasePath } from "../_lib/paths.ts";

const ANALYSIS_SIZE = 160;
const CANVAS_SIZE = 640;
const MAX_DISPLACEMENT = ANALYSIS_SIZE / 2;
const HANDLE_RADIUS_CSS = 14;
const VECTOR_COLORS = ["#ef573f", "#48764d", "#204ad8"];
const DEFAULT_DISPLACEMENTS: Displacement[] = [{ vx: 1, vy: 0 }, { vx: 1, vy: 1 }, { vx: -1, vy: 1 }];

type VectorSpec = Displacement & { enabled: boolean; name: string; color: string };
type Point = { x: number; y: number };
type EditTarget = number | "reference";
type DragState = { pointerId: number; mode: "tip" | "draw"; index: number } | { pointerId: number; mode: "reference" };
type ProbePair = { i: number; j: number | null; neighbor: Point };

function initialVectors(): VectorSpec[] {
  return DEFAULT_DISPLACEMENTS.map((vector, index) => ({ ...vector, enabled: true, name: `V${"₁₂₃"[index]}`, color: VECTOR_COLORS[index] }));
}

function probePairs(image: GrayImage, reference: Point, vectors: VectorSpec[], levels: number): ProbePair[] {
  const i = quantizeLevel(image.gray[reference.y * image.width + reference.x], levels);
  return vectors.map((vector) => {
    const neighbor = { x: reference.x + vector.vx, y: reference.y + vector.vy };
    const inside = neighbor.x >= 0 && neighbor.x < image.width && neighbor.y >= 0 && neighbor.y < image.height;
    return { i, j: inside ? quantizeLevel(image.gray[neighbor.y * image.width + neighbor.x], levels) : null, neighbor };
  });
}

function drawArrow(context: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number, color: string, width: number) {
  const angle = Math.atan2(endY - startY, endX - startX);
  const length = Math.hypot(endX - startX, endY - startY);
  for (const [stroke, lineWidth] of [["rgba(0,0,0,.72)", width + 3], [color, width]] as const) {
    context.strokeStyle = stroke;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
  }
  if (length < 18) return;
  const head = Math.min(14, length / 2.5);
  context.fillStyle = color;
  context.strokeStyle = "rgba(0,0,0,.72)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(endX - head * Math.cos(angle - Math.PI / 7), endY - head * Math.sin(angle - Math.PI / 7));
  context.lineTo(endX - head * Math.cos(angle + Math.PI / 7), endY - head * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
  context.stroke();
}

function outlinePixel(context: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string) {
  context.lineWidth = 3;
  context.strokeStyle = "rgba(0,0,0,.8)";
  context.strokeRect(x * scale - 1, y * scale - 1, scale + 2, scale + 2);
  context.lineWidth = 1.5;
  context.strokeStyle = color;
  context.strokeRect(x * scale - 1, y * scale - 1, scale + 2, scale + 2);
}

function drawHandle(context: CanvasRenderingContext2D, x: number, y: number, color: string, active: boolean) {
  context.beginPath();
  context.arc(x, y, active ? 11 : 9, 0, Math.PI * 2);
  context.lineWidth = active ? 3 : 2;
  context.strokeStyle = color;
  context.setLineDash(active ? [] : [4, 3]);
  context.stroke();
  context.setLineDash([]);
}

function DisplacementCanvas({
  image,
  levels,
  vectors,
  reference,
  target,
  onReferenceChange,
  onVectorChange,
  onTargetChange,
  describedBy,
}: {
  image: GrayImage;
  levels: number;
  vectors: VectorSpec[];
  reference: Point;
  target: EditTarget;
  onReferenceChange: (point: Point) => void;
  onVectorChange: (index: number, vector: Displacement) => void;
  onTargetChange: (target: EditTarget) => void;
  describedBy: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState | null>(null);
  const [cursor, setCursor] = useState("crosshair");
  const scale = CANVAS_SIZE / image.width;

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = image.width;
    offscreen.height = image.height;
    const offscreenContext = offscreen.getContext("2d");
    if (!offscreenContext) return;
    const rgba = new Uint8ClampedArray(image.gray.length * 4);
    image.gray.forEach((value, index) => {
      const quantized = quantizeLevel(value, levels) * (255 / Math.max(1, levels - 1));
      rgba[index * 4] = quantized;
      rgba[index * 4 + 1] = quantized;
      rgba[index * 4 + 2] = quantized;
      rgba[index * 4 + 3] = 255;
    });
    offscreenContext.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

    const startX = (reference.x + 0.5) * scale;
    const startY = (reference.y + 0.5) * scale;
    // Draw the edited vector last so it stays on top where vectors overlap.
    const order = vectors.map((_, index) => index).filter((index) => vectors[index].enabled).sort((a, b) => Number(a === target) - Number(b === target));
    for (const index of order) {
      const vector = vectors[index];
      const endX = (reference.x + vector.vx + 0.5) * scale;
      const endY = (reference.y + vector.vy + 0.5) * scale;
      drawArrow(context, startX, startY, endX, endY, vector.color, index === target ? 3.5 : 2.5);
      outlinePixel(context, reference.x + vector.vx, reference.y + vector.vy, scale, vector.color);
      drawHandle(context, endX, endY, vector.color, index === target);
      context.font = "700 20px Helvetica, Arial, sans-serif";
      context.lineWidth = 4;
      context.strokeStyle = "rgba(0,0,0,.8)";
      const labelX = clamp(endX + 13, 4, canvas.width - 30);
      const labelY = clamp(endY - 13, 20, canvas.height - 4);
      context.strokeText(vector.name, labelX, labelY);
      context.fillStyle = vector.color;
      context.fillText(vector.name, labelX, labelY);
    }
    outlinePixel(context, reference.x, reference.y, scale, "#ffffff");
    drawHandle(context, startX, startY, "#ffffff", target === "reference");
  }, [image, levels, reference, scale, target, vectors]);

  function locate(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const box = { left: rect.left + canvas.clientLeft, top: rect.top + canvas.clientTop, width: canvas.clientWidth, height: canvas.clientHeight };
    const point = clientToImagePoint(event.clientX, event.clientY, box, canvas.width, canvas.height, image.width, image.height);
    return {
      ...point,
      pixel: { x: clamp(Math.floor(point.x), 0, image.width - 1), y: clamp(Math.floor(point.y), 0, image.height - 1) },
    };
  }

  function distanceCss(point: { x: number; y: number; cssPerPixel: number }, pixelX: number, pixelY: number) {
    return Math.hypot(point.x - (pixelX + 0.5), point.y - (pixelY + 0.5)) * point.cssPerPixel;
  }

  function hitTest(point: { x: number; y: number; cssPerPixel: number }): "reference" | "draw" | { tip: number } {
    if (target === "reference") return "reference";
    // Short vectors put their tips right next to the reference, so pick the nearest handle;
    // the selected vector's tip wins ties because it is drawn on top.
    const handles: { hit: "reference" | { tip: number }; x: number; y: number }[] = [
      ...[target, ...vectors.map((_, index) => index).filter((index) => index !== target)]
        .filter((index) => vectors[index].enabled)
        .map((index) => ({ hit: { tip: index }, x: reference.x + vectors[index].vx, y: reference.y + vectors[index].vy })),
      { hit: "reference", x: reference.x, y: reference.y },
    ];
    let best: (typeof handles)[number] | null = null;
    let bestDistance = Infinity;
    for (const handle of handles) {
      const distance = distanceCss(point, handle.x, handle.y);
      if (distance <= HANDLE_RADIUS_CSS && distance < bestDistance) {
        best = handle;
        bestDistance = distance;
      }
    }
    return best ? best.hit : "draw";
  }

  function displacementTo(pixel: Point) {
    return constrainDisplacement(pixel.x - reference.x, pixel.y - reference.y, MAX_DISPLACEMENT);
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = locate(event);
    if (point.x < 0 || point.y < 0 || point.x >= image.width || point.y >= image.height) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const hit = hitTest(point);
    if (hit === "reference") {
      drag.current = { pointerId: event.pointerId, mode: "reference" };
      onReferenceChange(point.pixel);
    } else if (hit === "draw") {
      // Pressing on empty image moves the reference here; dragging then draws the selected vector.
      drag.current = { pointerId: event.pointerId, mode: "draw", index: target as number };
      onReferenceChange(point.pixel);
    } else {
      drag.current = { pointerId: event.pointerId, mode: "tip", index: hit.tip };
      onTargetChange(hit.tip);
    }
    setCursor("grabbing");
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const point = locate(event);
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) {
      setCursor(hitTest(point) === "draw" ? "crosshair" : "grab");
      return;
    }
    if (state.mode === "reference") {
      if (point.pixel.x !== reference.x || point.pixel.y !== reference.y) onReferenceChange(point.pixel);
      return;
    }
    const next = displacementTo(point.pixel);
    const current = vectors[state.index];
    if (next && (next.vx !== current.vx || next.vy !== current.vy || !current.enabled)) onVectorChange(state.index, next);
  }

  function endDrag(event: PointerEvent<HTMLCanvasElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setCursor("grab");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.key === "1" || event.key === "2" || event.key === "3") {
      onTargetChange(Number(event.key) - 1);
      event.preventDefault();
      return;
    }
    if (event.key === "r" || event.key === "R") {
      onTargetChange("reference");
      event.preventDefault();
      return;
    }
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const size = event.shiftKey ? 5 : 1;
    if (target === "reference") {
      onReferenceChange({ x: clamp(reference.x + step[0] * size, 0, image.width - 1), y: clamp(reference.y + step[1] * size, 0, image.height - 1) });
    } else {
      onVectorChange(target, nudgeDisplacement(vectors[target], step[0] * size, step[1] * size, MAX_DISPLACEMENT));
    }
  }

  return <canvas
    ref={ref}
    width={CANVAS_SIZE}
    height={CANVAS_SIZE}
    className="glcm-source-canvas"
    style={{ cursor }}
    tabIndex={0}
    role="application"
    aria-roledescription="displacement editor"
    aria-label={`Quantized ${image.width} by ${image.height} analysis image with the reference pixel and the enabled displacement vectors`}
    aria-describedby={describedBy}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={endDrag}
    onPointerCancel={endDrag}
    onKeyDown={handleKeyDown}
  />;
}

function MatrixCanvas({ result, levels, angle, sigma, color, label, maskOnly = false, highlight, mirrorHighlight = false }: { result?: MatrixResult; levels: number; angle: number; sigma: number; color: string; label: string; maskOnly?: boolean; highlight?: { i: number; j: number } | null; mirrorHighlight?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const cell = canvas.width / levels;
    const maximum = result ? Math.max(...result.probabilities, 1e-12) : 1;
    const rgb = color.match(/[a-f\d]{2}/gi)?.map((hex) => parseInt(hex, 16)) ?? [255, 255, 255];
    context.fillStyle = "#050505";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < levels; i += 1) {
      for (let j = 0; j < levels; j += 1) {
        const weight = weightAt(i, j, levels, angle, sigma);
        const probability = result?.probabilities[i * levels + j] ?? 0;
        const base = maskOnly ? 0 : 230 * Math.sqrt(probability / maximum);
        const blend = maskOnly ? weight : 0.28 * weight;
        const red = Math.round(base * (1 - blend) + rgb[0] * blend);
        const green = Math.round(base * (1 - blend) + rgb[1] * blend);
        const blue = Math.round(base * (1 - blend) + rgb[2] * blend);
        context.fillStyle = `rgb(${red},${green},${blue})`;
        context.fillRect(j * cell, i * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    if (highlight) {
      const cells = mirrorHighlight && highlight.i !== highlight.j ? [[highlight.i, highlight.j, false], [highlight.j, highlight.i, true]] as const : [[highlight.i, highlight.j, false]] as const;
      for (const [row, column, dashed] of cells) {
        context.setLineDash(dashed ? [3, 3] : []);
        context.lineWidth = 4;
        context.strokeStyle = "#000";
        context.strokeRect(column * cell + 1, row * cell + 1, cell - 2, cell - 2);
        context.lineWidth = 2;
        context.strokeStyle = "#fff";
        context.strokeRect(column * cell + 1, row * cell + 1, cell - 2, cell - 2);
      }
      context.setLineDash([]);
    }
    context.strokeStyle = "rgba(255,255,255,.16)";
    context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }, [angle, color, highlight, levels, maskOnly, mirrorHighlight, result, sigma]);
  return <canvas ref={ref} width={320} height={320} className="glcm-matrix-canvas" role="img" aria-label={label} />;
}

function QuantizedRaster({ image, levels, label }: { image: GrayImage; levels: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const rgba = new Uint8ClampedArray(image.gray.length * 4);
    image.gray.forEach((value, index) => {
      const level = quantizeLevel(value, levels) * (255 / Math.max(1, levels - 1));
      rgba.fill(level, index * 4, index * 4 + 3);
      rgba[index * 4 + 3] = 255;
    });
    context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  }, [image, levels]);
  return <canvas ref={ref} width={image.width} height={image.height} className="texture-raster" role="img" aria-label={label} />;
}

function HistogramBars({ histogram }: { histogram: Float64Array }) {
  const width = 480;
  const height = 220;
  const maximum = Math.max(...histogram, 1e-12);
  const bar = width / histogram.length;
  return <svg className="histogram-bars" viewBox={`0 0 ${width} ${height + 24}`} role="img" aria-label="Normalized gray-level histogram">
    {Array.from(histogram, (value, index) => <rect key={index} x={(index * bar + 0.5).toFixed(1)} y={(height - (value / maximum) * (height - 8)).toFixed(1)} width={(bar - 1).toFixed(1)} height={((value / maximum) * (height - 8)).toFixed(1)} style={{ fill: `rgb(${Math.round((index * 255) / Math.max(1, histogram.length - 1))},${Math.round((index * 255) / Math.max(1, histogram.length - 1))},${Math.round((index * 255) / Math.max(1, histogram.length - 1))})` }} />)}
    <line x1="0" x2={width} y1={height} y2={height} className="axis" />
    <text x="0" y={height + 18}>0</text>
    <text x={width} y={height + 18} textAnchor="end">{histogram.length - 1}</text>
    <text x={width / 2} y={height + 18} textAnchor="middle">level i</text>
  </svg>;
}

function FeatureRows({ result }: { result: MatrixResult }) {
  return <dl className="feature-readout">
    <div><dt>Energy</dt><dd>{result.energy.toFixed(4)}</dd></div>
    <div><dt>Entropy (bits)</dt><dd>{result.entropy.toFixed(4)}</dd></div>
    <div><dt>Contrast</dt><dd>{result.contrast.toFixed(3)}</dd></div>
    <div><dt>Homogeneity</dt><dd>{result.homogeneity.toFixed(4)}</dd></div>
    <div><dt>Maximum probability</dt><dd>{result.maximum.toFixed(4)}</dd></div>
    <div className="weighted-feature"><dt>Oriented weighted score</dt><dd>{result.weightedScore.toFixed(4)}</dd></div>
  </dl>;
}

export default function CooccurrenceDemo() {
  const [source, setSource] = useState(withBasePath("/textures/coocur-texture.png"));
  const [sourceName, setSourceName] = useState("Co-occurrence texture");
  const [image, setImage] = useState<GrayImage | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ crop: string; scale: number } | null>(null);
  const [levels, setLevels] = useState(16);
  const [symmetric, setSymmetric] = useState(false);
  const [weightAngle, setWeightAngle] = useState(135);
  const [weightSigma, setWeightSigma] = useState(1.5);
  const [vectors, setVectors] = useState<VectorSpec[]>(initialVectors);
  const [reference, setReference] = useState<Point>({ x: ANALYSIS_SIZE / 2, y: ANALYSIS_SIZE / 2 });
  const [target, setTarget] = useState<EditTarget>(0);
  const [shuffleSeed, setShuffleSeed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    loadSquareImage(source, ANALYSIS_SIZE).then((loaded) => {
      if (cancelled) return;
      const gray = Uint8ClampedArray.from(lumaOf(loaded.rgba), (value) => Math.round(value));
      setImage({ gray, width: ANALYSIS_SIZE, height: ANALYSIS_SIZE, name: sourceName });
      setSourceInfo({ crop: cropDescription(loaded), scale: loaded.cropSide / ANALYSIS_SIZE });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [source, sourceName]);

  const results = useMemo(() => image ? vectors.map((vector) => computeMatrix(image, vector, levels, symmetric, weightAngle, weightSigma)) : [], [image, levels, symmetric, vectors, weightAngle, weightSigma]);
  const comparisonIndex = typeof target === "number" ? target : 0;
  const shuffled = useMemo(() => image ? shuffledImage(image, shuffleSeed) : null, [image, shuffleSeed]);
  const histogram = useMemo(() => image ? grayHistogram(image, levels) : null, [image, levels]);
  const comparison = useMemo(() => {
    if (!image || !shuffled || !histogram || !results[comparisonIndex]) return [];
    const vector = vectors[comparisonIndex];
    const independent = independenceMatrix(histogram);
    return [
      { title: "Texture P_v(i,j)", heading: <>Texture P<sub>v</sub>(i,j)</>, note: "measured pairs", color: vector.color, result: results[comparisonIndex] },
      { title: "Shuffled P_v(i,j)", heading: <>Shuffled P<sub>v</sub>(i,j)</>, note: "measured pairs after permutation", color: "#7055a5", result: computeMatrix(shuffled, vector, levels, symmetric, weightAngle, weightSigma) },
      { title: "p(i)·p(j)", heading: <>p(i)·p(j)</>, note: "independence prediction from the histogram", color: "#625f57", result: matrixFeatures(independent, levels, weightAngle, weightSigma, 0) },
    ];
  }, [comparisonIndex, histogram, image, levels, results, shuffled, symmetric, vectors, weightAngle, weightSigma]);
  const probes = useMemo(() => image ? probePairs(image, reference, vectors, levels) : [], [image, levels, reference, vectors]);

  const liveSummary = target === "reference"
    ? `Reference pixel (${reference.x}, ${reference.y}), level ${probes[0]?.i ?? ""}.`
    : `${vectors[target].name} = (${vectors[target].vx}, ${vectors[target].vy}). ${probes[target]?.j == null ? "Neighbor outside the image." : `Pair (${probes[target].i}, ${probes[target].j}).`}`;

  function updateVector(index: number, next: Displacement) {
    setVectors((current) => current.map((vector, vectorIndex) => vectorIndex === index ? { ...vector, ...next, enabled: true } : vector));
  }

  function setEnabled(index: number, enabled: boolean) {
    setVectors((current) => current.map((vector, vectorIndex) => vectorIndex === index ? { ...vector, enabled } : vector));
  }

  function resetVectors() {
    setVectors(initialVectors());
    setReference({ x: ANALYSIS_SIZE / 2, y: ANALYSIS_SIZE / 2 });
    setTarget(0);
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
    <DemoChrome number="T03" title="Gray-level co-occurrence matrices" subtitle="Drag up to three spatial displacement vectors directly on the texture, follow one pixel pair into its matrix cell, compare the normalized co-occurrence matrices, calculate Haralick-style features, and test an oriented soft-diagonal measure against the texture pattern.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Image and vectors</p><h2>Ask which gray levels occur together</h2></header>
        <div className="glcm-workbench">
          <div className="glcm-image-panel">
            {image ? <DisplacementCanvas
              image={image}
              levels={levels}
              vectors={vectors}
              reference={reference}
              target={target}
              onReferenceChange={setReference}
              onVectorChange={updateVector}
              onTargetChange={setTarget}
              describedBy="glcm-editor-help"
            /> : <div className="texture-loading">Loading texture…</div>}
            <p id="glcm-editor-help" className="glcm-editor-help"><strong>Pointer:</strong> drag a ringed arrow tip to reshape that vector; drag the white reference pixel to move the probe; press elsewhere and drag to draw the selected vector from that pixel. <strong>Keyboard</strong> (focus the image): arrow keys move the selected vector tip or the reference by one pixel, Shift+arrow by five; 1, 2, 3 or R choose what to edit.</p>
            <p>{sourceName} · {sourceInfo ? sourceInfo.crop : `resized to ${ANALYSIS_SIZE}×${ANALYSIS_SIZE}`}, converted to luma, then quantized to {levels} levels. One analysis pixel spans {sourceInfo ? sourceInfo.scale.toFixed(2) : "…"} source pixels. Squares outline single analysis pixels at true scale; rings are drag handles only.</p>
          </div>
          <aside className="glcm-controls">
            <label className="file-control">Load another image<input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} /></label>
            <button type="button" className="tool-button" onClick={() => { setSource(withBasePath("/textures/coocur-texture.png")); setSourceName("Co-occurrence texture"); }}>Restore supplied texture</button>
            <label className="texture-control"><span>Gray-level bins</span><strong>{levels}</strong><input type="range" min="4" max="32" step="4" value={levels} onChange={(event) => setLevels(Number(event.target.value))} /></label>
            <label className="check-control"><input type="checkbox" checked={symmetric} onChange={(event) => setSymmetric(event.target.checked)} /><span>Include reverse pairs P(j,i)</span></label>
            <fieldset className="vector-target-list">
              <legend>Selected for editing</legend>
              {vectors.map((vector, index) => <div className={`vector-target-row${target === index ? " selected" : ""}`} key={vector.name} style={{ borderLeftColor: vector.color }}>
                <label className="vector-target-choice">
                  <input type="radio" name="glcm-edit-target" checked={target === index} onChange={() => setTarget(index)} />
                  <strong style={{ color: vector.color }}>{vector.name}</strong>
                  <span className="vector-components">v = ({vector.vx}, {vector.vy}){sourceInfo && sourceInfo.scale !== 1 ? <small> ≈ ({Math.round(vector.vx * sourceInfo.scale)}, {Math.round(vector.vy * sourceInfo.scale)}) source px</small> : null}</span>
                </label>
                <label className="vector-enabled-toggle"><input type="checkbox" checked={vector.enabled} onChange={(event) => setEnabled(index, event.target.checked)} />Use</label>
                <p className="vector-probe">{probes[index] ? (vector.enabled ? (probes[index].j === null
                  ? <>neighbor ({probes[index].neighbor.x}, {probes[index].neighbor.y}) lies outside the image: no pair</>
                  : <>pair (i, j) = ({probes[index].i}, {probes[index].j}) · P = {results[index].probabilities[probes[index].i * levels + probes[index].j].toFixed(4)}</>) : "not used") : "…"}</p>
              </div>)}
              <div className={`vector-target-row reference${target === "reference" ? " selected" : ""}`}>
                <label className="vector-target-choice">
                  <input type="radio" name="glcm-edit-target" checked={target === "reference"} onChange={() => setTarget("reference")} />
                  <strong>Reference</strong>
                  <span className="vector-components">(x, y) = ({reference.x}, {reference.y})</span>
                </label>
                <p className="vector-probe">{probes[0] ? <>level i = {probes[0].i}</> : "…"}</p>
              </div>
            </fieldset>
            <p className="sr-only" aria-live="polite">{liveSummary}</p>
            <button type="button" className="tool-button" onClick={resetVectors}>Reset vectors and reference</button>
            <p className="glcm-convention">x grows to the right and y grows downward. Components are limited to ±{MAX_DISPLACEMENT} px, half the analysis width.</p>
          </aside>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Ordered pair"><p>For a displacement v=(v<sub>x</sub>,v<sub>y</sub>), every pixel (x,y) with quantized level i whose neighbor (x+v<sub>x</sub>,y+v<sub>y</sub>) lies inside the image contributes one count to cell (i,j), where j is the neighbor&apos;s level. The outlined pair on the image is one such contribution; its cell is outlined in each matrix below. Dividing all counts by the number of valid pairs, (W−|v<sub>x</sub>|)(H−|v<sub>y</sub>|), gives P<sub>v</sub>(i,j).</p></ModelBlock>
          <ModelBlock title="Short and long vectors" tone="green"><p>Short vectors measure fine-scale structure; long vectors relate distant pixels and leave fewer valid pairs. For a regular texture, a vector equal to one period pairs pixels with the same gray level and concentrates probability on the main diagonal; for a two-tone pattern, half a period pairs dark with bright and moves probability to the off-diagonal corners.</p></ModelBlock>
          <ModelBlock title="Direction and quantization" tone="red"><p>A directional matrix distinguishes v from −v; enabling reverse pairs adds both orders and makes the matrix symmetric (the mirrored cell is outlined dashed). More bins preserve gray-level detail but make the matrix sparser. Compare features only under the same quantization convention.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Histogram versus co-occurrence</p><h2>Same gray levels, different arrangement</h2></header>
        {image && shuffled && histogram ? <>
          <div className="histogram-compare">
            <figure><QuantizedRaster image={image} levels={levels} label={`${image.name}, quantized to ${levels} levels`} /><figcaption>Texture · {levels} levels</figcaption></figure>
            <figure><QuantizedRaster image={shuffled} levels={levels} label="The same pixels in a random order" /><figcaption>Same pixels, randomly permuted <button type="button" className="tool-button inline" onClick={() => setShuffleSeed((seed) => seed + 1)}>Shuffle again</button></figcaption></figure>
            <figure className="histogram-figure"><HistogramBars histogram={histogram} /><figcaption>Gray-level histogram p(i) · identical for both images by construction, since a permutation only moves pixels.</figcaption></figure>
          </div>
          <p className="histogram-vector-note">Co-occurrence below uses <strong style={{ color: vectors[comparisonIndex].color }}>{vectors[comparisonIndex].name}</strong> = ({vectors[comparisonIndex].vx}, {vectors[comparisonIndex].vy}){symmetric ? " with reverse pairs" : ""}; select another vector in the editor above to change it.</p>
          <div className="histogram-matrices">
            {comparison.map((entry) => <article key={entry.title} className="glcm-card" style={{ borderTopColor: entry.color }}>
              <header><strong>{entry.heading}</strong><small>{entry.note}</small></header>
              <MatrixCanvas result={entry.result} levels={levels} angle={weightAngle} sigma={weightSigma} color={entry.color} label={entry.title} />
              <dl className="feature-readout">
                <div><dt>Contrast</dt><dd>{entry.result.contrast.toFixed(3)}</dd></div>
                <div><dt>Homogeneity</dt><dd>{entry.result.homogeneity.toFixed(4)}</dd></div>
                <div><dt>Entropy (bits)</dt><dd>{entry.result.entropy.toFixed(3)}</dd></div>
                <div className="weighted-feature"><dt>Mutual information I(i; j)</dt><dd>{mutualInformation(entry.result.probabilities, levels).toFixed(3)} bits</dd></div>
              </dl>
            </article>)}
          </div>
        </> : <div className="texture-loading">Loading texture…</div>}
        <div className="explanation-grid three">
          <ModelBlock title="First-order statistics"><p>The histogram p(i) counts how often each gray level occurs. It captures global brightness and contrast compactly, but any rearrangement of the pixels leaves it unchanged, so it cannot distinguish a texture from noise with the same gray levels.</p></ModelBlock>
          <ModelBlock title="Second-order statistics" tone="green"><p>The co-occurrence matrix counts pairs at a displacement v. If a pixel and its neighbor were independent, P<sub>v</sub>(i,j) would equal p(i)·p(j). The shuffled image comes close to this; the real texture departs from it, and that departure is the spatial information.</p></ModelBlock>
          <ModelBlock title="Mutual information" tone="violet"><p>I(i; j) = Σ P(i,j) log₂[P(i,j) / (P<sub>row</sub>(i)P<sub>col</sub>(j))], computed from each matrix&apos;s own marginals, measures in bits how much the neighbor&apos;s level reveals about the reference level. It is zero for exact independence; the shuffled image leaves only a small sampling residue.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>Directional weighting</p><h2>Rotate a soft diagonal detector</h2></header>
        <div className="weight-workbench">
          <div className="weight-mask-panel"><MatrixCanvas levels={levels} angle={weightAngle} sigma={weightSigma} color="#e3e754" label="Oriented Gaussian weighting mask" maskOnly /><p>W<sub>θ,σ</sub>(i,j) · brighter cells receive higher weight</p></div>
          <aside className="texture-controls">
            <label className="texture-control"><span>Ridge orientation</span><strong>{weightAngle}°</strong><input type="range" min="0" max="180" step="1" value={weightAngle} onChange={(event) => setWeightAngle(Number(event.target.value))} /></label>
            <label className="texture-control"><span>Falloff width σ</span><strong>{weightSigma.toFixed(1)} bins</strong><input type="range" min="0.5" max="6" step="0.1" value={weightSigma} onChange={(event) => setWeightSigma(Number(event.target.value))} /></label>
            <p className="formula-card">D<sub>θ,σ</sub>(v) = Σ<sub>i,j</sub> P<sub>v</sub>(i,j)W<sub>θ,σ</sub>(i,j)</p>
            <p className="formula-card">W = exp[−r<sub>⊥</sub><sup>2</sup>/(2σ<sup>2</sup>)]</p>
            <p>At 135° the ridge follows the displayed main diagonal (top-left to bottom-right). The score is an expectation under P, so it lies between 0 and 1.</p>
          </aside>
        </div>
        <ModelBlock title="What this score tests" tone="violet"><p>A high main-diagonal score means the selected displacement often connects similar gray levels. Rotating the ridge tests other linear organizations in the matrix. It is a teaching measure, not one of the canonical Haralick features below.</p></ModelBlock>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Three matrices</p><h2>Compare displacement hypotheses</h2></header>
        <div className="glcm-matrix-grid">
          {vectors.map((vector, index) => vector.enabled && results[index] ? <article className="glcm-card" key={vector.name} style={{ borderTopColor: vector.color }}>
            <header><span style={{ color: vector.color }}>{vector.name}</span><strong>v = ({vector.vx}, {vector.vy})</strong><small>{results[index].pairs.toLocaleString()} valid {symmetric ? "ordered + reverse" : "ordered"} pairs{symmetric ? "" : ` = (${ANALYSIS_SIZE}−${Math.abs(vector.vx)})(${ANALYSIS_SIZE}−${Math.abs(vector.vy)})`}</small></header>
            <MatrixCanvas result={results[index]} levels={levels} angle={weightAngle} sigma={weightSigma} color={vector.color} label={`Normalized co-occurrence matrix for ${vector.name}, displacement ${vector.vx}, ${vector.vy}`} highlight={probes[index]?.j != null ? { i: probes[index].i, j: probes[index].j } : null} mirrorHighlight={symmetric} />
            <p className="matrix-axis-note">rows i: reference level ↓ · columns j: neighbor level → · outlined: the probed pair</p>
            <FeatureRows result={results[index]} />
          </article> : null)}
        </div>
        {!vectors.some((vector) => vector.enabled) && <p className="empty-vector-note">Enable at least one vector to display a co-occurrence matrix.</p>}
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>Feature equations</p><h2>Turn each probability matrix into numbers</h2></header>
        <div className="feature-equation-grid">
          <article><strong>Energy</strong><p>Σ<sub>i,j</sub>P(i,j)<sup>2</sup></p><span>Large when probability is concentrated in a few cells.</span></article>
          <article><strong>Entropy</strong><p>−Σ<sub>P&gt;0</sub>P(i,j)log<sub>2</sub>P(i,j)</p><span>Large when probability is spread among many cells. Units are bits.</span></article>
          <article><strong>Contrast</strong><p>Σ<sub>i,j</sub>(i−j)<sup>2</sup>P(i,j)</p><span>Penalizes probability far from the main diagonal.</span></article>
          <article><strong>Homogeneity</strong><p>Σ<sub>i,j</sub>P(i,j)/(1+|i−j|)</p><span>Rewards probability close to the main diagonal.</span></article>
          <article><strong>Maximum probability</strong><p>max<sub>i,j</sub>P(i,j)</p><span>The most frequent quantized gray-level transition.</span></article>
        </div>
        <ModelBlock title="Normalization convention"><p>Every displayed feature uses the normalized probability matrix P, not raw counts C. Entropy uses log base 2 and omits zero-probability terms. Contrast therefore depends on the number and labeling of gray-level bins.</p></ModelBlock>
      </section>
    </DemoChrome>
  );
}
