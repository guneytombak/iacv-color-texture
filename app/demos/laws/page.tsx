"use client";

import { useEffect, useMemo, useState } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { Raster, rangeRgba, signedRgba, unsignedRgba } from "../_components/Raster";
import { cropDescription, loadSquareImage, lumaOf } from "../_lib/image.ts";
import {
  LAWS_SETS,
  LAWS_VECTORS,
  energyMap,
  euclidean,
  lawsBank,
  lawsFeatures,
  lawsMask,
  lawsResponse,
  logEnergies,
  removeLocalMean,
  vectorMagnitude,
} from "../_lib/laws.ts";
import type { LawsFilter, LawsName } from "../_lib/laws.ts";
import { withBasePath } from "../_lib/paths.ts";

const SIZE = 256;
const MEAN_RADIUS = 7;
const PRESETS = [
  { name: "Wicker", src: withBasePath("/textures/wicker.png"), color: "#e0452c" },
  { name: "Textile", src: withBasePath("/textures/textile.png"), color: "#204ad8" },
  { name: "Painting", src: withBasePath("/textures/painting.png"), color: "#2e8540" },
  { name: "Cloud", src: withBasePath("/textures/cloud.png"), color: "#7055a5" },
  { name: "Co-occurrence texture", src: withBasePath("/textures/coocur-texture.png"), color: "#a66f00" },
];
const UPLOAD_COLOR = "#171713";
const VECTOR_NAMES: Record<string, string> = { L: "Level · local weighted average", E: "Edge · first difference", S: "Spot · second difference", W: "Wave", R: "Ripple" };

type Loaded = { values: Float64Array; crop: string };

function MaskTable({ vertical, horizontal }: { vertical: LawsName; horizontal: LawsName }) {
  const mask = lawsMask(vertical, horizontal);
  const n = LAWS_VECTORS[vertical].length;
  const maximum = Math.max(...mask.map(Math.abs), 1);
  return <table className="laws-mask-table" aria-label={`${vertical}${horizontal} mask values`}>
    <thead><tr><th scope="col"><span className="sr-only">{vertical} \ {horizontal}</span></th>{LAWS_VECTORS[horizontal].map((value, index) => <th scope="col" key={index}>{value}</th>)}</tr></thead>
    <tbody>{LAWS_VECTORS[vertical].map((rowValue, row) => <tr key={row}>
      <th scope="row">{rowValue}</th>
      {mask.slice(row * n, row * n + n).map((value, column) => <td key={column} style={{ background: value === 0 ? undefined : value > 0 ? `rgba(224,69,44,${(0.75 * value) / maximum})` : `rgba(32,74,216,${(-0.75 * value) / maximum})` }}>{value}</td>)}
    </tr>)}</tbody>
  </table>;
}

function MiniMask({ filter, selected, onSelect }: { filter: LawsFilter; selected: boolean; onSelect: () => void }) {
  const mask = lawsMask(filter.vertical, filter.horizontal);
  const n = LAWS_VECTORS[filter.vertical].length;
  const maximum = Math.max(...mask.map(Math.abs), 1);
  return <button type="button" className="laws-mini" aria-pressed={selected} aria-label={`Select mask ${filter.name}`} onClick={onSelect}>
    <span className="laws-mini-grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} aria-hidden="true">
      {mask.map((value, index) => <i key={index} style={{ background: value === 0 ? "#e8e1d1" : value > 0 ? `rgba(224,69,44,${0.15 + (0.85 * value) / maximum})` : `rgba(32,74,216,${0.15 + (-0.85 * value) / maximum})` }} />)}
    </span>
    <small>{filter.name}</small>
  </button>;
}

