"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import type { RGB } from "../_lib/color";
import { clamp, coneSensitivity, integrateSpectrum, rgbCss, WAVELENGTHS } from "../_lib/color";

function prepareCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function SpectrumCanvas({
  samples,
  brightness,
  editable = false,
  onSamplesChange,
}: {
  samples: number[];
  brightness: number;
  editable?: boolean;
  onSamplesChange?: (samples: number[]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastIndex = useRef<number | null>(null);

  useEffect(() => {
    const render = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const prepared = prepareCanvas(canvas);
      if (!prepared) return;
      const { context: ctx, width, height } = prepared;
      const margin = { left: 46, right: 18, top: 22, bottom: 40 };
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;
      const x = (index: number) => margin.left + index / (WAVELENGTHS.length - 1) * plotWidth;
      const y = (value: number) => margin.top + (1 - clamp(value)) * plotHeight;

      ctx.fillStyle = "rgba(255,255,255,.22)";
      ctx.fillRect(margin.left, margin.top, plotWidth, plotHeight);
      ctx.strokeStyle = "rgba(23,23,19,.2)";
      ctx.lineWidth = 1;
      [400, 500, 600, 700].forEach((tick) => {
        const index = (tick - 380) / 5;
        ctx.beginPath();
        ctx.moveTo(x(index), margin.top);
        ctx.lineTo(x(index), margin.top + plotHeight);
        ctx.stroke();
        ctx.fillStyle = "#625f57";
        ctx.font = "11px Helvetica, Arial, sans-serif";
        ctx.fillText(String(tick), x(index) - 10, height - 13);
      });

      ctx.fillStyle = "#625f57";
      ctx.font = "11px Helvetica, Arial, sans-serif";
      ctx.fillText("1.0", 17, y(1) + 4);
      ctx.fillText("0", 28, y(0) + 4);

      const coneColors = ["#ef573f", "#48764d", "#204ad8"];
      const coneLabels = ["L cone", "M cone", "S cone"];
      const effective = samples.map((value) => clamp(value * brightness));

      if (editable) {
        // Show the overlap products as areas, then redraw the cone curves above them.
        for (let channel = 0; channel < 3; channel += 1) {
          ctx.beginPath();
          ctx.moveTo(x(0), y(0));
          WAVELENGTHS.forEach((wavelength, index) => {
            ctx.lineTo(x(index), y(effective[index] * coneSensitivity(wavelength)[channel]));
          });
          ctx.lineTo(x(WAVELENGTHS.length - 1), y(0));
          ctx.closePath();
          ctx.fillStyle = `${coneColors[channel]}20`;
          ctx.fill();
        }
      }

      for (let channel = 0; channel < 3; channel += 1) {
        ctx.beginPath();
        WAVELENGTHS.forEach((wavelength, index) => {
          const py = y(coneSensitivity(wavelength)[channel]);
          if (index === 0) ctx.moveTo(x(index), py);
          else ctx.lineTo(x(index), py);
        });
        ctx.strokeStyle = coneColors[channel];
        ctx.lineWidth = 2.2;
        ctx.setLineDash(editable ? [6, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = coneColors[channel];
        ctx.font = "700 11px Helvetica, Arial, sans-serif";
        ctx.fillText(`${coneLabels[channel]} H${["L", "M", "S"][channel]}(λ)`, margin.left + 8, margin.top + 16 + channel * 16);
      }

      if (editable) {
        ctx.beginPath();
        samples.forEach((value, index) => index === 0 ? ctx.moveTo(x(index), y(value)) : ctx.lineTo(x(index), y(value)));
        ctx.strokeStyle = "#171713";
        ctx.lineWidth = 3;
        ctx.stroke();

        if (Math.abs(brightness - 1) > 0.001) {
          ctx.beginPath();
          effective.forEach((value, index) => index === 0 ? ctx.moveTo(x(index), y(value)) : ctx.lineTo(x(index), y(value)));
          ctx.strokeStyle = "rgba(23,23,19,.42)";
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(margin.left, y(1));
        ctx.lineTo(width - margin.right, y(1));
        ctx.strokeStyle = "rgba(239,87,63,.45)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(150,40,29,.72)";
        ctx.font = "700 10px Helvetica, Arial, sans-serif";
        ctx.fillText("threshold / clipping at 1", width - 166, margin.top + 13);

        samples.forEach((value, index) => {
          if (value * brightness <= 1) return;
          ctx.fillStyle = "rgba(239,87,63,.7)";
          ctx.fillRect(x(index) - 2, margin.top, 4, 5);
        });
        ctx.fillStyle = "#171713";
        ctx.font = "700 11px Helvetica, Arial, sans-serif";
        ctx.fillText("drawn C(λ)", width - 90, height - margin.bottom - 10);
      } else {
        const peakIndex = samples.reduce((best, value, index) => value > samples[best] ? index : best, 0);
        const lineHeight = clamp(brightness);
        ctx.beginPath();
        ctx.moveTo(x(peakIndex), y(0));
        ctx.lineTo(x(peakIndex), y(lineHeight));
        ctx.strokeStyle = "#171713";
        ctx.lineWidth = 4;
        ctx.stroke();
        coneColors.forEach((color, channel) => {
          ctx.beginPath();
          ctx.arc(x(peakIndex), y(clamp(brightness * coneSensitivity(WAVELENGTHS[peakIndex])[channel])), 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = "#f2eee3";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        ctx.fillStyle = "#171713";
        ctx.font = "700 11px Helvetica, Arial, sans-serif";
        ctx.fillText(`line at ${WAVELENGTHS[peakIndex]} nm`, Math.min(width - 120, x(peakIndex) + 8), height - margin.bottom - 10);
      }
      ctx.fillStyle = "#625f57";
      ctx.font = "11px Helvetica, Arial, sans-serif";
      ctx.fillText("wavelength λ (nm)", width / 2 - 48, height - 7);
    };
    render();
    window.addEventListener("resize", render);
    return () => window.removeEventListener("resize", render);
  }, [brightness, editable, samples]);

  function drawAt(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!editable || !onSamplesChange || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const margin = { left: 46, right: 18, top: 22, bottom: 40 };
    const px = clamp((event.clientX - rect.left - margin.left) / (rect.width - margin.left - margin.right));
    const py = clamp(1 - (event.clientY - rect.top - margin.top) / (rect.height - margin.top - margin.bottom));
    const index = Math.round(px * (WAVELENGTHS.length - 1));
    const next = [...samples];
    const previous = lastIndex.current;
    if (previous !== null && previous !== index) {
      const start = Math.min(previous, index);
      const end = Math.max(previous, index);
      const startValue = next[previous];
      for (let i = start; i <= end; i += 1) {
        const t = (i - previous) / (index - previous);
        next[i] = clamp(startValue + (py - startValue) * t);
      }
    } else next[index] = py;
    lastIndex.current = index;
    onSamplesChange(next);
  }

  return (
    <canvas
      ref={ref}
      className={`spectrum-canvas ${editable ? "editable" : ""}`}
      onPointerDown={(event) => { if (!editable) return; drawing.current = true; lastIndex.current = null; event.currentTarget.setPointerCapture(event.pointerId); drawAt(event); }}
      onPointerMove={(event) => { if (drawing.current) drawAt(event); }}
      onPointerUp={() => { drawing.current = false; lastIndex.current = null; }}
      onPointerCancel={() => { drawing.current = false; lastIndex.current = null; }}
      role="img"
      aria-label={editable ? "Draw an arbitrary spectrum; colored areas show its contributions to the L, M, and S responses" : "A monochromatic spectrum with L, M, and S response contributions"}
    />
  );
}

function ResponsePanel({ responses, color }: { responses: RGB; color: RGB }) {
  const max = Math.max(1, ...responses);
  return (
    <div className="cone-response-panel">
      <div className="generated-color" style={{ background: rgbCss(color) }}><span>display rendering</span><strong>{color.map((value) => Math.round(value * 255)).join(" · ")}</strong></div>
      <div className="cone-meters" aria-label="Unnormalized cone responses">
        {[{ label: "L", value: responses[0], color: "red" }, { label: "M", value: responses[1], color: "green" }, { label: "S", value: responses[2], color: "blue" }].map((entry) => (
          <div key={entry.label}><span>{entry.label}</span><i className={entry.color} style={{ height: `${8 + entry.value / max * 92}%` }} /><strong>{entry.value.toFixed(3)}</strong></div>
        ))}
      </div>
      <p>These responses are independent measurements. They are not percentages and do not need to sum to one.</p>
    </div>
  );
}

const initialDrawing = WAVELENGTHS.map((wavelength) =>
  0.12 + 0.72 * Math.exp(-Math.pow((wavelength - 530) / 72, 2)) + 0.3 * Math.exp(-Math.pow((wavelength - 630) / 35, 2)),
).map((value) => clamp(value));

export default function ConeResponsesDemo() {
  const [wavelength, setWavelength] = useState(555);
  const [lineBrightness, setLineBrightness] = useState(1);
  const [drawnSpectrum, setDrawnSpectrum] = useState(initialDrawing);
  const [drawBrightness, setDrawBrightness] = useState(1);

  const lineSpectrum = useMemo(() => WAVELENGTHS.map((sample) => Math.exp(-Math.pow((sample - wavelength) / 4.5, 2))), [wavelength]);
  const lineResult = useMemo(() => integrateSpectrum(lineSpectrum, lineBrightness), [lineBrightness, lineSpectrum]);
  const effectiveDrawing = useMemo(() => drawnSpectrum.map((value) => clamp(value * drawBrightness)), [drawBrightness, drawnSpectrum]);
  const drawnResult = useMemo(() => integrateSpectrum(effectiveDrawing, 1), [effectiveDrawing]);

  return (
    <DemoChrome
      number="02"
      title="Human S, M, and L cone responses"
      subtitle="Compare a narrow spectral line with a spectrum you draw yourself. Both experiments use the same response integral, and brightness scales the three measurements without forcing normalization."
    >
      <section className="demo-section">
        <header className="section-heading compact"><p>Experiment A</p><h2>A narrow spectral line</h2></header>
        <div className="cone-workbench">
          <div>
            <SpectrumCanvas samples={lineSpectrum} brightness={lineBrightness} />
            <div className="dual-controls">
              <label>Wavelength <strong>{wavelength} nm</strong><input type="range" min="390" max="700" step="1" value={wavelength} onChange={(event) => setWavelength(Number(event.target.value))} /></label>
              <label>Brightness multiplier <strong>{lineBrightness.toFixed(2)}×</strong><input type="range" min="0" max="4" step="0.05" value={lineBrightness} onChange={(event) => setLineBrightness(Number(event.target.value))} /></label>
            </div>
          </div>
          <ResponsePanel responses={lineResult.responses} color={lineResult.displayRgb} />
        </div>
        <ModelBlock title="What is being computed">
          <p>For each cone class i, Rᵢ = ∫Hᵢ(λ)C(λ)dλ. The narrow line still excites several cone classes because their sensitivities overlap. Multiplying C by brightness b gives Rᵢ(bC)=bRᵢ(C).</p>
        </ModelBlock>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Experiment B</p><h2>Draw a spectral distribution and integrate it</h2></header>
        <div className="cone-workbench">
          <div>
            <SpectrumCanvas samples={drawnSpectrum} brightness={drawBrightness} editable onSamplesChange={setDrawnSpectrum} />
            <p className="interaction-hint">Draw directly in the graph. The black curve is spectral power; the translucent colored areas are C(λ)Hᵢ(λ), whose sums produce the three cone responses.</p>
            <div className="dual-controls">
              <label>Brightness multiplier <strong>{drawBrightness.toFixed(2)}×</strong><input type="range" min="0" max="1.5" step="0.025" value={drawBrightness} onChange={(event) => setDrawBrightness(Number(event.target.value))} /></label>
              <button className="tool-button" onClick={() => setDrawnSpectrum(WAVELENGTHS.map(() => 0))}>Clear spectrum</button>
              <button className="tool-button" onClick={() => setDrawnSpectrum(initialDrawing)}>Restore example</button>
            </div>
          </div>
          <ResponsePanel responses={drawnResult.responses} color={drawnResult.displayRgb} />
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Area and summation" tone="green"><p>The implementation samples every 5 nm. Each displayed response is a normalized Riemann sum, kᵢΣⱼC(λⱼ)Hᵢ(λⱼ)Δλ. A flat unit spectrum gives response 1 at brightness 1.</p></ModelBlock>
          <ModelBlock title="Brightness and clipping"><p>The faded dashed curve is the brightness-scaled spectrum. Values above the red threshold are clipped at 1, so responses scale together only before clipping; clipping can also change their ratios.</p></ModelBlock>
          <ModelBlock title="Rendering limitation" tone="red"><p>The cone curves are smooth pedagogical approximations. The swatch uses an analytic approximation to CIE 1931 color matching and clips the result to sRGB; real spectral work should use tabulated standard data.</p></ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
