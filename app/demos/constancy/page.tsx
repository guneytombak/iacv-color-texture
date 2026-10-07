"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { WAVELENGTHS, srgbDecode, srgbEncode } from "../_lib/color.ts";
import {
  PATCHES,
  REFERENCE_TEMPERATURE,
  blackbody,
  castGains,
  evaluate,
  grayWorldGains,
  greenSpectrum,
  ledSpectrum,
  neutralGains,
  whitePatchGains,
} from "../_lib/constancy.ts";
import type { Method, Spectrum, Vec3 } from "../_lib/constancy.ts";
import { loadSquareImage } from "../_lib/image.ts";
import { withBasePath } from "../_lib/paths.ts";

const PHOTO_SIZE = 256;
const METHODS: { id: Method; label: string; short: string }[] = [
  { id: "none", label: "No correction", short: "none" },
  { id: "grayWorld", label: "Gray world", short: "gray world" },
  { id: "whitePatch", label: "White patch (max-RGB)", short: "white patch" },
  { id: "manual", label: "Click a patch you believe is neutral", short: "your choice" },
  { id: "vonKries", label: "Known light (von Kries)", short: "known light" },
];
const LIGHT_PRESETS = [
  { label: "Candle-like 2000 K", temperature: 2000 },
  { label: "Tungsten 2856 K", temperature: 2856 },
  { label: "Warm white 4000 K", temperature: 4000 },
  { label: "Daylight-like 6500 K", temperature: 6500 },
  { label: "Blue shade 10000 K", temperature: 10000 },
];
const PHOTO_PRESETS = [
  { name: "Painting", src: withBasePath("/textures/painting.png") },
  { name: "Cloud", src: withBasePath("/textures/cloud.png") },
  { name: "Wicker", src: withBasePath("/textures/wicker.png") },
  { name: "Textile", src: withBasePath("/textures/textile.png") },
];
type LightKind = "blackbody" | "led" | "green";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
function css(linear: Vec3) {
  return `rgb(${linear.map((value) => Math.round(255 * srgbEncode(clamp01(value)))).join(" ")})`;
}
function outOfGamut(linear: Vec3) {
  return linear.some((value) => value < -0.002 || value > 1.002);
}

function lightSpectrum(kind: LightKind, temperature: number): Spectrum {
  return kind === "led" ? ledSpectrum() : kind === "green" ? greenSpectrum() : blackbody(temperature);
}

function SpectrumPlot({ spectrum }: { spectrum: Spectrum }) {
  const width = 420;
  const height = 120;
  const maximum = Math.max(...spectrum, 1e-12);
  const toX = (index: number) => (index / (spectrum.length - 1)) * width;
  const points = spectrum.map((value, index) => `${toX(index).toFixed(1)},${(height - 18 - (value / maximum) * (height - 26)).toFixed(1)}`).join(" ");
  return <svg className="constancy-spectrum" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Relative spectral power of the light, 380 to 700 nanometres">
    <defs><linearGradient id="visible-band" x1="0" x2="1">{["#6a00b8", "#2a3cff", "#00a8e8", "#00c060", "#d8e000", "#ff9a00", "#ff2a00", "#9a0000"].map((color, index) => <stop key={color} offset={`${(index / 7) * 100}%`} stopColor={color} />)}</linearGradient></defs>
    <rect x="0" y={height - 14} width={width} height="6" fill="url(#visible-band)" />
    <polyline points={points} />
    <text x="0" y={height - 1}>{WAVELENGTHS[0]} nm</text>
    <text x={width} y={height - 1} textAnchor="end">{WAVELENGTHS[WAVELENGTHS.length - 1]} nm</text>
  </svg>;
}