function VectorResponsePlot({ names, highlighted }: { names: LawsName[]; highlighted: LawsName[] }) {
  const width = 520;
  const height = 200;
  const samples = Array.from({ length: 101 }, (_, index) => (index / 100) * 0.5);
  const toX = (frequency: number) => 36 + (frequency / 0.5) * (width - 48);
  const toY = (value: number) => height - 24 - value * (height - 40);
  return <svg className="laws-response-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Normalized frequency response magnitude of each one-dimensional vector">
    <line x1={toX(0)} x2={toX(0.5)} y1={toY(0)} y2={toY(0)} className="axis" />
    {[0, 0.125, 0.25, 0.375, 0.5].map((frequency) => <text key={frequency} x={toX(frequency)} y={height - 6} textAnchor="middle">{frequency}</text>)}
    <text x="4" y={toY(1) + 4}>1</text><text x="4" y={toY(0) + 4}>0</text>
    {names.map((name) => {
      const peak = Math.max(...samples.map((frequency) => vectorMagnitude(name, frequency)));
      const active = highlighted.includes(name);
      const points = samples.map((frequency) => `${toX(frequency).toFixed(1)},${toY(vectorMagnitude(name, frequency) / peak).toFixed(1)}`).join(" ");
      const labelFrequency = samples[samples.reduce((best, frequency, index) => (vectorMagnitude(name, frequency) > vectorMagnitude(name, samples[best]) ? index : best), 0)];
      return <g key={name} className={active ? "active" : ""}>
        <polyline points={points} />
        <text x={Math.min(width - 20, toX(labelFrequency))} y={toY(1) - 4} textAnchor="middle">{name}</text>
      </g>;
    })}
  </svg>;
}

type Series = { name: string; color: string; values: number[]; dashed?: boolean };

