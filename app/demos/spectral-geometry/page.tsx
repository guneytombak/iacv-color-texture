"use client";

import { useRef, useState } from "react";
import { DemoChrome, ModelBlock } from "../_components/DemoChrome";
import type { RGB } from "../_lib/color";
import { clamp, rgbCss } from "../_lib/color";

type Position = [number, number];
type Ratio = number | null;

const platePositions: [number,number]=[0.28,0.72];
const plateY=0.77;

function hexToRgb(hex:string): RGB {
  const value=hex.replace("#","");
  return [parseInt(value.slice(0,2),16)/255,parseInt(value.slice(2,4),16)/255,parseInt(value.slice(4,6),16)/255];
}

function multiply(reflectance:RGB, light:RGB, shading=1): RGB {
  return reflectance.map((value,channel)=>value*light[channel]*shading) as RGB;
}

function safeRatio(a:number,b:number): Ratio {
  return Math.abs(b)<1e-9 ? null : a/b;
}

function ratioText(value:Ratio) {
  return value===null||!Number.isFinite(value)?"undefined":value.toFixed(3);
}

function SignalSwatch({label,value}:{label:string;value:RGB}) {
  return <div className="signal-swatch"><div style={{background:rgbCss(value)}}/><strong>{label}</strong><span>R {value[0].toFixed(3)} · G {value[1].toFixed(3)} · B {value[2].toFixed(3)}</span></div>;
}

function EqualityReadout({label,before,after}:{label:string;before:Ratio;after:Ratio}) {
  const measurable=before!==null&&after!==null;
  const stable=measurable&&Math.abs(before-after)<1e-8;
  return <div className="equality-readout"><span>{label}</span><strong>{ratioText(before)}</strong><i aria-hidden="true">→</i><strong>{ratioText(after)}</strong><b className={!measurable?"unavailable":stable?"stable":"changed"}>{!measurable?"not measurable":stable?"unchanged":"changed"}</b></div>;
}

function SpectrumControl({label,value,onChange,description}:{label:string;value:string;onChange:(value:string)=>void;description:string}) {
  const channels=hexToRgb(value);
  return <label className="spectrum-color-control"><span>{label}</span><input type="color" value={value} onChange={(event)=>onChange(event.target.value)}/><strong>{value.toUpperCase()}</strong><small>{description}</small><div><i>R {channels[0].toFixed(2)}</i><i>G {channels[1].toFixed(2)}</i><i>B {channels[2].toFixed(2)}</i></div></label>;
}

