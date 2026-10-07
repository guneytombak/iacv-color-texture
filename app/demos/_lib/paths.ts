// Static files under public/ are served below the base path on GitHub Pages (e.g. /iacv-color-texture/).
// next/link adds that prefix to page links automatically; plain URLs used in code must add it here.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefixes an absolute public path such as "/textures/wicker.png" with the base path. */
export function withBasePath(path: string) {
  return `${BASE_PATH}${path}`;
}
