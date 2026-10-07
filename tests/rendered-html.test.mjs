import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import test from "node:test";

// Tests read the static export in out/ (built by `npm test`). With NEXT_PUBLIC_BASE_PATH set, as in the
// GitHub Pages workflow, every internal link and asset must carry that prefix.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const page = (slug) => `${BASE}/demos/${slug}/`;

async function render(pathname = "/") {
  const file = new URL(`../out${pathname === "/" ? "/index.html" : `${pathname.replace(/\/$/, "")}/index.html`}`, import.meta.url);
  return readFile(file, "utf8");
}

test("exports the grouped color-and-texture index with attribution", async () => {
  const html = await render();
  assert.match(html, /<title>Color and Texture Demonstrations — IACV Lecture 4<\/title>/i);
  assert.match(html, /Eleven focused tools/);
  assert.match(html, /HS 2026/);
  assert.match(html, /Güney Tombak/);
  assert.match(html, /not an official ETH Zürich website/);
  assert.match(html, /<summary><span>01<\/span>.*Color/s);
  assert.match(html, /<summary><span>02<\/span>.*Texture/s);
  for (const slug of ["color-spaces", "cones", "pseudo-gamut", "constancy", "spectral-geometry"]) assert.ok(html.includes(`href="${page(slug)}"`), slug);
  assert.ok(html.indexOf(`href="${page("constancy")}"`) < html.indexOf(`href="${page("spectral-geometry")}"`), "constancy precedes illumination invariants, as in the lecture");
  // Texture demonstrations are listed in lecture order.
  const order = ["characteristics", "fourier", "cooccurrence", "laws", "gabor", "eigenfilters"].map((slug) => html.indexOf(`href="${page(slug)}"`));
  assert.ok(order.every((index) => index >= 0), "all texture links present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(html, /session-1/);
});

test("every exported page keeps links and assets under the base path", async () => {
  const pages = ["/", ...["color-spaces", "cones", "pseudo-gamut", "constancy", "spectral-geometry", "characteristics", "fourier", "cooccurrence", "laws", "gabor", "eigenfilters"].map((slug) => `/demos/${slug}/`)];
  for (const pathname of pages) {
    const html = await render(pathname);
    for (const [, url] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      assert.ok(BASE === "" || url.startsWith(`${BASE}/`), `${pathname}: ${url} lacks the base path`);
    }
    assert.match(html, /Güney Tombak/, `${pathname}: attribution`);
  }
  assert.equal(existsSync(new URL("../out/session-1/index.html", import.meta.url)), false, "session-1 is not published");
});

test("texture paths used in code exist in public/", async () => {
  const { readdir } = await import("node:fs/promises");
  const directories = await readdir(new URL("../app/demos/", import.meta.url));
  for (const directory of directories) {
    const file = new URL(`../app/demos/${directory}/page.tsx`, import.meta.url);
    if (!existsSync(file)) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /[^(]"\/textures\//, `${directory}: texture path not wrapped in withBasePath`);
    for (const [, path] of source.matchAll(/withBasePath\("(\/textures\/[^"]+)"\)/g)) {
      assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), `${directory}: ${path} missing`);
    }
  }
});

test("keeps the requested scientific models explicit in source", async () => {
  const [color, colorSpaces, cones, gamut, geometry, viewer, fourier, cooccurrence, glcm] = await Promise.all([
    readFile(new URL("../app/demos/_lib/color.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/color-spaces/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/cones/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/pseudo-gamut/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/spectral-geometry/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/_components/ThreeViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/fourier/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/cooccurrence/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/demos/_lib/glcm.ts", import.meta.url), "utf8"),
  ]);

  assert.match(color, /10\.25039\/CIE\.DS\.mifmy4x4/);
  assert.match(color, /export const CIE1931_LOCUS/);
  assert.match(colorSpaces, /useState\(0\.1\)/);
  assert.match(cones, /max="1\.5"/);
  assert.match(cones, /threshold \/ clipping at 1/);
  assert.match(gamut, /CIE1931_LOCUS/);
  assert.match(gamut, /primaryModel/);
  assert.match(gamut, /Swap R and G/);
  assert.match(geometry, /cross-ratio/);
  assert.match(geometry, /I<sub>c,p<\/sub> = E<sub>c<\/sub>ρ<sub>c,p<\/sub>g<sub>p<\/sub>/);
  assert.match(geometry, /moveLight/);
  assert.match(geometry, /Blue light · green \+ white/);
  assert.match(viewer, /scene\.background = new THREE\.Color\(0x050505\)/);
  assert.match(viewer, /pointSize/);
  assert.match(fourier, /e\^{-2 pi i kn\/N}/);
  assert.match(fourier, /value - referenceMean/);
  assert.match(fourier, /channels\.map/);
  assert.match(fourier, /Uniform noise amplitude/);
  const ringWedge = await readFile(new URL("../app/demos/fourier/RingWedge.tsx", import.meta.url), "utf8");
  assert.match(ringWedge, /ringFraction\(current, inner, outer\)/);
  assert.match(ringWedge, /wedgeFraction\(current, start, end\)/);
  assert.match(glcm, /probability \* Math\.log2\(probability\)/);
  assert.match(glcm, /\(i - j\) \*\* 2 \* probability/);
  assert.match(glcm, /probability \/ \(1 \+ Math\.abs\(i - j\)\)/);
  assert.match(cooccurrence, /setWeightAngle\(Number/);
  assert.match(cooccurrence, /VECTOR_COLORS/);
  // Displacement vectors are edited by pointer and keyboard on the image, not by number fields.
  assert.match(cooccurrence, /onPointerDown=\{handlePointerDown\}/);
  assert.match(cooccurrence, /setPointerCapture/);
  assert.match(cooccurrence, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(cooccurrence, /type="number"/);
});

test("exports all six texture laboratories and the colour constancy page", async () => {
  for (const slug of ["characteristics", "fourier", "cooccurrence", "laws", "gabor", "eigenfilters"]) {
    assert.match(await render(`/demos/${slug}/`), /Texture|Fourier|co-occurrence|Gabor|Laws|Eigenfilter/i, slug);
  }
  assert.match(await render("/demos/constancy/"), /Color constancy/);
});