export default function SpectralGeometryDemo() {
  const [lightHex,setLightHex]=useState("#F4D09A");
  const [plate1Hex,setPlate1Hex]=useState("#C75A35");
  const [plate2Hex,setPlate2Hex]=useState("#62A851");
  const [lightPosition,setLightPosition]=useState<Position>([0.50,0.19]);
  const sceneRef=useRef<HTMLDivElement>(null);
  const dragging=useRef(false);

  const light=hexToRgb(lightHex);
  const materials:[RGB,RGB]=[hexToRgb(plate1Hex),hexToRgb(plate2Hex)];

  function geometricFactor(x:number) {
    const dx=x-lightPosition[0], dy=plateY-lightPosition[1];
    const distanceSquared=dx*dx+dy*dy+0.012;
    const cosine=Math.max(0,dy/Math.sqrt(distanceSquared));
    return clamp(0.26*cosine/distanceSquared,0,1.1);
  }

  const shading:[number,number]=[geometricFactor(platePositions[0]),geometricFactor(platePositions[1])];
  const spectral:[RGB,RGB]=[multiply(materials[0],light),multiply(materials[1],light)];
  const combined:[RGB,RGB]=[multiply(materials[0],light,shading[0]),multiply(materials[1],light,shading[1])];

  function plateGradient(material:RGB,x:number) {
    const left=multiply(material,light,geometricFactor(x-0.11));
    const center=multiply(material,light,geometricFactor(x));
    const right=multiply(material,light,geometricFactor(x+0.11));
    return `linear-gradient(90deg,${rgbCss(left)},${rgbCss(center)} 50%,${rgbCss(right)})`;
  }

  function beamStyle(targetX:number) {
    const dx=targetX-lightPosition[0], adjustedDy=(plateY-lightPosition[1])*0.68;
    // Fixed precision keeps the server-rendered and hydrated style strings identical.
    return {left:`${(lightPosition[0]*100).toFixed(3)}%`,top:`${(lightPosition[1]*100).toFixed(3)}%`,width:`${(Math.hypot(dx,adjustedDy)*100).toFixed(3)}%`,transform:`rotate(${Math.atan2(adjustedDy,dx).toFixed(5)}rad)`};
  }

  function moveLight(event:React.PointerEvent<HTMLDivElement>) {
    const rect=sceneRef.current?.getBoundingClientRect();
    if (!rect) return;
    setLightPosition([clamp((event.clientX-rect.left)/rect.width,0.08,0.92),clamp((event.clientY-rect.top)/rect.height,0.07,0.57)]);
  }

  function nudgeLight(event:React.KeyboardEvent<HTMLButtonElement>) {
    const changes:Record<string,Position>={ArrowLeft:[-0.02,0],ArrowRight:[0.02,0],ArrowUp:[0,-0.02],ArrowDown:[0,0.02]};
    const change=changes[event.key];
    if (!change) return;
    event.preventDefault();
    setLightPosition(([x,y])=>[clamp(x+change[0],0.08,0.92),clamp(y+change[1],0.07,0.57)]);
  }

  const baseCrossRatio=safeRatio(materials[0][0]*materials[1][1],materials[1][0]*materials[0][1]);
  const changedCrossRatio=safeRatio(combined[0][0]*combined[1][1],combined[1][0]*combined[0][1]);
  const missingChannels=["R","G","B"].filter((_,index)=>light[index]<0.015);

  return (
    <DemoChrome number="05" title="Spectral and geometric changes" subtitle="Drag a colored light above two reflective plates. The demo computes illumination at each plate center, applies a visible spatial gradient, and shows when ratio invariants are measurable—or fail because the light contains no usable energy in a channel.">
      <section className="demo-section">
        <header className="section-heading compact"><p>Interactive scene</p><h2>Move the light; choose three RGB spectra</h2></header>
        <div className="change-overview">
          <div ref={sceneRef} className="two-point-scene interactive-light-scene" onPointerDown={(event)=>{dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);moveLight(event);}} onPointerMove={(event)=>{if(dragging.current)moveLight(event);}} onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}}>
            <button type="button" className="light-source-2d draggable" style={{left:`${lightPosition[0]*100}%`,top:`${lightPosition[1]*100}%`,background:rgbCss(light)}} onKeyDown={nudgeLight} aria-label={`Move light source. Current normalized position ${lightPosition[0].toFixed(2)}, ${lightPosition[1].toFixed(2)}`}><span>drag light</span></button>
            <i className="dynamic-ray" style={beamStyle(platePositions[0])}/><i className="dynamic-ray" style={beamStyle(platePositions[1])}/>
            <div className="patch patch-one"><span>P₁ · g₁ {shading[0].toFixed(3)}</span><b style={{background:plateGradient(materials[0],platePositions[0])}}/></div>
            <div className="patch patch-two"><span>P₂ · g₂ {shading[1].toFixed(3)}</span><b style={{background:plateGradient(materials[1],platePositions[1])}}/></div>
            <p>Click or drag in the upper field · gradients approximate illumination across each plate</p>
          </div>
          <div className="change-controls spectrum-controls">
            <SpectrumControl label="Light spectrum E" value={lightHex} onChange={setLightHex} description="relative energy in three sensor bands"/>
            <SpectrumControl label="Plate 1 reflectance ρ₁" value={plate1Hex} onChange={setPlate1Hex} description="fraction reflected in each band"/>
            <SpectrumControl label="Plate 2 reflectance ρ₂" value={plate2Hex} onChange={setPlate2Hex} description="fraction reflected in each band"/>
            <div className="scene-presets"><button onClick={()=>{setLightHex("#F4D09A");setPlate1Hex("#C75A35");setPlate2Hex("#62A851");}}>Broadband example</button><button onClick={()=>{setLightHex("#0000FF");setPlate1Hex("#00FF00");setPlate2Hex("#FFFFFF");}}>Blue light · green + white</button></div>
            <p>Prediction prompt: move the source closer to one plate. Which values scale, and which ratios should remain unchanged?</p>
          </div>
        </div>
        <ModelBlock title="Three-band teaching model"><p>At point p and channel c, I<sub>c,p</sub> = E<sub>c</sub>ρ<sub>c,p</sub>g<sub>p</sub>. Here E and ρ are only three RGB samples. The geometric term g is computed from source distance and incidence at the plate center; it is not an independent slider.</p></ModelBlock>
        {missingChannels.length>0&&<div className="missing-spectrum-warning"><strong>Missing measurement channels: {missingChannels.join(", ")}</strong><p>The selected source contains essentially no energy in these bands. Every surface therefore returns zero there, so ratios such as 0/0 cannot reveal relative reflectance. Use the blue-light preset to inspect this failure directly.</p></div>}
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Case 1</p><h2>Spectral change: compare one channel across points</h2></header>
        <div className="change-case-layout">
          <div className="swatch-pairs"><SignalSwatch label="P₁ reflectance under unit white" value={materials[0]}/><SignalSwatch label="P₁ under selected light" value={spectral[0]}/><SignalSwatch label="P₂ reflectance under unit white" value={materials[1]}/><SignalSwatch label="P₂ under selected light" value={spectral[1]}/></div>
          <div className="invariant-panel">
            <p className="formula-large">I′<sub>c,p</sub> = E<sub>c</sub>ρ<sub>c,p</sub> &nbsp;⇒&nbsp; I′<sub>c,1</sub>/I′<sub>c,2</sub> = ρ<sub>c,1</sub>/ρ<sub>c,2</sub></p>
            <EqualityReadout label="R₁ / R₂" before={safeRatio(materials[0][0],materials[1][0])} after={safeRatio(spectral[0][0],spectral[1][0])}/><EqualityReadout label="G₁ / G₂" before={safeRatio(materials[0][1],materials[1][1])} after={safeRatio(spectral[0][1],spectral[1][1])}/><EqualityReadout label="B₁ / B₂" before={safeRatio(materials[0][2],materials[1][2])} after={safeRatio(spectral[0][2],spectral[1][2])}/>
          </div>
        </div>
        <p className="case-explanation">The same nonzero E<sub>c</sub> multiplies both points and cancels. If E<sub>c</sub>=0, both measurements are zero: the algebra suggests cancellation, but the sensor has no information and the ratio is undefined.</p>
      </section>

      <section className="demo-section">
        <header className="section-heading compact"><p>Case 2</p><h2>Geometric change: compare channels at one point</h2></header>
        <div className="change-case-layout">
          <div className="swatch-pairs"><SignalSwatch label="P₁ before geometric scaling" value={spectral[0]}/><SignalSwatch label="P₁ at current light position" value={combined[0]}/><SignalSwatch label="P₂ before geometric scaling" value={spectral[1]}/><SignalSwatch label="P₂ at current light position" value={combined[1]}/></div>
          <div className="invariant-panel">
            <p className="formula-large">I′<sub>c,p</sub> = g<sub>p</sub>I<sub>c,p</sub> &nbsp;⇒&nbsp; I′<sub>R,p</sub>/I′<sub>G,p</sub> = I<sub>R,p</sub>/I<sub>G,p</sub></p>
            <EqualityReadout label="P₁: R / G" before={safeRatio(spectral[0][0],spectral[0][1])} after={safeRatio(combined[0][0],combined[0][1])}/><EqualityReadout label="P₁: R / B" before={safeRatio(spectral[0][0],spectral[0][2])} after={safeRatio(combined[0][0],combined[0][2])}/><EqualityReadout label="P₂: G / B" before={safeRatio(spectral[1][1],spectral[1][2])} after={safeRatio(combined[1][1],combined[1][2])}/>
          </div>
        </div>
        <p className="case-explanation">Dragging the light changes distance and incidence, so each plate receives a different g<sub>p</sub>. Within one plate that same factor scales every available channel, leaving measurable channel ratios unchanged.</p>
      </section>

      <section className="demo-section alternate">
        <header className="section-heading compact"><p>Case 3</p><h2>Combined change: use a cross-ratio</h2></header>
        <div className="change-case-layout">
          <div className="swatch-pairs"><SignalSwatch label="P₁ reflectance" value={materials[0]}/><SignalSwatch label="P₁ spectral + geometric" value={combined[0]}/><SignalSwatch label="P₂ reflectance" value={materials[1]}/><SignalSwatch label="P₂ spectral + geometric" value={combined[1]}/></div>
          <div className="invariant-panel cross-ratio-panel"><p className="formula-large">(R₁G₂)/(R₂G₁)</p><EqualityReadout label="cross-ratio" before={baseCrossRatio} after={changedCrossRatio}/><p>Both channel energies and both geometric factors occur once above and once below the fraction bar. They cancel only when all four required measurements are available and nonzero.</p></div>
        </div>
        <div className="explanation-grid three">
          <ModelBlock title="Zero-energy failure" tone="red"><p>With an ideal blue-only source, the red and green measurements are exactly zero. A green plate and a white plate may therefore be indistinguishable in the unavailable bands; the corresponding ratio invariant cannot be evaluated.</p></ModelBlock>
          <ModelBlock title="How common is that?" tone="green"><p>Exact single-band illumination is extremely rare in ordinary scenes. Daylight and most lamps are broadband. Lasers, narrowband LEDs, or strong color filters are deliberate exceptions, and weak channels can still be noise-sensitive.</p></ModelBlock>
          <ModelBlock title="From RGB to spectra"><p>This demo compresses illumination and reflectance into three RGB bands. Real image formation integrates the continuous product E(λ)ρ(λ)H<sub>c</sub>(λ) over wavelength for each sensor response H<sub>c</sub>.</p></ModelBlock>
        </div>
      </section>
    </DemoChrome>
  );
}
