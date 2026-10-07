"use client";

import { useMemo, useState } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import { ColorSpaceViewer } from "../_components/ThreeViews";
import type { HSL, HSV, RGB } from "../_lib/color";
import { clamp, hslToRgb, hsvToRgb, rgbCss, rgbToHsl, rgbToHsv } from "../_lib/color";

function readImagePixels(file: File, onReady: (pixels: RGB[], url: string, name: string) => void) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    const maxDimension = 320;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.ceil((width * height) / 6000));
    const pixels: RGB[] = [];
    for (let index = 0; index < width * height; index += step) {
      const offset = index * 4;
      if (data[offset + 3] < 16) continue;
      pixels.push([data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255]);
    }
    onReady(pixels, url, file.name);
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}

function ChannelControls({
  title,
  values,
  channels,
  onChange,
}: {
  title: string;
  values: number[];
  channels: { label: string; min: number; max: number; step: number; suffix?: string }[];
  onChange: (index: number, value: number) => void;
}) {
  return (
    <section className="conversion-controls">
      <h3>{title}</h3>
      {channels.map((channel, index) => (
        <label key={channel.label}>
          <span>{channel.label}</span>
          <input type="range" min={channel.min} max={channel.max} step={channel.step} value={values[index]} onChange={(event) => onChange(index, Number(event.target.value))} />
          <output>{values[index].toFixed(channel.step < 1 ? 2 : 0)}{channel.suffix}</output>
        </label>
      ))}
    </section>
  );
}

export default function ColorSpacesDemo() {
  const [rgb, setRgb] = useState<RGB>([0.13, 0.29, 0.85]);
  const [pixels, setPixels] = useState<RGB[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [pointSize, setPointSize] = useState(0.1);
  const hsv = useMemo(() => rgbToHsv(rgb), [rgb]);
  const hsl = useMemo(() => rgbToHsl(rgb), [rgb]);
  const hex = `#${rgb.map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

  function updateRgb(index: number, value: number) {
    setRgb((current) => current.map((entry, i) => i === index ? clamp(value / 255) : entry) as RGB);
  }

  function updateHsv(index: number, value: number) {
    const next = hsv.map((entry, i) => i === index ? (index === 0 ? value : value / 100) : entry) as HSV;
    setRgb(hsvToRgb(next));
  }

  function updateHsl(index: number, value: number) {
    const next = hsl.map((entry, i) => i === index ? (index === 0 ? value : value / 100) : entry) as HSL;
    setRgb(hslToRgb(next));
  }

  function handleUpload(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    readImagePixels(file, (nextPixels, url, name) => {
      setPixels(nextPixels);
      setImageUrl(url);
      setImageName(name);
    });
  }

  return (
    <DemoChrome
      number="01"
      title="RGB, HSV, and HSL conversions"
      subtitle="Edit the same color in three coordinate systems, then inspect an image as a three-dimensional distribution rather than a list of channel values."
    >
      <section className="demo-section">
        <header className="section-heading compact"><p>Part A</p><h2>One color, three coordinate descriptions</h2></header>
        <div className="conversion-workbench">
          <div className="conversion-sidebar">
            <div className="mini-upload">
              <div className="compact-color-readout"><i style={{ background: rgbCss(rgb) }} /><span>Selected point</span><strong>{hex}</strong></div>
              <label className="file-control">
                <span>Load image</span>
                <input type="file" accept="image/*" onChange={(event) => handleUpload(event.target.files?.[0])} />
              </label>
              {imageUrl ? (
                <figure>{/* A blob URL is local-only and is not compatible with next/image optimization. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt={`Uploaded image ${imageName}`} /><figcaption>{imageName}<br />{pixels.length.toLocaleString()} sampled pixels</figcaption></figure>
              ) : (
                <div className="mini-upload-placeholder"><span>Image preview</span><small>Processed locally in this browser</small></div>
              )}
              <label className="point-size-control">3D pixel size <strong>{pointSize.toFixed(3)}</strong><input type="range" min="0.012" max="0.1" step="0.002" value={pointSize} onChange={(event) => setPointSize(Number(event.target.value))} /></label>
            </div>
            <ChannelControls title="RGB · encoded sRGB" values={rgb.map((value) => value * 255)} channels={[{ label: "R", min: 0, max: 255, step: 1 }, { label: "G", min: 0, max: 255, step: 1 }, { label: "B", min: 0, max: 255, step: 1 }]} onChange={updateRgb} />
            <ChannelControls title="HSV" values={[hsv[0], hsv[1] * 100, hsv[2] * 100]} channels={[{ label: "H", min: 0, max: 360, step: 1, suffix: "°" }, { label: "S", min: 0, max: 100, step: 1, suffix: "%" }, { label: "V", min: 0, max: 100, step: 1, suffix: "%" }]} onChange={updateHsv} />
            <ChannelControls title="HSL" values={[hsl[0], hsl[1] * 100, hsl[2] * 100]} channels={[{ label: "H", min: 0, max: 360, step: 1, suffix: "°" }, { label: "S", min: 0, max: 100, step: 1, suffix: "%" }, { label: "L", min: 0, max: 100, step: 1, suffix: "%" }]} onChange={updateHsl} />
          </div>
          <div className="three-space-grid">
            <article><header><span>RGB cube</span><strong>coordinates: (R,G,B)</strong></header><ColorSpaceViewer space="rgb" rgb={rgb} pixels={pixels} pointSize={pointSize} /><p>Cartesian channel coordinates. The cube is exact for normalized encoded RGB values.</p></article>
            <article><header><span>HSV solid</span><strong>height: V · radius: C=SV</strong></header><ColorSpaceViewer space="hsv" rgb={rgb} pixels={pixels} pointSize={pointSize} /><p>The cone uses chroma C as radius. Hue is angular; V is the largest RGB component.</p></article>
            <article><header><span>HSL solid</span><strong>height: L · radius: C</strong></header><ColorSpaceViewer space="hsl" rgb={rgb} pixels={pixels} pointSize={pointSize} /><p>The double cone narrows toward black and white because C=(1−|2L−1|)S.</p></article>
          </div>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Interpretation</p><h2>How to read the three spaces</h2></header>
        <div className="explanation-grid three">
          <ModelBlock title="Conversion definitions">
            <p>Let M=max(R,G,B), m=min(R,G,B), and C=M−m. HSV uses V=M and S=C/V when V&gt;0. HSL uses L=(M+m)/2 and S=C/(1−|2L−1|) when C&gt;0.</p>
          </ModelBlock>
          <ModelBlock title="How to read an image cloud" tone="green">
            <p>A gray image forms a diagonal in RGB and collapses toward the central axes of HSV/HSL. Saturated pixels move outward. Use the pixel-size control when dense images obscure their internal distribution.</p>
          </ModelBlock>
          <ModelBlock title="Important limitation" tone="red">
            <p>HSV and HSL reorganize encoded RGB coordinates; they are not perceptually uniform and are not physical models of light. Euclidean distance in these views is not a reliable color-difference measure.</p>
          </ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