function PatchGrid({ colors, label, errors, selected, onPick }: { colors: Vec3[]; label: string; errors?: number[]; selected?: number; onPick?: (index: number) => void }) {
  return <div className="constancy-grid" role={onPick ? "group" : "img"} aria-label={label}>
    {colors.map((color, index) => {
      const content = <>
        {errors && <small>{errors[index].toFixed(1)}</small>}
        {outOfGamut(color) && <i title="outside the sRGB gamut; displayed clipped">◆</i>}
      </>;
      return onPick
        ? <button type="button" key={PATCHES[index].name} style={{ background: css(color) }} aria-pressed={selected === index} aria-label={`${PATCHES[index].name}: use as neutral`} title={PATCHES[index].name} onClick={() => onPick(index)}>{content}</button>
        : <span key={PATCHES[index].name} style={{ background: css(color) }} title={`${PATCHES[index].name}${errors ? ` · ΔE ${errors[index].toFixed(1)}` : ""}`}>{content}</span>;
    })}
  </div>;
}

function PhotoCanvas({ rgba, label, onPick }: { rgba: Uint8ClampedArray; label: string; onPick?: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) context.putImageData(new ImageData(new Uint8ClampedArray(rgba), PHOTO_SIZE, PHOTO_SIZE), 0, 0);
  }, [rgba]);
  function pick(event: PointerEvent<HTMLCanvasElement>) {
    if (!onPick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPick(Math.floor(((event.clientX - rect.left) / rect.width) * PHOTO_SIZE), Math.floor(((event.clientY - rect.top) / rect.height) * PHOTO_SIZE));
  }
  return <canvas ref={ref} width={PHOTO_SIZE} height={PHOTO_SIZE} className={`texture-raster${onPick ? " constancy-pickable" : ""}`} role="img" aria-label={label} onPointerDown={pick} />;
}

function toRgba(linear: Float64Array) {
  const rgba = new Uint8ClampedArray((linear.length / 3) * 4);
  for (let index = 0; index < linear.length / 3; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) rgba[index * 4 + channel] = Math.round(255 * srgbEncode(clamp01(linear[index * 3 + channel])));
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}

// The dress (slide 35), reconstructed with two representative stripe colours; they resemble the
// photograph but are not sampled from it.
const STRIPE_LIGHT: Vec3 = [131, 142, 189].map((value) => srgbDecode(value / 255)) as Vec3;
const STRIPE_DARK: Vec3 = [118, 95, 58].map((value) => srgbDecode(value / 255)) as Vec3;
const SHADOW_LIGHT = STRIPE_LIGHT.map((value) => value / 0.85) as Vec3;
const WARM_LIGHT = castGains(blackbody(3000)).map((value) => value * 2.5) as Vec3;

function Stripes({ light, dark, label }: { light: Vec3; dark: Vec3; label: string }) {
  return <div className="dress-stripes" role="img" aria-label={label}>
    {Array.from({ length: 7 }, (_, index) => <span key={index} style={{ background: css(index % 2 ? dark : light) }} />)}
  </div>;
}