function EnergyChart({ bank, series, selected, onSelect }: { bank: LawsFilter[]; series: Series[]; selected: string; onSelect: (filter: LawsFilter) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 920;
  const height = 300;
  const left = 46;
  const bottom = 58;
  const all = series.flatMap((entry) => entry.values);
  const low = Math.floor(Math.min(...all, 0));
  const high = Math.ceil(Math.max(...all, 1));
  const toX = (index: number) => left + ((index + 0.5) / bank.length) * (width - left - 12);
  const toY = (value: number) => 10 + ((high - value) / Math.max(1e-9, high - low)) * (height - bottom - 10);
  const ticks = Array.from({ length: high - low + 1 }, (_, index) => low + index);

  function locate(event: { clientX: number; currentTarget: SVGSVGElement }) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(bank.length - 1, Math.floor(((x - left) / (width - left - 12)) * bank.length)));
  }

  return <div className="laws-chart">
    <ul className="laws-legend">{series.map((entry) => <li key={entry.name}><i style={{ background: entry.dashed ? `repeating-linear-gradient(90deg, ${entry.color} 0 5px, transparent 5px 8px)` : entry.color }} />{entry.name}</li>)}</ul>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Logarithm of mean energy for each Laws filter and texture"
      onPointerMove={(event) => setHover(locate(event))}
      onPointerLeave={() => setHover(null)}
      onClick={(event) => onSelect(bank[locate(event)])}>
      {ticks.map((tick) => <g key={tick} className="grid"><line x1={left} x2={width - 12} y1={toY(tick)} y2={toY(tick)} /><text x={left - 8} y={toY(tick) + 4} textAnchor="end">{tick}</text></g>)}
      {bank.map((filter, index) => <g key={filter.name} className={filter.name === selected ? "selected-band" : ""}>
        {filter.name === selected && <rect x={toX(index) - (width - left - 12) / bank.length / 2} y="10" width={(width - left - 12) / bank.length} height={height - bottom - 10} />}
        <text x={toX(index)} y={height - bottom + 14} transform={`rotate(-55 ${toX(index)} ${height - bottom + 14})`} textAnchor="end">{filter.name}</text>
      </g>)}
      {series.map((entry) => <polyline key={entry.name} points={entry.values.map((value, index) => `${toX(index).toFixed(1)},${toY(value).toFixed(1)}`).join(" ")} style={{ stroke: entry.color }} strokeDasharray={entry.dashed ? "6 4" : undefined} />)}
      {hover !== null && <g className="crosshair">
        <line x1={toX(hover)} x2={toX(hover)} y1="10" y2={height - bottom} />
        {series.map((entry) => <circle key={entry.name} cx={toX(hover)} cy={toY(entry.values[hover])} r="4.5" style={{ fill: entry.color }} />)}
      </g>}
    </svg>
    {hover !== null && <div className="laws-tooltip" style={{ left: `${(toX(hover) / width) * 100}%` }}>
      <strong>{bank[hover].name}</strong>
      {series.map((entry) => <span key={entry.name}><i style={{ background: entry.color }} />{entry.name}<b>{entry.values[hover].toFixed(2)}</b></span>)}
    </div>}
    <details className="laws-table-view">
      <summary>Show values as a table</summary>
      <div className="laws-table-scroll">
        <table>
          <thead><tr><th scope="col">Filter</th>{series.map((entry) => <th scope="col" key={entry.name}>{entry.name}</th>)}</tr></thead>
          <tbody>{bank.map((filter, index) => <tr key={filter.name}><th scope="row">{filter.name}</th>{series.map((entry) => <td key={entry.name}>{entry.values[index].toFixed(3)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}

export default function LawsDemo() {
  const [set, setSet] = useState<"3" | "5">("5");
  const [vertical, setVertical] = useState<LawsName>("E5");
  const [horizontal, setHorizontal] = useState<LawsName>("L5");
  const [source, setSource] = useState(PRESETS[0].src);
  const [sourceName, setSourceName] = useState(PRESETS[0].name);
  const [loaded, setLoaded] = useState<{ source: string; image: Loaded } | null>(null);
  const [presetImages, setPresetImages] = useState<Record<string, Float64Array>>({});
  const [removeMean, setRemoveMean] = useState(true);
  const [energyRadius, setEnergyRadius] = useState(7);
  const [normalize, setNormalize] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSquareImage(source, SIZE).then((image) => { if (!cancelled) setLoaded({ source, image: { values: lumaOf(image.rgba), crop: cropDescription(image) } }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(PRESETS.map(async (preset) => [preset.name, lumaOf((await loadSquareImage(preset.src, SIZE)).rgba)] as const))
      .then((entries) => { if (!cancelled) setPresetImages(Object.fromEntries(entries)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const bank = useMemo(() => lawsBank(set), [set]);
  const current = loaded && loaded.source === source ? loaded.image : null;
  const prepare = useMemo(() => (values: Float64Array) => removeMean ? removeLocalMean(values, SIZE, MEAN_RADIUS) : values, [removeMean]);
  const processed = useMemo(() => current ? prepare(current.values) : null, [current, prepare]);
  const response = useMemo(() => processed ? lawsResponse(processed, SIZE, vertical, horizontal) : null, [horizontal, processed, vertical]);
  const energy = useMemo(() => response ? energyMap(response, SIZE, energyRadius) : null, [energyRadius, response]);

  const presetFeatures = useMemo(() => {
    if (Object.keys(presetImages).length < PRESETS.length) return null;
    return PRESETS.map((preset) => ({ preset, features: lawsFeatures(prepare(presetImages[preset.name]), SIZE, bank) }));
  }, [bank, prepare, presetImages]);
  const isUpload = !PRESETS.some((preset) => preset.src === source);
  const uploadFeatures = useMemo(() => isUpload && processed ? lawsFeatures(processed, SIZE, bank) : null, [bank, isUpload, processed]);

  const series: Series[] = useMemo(() => {
    if (!presetFeatures) return [];
    const list: Series[] = presetFeatures.map(({ preset, features }) => ({ name: preset.name, color: preset.color, values: logEnergies(features.whole, bank, normalize) }));
    if (uploadFeatures) list.push({ name: sourceName, color: UPLOAD_COLOR, values: logEnergies(uploadFeatures.whole, bank, normalize), dashed: true });
    return list;
  }, [bank, normalize, presetFeatures, sourceName, uploadFeatures]);

  const classification = useMemo(() => {
    if (!presetFeatures) return null;
    const lefts = presetFeatures.map(({ features }) => logEnergies(features.left, bank, normalize));
    const rights = presetFeatures.map(({ features }) => logEnergies(features.right, bank, normalize));
    const distances = rights.map((right) => lefts.map((left) => euclidean(left, right)));
    const nearest = distances.map((row) => row.indexOf(Math.min(...row)));
    return { distances, nearest, correct: nearest.filter((value, index) => value === index).length };
  }, [bank, normalize, presetFeatures]);

  function chooseSet(next: "3" | "5") {
    setSet(next);
    setVertical(next === "5" ? "E5" : "E3");
    setHorizontal(next === "5" ? "L5" : "L3");
  }

  function uploadImage(file?: File) {
    if (!file) return;
    setSource((previous) => {
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setSourceName(file.name);
  }

  const name = `${vertical}${horizontal}`;
  const names = LAWS_SETS[set];

  return (
    <DemoChrome number="T04" title="Laws texture energy" subtitle="Build two-dimensional masks from Laws' one-dimensional level, edge, spot, wave and ripple vectors, filter a texture, average the squared output into local energy, and compare the resulting energy vectors across textures.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Masks</p><h2>Two short vectors make one mask</h2></header>
        <div className="laws-mask-layout">
          <aside className="texture-controls">
            <fieldset className="laws-choice"><legend>Vector length</legend>
              {(["5", "3"] as const).map((value) => <button type="button" key={value} aria-pressed={set === value} onClick={() => chooseSet(value)}>{value}-tap · {lawsBank(value).length} masks</button>)}
            </fieldset>
            <fieldset className="laws-choice"><legend>Vertical vector (down the columns, y)</legend>
              {names.map((value) => <button type="button" key={value} aria-pressed={vertical === value} onClick={() => setVertical(value)}>{value}</button>)}
            </fieldset>
            <fieldset className="laws-choice"><legend>Horizontal vector (along the rows, x)</legend>
              {names.map((value) => <button type="button" key={value} aria-pressed={horizontal === value} onClick={() => setHorizontal(value)}>{value}</button>)}
            </fieldset>
            <dl className="laws-vector-notes">{names.map((value) => <div key={value}><dt>{value} = [{LAWS_VECTORS[value].join(" ")}]</dt><dd>{VECTOR_NAMES[value[0]]}</dd></div>)}</dl>
          </aside>
          <div className="laws-mask-views">
            <figure><MaskTable vertical={vertical} horizontal={horizontal} /><figcaption><strong>{name}</strong> = {vertical}<sup>T</sup> × {horizontal}: each entry is the product of its row value ({vertical}, left) and column value ({horizontal}, top). Red is positive, blue negative.</figcaption></figure>
            <figure><VectorResponsePlot names={names} highlighted={[vertical, horizontal]} /><figcaption>Frequency response |H(f)| of each 1D vector against f in cycles per pixel (0 to 0.5), normalized to its own peak. The five vectors pass progressively higher frequencies; the selected pair is drawn darker.</figcaption></figure>
            <figure className="laws-gallery-figure">
              <div className="laws-gallery" style={{ gridTemplateColumns: `repeat(${names.length}, minmax(0, 76px))` }}>{bank.map((filter) => <MiniMask key={filter.name} filter={filter} selected={filter.name === name} onSelect={() => { setVertical(filter.vertical); setHorizontal(filter.horizontal); }} />)}</div>
              <figcaption>All {bank.length} masks: rows share the vertical vector, columns the horizontal one. Click to select.</figcaption>
            </figure>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Separable masks"><p>Every mask is an outer product, mask[y][x] = a[y]·b[x], so filtering is a pass along the rows with b followed by a pass down the columns with a. In the name {name}, the first vector ({vertical}) runs vertically and the second ({horizontal}) horizontally; E5L5 therefore averages along x and differentiates along y, and responds to horizontal edges.</p></ModelBlock>
          <ModelBlock title="A small filter bank" tone="green"><p>Apart from the level vectors, every vector sums to zero, so all masks except L·L ignore constant brightness. Their frequency responses peak at increasing frequencies, which makes the 25 masks a coarse, cheap partition of the Fourier plane, comparable in spirit to a bank of Gabor filters.</p></ModelBlock>
          <ModelBlock title="Naming" tone="violet"><p>The lecture lists seven vector types (level, edge, spot, wave, ripple, oscillation, undulation); the table on the slide, and this page, use the first five, in 3-tap and 5-tap versions. Odd lengths keep each mask centred on its pixel.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Energy</p><h2>Square the response, then average it locally</h2></header>
        <div className="image-fourier-layout laws-energy-layout">
          <aside className="texture-image-picker">
            <div className="preset-strip">{PRESETS.map((preset) => <button type="button" className={source === preset.src ? "active" : ""} aria-pressed={source === preset.src} key={preset.name} onClick={() => { setSource(preset.src); setSourceName(preset.name); }}>{preset.name}</button>)}</div>
            <label className="file-control">Load another image<input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} /></label>
            <label className="check-control"><input type="checkbox" checked={removeMean} onChange={(event) => setRemoveMean(event.target.checked)} /><span>Remove the local mean ({2 * MEAN_RADIUS + 1}×{2 * MEAN_RADIUS + 1} window) first</span></label>
            <label className="texture-control"><span>Energy window</span><strong>{2 * energyRadius + 1}×{2 * energyRadius + 1} px</strong><input type="range" min="1" max="20" step="1" value={energyRadius} onChange={(event) => setEnergyRadius(Number(event.target.value))} /></label>
            <p>{current ? current.crop : "Loading…"}; luma (Rec. 709 weights on encoded values). Borders are mirrored.</p>
          </aside>
          <div className="gabor-response-grid">
            <figure>{processed ? <Raster rgba={rangeRgba(processed)} size={SIZE} label={`${sourceName}${removeMean ? " after local mean removal" : ""}`} /> : <div className="texture-loading">Loading…</div>}<figcaption>{sourceName}{removeMean ? " · local mean removed (display stretched to its range)" : " · luma"}</figcaption></figure>
            <figure className="spectral-panel">{response ? <Raster rgba={signedRgba(response)} size={SIZE} label={`${name} response`} /> : <div className="texture-loading">…</div>}<figcaption>{name} response · signed, mid-gray is 0</figcaption></figure>
            <figure className="spectral-panel">{energy ? <Raster rgba={unsignedRgba(energy, 0.5)} size={SIZE} label={`${name} local energy`} /> : <div className="texture-loading">…</div>}<figcaption>Local energy, mean of response² over {2 * energyRadius + 1}×{2 * energyRadius + 1} px · brightness ∝ √energy</figcaption></figure>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Why square and average"><p>A filter response oscillates in sign as the mask slides over the texture. Squaring makes every match positive, and averaging over a window turns the result into a smooth local measure of how much structure of that type is present.</p></ModelBlock>
          <ModelBlock title="Window size" tone="green"><p>A small window localizes texture boundaries but gives noisy energies; a large window gives stable energies but blurs boundaries. The same trade-off reappears in every local texture measure.</p></ModelBlock>
          <ModelBlock title="Local mean removal" tone="red"><p>Without it, the L·L mask mostly measures brightness and the other masks inherit slow illumination changes at the image border. Turn the option off and watch the {set === "5" ? "L5L5" : "L3L3"} energy in the chart below.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>Features</p><h2>One energy per mask: a texture signature</h2></header>
        <div className="laws-feature-controls">
          <label className="check-control"><input type="checkbox" checked={normalize} onChange={(event) => setNormalize(event.target.checked)} /><span>Divide every energy by the {set === "5" ? "L5L5" : "L3L3"} energy (contrast normalization)</span></label>
          <p>Vertical axis: log<sub>10</sub> of the mean squared response over the whole {SIZE}×{SIZE} image{normalize ? `, relative to ${set === "5" ? "L5L5" : "L3L3"}` : ""}. Hover for values; click a column to select that mask above.</p>
        </div>
        {series.length ? <EnergyChart bank={bank} series={series} selected={name} onSelect={(filter) => { setVertical(filter.vertical); setHorizontal(filter.horizontal); }} /> : <div className="texture-loading">Computing energies for the supplied textures…</div>}
        {classification && <div className="laws-classification">
          <table>
            <caption>Can the energy vectors tell textures apart? Each image is split into left and right halves; every right half is assigned to the left half with the nearest log-energy vector (Euclidean distance). {classification.correct} of {PRESETS.length} right halves find their own texture.</caption>
            <thead><tr><th scope="col">right half ↓ · left half →</th>{PRESETS.map((preset) => <th scope="col" key={preset.name}>{preset.name}</th>)}</tr></thead>
            <tbody>{PRESETS.map((preset, row) => <tr key={preset.name}>
              <th scope="row">{preset.name}</th>
              {classification.distances[row].map((distance, column) => <td key={column} className={`${classification.nearest[row] === column ? "nearest" : ""} ${row === column ? "same" : ""}`}>{distance.toFixed(2)}</td>)}
            </tr>)}</tbody>
          </table>
        </div>}
        <div className="explanation-grid three">
          <ModelBlock title="Reading the chart"><p>Each line is one texture&apos;s feature vector. Fine textures keep more energy in the high-frequency masks (spots, waves, ripples); oriented textures differ between a mask and its transpose, for example E5L5 versus L5E5.</p></ModelBlock>
          <ModelBlock title="Classification" tone="green"><p>Comparing halves of the same image is a minimal test: a feature that describes the texture, not the particular pixels, should match a half to the other half of the same texture. Outlined cells are the nearest match; shaded cells are the correct one.</p></ModelBlock>
          <ModelBlock title="Contrast normalization" tone="violet"><p>Energies scale with image contrast. Dividing by the L·L energy removes a common gain and keeps only the shape of the signature; it also removes the L·L entry itself, which becomes exactly 0 on the log scale.</p></ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
