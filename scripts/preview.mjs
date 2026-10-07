// Serves the static export in out/ the way GitHub Pages does, below the base path.
//   NEXT_PUBLIC_BASE_PATH=/iacv-color-texture npm run build
//   NEXT_PUBLIC_BASE_PATH=/iacv-color-texture npm run preview   →  http://localhost:4173/iacv-color-texture/
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = join(process.cwd(), "out");
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "localhost";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

if (!existsSync(root)) {
  console.error("out/ not found: run `npm run build` first.");
  process.exit(1);
}

function send(response, status, file) {
  response.writeHead(status, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith(`${base}/`) && pathname !== base) return send(response, 404, join(root, "404.html"));
  // Resolve, then make sure the file stays inside out/ (file names may legitimately contain "..").
  let file = resolve(root, `.${normalize(pathname.slice(base.length) || "/")}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) return send(response, 404, join(root, "404.html"));
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!pathname.endsWith("/")) {
      response.writeHead(301, { location: `${pathname}/${url.search}` });
      return response.end();
    }
    file = join(file, "index.html");
  }
  if (!existsSync(file)) return send(response, 404, join(root, "404.html"));
  send(response, 200, file);
}).listen(port, host, () => console.log(`Serving out/ at http://${host}:${port}${base}/`));