export default function ConstancyDemo() {
  const [kind, setKind] = useState<LightKind>("blackbody");
  const [temperature, setTemperature] = useState(2856);
  const [method, setMethod] = useState<Method>("grayWorld");
  const [manualIndex, setManualIndex] = useState(20);
  const [photoSource, setPhotoSource] = useState(PHOTO_PRESETS[0].src);
  const [photoName, setPhotoName] = useState(PHOTO_PRESETS[0].name);
  const [photo, setPhoto] = useState<{ source: string; linear: Float64Array } | null>(null);
  const [castTemperature, setCastTemperature] = useState(3000);
  const [photoMethod, setPhotoMethod] = useState<Exclude<Method, "vonKries">>("grayWorld");
  const [photoNeutral, setPhotoNeutral] = useState<{ x: number; y: number } | null>(null);
  const [assumption, setAssumption] = useState(0);

  const spectrum = useMemo(() => lightSpectrum(kind, temperature), [kind, temperature]);
  const deferredSpectrum = useDeferredValue(spectrum);
  const result = useMemo(() => evaluate(deferredSpectrum, method, manualIndex), [deferredSpectrum, manualIndex, method]);
  const comparison = useMemo(() => METHODS.map((entry) => ({ ...entry, error: evaluate(deferredSpectrum, entry.id, manualIndex).meanError })), [deferredSpectrum, manualIndex]);
  const reference = useMemo(() => evaluate(blackbody(REFERENCE_TEMPERATURE), "none", 0).reference, []);

  useEffect(() => {
    let cancelled = false;
    loadSquareImage(photoSource, PHOTO_SIZE).then((image) => {
      if (cancelled) return;
      const linear = new Float64Array(PHOTO_SIZE * PHOTO_SIZE * 3);
      for (let index = 0; index < PHOTO_SIZE * PHOTO_SIZE; index += 1) for (let channel = 0; channel < 3; channel += 1) linear[index * 3 + channel] = srgbDecode(image.rgba[index * 4 + channel] / 255);
      setPhoto({ source: photoSource, linear });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [photoSource]);

  const photoViews = useMemo(() => {
    if (!photo || photo.source !== photoSource) return null;
    const cast = castGains(blackbody(castTemperature));
    const casted = Float64Array.from(photo.linear, (value, index) => value * cast[index % 3]);
    const pixels: Vec3[] = [];
    for (let index = 0; index < casted.length; index += 3) pixels.push([casted[index], casted[index + 1], casted[index + 2]]);
    let gains: Vec3 = [1, 1, 1];
    if (photoMethod === "grayWorld") gains = grayWorldGains(pixels);
    else if (photoMethod === "whitePatch") gains = whitePatchGains(pixels, [1, 1, 1], 0.99);
    else if (photoMethod === "manual" && photoNeutral) {
      const sample: Vec3 = [0, 0, 0];
      let count = 0;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const x = Math.min(PHOTO_SIZE - 1, Math.max(0, photoNeutral.x + dx));
        const y = Math.min(PHOTO_SIZE - 1, Math.max(0, photoNeutral.y + dy));
        for (let channel = 0; channel < 3; channel += 1) sample[channel] += pixels[y * PHOTO_SIZE + x][channel];
        count += 1;
      }
      gains = neutralGains(sample.map((value) => value / count) as Vec3);
    }
    // Keep overall exposure comparable: normalize the gains so the green channel gain is 1.
    gains = gains.map((value) => value / gains[1]) as Vec3;
    const corrected = Float64Array.from(casted, (value, index) => value * gains[index % 3]);
    return { original: toRgba(photo.linear), casted: toRgba(casted), corrected: toRgba(corrected), cast, gains };
  }, [castTemperature, photo, photoMethod, photoNeutral, photoSource]);

  const assumedLight = SHADOW_LIGHT.map((value, index) => Math.exp((1 - assumption) * Math.log(value) + assumption * Math.log(WARM_LIGHT[index]))) as Vec3;
  const fabricLight = STRIPE_LIGHT.map((value, index) => value / assumedLight[index]) as Vec3;
  const fabricDark = STRIPE_DARK.map((value, index) => value / assumedLight[index]) as Vec3;

  function pickPatch(index: number) {
    setManualIndex(index);
    setMethod("manual");
  }

  function uploadPhoto(file?: File) {
    if (!file) return;
    setPhotoSource((previous) => {
      if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    setPhotoName(file.name);
    setPhotoNeutral(null);
  }

  return (
    <DemoChrome number="04" title="Color constancy" subtitle="The light reaching a camera is the product of surface reflectance and illumination. Change the light on a chart of surfaces, try to recover the surface colours with simple constancy algorithms, apply the same ideas to a photograph, and see why one photograph of a dress divided the internet.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Surfaces under changing light</p><h2>Recover the surface, discount the light</h2></header>
        <div className="constancy-workbench">
          <aside className="texture-controls">
            <fieldset className="laws-choice"><legend>Light source</legend>
              {(["blackbody", "led", "green"] as LightKind[]).map((value) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "blackbody" ? "Blackbody" : value === "led" ? "White LED" : "Green light"}</button>)}
            </fieldset>
            {kind === "blackbody" && <>
              <label className="texture-control"><span>Colour temperature</span><strong>{temperature} K</strong><input type="range" min="2000" max="12000" step="50" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label>
              <div className="constancy-presets">{LIGHT_PRESETS.map((preset) => <button type="button" key={preset.temperature} className="tool-button" aria-pressed={temperature === preset.temperature} onClick={() => setTemperature(preset.temperature)}>{preset.label}</button>)}</div>
            </>}
            <SpectrumPlot spectrum={spectrum} />
            <fieldset className="constancy-methods"><legend>Correction</legend>
              {METHODS.map((entry) => <label key={entry.id} className="check-control"><input type="radio" name="constancy-method" checked={method === entry.id} onChange={() => setMethod(entry.id)} /><span>{entry.label}</span></label>)}
            </fieldset>
            <div className="texture-readout cased-readout">
              <span>mean ΔE*ab to reference</span><strong>{result.meanError.toFixed(1)}</strong>
              {result.gains && <><span>channel gains (X, Y, Z)</span><strong>{result.gains.map((value) => value.toFixed(2)).join(" · ")}</strong></>}
            </div>
          </aside>
          <div className="constancy-views">
            <figure><PatchGrid colors={result.recorded} label="Patches as recorded under the selected light" selected={method === "manual" ? manualIndex : undefined} onPick={pickPatch} /><figcaption><strong>Recorded</strong> under this light, without adaptation. Click a patch to declare it neutral.</figcaption></figure>
            <figure><PatchGrid colors={result.corrected} errors={result.errors} label="Patches after correction, with colour differences" /><figcaption><strong>Corrected</strong> · number: ΔE*ab to the reference patch (below about 2 is hard to see; above 10 is obvious).</figcaption></figure>
            <figure><PatchGrid colors={reference} label="Patches under the reference light" /><figcaption><strong>Reference</strong>: the same surfaces under a {REFERENCE_TEMPERATURE} K blackbody, what perfect constancy would show. All grids are displayed relative to this light&apos;s white; ◆ marks colours outside the sRGB gamut, shown clipped.</figcaption></figure>
            <div className="constancy-comparison">
              <table>
                <caption>Mean ΔE*ab over all {PATCHES.length} patches under the current light</caption>
                <tbody><tr>{comparison.map((entry) => <td key={entry.id} className={entry.id === method ? "current" : ""}><span>{entry.short}</span><strong>{entry.error.toFixed(1)}</strong></td>)}</tr></tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="A product of two unknowns"><p>The signal from a surface is ∫E(λ)R(λ)s̄<sub>c</sub>(λ)dλ for each sensor c: illuminant E times reflectance R. Constancy means estimating R, or at least its appearance under a standard light, without knowing E. Here the &quot;camera&quot; records with the CIE colour-matching functions, so every recording is an XYZ triple, and exposure is set so a perfect white has Y = 1.</p></ModelBlock>
          <ModelBlock title="Guessing the light" tone="green"><p>Gray world assumes the average surface is gray; white patch assumes the brightest value in each channel comes from a white surface. Each turns its assumption into one gain per channel that maps the estimate onto the reference white. Both fail when the scene breaks the assumption, for example a chart dominated by one hue.</p></ModelBlock>
          <ModelBlock title="Even the true light is not enough" tone="red"><p>With the light known, von Kries adaptation scales cone-like (Bradford) responses so the light&apos;s white maps to the reference white. Errors remain, because a per-channel gain cannot undo every spectral product: two surfaces that match under one light can differ under another. Human vision also uses context, as Land&apos;s experiments showed.</p></ModelBlock>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Your own photograph</p><h2>Add a colour cast, then take it away</h2></header>
        <div className="image-fourier-layout constancy-photo-layout">
          <aside className="texture-image-picker">
            <div className="preset-strip">{PHOTO_PRESETS.map((preset) => <button type="button" key={preset.name} className={photoSource === preset.src ? "active" : ""} aria-pressed={photoSource === preset.src} onClick={() => { setPhotoSource(preset.src); setPhotoName(preset.name); setPhotoNeutral(null); }}>{preset.name}</button>)}</div>
            <label className="file-control">Load a photograph<input type="file" accept="image/*" onChange={(event) => uploadPhoto(event.target.files?.[0])} /></label>
            <label className="texture-control"><span>Simulated light</span><strong>{castTemperature} K</strong><input type="range" min="2000" max="12000" step="100" value={castTemperature} onChange={(event) => setCastTemperature(Number(event.target.value))} /></label>
            <fieldset className="constancy-methods"><legend>Correction</legend>
              {METHODS.filter((entry) => entry.id !== "vonKries").map((entry) => <label key={entry.id} className="check-control"><input type="radio" name="photo-method" checked={photoMethod === entry.id} onChange={() => setPhotoMethod(entry.id as Exclude<Method, "vonKries">)} /><span>{entry.id === "manual" ? "Click a point you believe is neutral" : entry.id === "whitePatch" ? "White patch (99th percentile)" : entry.label}</span></label>)}
            </fieldset>
            {photoViews && <div className="texture-readout cased-readout"><span>cast gains (R, G, B)</span><strong>{photoViews.cast.map((value) => value.toFixed(2)).join(" · ")}</strong><span>correction gains</span><strong>{photoViews.gains.map((value) => value.toFixed(2)).join(" · ")}</strong></div>}
            <p>The cast multiplies linear RGB by the colour of a white surface under a blackbody of that temperature relative to {REFERENCE_TEMPERATURE} K, a diagonal approximation of re-lighting. The photograph is assumed to have been taken under neutral light.</p>
          </aside>
          <div className="gabor-response-grid">
            <figure>{photoViews ? <PhotoCanvas rgba={photoViews.original} label={`${photoName}, as supplied`} /> : <div className="texture-loading">Loading…</div>}<figcaption>{photoName} · as supplied</figcaption></figure>
            <figure>{photoViews ? <PhotoCanvas rgba={photoViews.casted} label={`${photoName} under the simulated light`} onPick={(x, y) => { setPhotoNeutral({ x, y }); setPhotoMethod("manual"); }} /> : <div className="texture-loading">…</div>}<figcaption>Under {castTemperature} K · click a point that should be neutral</figcaption></figure>
            <figure>{photoViews ? <PhotoCanvas rgba={photoViews.corrected} label={`${photoName} after correction`} /> : <div className="texture-loading">…</div>}<figcaption>Corrected · {photoMethod === "manual" && !photoNeutral ? "click the middle image first" : METHODS.find((entry) => entry.id === photoMethod)?.short}</figcaption></figure>
          </div>
        </div>
        <ModelBlock title="Try to break it"><p>Use the cloud image: gray world assumes the average is gray, so it removes the blue of the sky together with the cast. White patch depends on a few bright pixels and is fooled by coloured highlights. Clicking a point works well only if that point really is neutral.</p></ModelBlock>
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>The dress (slide 35)</p><h2>Identical pixels, two assumed lights</h2></header>
        <div className="dress-layout">
          <figure className="dress-context shadow"><Stripes light={STRIPE_LIGHT} dark={STRIPE_DARK} label="Stripes on a bluish, shadowed background" /><figcaption>The same two pixel colours on a bluish, shadowed background</figcaption></figure>
          <figure className="dress-context warm"><Stripes light={STRIPE_LIGHT} dark={STRIPE_DARK} label="Stripes on a warm, bright background" /><figcaption>…and on a warm, brightly lit background</figcaption></figure>
          <figure className="dress-result">
            <Stripes light={fabricLight} dark={fabricDark} label="Inferred fabric colours under the assumed light" />
            <label className="texture-control"><span>Assumed light</span><strong>{assumption < 0.35 ? "bluish shadow" : assumption > 0.65 ? "warm, bright light" : "in between"}</strong><input type="range" min="0" max="1" step="0.01" value={assumption} onChange={(event) => setAssumption(Number(event.target.value))} /></label>
            <figcaption>Inferred fabric = pixel ÷ assumed light (per channel, linear RGB). Shadow: <b>white and gold</b>; warm light: <b>blue and black</b>.</figcaption>
          </figure>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="One image, two decompositions"><p>The photograph fixes only the product of light and fabric. Viewers who assume bluish shadow divide by a bluish light and see white and gold; those who assume warm artificial light divide by a yellowish light and see blue and black. Both decompositions explain the same pixels.</p></ModelBlock>
          <ModelBlock title="A reconstruction" tone="green"><p>The stripe colours here were chosen to resemble the photograph on the slide; they are not sampled from it, and the two assumed lights are illustrative. The dress itself was blue and black.</p></ModelBlock>
          <ModelBlock title="Context sets the assumption" tone="violet"><p>The two backgrounds above contain identical stripes. The surround, and prior experience of daylight versus indoor light, influence which light the visual system assumes, which is why the effect differs between people and between viewing conditions.</p></ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
