"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import type { RGB, XY, XYZ } from "../_lib/color";
import { CIE1931_LOCUS, clamp, rgbToXyz, srgbDecode, xyYToXyz, xyzToRgb } from "../_lib/color";

type Triangle = [XY, XY, XY];
type Matrix3 = [number, number, number, number, number, number, number, number, number];

const D65: XYZ = [0.95047, 1, 1.08883];
const SRGB_TRIANGLE: Triangle = [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]];

const presets: Record<string, Triangle> = {
  "sRGB": SRGB_TRIANGLE,
  "Display P3": [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]],
  "Rec.2020": [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]],
  "Swap R and G": [[0.30, 0.60], [0.64, 0.33], [0.15, 0.06]],
  "Narrow teaching gamut": [[0.54, 0.34], [0.31, 0.52], [0.20, 0.12]],
};

function multiplyMatrixVector(matrix: Matrix3, vector: RGB | XYZ): XYZ {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function invertMatrix(matrix: Matrix3): Matrix3 | null {
  const [a,b,c,d,e,f,g,h,i] = matrix;
  const A = e*i-f*h, B = c*h-b*i, C = b*f-c*e;
  const D = f*g-d*i, E = a*i-c*g, F = c*d-a*f;
  const G = d*h-e*g, H = b*g-a*h, I = a*e-b*d;
  const determinant = a*A + b*D + c*G;
  if (Math.abs(determinant) < 1e-10) return null;
  return [A,B,C,D,E,F,G,H,I].map((value) => value / determinant) as Matrix3;
}

function primaryModel(triangle: Triangle) {
  const columns = triangle.map(([x,y]) => [x/y, 1, (1-x-y)/y] as XYZ);
  const unscaled: Matrix3 = [
    columns[0][0], columns[1][0], columns[2][0],
    columns[0][1], columns[1][1], columns[2][1],
    columns[0][2], columns[1][2], columns[2][2],
  ];
  const inverseUnscaled = invertMatrix(unscaled);
  if (!inverseUnscaled) return null;
  const scales = multiplyMatrixVector(inverseUnscaled, D65);
  const matrix: Matrix3 = [
    columns[0][0]*scales[0], columns[1][0]*scales[1], columns[2][0]*scales[2],
    scales[0], scales[1], scales[2],
    columns[0][2]*scales[0], columns[1][2]*scales[1], columns[2][2]*scales[2],
  ];
  const inverse = invertMatrix(matrix);
  return inverse ? { matrix, inverse, validWhite: scales.every((value) => value > 0) } : null;
}

function isOrderedSrgb(triangle: Triangle) {
  return triangle.every((point,index) => Math.abs(point[0]-SRGB_TRIANGLE[index][0]) < 1e-7 && Math.abs(point[1]-SRGB_TRIANGLE[index][1]) < 1e-7);
}

function createReferenceImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 280;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, "#204ad8");
  gradient.addColorStop(0.28, "#32b0af");
  gradient.addColorStop(0.52, "#e3e754");
  gradient.addColorStop(0.76, "#ef923f");
  gradient.addColorStop(1, "#ef573f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const vertical = context.createLinearGradient(0, 0, 0, canvas.height);
  vertical.addColorStop(0, "rgba(255,255,255,.78)");
  vertical.addColorStop(0.5, "rgba(255,255,255,0)");
  vertical.addColorStop(1, "rgba(0,0,0,.82)");
  context.fillStyle = vertical;
  context.fillRect(0, 0, canvas.width, canvas.height);
  [
    [85, 90, 56, "#ff1744"], [205, 84, 52, "#00e676"], [327, 92, 58, "#2979ff"],
    [140, 205, 42, "#ffea00"], [280, 205, 45, "#d500f9"],
  ].forEach(([x, y, radius, color]) => {
    context.beginPath();
    context.arc(Number(x), Number(y), Number(radius), 0, Math.PI * 2);
    context.fillStyle = String(color);
    context.fill();
  });
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function drawImageData(canvas: HTMLCanvasElement | null, image: ImageData | null) {
  if (!canvas || !image) return;
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
}

function traceSmoothLocus(ctx: CanvasRenderingContext2D, px: (x:number)=>number, py: (y:number)=>number) {
  const points = CIE1931_LOCUS;
  ctx.beginPath();
  ctx.moveTo(px(points[0][0]), py(points[0][1]));
  for (let index=0; index<points.length-1; index+=1) {
    const p0=points[Math.max(0,index-1)], p1=points[index], p2=points[index+1], p3=points[Math.min(points.length-1,index+2)];
    const cp1: XY = [p1[0]+(p2[0]-p0[0])/6, p1[1]+(p2[1]-p0[1])/6];
    const cp2: XY = [p2[0]-(p3[0]-p1[0])/6, p2[1]-(p3[1]-p1[1])/6];
    ctx.bezierCurveTo(px(cp1[0]),py(cp1[1]),px(cp2[0]),py(cp2[1]),px(p2[0]),py(p2[1]));
  }
  ctx.lineTo(px(points[0][0]),py(points[0][1]));
  ctx.closePath();
}

function GamutEditor({ triangle, onChange }: { triangle: Triangle; onChange: (triangle: Triangle) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const background = useRef<{ key:string; canvas:HTMLCanvasElement } | null>(null);

  useEffect(() => {
    const render = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const m = { left: 42, right: 18, top: 18, bottom: 34 };
      const width = rect.width - m.left - m.right;
      const height = rect.height - m.top - m.bottom;
      const px = (x: number) => m.left + x / 0.8 * width;
      const py = (y: number) => m.top + (1 - y / 0.9) * height;
      ctx.fillStyle = "#e6e1d4";
      ctx.fillRect(0, 0, rect.width, rect.height);

      const cacheKey = `${Math.round(width)}x${Math.round(height)}`;
      if (!background.current || background.current.key !== cacheKey) {
        const colorCanvas = document.createElement("canvas");
        colorCanvas.width = Math.max(1,Math.round(width/2));
        colorCanvas.height = Math.max(1,Math.round(height/2));
        const colorContext = colorCanvas.getContext("2d");
        if (colorContext) {
          const pixels = colorContext.createImageData(colorCanvas.width,colorCanvas.height);
          for (let sy=0; sy<colorCanvas.height; sy+=1) {
            for (let sx=0; sx<colorCanvas.width; sx+=1) {
              const chromaticity: XY = [sx/Math.max(1,colorCanvas.width-1)*0.8,(1-sy/Math.max(1,colorCanvas.height-1))*0.9];
              const rgb = xyzToRgb(xyYToXyz(chromaticity,0.42));
              const offset=(sy*colorCanvas.width+sx)*4;
              pixels.data[offset]=Math.round(rgb[0]*255); pixels.data[offset+1]=Math.round(rgb[1]*255); pixels.data[offset+2]=Math.round(rgb[2]*255); pixels.data[offset+3]=220;
            }
          }
          colorContext.putImageData(pixels,0,0);
        }
        background.current={key:cacheKey,canvas:colorCanvas};
      }

      ctx.save();
      traceSmoothLocus(ctx,px,py);
      ctx.clip();
      ctx.drawImage(background.current.canvas,m.left,m.top,width,height);
      ctx.restore();

      ctx.strokeStyle = "rgba(23,23,19,.22)";
      ctx.lineWidth=1;
      [0.2,0.4,0.6,0.8].forEach((tick) => {
        ctx.beginPath(); ctx.moveTo(px(tick),py(0)); ctx.lineTo(px(tick),py(.9)); ctx.moveTo(px(0),py(tick)); ctx.lineTo(px(.8),py(tick)); ctx.stroke();
      });
      traceSmoothLocus(ctx,px,py);
      ctx.strokeStyle = "#171713"; ctx.lineWidth = 2.3; ctx.lineJoin="round"; ctx.lineCap="round"; ctx.stroke();

      const drawReference = (points: Triangle, color: string, dash: number[]) => {
        ctx.beginPath();
        points.forEach((point,index) => index ? ctx.lineTo(px(point[0]),py(point[1])) : ctx.moveTo(px(point[0]),py(point[1])));
        ctx.closePath(); ctx.strokeStyle=color; ctx.lineWidth=1.25; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
      };
      drawReference(presets["Rec.2020"], "rgba(137,49,192,.82)", [7,4]);
      drawReference(presets.sRGB, "rgba(239,87,63,.88)", [3,4]);
      ctx.beginPath();
      triangle.forEach((point,index) => index ? ctx.lineTo(px(point[0]),py(point[1])) : ctx.moveTo(px(point[0]),py(point[1])));
      ctx.closePath(); ctx.fillStyle = "rgba(32,74,216,.10)"; ctx.fill(); ctx.strokeStyle = "#204ad8"; ctx.lineWidth = 2.8; ctx.stroke();
      const labels = ["R", "G", "B"];
      triangle.forEach((point,index) => {
        ctx.beginPath(); ctx.arc(px(point[0]),py(point[1]),8,0,Math.PI*2); ctx.fillStyle = ["#ef573f","#48764d","#204ad8"][index]; ctx.fill(); ctx.strokeStyle="#171713"; ctx.lineWidth=1.5; ctx.stroke();
        ctx.fillStyle="#171713"; ctx.font="700 12px Helvetica, Arial, sans-serif"; ctx.fillText(labels[index],px(point[0])+11,py(point[1])+4);
      });
      const white: XY=[0.3127,0.3290];
      ctx.beginPath(); ctx.arc(px(white[0]),py(white[1]),4,0,Math.PI*2); ctx.fillStyle="#fff"; ctx.fill(); ctx.strokeStyle="#171713"; ctx.stroke();
      ctx.fillStyle="#171713"; ctx.font="9px Helvetica, Arial, sans-serif"; ctx.fillText("D65",px(white[0])+7,py(white[1])+3);
      [[380,CIE1931_LOCUS[0]],[450,CIE1931_LOCUS[14]],[520,CIE1931_LOCUS[28]],[555,CIE1931_LOCUS[35]],[600,CIE1931_LOCUS[44]],[700,CIE1931_LOCUS[64]]].forEach(([wavelength,point]) => {
        const [cx,cy] = point as XY; ctx.fillStyle="#171713"; ctx.font="9px Helvetica, Arial, sans-serif"; ctx.fillText(String(wavelength),px(cx)+4,py(cy)-4);
      });
      ctx.fillStyle="#171713"; ctx.font="11px Helvetica, Arial, sans-serif"; ctx.fillText("x",rect.width-14,py(0)+2); ctx.fillText("y",px(0)-2,12);
    };
    render();
    window.addEventListener("resize", render);
    return () => window.removeEventListener("resize", render);
  }, [triangle]);

  function position(event: React.PointerEvent<HTMLCanvasElement>): XY {
    const rect = event.currentTarget.getBoundingClientRect();
    const m = { left: 42, right: 18, top: 18, bottom: 34 };
    return [
      Math.min(.78, Math.max(.01, (event.clientX - rect.left - m.left) / (rect.width - m.left - m.right) * .8)),
      Math.min(.88, Math.max(.01, (1 - (event.clientY - rect.top - m.top) / (rect.height - m.top - m.bottom)) * .9)),
    ];
  }

  return <canvas ref={ref} className="gamut-editor" onPointerDown={(event) => {
    const point = position(event);
    dragging.current = triangle.reduce((best,indexPoint,index) => {
      const distance = (indexPoint[0]-point[0])**2 + (indexPoint[1]-point[1])**2;
      const bestDistance = (triangle[best][0]-point[0])**2 + (triangle[best][1]-point[1])**2;
      return distance < bestDistance ? index : best;
    },0);
    event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={(event) => {
    if (dragging.current === null) return;
    onChange(triangle.map((entry,index) => index === dragging.current ? position(event) : entry) as Triangle);
  }} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }} role="img" aria-label="Drag three labeled primary chromaticities on a colored CIE 1931 x-y diagram" />;
}

export default function PseudoGamutDemo() {
  const [triangle, setTriangle] = useState<Triangle>(presets.sRGB);
  const [image, setImage] = useState<ImageData | null>(null);
  const [name, setName] = useState("generated reference image");
  const [presetName, setPresetName] = useState<string | null>("sRGB");
  const originalRef = useRef<HTMLCanvasElement>(null);
  const directRef = useRef<HTMLCanvasElement>(null);
  const managedRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setImage(createReferenceImage()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const mapped = useMemo(() => {
    if (!image) return { direct:null as ImageData|null, managed:null as ImageData|null, coverage:0, clipped:0, validWhite:true };
    const direct = new ImageData(new Uint8ClampedArray(image.data),image.width,image.height);
    const managed = new ImageData(new Uint8ClampedArray(image.data),image.width,image.height);
    const model=primaryModel(triangle);
    if (!model) return { direct,managed,coverage:0,clipped:0,validWhite:false };
    const exactSrgb=isOrderedSrgb(triangle);
    let inside=0, opaque=0;
    for (let offset=0; offset<image.data.length; offset+=4) {
      if (image.data[offset+3]<8) continue;
      opaque+=1;
      const encoded: RGB=[image.data[offset]/255,image.data[offset+1]/255,image.data[offset+2]/255];
      const linear=encoded.map(srgbDecode) as RGB;

      if (!exactSrgb) {
        const directRgb=xyzToRgb(multiplyMatrixVector(model.matrix,linear));
        direct.data[offset]=Math.round(directRgb[0]*255); direct.data[offset+1]=Math.round(directRgb[1]*255); direct.data[offset+2]=Math.round(directRgb[2]*255);
      }

      const desiredXyz=rgbToXyz(encoded);
      const drives=multiplyMatrixVector(model.inverse,desiredXyz);
      const reproducible=drives.every((value)=>value>=-1e-8&&value<=1+1e-8);
      if (reproducible) { inside+=1; continue; }
      const clippedDrives=drives.map((value)=>clamp(value)) as RGB;
      const managedRgb=xyzToRgb(multiplyMatrixVector(model.matrix,clippedDrives));
      managed.data[offset]=Math.round(managedRgb[0]*255); managed.data[offset+1]=Math.round(managedRgb[1]*255); managed.data[offset+2]=Math.round(managedRgb[2]*255);
    }
    return { direct,managed,coverage:opaque?inside/opaque:1,clipped:opaque-inside,validWhite:model.validWhite };
  },[image,triangle]);

  useEffect(() => {
    drawImageData(originalRef.current,image); drawImageData(directRef.current,mapped.direct); drawImageData(managedRef.current,mapped.managed);
  },[image,mapped.direct,mapped.managed]);

  function handleUpload(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    const url=URL.createObjectURL(file); const uploaded=new Image();
    uploaded.onload=()=>{
      const scale=Math.min(1,420/Math.max(uploaded.naturalWidth,uploaded.naturalHeight));
      const canvas=document.createElement("canvas"); canvas.width=Math.max(1,Math.round(uploaded.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(uploaded.naturalHeight*scale));
      const context=canvas.getContext("2d",{willReadFrequently:true});
      if (context) { context.drawImage(uploaded,0,0,canvas.width,canvas.height); setImage(context.getImageData(0,0,canvas.width,canvas.height)); setName(file.name); }
      URL.revokeObjectURL(url);
    };
    uploaded.src=url;
  }

  return (
    <DemoChrome number="03" title="Pseudo-gamut and primary mapping" subtitle="Move labeled R, G, and B primaries and compare two different questions: what fixed channel drives would emit, and what a color-managed device can reproduce without clipping.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Live comparison</p><h2>Move or permute the primaries</h2></header>
        <div className="gamut-live-layout">
          <div className="gamut-primary-column">
            <GamutEditor triangle={triangle} onChange={(next)=>{setTriangle(next);setPresetName(null);}} />
            <div className="gamut-reference-legend"><span className="selected">selected</span><span className="srgb-ref">sRGB reference</span><span className="rec-ref">Rec.2020 reference</span></div>
            <p className="interaction-hint">Drag the labeled R, G, or B point. The colored horseshoe uses the CIE 1931 2° locus; the curved spectral edge is smoothly interpolated between standard samples and the purple edge remains straight.</p>
            <div className="preset-buttons">{Object.entries(presets).map(([label,value])=><button key={label} className={presetName===label?"active":""} onClick={()=>{setTriangle(value);setPresetName(label);}}>{label}</button>)}</div>
            <div className="primary-values">{triangle.map((point,index)=><div key={index}><span>{["R","G","B"][index]}</span><strong>x {point[0].toFixed(3)}</strong><strong>y {point[1].toFixed(3)}</strong></div>)}</div>
          </div>
          <div className="gamut-image-column">
            <div className="gamut-status"><div><span>managed coverage</span><strong>{(mapped.coverage*100).toFixed(1)}%</strong></div><div><span>clipped pixels</span><strong>{mapped.clipped.toLocaleString()}</strong></div><label className="file-control"><span>Use another image</span><input type="file" accept="image/*" onChange={(event)=>handleUpload(event.target.files?.[0])}/></label></div>
            {!mapped.validWhite&&<p className="gamut-warning">The selected triangle does not contain D65. A display with these primaries cannot form the chosen neutral white using positive channel powers, so this configuration is physically invalid.</p>}
            <div className="image-comparison three-images">
              <figure><canvas ref={originalRef}/><figcaption>Original · {name}</figcaption></figure>
              <figure><canvas ref={directRef}/><figcaption>Fixed RGB drives → selected labeled primaries</figcaption></figure>
              <figure><canvas ref={managedRef}/><figcaption>Color-managed fit, with out-of-gamut drives clipped</figcaption></figure>
            </div>
            <ModelBlock title="Why swapping R and G now matters" tone="green"><p>The middle image keeps each pixel’s numerical R, G, and B drives but changes the chromaticity emitted by each labeled primary. Swapping R and G therefore swaps their hue roles. The right image instead solves for new drives that preserve the intended XYZ color.</p></ModelBlock>
          </div>
        </div>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Model</p><h2>Two valid questions, two different answers</h2></header>
        <div className="explanation-grid three">
          <ModelBlock title="Direct primary experiment"><p>The selected x–y points define the columns of an RGB-to-XYZ matrix, scaled so R+G+B produces D65. Applying that matrix to the original channel drives visualizes how the image changes when the physical primaries—or their labels—change.</p></ModelBlock>
          <ModelBlock title="Color-managed identity" tone="green"><p>The managed view solves the inverse matrix for new device drives. If all three drives lie in [0,1], the desired XYZ is reconstructed and the original pixel is copied exactly. Only pixels requiring invalid drives are clipped.</p></ModelBlock>
          <ModelBlock title="Why this remains a teaching model" tone="red"><p>The preview is rendered back through an sRGB screen, and channel clipping is not perceptually uniform gamut mapping. Real systems use measured display profiles, adaptation, tone curves, and perceptual rendering intents.</p></ModelBlock>
        </div>
        <p className="data-source-note">Spectral-locus data: <a href="https://cie.co.at/datatable/cie-1931-chromaticity-coordinates-spectrum-loci-2-degree-observer" target="_blank" rel="noreferrer">CIE 1931 2° chromaticity coordinates</a>, CIE 018:2019 Table 6, DOI 10.25039/CIE.DS.mifmy4x4.</p>
      </section>
    </DemoChrome>
  );
}
