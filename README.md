# IACV Color and Texture — interactive demonstrations

Interactive demonstrations for students of **Image Analysis and Computer Vision** (ETH Zürich, HS 2026),
Lecture 4: *Color and Texture*. Created by **Güney Tombak** as a learning aid. The lecture slides remain the
primary reference; this is not an official ETH Zürich website.

**Live site:** https://guneytombak.github.io/iacv-color-texture/

## Demonstrations

| | Color | | Texture |
|---|---|---|---|
| C01 | RGB, HSV and HSL conversions | T01 | Texture characteristics |
| C02 | Human S, M and L cone responses | T02 | Sinusoids, the Fourier domain, ring and wedge features |
| C03 | Pseudo-gamut and primary mapping | T03 | Gray-level co-occurrence matrices |
| C04 | Color constancy | T04 | Laws texture energy |
| C05 | Spectral and geometric changes | T05 | Gabor filters |
| | | T06 | Eigenfilters for texture inspection |

All image processing runs in the browser; uploaded images never leave the computer.

## Development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev        # development server at http://localhost:3000
npm test           # static export to out/ and all tests
npm run lint
npm run typecheck
```

To check the site exactly as GitHub Pages serves it, below the repository path:

```bash
NEXT_PUBLIC_BASE_PATH=/iacv-color-texture npm run build
NEXT_PUBLIC_BASE_PATH=/iacv-color-texture npm run preview   # http://localhost:4173/iacv-color-texture/
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which lints, type-checks, builds the static
export with the repository name as base path, runs the tests, and publishes `out/` to GitHub Pages
(repository settings → Pages → Source: *GitHub Actions*).

## License

Source code: MIT (see `LICENSE`). The images in `public/` are not covered by the license.
