import Link from "next/link";

const colorDemos = [
  {
    number: "C01",
    title: "RGB, HSV, and HSL conversions",
    description: "Linked controls, simultaneous 3D color solids, and image-pixel point clouds in all three coordinate systems.",
    href: "/demos/color-spaces",
    tags: ["3D", "image upload", "conversion"],
  },
  {
    number: "C02",
    title: "Human S, M, and L cone responses",
    description: "A monochromatic probe and a drawable spectrum with response integrals, brightness scaling, and display rendering.",
    href: "/demos/cones",
    tags: ["spectrum", "integration", "drawing"],
  },
  {
    number: "C03",
    title: "Pseudo-gamut and primary mapping",
    description: "Drag or permute labeled primaries and compare direct channel-to-primary rendering with color-managed gamut fitting.",
    href: "/demos/pseudo-gamut",
    tags: ["chromaticity", "image upload", "mapping"],
  },
  {
    number: "C04",
    title: "Color constancy",
    description: "Change the light on a chart of surfaces, recover their colours with gray world, white patch, a chosen neutral, or a known light, correct your own photographs, and revisit the dress.",
    href: "/demos/constancy",
    tags: ["illuminant", "white balance", "image upload"],
  },
  {
    number: "C05",
    title: "Spectral and geometric changes",
    description: "Drag a colored light over two reflective plates and test spatial ratios, channel ratios, cross-ratios, and missing-band failures.",
    href: "/demos/spectral-geometry",
    tags: ["2D", "invariants", "illumination"],
  },
];

const textureDemos = [
  {
    number: "T01",
    title: "Texture characteristics",
    description: "Measure orientedness, coarseness and regularity from the power spectrum and the autocorrelation, and test the measures by rotating, magnifying and adding noise.",
    href: "/demos/characteristics",
    tags: ["autocorrelation", "spectrum", "image upload"],
  },
  {
    number: "T02",
    title: "Sinusoids and the Fourier domain",
    description: "Link spatial frequency and orientation to Fourier peaks, inspect DC removal and noise, transform supplied or uploaded RGB images, and integrate power over rings and wedges.",
    href: "/demos/fourier",
    tags: ["FFT", "ring and wedge", "image upload"],
  },
  {
    number: "T03",
    title: "Gray-level co-occurrence matrices",
    description: "Drag up to three displacement vectors on the texture, follow a pixel pair into its matrix cell, compare with the histogram, and calculate normalized GLCM features.",
    href: "/demos/cooccurrence",
    tags: ["GLCM", "histogram", "Haralick"],
  },
  {
    number: "T04",
    title: "Laws texture energy",
    description: "Build masks from level, edge, spot, wave and ripple vectors, map local energy, and compare energy signatures across textures.",
    href: "/demos/laws",
    tags: ["filter bank", "energy", "classification"],
  },
  {
    number: "T05",
    title: "Gabor filters",
    description: "Shape a Gabor filter in space and frequency, map its local response on a texture, and cover the Fourier plane with an energy-measuring filter bank.",
    href: "/demos/gabor",
    tags: ["uncertainty", "filter bank", "image upload"],
  },
  {
    number: "T06",
    title: "Eigenfilters for texture inspection",
    description: "Learn filters by PCA of sparse-mask samples from a defect-free region, then flag synthetic defects whose filter energies leave the normal range.",
    href: "/demos/eigenfilters",
    tags: ["PCA", "inspection", "synthetic defects"],
  },
];

function DemoList({ demos, label }: { demos: typeof colorDemos; label: string }) {
  return <section className="demo-card-list" aria-label={label}>
    {demos.map((demo) => (
      <Link className="demo-card" href={demo.href} key={demo.number}>
        <span className="demo-card-number">{demo.number}</span>
        <div><p>Interactive demonstration</p><h2>{demo.title}</h2><span>{demo.description}</span><ul>{demo.tags.map((tag)=><li key={tag}>{tag}</li>)}</ul></div>
        <strong aria-hidden="true">→</strong>
      </Link>
    ))}
  </section>;
}

export default function Home() {
  return (
    <main className="demo-index">
      <header className="index-header">
        <div className="course-mark">IACV</div>
        <div><p>Image Analysis and Computer Vision · ETH Zürich · HS 2026</p><span>Lecture 04 · interactive demonstrations</span></div>
      </header>

      <section className="demo-index-intro">
        <div><p className="overline">Color and texture</p><h1>Interactive laboratory</h1></div>
        <div><p>Eleven focused tools support Lecture 4. Open either subject menu, then choose a demonstration. Every page states its model and conventions before exposing the controls.</p><span>No account or server upload is required. Images remain in the browser.</span><span>Created by Güney Tombak as an interactive learning aid for students of the course. These pages accompany the lecture slides, which remain the primary reference; they are not an official ETH Zürich website. If something here looks wrong, please tell the instructor.</span></div>
      </section>

      <div className="demo-dropdowns">
        <details className="demo-dropdown" open>
          <summary><span>01</span><div><strong>Color</strong><small>Five demonstrations · representation, perception, gamut, constancy, and illumination</small></div><b aria-hidden="true">+</b></summary>
          <DemoList demos={colorDemos} label="Color demonstrations" />
        </details>
        <details className="demo-dropdown texture-menu" open>
          <summary><span>02</span><div><strong>Texture</strong><small>Six demonstrations · characteristics, Fourier features, co-occurrence, Laws energy, Gabor filters, and eigenfilters</small></div><b aria-hidden="true">+</b></summary>
          <DemoList demos={textureDemos} label="Texture demonstrations" />
        </details>
      </div>

      <footer className="index-footer"><span>Created by Güney Tombak</span><span>Interactive learning aid · Lecture 04: Color and Texture · not an official ETH Zürich website</span></footer>
    </main>
  );
}
